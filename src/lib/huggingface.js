/**
 * STAGE 1 — Zero-Shot Object Detection via the Hugging Face Inference API.
 *
 * Primary detector — OWL-ViT:
 *   POST https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32
 *   Authorization: Bearer <HF_TOKEN>
 *   Response: [{ "label": "storm system", "score": 0.87,
 *                "box": { "xmin": 12, "ymin": 34, "xmax": 210, "ymax": 180 } }, ...]
 *
 * ⚠ HF removed zero-shot-object-detection from the serverless `hf-inference`
 * provider: that route now answers HTTP 400 "Model not supported by provider
 * hf-inference" (or 404). When that happens we don't give up — we fall back to
 * zero-shot detection through the OpenAI-compatible chat router:
 *   POST https://router.huggingface.co/v1/chat/completions   (same Bearer token)
 * trying vision-language models in order:
 *   Qwen/Qwen3-VL-8B-Instruct → meta-llama/Llama-4-Scout-17B-16E-Instruct →
 *   Qwen/Qwen2.5-VL-7B-Instruct
 * The image is sent as a data-URL `image_url`; the prompt asks for ONLY a JSON
 * array [{label, score, box:{xmin,ymin,xmax,ymax}}] with integer coordinates
 * normalized to a 0–1000 grid, which we then scale by the image's width/height.
 *
 * The zero-shot-object-detection schema has shifted across gateway
 * generations, so we still try a small chain of known payload shapes and
 * retry through model "cold start" (503 + estimated_time). Override endpoints
 * with VITE_HF_ENDPOINT / VITE_HF_CHAT_ENDPOINT if HF moves them again.
 */

const DEFAULT_ENDPOINT =
  'https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32';

const DEFAULT_CHAT_ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';

/** Vision-language models used for zero-shot chat detection, best first. */
export const VLM_MODEL_CHAIN = [
  'Qwen/Qwen3-VL-8B-Instruct',
  'meta-llama/Llama-4-Scout-17B-16E-Instruct',
  'Qwen/Qwen2.5-VL-7B-Instruct',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function detectFeatures({
  token,
  base64,
  mimeType = 'image/jpeg',
  labels,
  threshold = 0.1,
  width,
  height,
}) {
  // No user key → route through the SpaceSnap relay (/api/detect), which holds
  // the token server-side. Falls back with code 'relay_unavailable' on static
  // hosts (GitHub Pages etc.) or when the deployment has no HF_TOKEN secret.
  if (!token) {
    return detectViaRelay({ base64, mimeType, labels, threshold, width, height });
  }

  const endpoint = import.meta.env.VITE_HF_ENDPOINT?.trim() || DEFAULT_ENDPOINT;

  // Payload variants, most modern first.
  const bodies = [
    { inputs: { image: base64 }, parameters: { candidate_labels: labels, threshold } },
    { inputs: { image: base64 }, parameters: { candidate_labels: labels } },
    { inputs: base64, parameters: { candidate_labels: labels, threshold } },
    { inputs: base64, parameters: { candidate_labels: labels } },
  ];

  let lastErr = null;
  let owlvitRetired = false; // 400 "Model not supported by provider hf-inference" / 404

  for (const body of bodies) {
    let warmRetries = 0;

    for (;;) {
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (netErr) {
        throw new Error(
          `Network error reaching Hugging Face (${netErr.message}). Check your connection / CORS.`
        );
      }

      let data = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON body (HTML error page etc.) */
      }

      // ✅ Success — an array of detections.
      if (res.ok && Array.isArray(data)) {
        logDetector('OWL-ViT (google/owlvit-base-patch32)');
        return withDetector(normalizeDetections(data, width, height), 'OWL-ViT');
      }

      // 🥶 Model is warming up — wait the suggested time and retry this body.
      const estimated = Number(data?.estimated_time);
      const isLoading =
        res.status === 503 ||
        (typeof data?.error === 'string' && data.error.toLowerCase().includes('loading'));
      if (isLoading && warmRetries < 4) {
        warmRetries += 1;
        await sleep(Math.min(estimated > 0 ? estimated : 12, 25) * 1000 + 250);
        continue;
      }

      // 🔑 Auth problems are fatal — no point trying other payload shapes.
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Hugging Face rejected the token (HTTP ${res.status}). Create one with the "Inference Providers" permission at hf.co/settings/tokens.`
        );
      }

      // 🪦 OWL-ViT is no longer served by hf-inference (400 "not supported" /
      // 404 / 410) — stop probing payload shapes and fall back to chat VLMs.
      if (res.status === 400 || res.status === 404 || res.status === 410) {
        owlvitRetired = true;
        lastErr = new Error(
          `OWL-ViT endpoint unavailable (HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}) at ${endpoint}.`
        );
        break;
      }

      // Anything else (422 schema mismatch, 429 rate limit, 5xx) → try next shape.
      lastErr = new Error(
        `HTTP ${res.status}${data?.error ? `: ${data.error}` : res.statusText ? ` ${res.statusText}` : ''}`
      );
      break;
    }

    if (owlvitRetired) break;
  }

  if (owlvitRetired) {
    console.info(
      '[SpaceSnap] Stage 1 — OWL-ViT rejected by hf-inference; falling back to zero-shot chat detection.'
    );
    return detectWithChatModels({ token, base64, mimeType, labels, threshold, width, height });
  }

  throw lastErr || new Error('Hugging Face inference failed.');
}

/**
 * Fallback detector — zero-shot detection through the OpenAI-compatible chat
 * router. Each VLM receives the data-URL image and a prompt demanding ONLY a
 * JSON array with 0–1000-normalized integer boxes; we scale those to pixels.
 */
async function detectWithChatModels({
  token,
  base64,
  mimeType,
  labels,
  threshold,
  width,
  height,
}) {
  const endpoint =
    import.meta.env.VITE_HF_CHAT_ENDPOINT?.trim() || DEFAULT_CHAT_ENDPOINT;
  const imageUrl = toDataUrl(base64, mimeType);
  const prompt = buildDetectionPrompt(labels, threshold);
  const failures = [];

  for (const model of VLM_MODEL_CHAIN) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
    } catch (netErr) {
      failures.push(`${model}: network error (${netErr.message})`);
      continue;
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      // Same token as OWL-ViT — a 401/403 means the key itself is bad.
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Hugging Face rejected the token (HTTP ${res.status}). Create one with the "Inference Providers" permission at hf.co/settings/tokens.`
        );
      }
      failures.push(
        `${model}: HTTP ${res.status}${data?.error ? `: ${data.error}` : ''}`
      );
      continue;
    }

    const text = chatText(data);
    const parsed = parseDetectionsJSON(text);
    if (!parsed) {
      failures.push(`${model}: unparseable response`);
      continue;
    }

    logDetector(`${model} (zero-shot chat)`);
    return withDetector(normalizeChatDetections(parsed, width, height), model);
  }

  throw new Error(
    `OWL-ViT is not served by hf-inference and every vision-language fallback failed — ${failures.join(' | ')}`
  );
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
 * Chat models answer on a 0–1000 normalized grid → scale to the image's
 * pixel space (same shape the OWL-ViT path returns). `box` arrays are
 * tolerated as [xmin, ymin, xmax, ymax] in case a model flattens it.
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

