import { useState } from 'react';
import { motion } from 'framer-motion';

/**
 * API keyring — keys are stored ONLY in the browser's localStorage and are
 * sent directly to Hugging Face / Google from the client (fine for a
 * hackathon prototype; proxy them through a backend for production).
 * Keys can also be baked in via .env (see .env.example).
 */
export default function KeyModal({ open, onClose, keys, onSave }) {
  const [draft, setDraft] = useState(keys);

  if (!open) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="hud-frame w-full max-w-md p-5"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-pixel text-[10px] text-neon-blue text-glow-blue">
          ▣ API KEYRING
        </h2>
        <p className="mt-2 text-[10px] leading-relaxed tracking-wider text-cyan-100/60">
          KEYS LIVE IN YOUR BROWSER (localStorage) ONLY. WITHOUT THEM, THE APP RUNS IN
          DEMO MODE.
        </p>

        <label className="mt-4 block text-[10px] uppercase tracking-widest text-neon-green">
          HF Access Token <span className="text-slate-400">— Stage 1 · OWL-ViT</span>
        </label>
        <input
          type="password"
          value={draft.hf}
          onChange={(e) => setDraft((d) => ({ ...d, hf: e.target.value.trim() }))}
          placeholder="hf_…  (hf.co/settings/tokens · needs 'Inference Providers')"
          className="neon-input mt-1"
          autoComplete="off"
        />

        <label className="mt-4 block text-[10px] uppercase tracking-widest text-neon-purple">
          Gemini API Key <span className="text-slate-400">— Stage 2 · Explanation</span>
        </label>
        <input
          type="password"
          value={draft.gemini}
          onChange={(e) => setDraft((d) => ({ ...d, gemini: e.target.value.trim() }))}
          placeholder="AIza…  (aistudio.google.com/app/apikey)"
          className="neon-input mt-1"
          autoComplete="off"
        />

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="pixel-btn-pink px-4 py-2 text-[9px]">
            CANCEL
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="pixel-btn-green px-4 py-2 text-[9px]"
          >
            SAVE KEYS
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
