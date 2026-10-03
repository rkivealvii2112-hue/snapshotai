import { motion } from 'framer-motion';

/**
 * Landing screen — gamified hero over the live starfield.
 * Clicking the button triggers the warp transition (App handles phases).
 */
export default function Landing({ onLaunch }) {
  return (
    <motion.div
      className="fixed inset-0 z-10 flex flex-col items-center justify-center px-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ scale: 2.4, opacity: 0, filter: 'blur(8px)' }}
      transition={{ duration: 0.5, ease: [0.7, 0, 1, 0.5] }}
    >
      {/* corner HUD decorations */}
      <div className="absolute left-4 top-4 font-term text-lg text-cyan-300/70">
        REC <span className="animate-blink text-neon-pink">●</span>
      </div>
      <div className="absolute right-4 top-4 font-term text-lg text-cyan-300/70">
        LAT 00.00 · LON 00.00 · ALT 408 KM
      </div>
      <div className="absolute bottom-4 left-4 text-[10px] tracking-wider text-purple-300/60">
        SYS.CHECK ▸ OWL-ViT [OK] ▸ GEMINI [OK] ▸ CANVAS-HUD [OK]
      </div>
      <div className="absolute bottom-4 right-4 font-pixel text-[8px] text-cyan-300/50">
        INSERT COIN ␣
      </div>

      <motion.div
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="chip mb-6"
      >
        <span className="text-neon-green">▣</span> EARTH-OBSERVATION VISION SYSTEM v1.0
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 120, damping: 14 }}
        className="animate-flicker bg-gradient-to-r from-neon-blue via-white to-neon-purple bg-clip-text font-pixel text-3xl leading-tight text-transparent drop-shadow-[0_0_18px_rgba(0,229,255,0.45)] sm:text-5xl md:text-6xl"
      >
        SPACESNAP<span className="drop-shadow-[0_0_14px_rgba(57,255,20,0.8)]">.AI</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
        className="mt-6 max-w-xl text-xs leading-relaxed tracking-wider text-cyan-100/80 sm:text-sm"
      >
        POINT YOUR CAMERA AT THE PLANET. A ZERO-SHOT DETECTOR LOCKS ONTO CLOUDS, STORMS,
        FIRES &amp; ICE — THEN A VISION-LANGUAGE MODEL EXPLAINS WHAT YOU&apos;RE SEEING.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="mt-6 flex flex-wrap items-center justify-center gap-2"
      >
        <span className="chip">STAGE 1 · OWL-ViT</span>
        <span className="text-neon-purple">▸</span>
        <span className="chip">STAGE 2 · GEMINI 1.5 FLASH</span>
        <span className="text-neon-purple">▸</span>
        <span className="chip">CANVAS HUD</span>
      </motion.div>

      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onLaunch}
        className="pixel-btn-green mt-10 px-6 py-4 text-[10px] leading-relaxed sm:px-10 sm:py-5 sm:text-xs"
      >
        ▶ READY TO ANALYZE SPACE IMAGES?
      </motion.button>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="mt-6 font-term text-xl text-neon-amber/80"
      >
        [ PRESS START ] <span className="animate-blink">▮</span>
      </motion.div>
    </motion.div>
  );
}