/**
 * Relay path: POST /api/detect (see api/detect.js). The relay returns the
 * same shapes as HF directly, so the warm-up retry loop mirrors the one above.
 */
async function detectViaRelay({ base64, mimeType, labels, threshold, width, height }) {
  for (let warm = 0; warm <= 4; warm++) {
    let res;
    try {
      res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          mimeType,
          labels,
          threshold,
          width,
          height,
        }),
      });
    } catch (netErr) {
      throw new Error(`Network error reaching the SpaceSnap relay (${netErr.message}).`);
    }

    const data = await res.json().catch(() => null);

    // ✅ Success — array of detections (relay already scaled them to pixels).
    if (res.ok && Array.isArray(data)) {
      const detector = res.headers?.get?.('x-spacesnap-detector') || null;
      if (detector) logDetector(`${detector} · relay`);
      const dets = normalizeDetections(data, width, height);
      return detector ? withDetector(dets, detector) : dets;
    }

    // Relay not deployed (static host) or deployment missing HF_TOKEN.
    if (res.status === 404 || res.status === 501) {
      const err = new Error(
        data?.message || 'SpaceSnap relay unavailable — no token and no proxy.'
      );
      err.code = 'relay_unavailable';
      throw err;
    }

    // Model warming upstream — wait HF's suggested time and retry.
    const estimated = Number(data?.estimated_time);
    const isLoading =
      res.status === 503 ||
      (typeof data?.error === 'string' && data.error.toLowerCase().includes('loading'));
    if (isLoading && warm < 4) {
      await sleep(Math.min(estimated > 0 ? estimated : 12, 25) * 1000 + 250);
      continue;
    }

    if (res.status === 429) {
      throw new Error('SpaceSnap relay is rate-limited — wait ~30s and try again.');
    }

    throw new Error(
      `Relay HTTP ${res.status}${data?.error ? `: ${data.error}` : res.statusText ? ` ${res.statusText}` : ''}`
    );
  }
  throw new Error('OWL-ViT is still warming up upstream — try again in a few seconds.');
}

function normalizeDetections(arr, width, height) {
  // Unknown dimensions → don't clamp (Infinity bound) instead of NaN-dropping boxes.
  const W = Number(width) > 0 ? Number(width) : Infinity;
  const H = Number(height) > 0 ? Number(height) : Infinity;

  return arr
    .filter((d) => d && d.box)
    .map((d) => ({
      label: String(d.label ?? 'feature'),
      score: Number(d.score ?? 0),
      box: {
        xmin: clamp(d.box.xmin, 0, W),
        ymin: clamp(d.box.ymin, 0, H),
        xmax: clamp(d.box.xmax, 0, W),
        ymax: clamp(d.box.ymax, 0, H),
      },
    }))
    .filter((d) => d.box.xmax > d.box.xmin && d.box.ymax > d.box.ymin);
}

const toDataUrl = (base64, mimeType) =>
  /^data:/i.test(base64) ? base64 : `data:${mimeType || 'image/jpeg'};base64,${base64}`;

/** Tag a detections array with the detector that answered (non-enumerable). */
function withDetector(arr, name) {
  Object.defineProperty(arr, 'detector', { value: name, enumerable: false });
  return arr;
}

function logDetector(name) {
  console.info(`[SpaceSnap] Stage 1 detector: ${name}`);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
