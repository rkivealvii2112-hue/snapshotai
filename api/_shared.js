/**
 * Shared helpers for the SpaceSnap relay functions (Vercel serverless).
 * `_`-prefixed files are NOT deployed as endpoints.
 */

/** Vercel auto-parses JSON bodies; handle the edge cases anyway. */
export async function readJson(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export function sendJson(res, status, obj) {
  res.status(status).json(obj);
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Best-effort IP rate limit (sliding window, in-memory per warm instance).
 * Good enough to blunt casual abuse on a hobby deployment; for hard limits
 * swap this for Vercel KV / Upstash (single round-trip implementation).
 */
const buckets = new Map();

export function rateLimit(req, scope, { limit = 12, windowMs = 60_000 } = {}) {
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear(); // cap memory growth
  return hits.length <= limit;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
