import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SAMPLES } from '../config.js';

/** Drag & drop / click-to-browse upload pad + bundled demo imagery. */
export default function Dropzone({ onFile, onSample, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return;
    onFile(file);
  };

  return (
    <div className="space-y-4">
      <motion.div
        role="button"
        tabIndex={0}
        aria-label="Upload a JPG or PNG Earth-observation image"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
        animate={dragging ? { scale: 1.015 } : { scale: 1 }}
        className={`group grid cursor-pointer place-items-center border-2 border-dashed px-6 py-16 text-center transition-colors ${
          dragging
            ? 'border-neon-green bg-neon-green/10 shadow-neon-green'
            : 'border-cyan-400/40 bg-void/40 hover:border-neon-green/70 hover:bg-neon-green/5'
        }`}
      >
        <div className="pointer-events-none select-none">
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            className="mb-4 text-5xl"
          >
            🛰️
          </motion.div>
          <p className="font-pixel text-[10px] leading-relaxed text-neon-blue text-glow-blue sm:text-xs">
            DROP SATELLITE IMG HERE
          </p>
          <p className="mt-3 text-[10px] tracking-widest text-cyan-100/50">
            — OR CLICK TO BROWSE · JPG / PNG —
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </motion.div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-purple-300/70">
          No image? Try a sample ▸
        </span>
        {SAMPLES.map((s) => (
          <button
            key={s.url}
            type="button"
            disabled={disabled}
            onClick={() => onSample(s)}
            className="chip transition-colors hover:border-neon-amber hover:text-neon-amber disabled:opacity-40"
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
