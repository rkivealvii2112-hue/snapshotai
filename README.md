# 🛰️ SpaceSnap AI

> Point your camera at the planet. A **zero-shot detector** locks onto clouds, storms, fires & ice — then a **vision-language model** explains what you're seeing, drawn live on a glowing CRT-styled HUD.

Built for an AI/ML coding challenge with a **Two-Stage ML Pipeline**:

```
                 ┌──────────────────────────────────────────────────────┐
  JPG / PNG ───► │  STAGE 1 · google/owlvit-base-patch32 (OWL-ViT)      │  → bounding boxes
  (resized to    │  Zero-Shot Detection · HF Inference API              │    { label, score, box }
   ≤1024 px) ──► │  ↳ fallback: zero-shot chat VLM on HF (Qwen3-VL /    │
                 │    Llama-4-Scout / Qwen2.5-VL) if HF retired OWL-ViT │
                 └──────────────────────────────────────────────────────┘
                 ┌──────────────────────────────────────────────────────┐
                 │  STAGE 2 · Gemini Flash chain (Google Gemini API)    │  → 1-sentence plain-
                 │  1.5 → 3.8 → 2.5 → 2.0 · vision + detections         │    English readout
                 └──────────────────────────────────────────────────────┘
```

The UI is a gamified, Codedex-flavoured React app: landing screen → **warp-speed starfield transition** (Framer Motion + custom canvas physics) → mission dashboard with drag-and-drop upload, an HTML5 `<canvas>` that paints neon bounding boxes over the feed, and a terminal-style "MISSION LOG" that narrates the pipeline, typewriter-typing Gemini's explanation.

---

## 🚀 Quickstart

Requires **Node.js ≥ 18**.

```bash
# 1 · clone & enter the project
git clone <your-repo-url> spacesnap-ai && cd spacesnap-ai

# 2 · install dependencies
npm install

# 3 · add your API keys (optional — the app runs in DEMO MODE without them)
cp .env.example .env     # then fill in VITE_HF_TOKEN and VITE_GEMINI_API_KEY

# 4 · launch
npm run dev              # → http://localhost:5173
```

### Scaffolding from scratch (the commands that created this project)

```bash
npm create vite@latest spacesnap-ai -- --template react
cd spacesnap-ai
npm install
npm install framer-motion @google/generative-ai
npm install -D tailwindcss@^3 postcss autoprefixer
npx tailwindcss init -p
npm run dev
```

### 🔑 API keys

