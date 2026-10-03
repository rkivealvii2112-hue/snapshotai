/**
 * STAGE 1 — Zero-Shot Object Detection via the Hugging Face Inference API.
 *
 * Model: google/owlvit-base-patch32 (OWL-ViT)
 * Endpoint (Inference Providers router):
 *   POST https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32
 *   Authorization: Bearer <HF_TOKEN>
 *
 * Response (on success):
 *   [{ "label": "storm system", "score": 0.87,
 *      "box": { "xmin": 12, "ymin": 34, "xmax": 210, "ymax": 180 } }, ...]
 *
 * The zero-shot-object-detection schema has shifted slightly across gateway
 * generations, so we try a small chain of known payload shapes and retry
 * through model "cold start" (503 + estimated_time). Override the endpoint
 * with VITE_HF_ENDPOINT if HF moves it again.
 */

const DEFAULT_ENDPOINT =
  'https://router.huggingface.co/hf-inference/models/google/owlvit-base-patch32';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function detectFeatures({ token, base64, labels, threshold = 0.1, width, height }) {
  const endpoint = import.meta.env.VITE_HF_ENDPOINT?.trim() || DEFAULT_ENDPOINT;

  // Payload variants, most modern first.
  const bodies = [
    { inputs: { image: base64 }, parameters: { candidate_labels: labels, threshold } },
    { inputs: { image: base64 }, parameters: { candidate_labels: labels } },
    { inputs: base64, parameters: { candidate_labels: labels, threshold } },
    { inputs: base64, parameters: { candidate_labels: labels } },
  ];

  let lastErr = null;

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
        return normalizeDetections(data, width, height);
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
      if (res.status === 404 || res.status === 410) {
        throw new Error(
          `Model endpoint unavailable (HTTP ${res.status}) at ${endpoint}. Override with VITE_HF_ENDPOINT (see .env.example).`
        );
      }

      // Anything else (400/422 schema mismatch, 429 rate limit, 5xx) → try next shape.
      lastErr = new Error(
        `HTTP ${res.status}${data?.error ? `: ${data.error}` : res.statusText ? ` ${res.statusText}` : ''}`
      );
      break;
    }
  }

  throw lastErr || new Error('Hugging Face inference failed.');
}

function normalizeDetections(arr, width, height) {
  return arr
    .filter((d) => d && d.box)
    .map((d) => ({
      label: String(d.label ?? 'feature'),
      score: Number(d.score ?? 0),
      box: {
        xmin: clamp(d.box.xmin, 0, width),
        ymin: clamp(d.box.ymin, 0, height),
        xmax: clamp(d.box.xmax, 0, width),
        ymax: clamp(d.box.ymax, 0, height),
      },
    }))
    .filter((d) => d.box.xmax > d.box.xmin && d.box.ymax > d.box.ymin);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
