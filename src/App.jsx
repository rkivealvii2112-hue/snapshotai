import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Starfield from './components/Starfield.jsx';
import Landing from './components/Landing.jsx';
import Dashboard from './components/Dashboard.jsx';

/**
 * Phase state machine:
 *
 *   'landing'  ──[button click]──▶  'transitioning'  ──[warp done]──▶  'dashboard'
 *       ▲                                                             │
 *       └──────────────────────[ EXIT button in dashboard ]───────────┘
 *
 * The <Starfield> stays mounted across all phases — `warp` drives the speed.
 */
export default function App() {
  const [phase, setPhase] = useState('landing');

  const onWarped = useCallback(() => setPhase('dashboard'), []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-void">
      {/* persistent starfield (idle drift ⇄ warp speed) */}
      <div className="fixed inset-0 z-0">
        <Starfield warp={phase === 'transitioning'} onWarped={onWarped} />
      </div>

      {/* CRT scanlines + vignette over everything */}
      <div className="crt vignette pointer-events-none fixed inset-0 z-30" />

      {/* PHASE 1 — LANDING */}
      <AnimatePresence>
        {phase === 'landing' && (
          <Landing key="landing" onLaunch={() => setPhase('transitioning')} />
        )}
      </AnimatePresence>

      {/* PHASE 2 — WARP TRANSITION overlay */}
      <AnimatePresence>
        {phase === 'transitioning' && (
          <motion.div
            key="warp"
            className="fixed inset-0 z-20 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="font-pixel text-sm text-neon-green text-glow-green sm:text-xl"
              initial={{ opacity: 0, letterSpacing: '0.1em' }}
              animate={{ opacity: [0, 1, 1, 0], letterSpacing: '0.45em' }}
              transition={{ duration: 2.1, times: [0, 0.15, 0.8, 1] }}
            >
              ENTERING ORBIT…
            </motion.div>
            {/* white flash right before the dashboard materialises */}
            <motion.div
              className="absolute inset-0 bg-cyan-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0, 0.85, 0] }}
              transition={{ duration: 2.3, times: [0, 0.86, 0.94, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PHASE 3 — DASHBOARD */}
      <AnimatePresence>
        {phase === 'dashboard' && (
          <motion.main
            key="dashboard"
            className="relative z-10"
            initial={{ opacity: 0, scale: 1.14, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <Dashboard onExit={() => setPhase('landing')} />
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}
