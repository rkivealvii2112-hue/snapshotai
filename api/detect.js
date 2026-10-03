/**
 * POST /api/detect — SpaceSnap relay for STAGE 1 (OWL-ViT zero-shot detection).
 *
 * Keeps HF_TOKEN server-side so public visitors get live inference without
 * a key. Relays HF's response shape (array of detections, or
 * { error, estimated_time } while the model warms up) so the client's
 * existing retry logic works unchanged.
 *
 * Body:  { image: "<base64>", labels: string[], threshold?: number }
 * Env:   HF_TOKEN (required), HF_ENDPOINT (optional override)
 */

import { clamp, rateLimit, readJson, sendJson, sleep } from './_shared.js';

const DEFAULT_ENDPOINT =
  'https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32';

const MAX_IMAGE_B64 = 6_000_000; // ~4.5 MB decoded — plenty for a 1024px JPEG
const MAX_WARM_WAIT_S = 8; // hold the connection only for short warm-ups

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimit(req, 'detect', { limit: 12, windowMs: 60_000 }))
    return sendJson(res, 429, { error: 'rate_limited', retryAfter: 30 });

  const token = process.env.HF_TOKEN;
  if (!token)
    return sendJson(res, 501, {
      error: 'not_configured',
      message: 'Deployment has no HF_TOKEN secret — client will fall back to demo mode.',
    });

  // ── validate + sanitise input ─────────────────────────────────────
  const body = await readJson(req);
  const { image } = body;
  if (typeof image !== 'string' || image.length < 100)
    return sendJson(res, 400, { error: 'invalid_image' });
  if (image.length > MAX_IMAGE_B64) return sendJson(res, 413, { error: 'image_too_large' });

  const labels = Array.isArray(body.labels)
    ? body.labels
        .filter((s) => typeof s === 'string')
        .map((s) => s.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 10)
    : [];
  if (!labels.length) return sendJson(res, 400, { error: 'invalid_labels' });

  const threshold = clamp(Number(body.threshold) || 0.1, 0.01, 0.95);
  const endpoint = process.env.HF_ENDPOINT?.trim() || DEFAULT_ENDPOINT;

  // ── call HF (two known payload shapes; short internal warm wait) ──
  const shapes = [
    { inputs: { image }, parameters: { candidate_labels: labels, threshold } },
    { inputs: image, parameters: { candidate_labels: labels, threshold } },
  ];

  let lastStatus = 502;
  let lastBody = { error: 'upstream_unreachable' };

  try {
    for (const payload of shapes) {
      let attempt = await callHF(endpoint, token, payload);

      // model warming + short ETA → wait once, retry once
      const est = Number(attempt.body?.estimated_time);
      if (attempt.status === 503 && est > 0 && est <= MAX_WARM_WAIT_S) {
        await sleep(est * 1000 + 250);
        attempt = await callHF(endpoint, token, payload);
      }

      lastStatus = attempt.status;
      lastBody = attempt.body;

      if (attempt.status === 200 && Array.isArray(attempt.body)) break; // ✅
      if (attempt.status === 503) break; // still warming → relay to client
      if (attempt.status === 401 || attempt.status === 403) break; // fatal
      // else (400/422/etc.) → try next payload shape
    }
  } catch (e) {
    return sendJson(res, 502, { error: `hf_fetch_failed: ${e.message}` });
  }

  return sendJson(res, lastStatus, lastBody);
}

async function callHF(endpoint, token, payload) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = { error: `non_json_response_${r.status}` };
  }
  return { status: r.status, body };
}
