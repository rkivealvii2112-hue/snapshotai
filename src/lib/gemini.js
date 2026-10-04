/**
 * STAGE 2 — Vision-Language explanation via the Gemini API (@google/generative-ai).
 *
 * Architecture requested by the brief: gemini-1.5-flash. Google has since
 * retired both 1.5 Flash and 2.0 Flash — the API answers with a 404 telling you
 * to use `gemini-3.8-flash`. So we walk a model chain, first success wins, and
 * we always report which model actually answered:
 *
 *   VITE_GEMINI_MODEL (env override) → gemini-1.5-flash → gemini-3.8-flash
 *   → gemini-2.5-flash → gemini-2.0-flash
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export const MODEL_CHAIN = [
  ...(import.meta.env.VITE_GEMINI_MODEL ? [import.meta.env.VITE_GEMINI_MODEL.trim()] : []),
  'gemini-1.5-flash', // requested by the brief (retired → falls through)
  'gemini-3.8-flash', // successor named by Google's own retirement error
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export async function explainScene({
  apiKey,
  base64,
  mimeType = 'image/jpeg',
  detections = [],
}) {
  // No user key → route through the SpaceSnap relay (/api/explain).
  if (!apiKey) {
    return explainViaRelay({ base64, mimeType, detections });
  }

  const genAI = new GoogleGenerativeAI(apiKey);

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

  const chain = [...new Set(MODEL_CHAIN)];
  let lastErr = null;

  for (const model of chain) {
    try {
      const m = genAI.getGenerativeModel({ model });
      const result = await m.generateContent([
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ]);
      const text = result?.response?.text()?.trim().replace(/\s+/g, ' ');
      if (text) {
        console.info(`[SpaceSnap] Stage 2 model: ${model}`);
        return { text, model };
      }
      lastErr = new Error(`${model}: empty response`);
    } catch (e) {
      lastErr = e; // model retired / quota / bad key → try the next one
      console.info(`[SpaceSnap] Stage 2 model ${model} failed (${e.message}) — next in chain.`);
    }
  }

  throw new Error(
    `All Gemini models failed (${chain.join(' → ')}). Last error: ${lastErr?.message || 'unknown'}`
  );
}

/** Relay path: POST /api/explain (see api/explain.js). */
async function explainViaRelay({ base64, mimeType, detections }) {
  let res;
  try {
    res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mimeType, detections }),
    });
  } catch (netErr) {
    throw new Error(`Network error reaching the SpaceSnap relay (${netErr.message}).`);
  }

  const data = await res.json().catch(() => null);

  if (res.ok && data?.text) {
    if (data.model) console.info(`[SpaceSnap] Stage 2 model: ${data.model} (relay)`);
    return { text: data.text, model: `${data.model} · relay` };
  }
  if (res.status === 404 || res.status === 501) {
    const err = new Error(data?.message || 'SpaceSnap relay unavailable.');
    err.code = 'relay_unavailable';
    throw err;
  }
  if (res.status === 429) {
    throw new Error('SpaceSnap relay is rate-limited — wait ~30s and try again.');
  }
  throw new Error(`Relay HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}`);
}
