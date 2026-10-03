import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const KIND_STYLE = {
  sys: 'text-cyan-300',
  ok: 'text-neon-green',
  warn: 'text-neon-amber',
  err: 'text-rose-400',
  data: 'text-slate-300',
  gemini: 'text-purple-300',
};

/**
 * "MISSION LOG" — CRT terminal showing the pipeline narrating itself:
 * uplink status, every detection with score + coords, and Gemini's
 * plain-English explanation typed out letter by letter.
 */
export default function Terminal({ lines, busy }) {
  const bodyRef = useRef(null);
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(`${new Date().toISOString().slice(11, 19)} UTC`);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="hud-frame flex h-full min-h-[420px] flex-col">
      {/* window chrome */}
      <div className="flex items-center justify-between border-b border-cyan-300/20 bg-void/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 bg-rose-500/80" />
          <span className="h-2.5 w-2.5 bg-neon-amber/80" />
          <span className="h-2.5 w-2.5 bg-neon-green/80" />
        </div>
        <span className="font-pixel text-[8px] tracking-widest text-cyan-200/80">
          ▣ MISSION.LOG
        </span>
        <span className="font-term text-base text-cyan-300/70">{clock}</span>
      </div>

      {/* scrollback */}
      <div
        ref={bodyRef}
        className="flex-1 space-y-1 overflow-y-auto p-3 font-term text-lg leading-5"
      >
        {lines.map((l) =>
          l.kind === 'gemini' ? (
            <TypeLine key={l.id} text={format(l)} className={KIND_STYLE.gemini} />
          ) : (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className={`whitespace-pre-wrap break-words ${KIND_STYLE[l.kind] || KIND_STYLE.data}`}
            >
              {format(l)}
            </motion.div>
          )
        )}
        <div className="text-neon-green">
          {busy ? '▮'.padEnd(1) : '>'} <span className="animate-blink">▮</span>
        </div>
      </div>
    </div>
  );
}

function format(line) {
  const t = line.t instanceof Date ? line.t.toISOString().slice(11, 19) : '';
  return `[${t}] ${line.text}`;
}

/** Typewriter reveal for the Gemini explanation line. */
function TypeLine({ text, className }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(t);
          return v;
        }
        return v + 3;
      });
    }, 22);
    return () => clearInterval(t);
  }, [text]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`whitespace-pre-wrap break-words ${className}`}>
      {text.slice(0, n)}
      {n < text.length && <span className="animate-blink">▌</span>}
    </motion.div>
  );
}
