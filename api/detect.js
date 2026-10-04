/**
 * POST /api/detect — SpaceSnap relay for STAGE 1 (zero-shot detection).
 *
 * Keeps HF_TOKEN server-side so public visitors get live inference without a
 * key. Primary detector is OWL-ViT, but HF removed zero-shot-object-detection
 * from the serverless `hf-inference` provider (that route now answers HTTP 400
 * "Model not supported by provider hf-inference", or 404) — so on those
 * statuses we fall back to zero-shot detection via the OpenAI-compatible chat
 * router, trying Qwen3-VL-8B → Llama-4-Scout-17B → Qwen2.5-VL-7B with the
 * image as a data-URL `image_url` and a prompt demanding ONLY a JSON array of
 * {label, score, box} with integer boxes normalized to a 0–1000 grid, which
 * the relay scales to the image's pixel dimensions before replying.
 *
 * Body:  { image: "<base64>", labels: string[], threshold?: number,
 *          mimeType?: "image/jpeg", width?: number, height?: number }
 * Reply: array of { label, score, box } (pixel coords), or { error, ... }
 * Header: X-SpaceSnap-Detector — which detector answered
 * Env:   HF_TOKEN (required), HF_ENDPOINT (optional), HF_CHAT_ENDPOINT (optional)
 */

import { clamp, rateLimit, readJson, sendJson, sleep } from './_shared.js';

const DEFAULT_ENDPOINT =
  'https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32';

const DEFAULT_CHAT_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';

/** Mirrors VLM_MODEL_CHAIN in src/lib/huggingface.js — keep in sync. */
const VLM_MODEL_CHAIN = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  'Qwen/Qwen2.5-VL-7B-Instruct',
];

const MAX_IMAGE_B64 = 6_000_000; // ~4.5 MB decoded — plenty for a 1024px JPEG
const MAX_WARM_WAIT_S = 8; // hold the connection only for short warm-ups
const MAX_DIM = 20_000;

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
  const mimeType = typeof body.mimeType === 'string' && /^image\//.test(body.mimeType)
    ? body.mimeType
    : 'image/jpeg';
  const width = clamp(Number(body.width) || 0, 0, MAX_DIM) || null;
  const height = clamp(Number(body.height) || 0, 0, MAX_DIM) || null;

  const endpoint = process.env.HF_ENDPOINT?.trim() || DEFAULT_ENDPOINT;

  // ── OWL-ViT first (two known payload shapes; short internal warm wait) ──
  const shapes = [
    { inputs: { image }, parameters: { candidate_labels: labels, threshold } },
    { inputs: image, parameters: { candidate_labels: labels, threshold } },
  ];

  let lastStatus = 502;
  let lastBody = { error: 'upstream_unreachable' };
  let owlvitRetired = false; // 400 "not supported" / 404 / 410 → chat fallback

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

      if (attempt.status === 200 && Array.isArray(attempt.body)) {
        res.setHeader('X-SpaceSnap-Detector', 'OWL-ViT');
        console.info('[spacesnap] Stage 1 detector: OWL-ViT (google/owlvit-base-patch32)');
        return sendJson(res, 200, attempt.body); // ✅
      }
      if (attempt.status === 503) break; // still warming → relay to client
      if (attempt.status === 401 || attempt.status === 403) break; // fatal
      if (attempt.status === 400 || attempt.status === 404 || attempt.status === 410) {
        owlvitRetired = true;
        break;
      }
      // else (422/etc.) → try next payload shape
    }
  } catch (e) {
    return sendJson(res, 502, { error: `hf_fetch_failed: ${e.message}` });
  }

  // ── OWL-ViT retired by the provider → zero-shot chat detection ──
  if (owlvitRetired) {
    console.info(
      '[spacesnap] OWL-ViT rejected by hf-inference; falling back to zero-shot chat detection.'
    );
    try {
      const result = await detectWithChatModels({
        token,
        image,
        mimeType,
        labels,
        threshold,
        width,
        height,
      });
      res.setHeader('X-SpaceSnap-Detector', result.model);
      console.info(`[spacesnap] Stage 1 detector: ${result.model} (zero-shot chat)`);
      return sendJson(res, 200, result.detections);
    } catch (e) {
      return sendJson(res, 502, { error: `all_detectors_failed: ${e.message}` });
    }
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

/**
 * Mirror of detectWithChatModels() in src/lib/huggingface.js: image as a
 * data-URL `image_url`, prompt asks for ONLY a JSON array of detections with
 * integer boxes on a 0–1000 grid, then scaled to the image's pixel size.
 */
async function detectWithChatModels({ token, image, mimeType, labels, threshold, width, height }) {
  const endpoint = process.env.HF_CHAT_ENDPOINT?.trim() || DEFAULT_CHAT_ENDPOINT;
  const imageUrl = /^data:/i.test(image) ? image : `data:${mimeType};base64,${image}`;
  const prompt = buildDetectionPrompt(labels, threshold);
  const failures = [];

  for (const model of VLM_MODEL_CHAIN) {
    let r;
    try {
      r = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens: 1024,
          temperature: 0.1,
        }),
      });
    } catch (e) {
      failures.push(`${model}: network error (${e.message})`);
      continue;
    }

    const data = await r.json().catch(() => null);
    if (!r.ok) {
      // Same token as OWL-ViT — surface bad-key errors straight away.
      if (r.status === 401 || r.status === 403) {
        throw new Error(
          `Hugging Face rejected the token (HTTP ${r.status}) — needs the "Inference Providers" permission.`
        );
      }
      failures.push(`${model}: HTTP ${r.status}${data?.error ? `: ${data.error}` : ''}`);
      continue;
    }

    const parsed = parseDetectionsJSON(chatText(data));
    if (!parsed) {
      failures.push(`${model}: unparseable response`);
      continue;
    }

    return { model, detections: normalizeChatDetections(parsed, width, height) };
  }

  throw new Error(`every vision-language fallback failed — ${failures.join(' | ')}`);
}

