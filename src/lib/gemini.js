/**
 * STAGE 2 — Vision-Language explanation via the Gemini API (@google/generative-ai).
 *
 * Architecture requested by the brief: gemini-1.5-flash.
 * Note: Google retired the 1.5 Flash endpoints in Sept 2025, so we try the
 * requested model first and automatically fall back to its modern successors
 * (gemini-2.5-flash → gemini-2.0-flash), reporting which model answered.
 * Pin a specific one with VITE_GEMINI_MODEL.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL_CHAIN = [
  ...(import.meta.env.VITE_GEMINI_MODEL ? [import.meta.env.VITE_GEMINI_MODEL.trim()] : []),
  'gemini-1.5-flash', // requested by the brief (retired → falls through)
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

export async function explainScene({
  apiKey,
  base64,
  mimeType = 'image/jpeg',
  detections = [],
}) {
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
      if (text) return { text, model };
    } catch (e) {
      lastErr = e; // model retired / quota / bad key → try the next one
    }
  }

  throw new Error(
    `All Gemini models failed (${chain.join(' → ')}). Last error: ${lastErr?.message || 'unknown'}`
  );
}