| Key | Powers | Get it at |
| --- | --- | --- |
| `VITE_HF_TOKEN` | Stage 1 — OWL-ViT | [hf.co/settings/tokens](https://huggingface.co/settings/tokens) — enable **"Inference Providers"** permission |
| `VITE_GEMINI_API_KEY` | Stage 2 — Explanation | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |

Keys can also be entered at runtime via the **`KEYS`** button (stored in browser `localStorage` only). No keys? The app automatically falls back to its **onboard demo detector + template explainer**, including two bundled NASA-style sample images — perfect for judging.

---

## 🌍 Deploy it publicly (so anyone can use it — Vercel)

Public deployment uses a **serverless relay** (`api/detect.js`, `api/explain.js`) so your API keys stay **server-side** and every visitor gets **live inference without needing a key**. Never deploy with `VITE_*` keys set — they'd be visible in the public JS bundle.

**Steps (~5 minutes):**

1. Push this repo to GitHub (done if you're reading this there).
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** your repository. Vercel auto-detects **Vite** (build `npm run build`, output `dist`) — no config changes needed (`vercel.json` is already included).
3. In **Project → Settings → Environment Variables**, add:
   - `HF_TOKEN` = your Hugging Face token (Inference Providers permission)
   - `GEMINI_API_KEY` = your Google AI Studio key
4. **Deploy** → you get `https://<your-project>.vercel.app`. Share the link — visitors immediately get the full two-stage pipeline via `/api/detect` + `/api/explain`.

**Local full-stack test** (functions + frontend like production):

```bash
npm i -g vercel
cp .env.example .env.local   # fill HF_TOKEN / GEMINI_API_KEY (server-side names!)
npm run dev:full             # → vercel dev (serves /api/* + Vite together)
```

**Relay details & safety:**

- `/api/detect` and `/api/explain` validate + sanitise input (max ~4.5 MB image, ≤10 labels), enforce a soft **12 req/min per-IP rate limit** (in-memory sliding window — swap for Vercel KV/Upstash for hard limits), and time out at 30 s.
- If the relay is absent (e.g. static-only host) or env vars are missing, every visitor gracefully falls back to the built-in demo mode — the link never "breaks".
- Visitants' own keys (via the `KEYS` button) always take precedence over the relay.
- Free-tier quotas apply to *your* HF/Gemini accounts; the rate limit keeps casual traffic well inside them.
- Alternative hosts: Netlify (ports the `api/` handlers to `netlify/functions` with ~10 lines of changes), or Render/Railway with a tiny Express server serving `dist/` + the same two routes.

---

## 🧠 How the pipeline works

**Stage 1 — Detection (`src/lib/huggingface.js`).** The upload is downscaled to ≤1024 px (`src/lib/image.js`), base64-encoded, and POSTed to the HF Inference router with your candidate labels (`clouds, storm system, ocean, forest, wildfire, smoke plume, ice sheet` — editable in the UI). OWL-ViT is tried first, and the client retries through cold starts (HTTP 503 + `estimated_time`) and modern/legacy payload shapes for resilience. Response: `[{ label, score, box: {xmin, ymin, xmax, ymax} }]`.

> ⚠️ **OWL-ViT fallback.** HF removed zero-shot-object-detection from the serverless `hf-inference` provider, so that route now answers `HTTP 400: Model not supported by provider hf-inference` (or 404). On those statuses the client transparently switches to **zero-shot detection via the OpenAI-compatible chat router** (`POST https://router.huggingface.co/v1/chat/completions`, same Bearer token), trying `Qwen/Qwen3-VL-8B-Instruct → meta-llama/Llama-4-Scout-17B-16E-Instruct → Qwen/Qwen2.5-VL-7B-Instruct`. The image goes in as a data-URL `image_url`, the prompt demands *only* a JSON array `[{label, score, box:{xmin,ymin,xmax,ymax}}]` with integer coordinates on a **0–1000 grid**, and those are scaled to the image's width/height. The detector that answered is logged and surfaced (`data.detector` on the client, `X-SpaceSnap-Detector` on the relay).

**Stage 2 — Explanation (`src/lib/gemini.js`).** The same image plus the detection summary is sent to Gemini with a prompt demanding *one plain-English sentence* about the meteorological/geographical event. Google has retired both 1.5 Flash and 2.0 Flash (its error points at `gemini-3.8-flash`), so the client walks a chain — `VITE_GEMINI_MODEL` → `gemini-1.5-flash` → `gemini-3.8-flash` → `gemini-2.5-flash` → `gemini-2.0-flash` — and reports which model answered.

**Canvas mapping (`src/components/DetectionCanvas.jsx`).** The canvas is sized so it displays the *exact pixels* sent to the API, scaled to fit its container — so box coordinates need a single scale factor:

```js
const scale = canvasDisplayWidth / imageNaturalWidth;
ctx.strokeRect(box.xmin * scale, box.ymin * scale,
               (box.xmax - box.xmin) * scale, (box.ymax - box.ymin) * scale);
```

Boxes pop in one-by-one with glowing corner brackets, center reticles and confidence chips, while a cyan sweep line rasterises the frame during inference.

## 🗂️ Project structure

```
├── index.html                  # fonts (Press Start 2P / VT323 / Space Mono)
├── tailwind.config.js          # neon palette, glow shadows, CRT keyframes
├── .env.example                # API keys + endpoint overrides
├── public/samples/             # bundled demo imagery (hurricane, wildfire)
└── src/
    ├── App.jsx                 # phase state machine: landing → transitioning → dashboard
    ├── config.js               # candidate labels, neon palette, constants
    ├── lib/
    │   ├── huggingface.js      # STAGE 1 — OWL-ViT zero-shot detection
    │   ├── gemini.js           # STAGE 2 — Gemini vision-language explanation
    │   ├── demo.js             # zero-key fallback (demo detections + templates)
    │   └── image.js            # file/url → dataURL, ≤1024px downscale
    └── components/
        ├── Starfield.jsx       # custom canvas starfield; warp when `warp` prop set
        ├── Landing.jsx         # hero + "READY TO ANALYZE SPACE IMAGES?" button
        ├── Dashboard.jsx       # orchestrates the pipeline, XP/level, keyring
        ├── Dropzone.jsx        # drag & drop upload + sample buttons
        ├── DetectionCanvas.jsx # <canvas> neon bounding-box overlay
        ├── Terminal.jsx        # MISSION.LOG with typewriter Gemini readout
        └── KeyModal.jsx        # runtime API-key entry (localStorage)
```

## 📝 Challenge submission write-up (~130 words)

> **SpaceSnap AI** is a gamified Earth-observation analyzer built on a two-stage ML pipeline. Stage 1 runs zero-shot object detection with **OWL-ViT** (`google/owlvit-base-patch32`) via the Hugging Face Inference API: an uploaded satellite image is downscaled, sent with editable candidate labels — clouds, storms, oceans, forests, wildfires, ice — and returns precise bounding boxes with confidence scores (with an automatic zero-shot **chat-VLM fallback** on the same token if HF has retired OWL-ViT serverlessly). Stage 2 passes those detections plus the image to **Gemini** (chain: `gemini-1.5-flash → 3.8-flash → 2.5-flash → 2.0-flash`), which generates a one-sentence, plain-English explanation of the meteorological or geographical event. The **React + Vite** frontend uses **Framer Motion** for a warp-speed starfield transition from landing page to dashboard, **Tailwind** for the retro neon HUD aesthetic, and an HTML5 `<canvas>` to map API coordinates onto the live image feed as glowing labeled boxes.

## 🛠️ Troubleshooting

- **`HTTP 503 / "Model loading"`** — normal on HF free tier; the client waits `estimated_time` and retries automatically.
- **`HTTP 400 "Model not supported by provider hf-inference"` (or 404)** — OWL-ViT is no longer served serverlessly; the client automatically falls back to zero-shot chat detection (Qwen3-VL → Llama-4-Scout → Qwen2.5-VL). No action needed.
- **`401/403` from HF** — regenerate the token with the **Inference Providers** permission.
- **Endpoints moved?** — override without code changes: `VITE_HF_ENDPOINT` / `VITE_HF_CHAT_ENDPOINT` (client) or `HF_ENDPOINT` / `HF_CHAT_ENDPOINT` (relay).
- **Gemini `404`** — 1.5 Flash is retired and 2.0 Flash is on the way out; the chain falls through to `gemini-3.8-flash` automatically, or pin one with `VITE_GEMINI_MODEL=gemini-3.8-flash`.
- **Box positions drifting on huge images** — can't happen here: the API and the canvas always see the identical processed pixels.

---

_Hackathon prototype — API keys are used client-side. Proxy them through a backend before shipping to production._ 🌌
