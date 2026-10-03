/**
 * POST /api/explain — SpaceSnap relay for STAGE 2 (Gemini vision-language
 * explanation). Keeps GEMINI_API_KEY server-side. Uses Gemini's plain REST
 * endpoint (no SDK needed in the serverless sandbox).
 *
 * Body:  { image: "<base64>", mimeType?: "image/jpeg", detections?: [{label, score}] }
 * Reply: { text: string, model: string }  |  { error: string }
 * Env:   GEMINI_API_KEY (required), GEMINI_MODEL (optional, first in chain)
 */

import { rateLimit, readJson, sendJson } from './_shared.js';

const MAX_IMAGE_B64 = 6_000_000;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MODEL_CHAIN = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL.trim()] : []),
  'gemini-1.5-flash', // requested architecture (retired Sept 2025 → falls through)
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimit(req, 'explain', { limit: 12, windowMs: 60_000 }))
    return sendJson(res, 429, { error: 'rate_limited', retryAfter: 30 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return sendJson(res, 501, {
      error: 'not_configured',
      message: 'Deployment has no GEMINI_API_KEY secret — client will fall back to template mode.',
    });

  // ── validate + sanitise input ─────────────────────────────────────
  const body = await readJson(req);
  const { image } = body;
  if (typeof image !== 'string' || image.length < 100)
    return sendJson(res, 400, { error: 'invalid_image' });
  if (image.length > MAX_IMAGE_B64) return sendJson(res, 413, { error: 'image_too_large' });

  const mimeType = ALLOWED_MIME.has(body.mimeType) ? body.mimeType : 'image/jpeg';
  const detections = Array.isArray(body.detections)
    ? body.detections
        .filter((d) => d && typeof d.label === 'string')
        .slice(0, 10)
        .map((d) => ({ label: d.label.slice(0, 60), score: Number(d.score) || 0 }))
    : [];

  const found = detections.length
    ? detections.map((d) => `${d.label} (${(d.score * 100).toFixed(0)}% confidence)`).join(', ')
    : 'no labeled features';

  const prompt = [
    'You are an Earth-observation scientist narrating a public mission dashboard.',
    `A zero-shot object detector scanned this aerial / satellite image and reported: ${found}.`,
    'Write ONE plain-English sentence (max 30 words) explaining the meteorological or',
    'geographical event or feature visible. No jargon. Do not mention AI, bounding boxes,',
    'or the fact that this is an image.',
  ].join(' ');

  // ── try the model chain (retired models 404 fast, then fall through) ──
  const chain = [...new Set(MODEL_CHAIN)];
  let lastErr = 'unknown';

  for (const model of chain) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: prompt }],
              },
            ],
            generationConfig: { maxOutputTokens: 120, temperature: 0.6 },
          }),
        }
      );
      const j = await r.json().catch(() => null);
      if (r.ok) {
        const text = (j?.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .join('')
          .trim()
          .replace(/\s+/g, ' ');
        if (text) return sendJson(res, 200, { text, model });
        lastErr = 'empty_response';
      } else {
        lastErr = j?.error?.message || `http_${r.status}`;
      }
    } catch (e) {
      lastErr = e.message; // network issue → try next model anyway
    }
  }

  return sendJson(res, 502, { error: `all_models_failed (${chain.join(' → ')}): ${lastErr}` });
}
