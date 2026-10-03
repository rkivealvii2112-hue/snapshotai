import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Dropzone from './Dropzone.jsx';
import DetectionCanvas from './DetectionCanvas.jsx';
import Terminal from './Terminal.jsx';
import KeyModal from './KeyModal.jsx';
import { DEFAULT_LABELS, MAX_IMAGE_DIM } from '../config.js';
import { detectFeatures } from '../lib/huggingface.js';
import { explainScene } from '../lib/gemini.js';
import { demoDetections, demoExplanation } from '../lib/demo.js';
import { fileToDataURL, loadImageEl, processImage, urlToDataURL } from '../lib/image.js';

const BOOT_LINES = [
  { kind: 'sys', text: 'SPACESNAP v1.0 — BOOT SEQUENCE COMPLETE' },
  { kind: 'sys', text: 'PIPELINE: [1] OWL-ViT ZERO-SHOT DETECTION → [2] GEMINI VISION EXPLANATION' },
  { kind: 'ok', text: 'AWAITING SATELLITE IMAGERY…' },
];

let lineId = 0;

export default function Dashboard({ onExit }) {
  // ── api keyring (env → localStorage) ──────────────────────────────
  const [keys, setKeys] = useState(() => ({
    hf: localStorage.getItem('ssai.hf') || import.meta.env.VITE_HF_TOKEN || '',
    gemini: localStorage.getItem('ssai.gemini') || import.meta.env.VITE_GEMINI_API_KEY || '',
  }));
  const [showKeys, setShowKeys] = useState(false);

  // ── mission state ─────────────────────────────────────────────────
  const [image, setImage] = useState(null); // { url, base64, mime, el, width, height, name }
  const [detections, setDetections] = useState([]);
  const [explanation, setExplanation] = useState('');
  const [stage, setStage] = useState('idle'); // idle | detecting | explaining | done
  const [labelsText, setLabelsText] = useState(DEFAULT_LABELS.join(', '));
  const [threshold, setThreshold] = useState(0.12);
  const [lines, setLines] = useState(() =>
    BOOT_LINES.map((l) => ({ ...l, id: ++lineId, t: new Date() }))
  );
  const [missions, setMissions] = useState(() => Number(localStorage.getItem('ssai.missions') || 0));

  const busy = stage === 'detecting' || stage === 'explaining';

  const log = useCallback((text, kind = 'data') => {
    setLines((ls) => [...ls.slice(-140), { id: ++lineId, text, kind, t: new Date() }]);
  }, []);

  // ── image loading (upload or bundled sample) ─────────────────────
  const loadImage = useCallback(
    async (dataUrl, name) => {
      try {
        const processed = await processImage(dataUrl, MAX_IMAGE_DIM);
        const el = await loadImageEl(processed.dataUrl);
        setImage({ ...processed, url: processed.dataUrl, el, name });
        setDetections([]);
        setExplanation('');
        setStage('idle');
        log(`LOADED “${name}” — ${processed.width}×${processed.height}px`, 'ok');
      } catch (e) {
        log(`IMAGE LOAD FAILED: ${e.message}`, 'err');
      }
    },
    [log]
  );

  const handleFile = useCallback(
    async (file) => loadImage(await fileToDataURL(file), file.name),
    [loadImage]
  );

  const handleSample = useCallback(
    async (sample) => loadImage(await urlToDataURL(sample.url), sample.name),
    [loadImage]
  );

  // ── TWO-STAGE ML PIPELINE ─────────────────────────────────────────
  const analyze = useCallback(async () => {
    if (!image || busy) return;

    const labels = labelsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!labels.length) {
      log('NO CANDIDATE LABELS — ADD AT LEAST ONE.', 'err');
      return;
    }

    setDetections([]);
    setExplanation('');

    // ····· STAGE 1 — zero-shot object detection (OWL-ViT) ·····
    setStage('detecting');
    log('▸ STAGE 1/2 · ZERO-SHOT DETECTION @ google/owlvit-base-patch32', 'sys');
    log(keys.hf ? 'UPLINK MODE: DIRECT (LOCAL TOKEN)' : 'UPLINK MODE: SPACESNAP RELAY', 'sys');
    let dets = [];
    const t0 = performance.now();
    try {
      dets = await detectFeatures({
        token: keys.hf || null, // null → routed via /api/detect serverless relay
        base64: image.base64,
        labels,
        threshold,
        width: image.width,
        height: image.height,
      });
      log(`UPLINK OK — ${dets.length} RAW HIT(S) IN ${((performance.now() - t0) / 1000).toFixed(1)}s`, 'ok');
    } catch (e) {
      if (e.code === 'relay_unavailable') {
        log('NO TOKEN & NO RELAY CONFIGURED — ONBOARD DEMO DETECTOR ENGAGED', 'warn');
      } else {
        log(`DETECTION ERROR — ${e.message}`, 'err');
        log('FALLBACK → ONBOARD DEMO DETECTOR ENGAGED', 'warn');
      }
      dets = demoDetections(image.width, image.height, labels, image.name);
    }

    dets = dets
      .filter((d) => d.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    setDetections(dets);
    dets.forEach((d, i) =>
      log(
        `  [${String(i).padStart(2, '0')}] ${d.label.toUpperCase().padEnd(16, '·')} ${(d.score * 100)
          .toFixed(1)
          .padStart(5)}%  @ (${d.box.xmin},${d.box.ymin})→(${d.box.xmax},${d.box.ymax})`,
        'data'
      )
    );
    if (!dets.length) log('NO FEATURES ABOVE THRESHOLD — TRY LOWER SENSITIVITY.', 'warn');

    // ····· STAGE 2 — vision-language explanation (Gemini) ·····
    setStage('explaining');
    log('▸ STAGE 2/2 · VISION-LANGUAGE EXPLANATION @ gemini-1.5-flash', 'sys');
    try {
      const r = await explainScene({
        apiKey: keys.gemini || null, // null → routed via /api/explain serverless relay
        base64: image.base64,
        mimeType: image.mime,
        detections: dets,
      });
      setExplanation(r.text);
      log(`GEMINI (${r.model}) ↳ ${r.text}`, 'gemini');
    } catch (e) {
      if (e.code === 'relay_unavailable') {
        log('NO KEY & NO RELAY CONFIGURED — TEMPLATE EXPLAINER ENGAGED', 'warn');
      } else {
        log(`GEMINI ERROR — ${e.message}`, 'err');
      }
      const fallback = demoExplanation(dets);
      setExplanation(fallback);
      log(`TEMPLATE EXPLAINER ↳ ${fallback}`, 'gemini');
    }

    // ····· mission complete ·····
    setStage('done');
    const n = missions + 1;
    setMissions(n);
    localStorage.setItem('ssai.missions', String(n));
    log(`MISSION ${String(n).padStart(3, '0')} COMPLETE ✔  +120 XP`, 'ok');
  }, [image, busy, labelsText, threshold, keys, log, missions]);

  // auto-run once a fresh image lands (guarded against StrictMode double-fire)
  const autoRan = useRef('');
  useEffect(() => {
    if (image && stage === 'idle' && autoRan.current !== image.url) {
      autoRan.current = image.url;
      analyze();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const clearImage = () => {
    setImage(null);
    setDetections([]);
    setExplanation('');
    setStage('idle');
    autoRan.current = '';
    log('FEED CLEARED — AWAITING NEW IMAGERY.', 'sys');
  };

  const saveKeys = (k) => {
    localStorage.setItem('ssai.hf', k.hf);
    localStorage.setItem('ssai.gemini', k.gemini);
    setKeys(k);
    setShowKeys(false);
    log('KEYRING UPDATED — LIVE MODE READY.', 'ok');
  };

  const xp = (missions * 120) % 500;
  const level = Math.floor((missions * 120) / 500) + 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      {/* ── header ──────────────────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mb-5 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center border-2 border-neon-purple/70 bg-purple-950/40 font-pixel text-sm text-neon-purple shadow-neon-purple">
            ⌖
          </div>
          <div>
            <h1 className="font-pixel text-xs text-white sm:text-sm">
              SPACESNAP<span className="text-neon-green text-glow-green">.AI</span>
            </h1>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-cyan-300/70">
              EARTH-OBSERVATION INTELLIGENCE // TWO-STAGE ML PIPELINE
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge ok={!!keys.hf} label="STAGE1·OWL-ViT" />
          <StatusBadge ok={!!keys.gemini} label="STAGE2·GEMINI" />

          {/* gamified XP bar */}
          <div className="hidden items-center gap-2 sm:flex" title={`${missions} missions flown`}>
            <span className="font-pixel text-[8px] text-neon-amber text-glow-amber">
              LVL {level}
            </span>
            <div className="h-2.5 w-24 border border-neon-amber/60 bg-void/70 p-[2px]">
              <motion.div
                className="h-full bg-neon-amber shadow-neon-green"
                animate={{ width: `${(xp / 500) * 100}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>

          <button type="button" onClick={() => setShowKeys(true)} className="pixel-btn-blue px-3 py-2 text-[9px]">
            KEYS
          </button>
          <button type="button" onClick={onExit} className="pixel-btn-pink px-3 py-2 text-[9px]">
            EXIT
          </button>
        </div>
      </motion.header>

      {/* ── main grid: imagery + terminal ───────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.85fr)]">
        {/* LEFT — SAT FEED */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="hud-frame bg-grid-hud bg-grid-hud p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-cyan-300/15 pb-2">
            <span className="font-pixel text-[9px] text-neon-blue text-glow-blue">
              ▣ SAT-FEED / IMAGERY
            </span>
            <span className="font-term text-base text-cyan-300/70">
              {image ? `${image.name} · ${image.width}×${image.height}` : 'NO SIGNAL'}
            </span>
          </div>

          {image ? (
            <DetectionCanvas image={image} detections={detections} scanning={stage === 'detecting'} />
          ) : (
            <Dropzone onFile={handleFile} onSample={handleSample} disabled={busy} />
          )}

          {/* controls */}
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-[9px] uppercase tracking-widest text-cyan-300/70">
                Candidate labels (zero-shot queries, comma-separated)
              </label>
              <input
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                disabled={busy}
                className="neon-input mt-1"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-cyan-300/70">
                Sensitivity
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={threshold}
                  disabled={busy}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="h-1.5 w-32 cursor-pointer appearance-none bg-purple-900/70 accent-neon-green"
                />
                <span className="font-term text-lg text-neon-green">{(threshold * 100).toFixed(0)}%</span>
              </label>

              <div className="ml-auto flex gap-2">
                {image && (
                  <button type="button" onClick={clearImage} disabled={busy} className="pixel-btn-pink px-3 py-2 text-[9px]">
                    CLEAR
                  </button>
                )}
                <button type="button" onClick={analyze} disabled={!image || busy} className="pixel-btn-green px-4 py-2 text-[9px]">
                  {stage === 'detecting' ? '⌖ SCANNING…' : stage === 'explaining' ? '✎ EXPLAINING…' : '▶ ANALYZE'}
                </button>
              </div>
            </div>
          </div>

          {/* explanation banner */}
          <AnimatePresence>
            {explanation && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 border border-neon-purple/50 bg-purple-950/30 p-3"
              >
                <span className="font-pixel text-[8px] text-neon-purple text-glow-purple">
                  ◈ PLAIN-ENGLISH READOUT
                </span>
                <p className="mt-1.5 font-term text-xl leading-6 text-purple-100">
                  “{explanation}”
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* RIGHT — TERMINAL */}
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Terminal lines={lines} busy={busy} />
        </motion.section>
      </div>

      <footer className="mt-5 text-center text-[9px] uppercase tracking-widest text-cyan-300/40">
        STAGE 1 · google/owlvit-base-patch32 @ HF INFERENCE ▸ STAGE 2 · gemini-1.5-flash @ GOOGLE
        AI ▸ RENDER · HTML5 CANVAS HUD
      </footer>

      <AnimatePresence>
        {showKeys && (
          <KeyModal open={showKeys} onClose={() => setShowKeys(false)} keys={keys} onSave={saveKeys} />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBadge({ ok, label }) {
  return (
    <span
      className={`chip ${ok ? 'border-neon-green/60 text-neon-green' : 'border-neon-amber/60 text-neon-amber'}`}
      title={
        ok
          ? 'Live API key configured (your own key, direct uplink)'
          : 'No local key — uses the SpaceSnap relay when deployed (demo mode otherwise)'
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-neon-green' : 'bg-neon-amber'} animate-blink`} />
      {label} · {ok ? 'LIVE' : 'AUTO'}
    </span>
  );
}