/** Prompt: ONLY a JSON array, integer boxes on a 0–1000 grid. */
function buildDetectionPrompt(labels, threshold) {
  return [
    'You are the zero-shot object detector for an Earth-observation pipeline.',
    `Candidate labels: ${labels.join(', ')}.`,
    `Find every feature in the image that matches one of those labels with confidence >= ${threshold}.`,
    'Reply with ONLY a JSON array — no prose, no markdown, no code fences.',
    'Every element must have exactly this shape:',
    '{"label":"<one of the candidate labels>","score":<number 0-1>,"box":{"xmin":<int>,"ymin":<int>,"xmax":<int>,"ymax":<int>}}',
    'Coordinates must be integers normalized to a 0-1000 grid relative to the image',
    '(0 = left/top edge, 1000 = right/bottom edge); (xmin,ymin) is the top-left corner of the box,',
    '(xmax,ymax) the bottom-right. If nothing matches, reply with [].',
  ].join(' ');
}

/** Pull assistant text out of an OpenAI-compatible chat completion. */
function chatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  return '';
}

/** Strip code fences / prose and JSON.parse the first [...] block. */
function parseDetectionsJSON(text) {
  if (!text) return null;
  const s = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

/**
 * Chat models answer on a 0–1000 normalized grid → scale to pixels. When the
 * client didn't send dimensions the coords pass through on a 1000-grid (the
 * client clamps them to its own width/height).
 */
function normalizeChatDetections(arr, width, height) {
  const W = Number(width) > 0 ? Number(width) : 1000;
  const H = Number(height) > 0 ? Number(height) : 1000;

  return arr
    .filter((d) => d && typeof d === 'object')
    .map((d) => {
      const raw = d.box || d.bbox || d.bounding_box;
      const b = Array.isArray(raw)
        ? { xmin: raw[0], ymin: raw[1], xmax: raw[2], ymax: raw[3] }
        : raw;
      if (!b) return null;
      return {
        label: String(d.label ?? d.name ?? 'feature'),
        score: normScore(d.score ?? d.confidence),
        box: {
          xmin: scale1000(b.xmin, W),
          ymin: scale1000(b.ymin, H),
          xmax: scale1000(b.xmax, W),
          ymax: scale1000(b.ymax, H),
        },
      };
    })
    .filter(Boolean)
    .filter((d) => d.box.xmax > d.box.xmin && d.box.ymax > d.box.ymin);
}

const scale1000 = (v, size) => clamp((Number(v) / 1000) * size, 0, size);

function normScore(v) {
  let s = Number(v);
  if (!Number.isFinite(s) || s < 0) return 0;
  if (s > 1) s /= 100; // a model answered 87 instead of 0.87
  return clamp(s, 0, 1);
}
