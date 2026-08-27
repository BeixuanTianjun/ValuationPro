import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

/**
 * The curtain wipe between the front page and the terminal.
 *
 * WHY ANIMATE THIS AT ALL. Entering the terminal replaces the entire screen —
 * a marketing page becomes a dense grid of numbers. Swapped instantly it reads
 * as a page error for the first beat, and the reader has to re-find themselves.
 * A wipe says "the same app is turning into something else", and it buys the
 * ~400ms the market database needs to finish parsing so the terminal's first
 * frame is already populated instead of showing spinners.
 *
 * HOW IT RUNS. Panels sweep in to cover, the route swaps while the screen is
 * fully hidden, then the panels sweep out. The swap is driven from here rather
 * than by the caller so the timing cannot drift out of sync with the animation:
 * `onCover` fires exactly once, at the moment nothing is visible.
 *
 * REDUCED MOTION. A full-screen wipe is precisely the effect that triggers
 * vestibular discomfort, so under `prefers-reduced-motion` the panels are not
 * rendered at all and `onCover` fires immediately — the route still changes,
 * it just changes instantly.
 */

const PANELS = 6;
/** Time from the first panel starting to the last one finishing, in seconds. */
const SWEEP = 0.55;
const STAGGER = 0.05;

interface Props {
  /** Fires once, when the screen is fully covered. Do the route swap here. */
  onCover: () => void;
  /** Fires when the panels have finished clearing and the overlay can unmount. */
  onDone: () => void;
}

export const CurtainTransition: React.FC<Props> = ({ onCover, onDone }) => {
  const [phase, setPhase] = useState<'covering' | 'clearing'>('covering');

  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (!reduced) return;
    onCover();
    onDone();
  }, [reduced, onCover, onDone]);

  useEffect(() => {
    if (reduced) return;
    const coverAt = (SWEEP + STAGGER * (PANELS - 1)) * 1000;
    const cover = window.setTimeout(() => {
      onCover();
      setPhase('clearing');
    }, coverAt);
    const done = window.setTimeout(() => onDone(), coverAt + (SWEEP + STAGGER * (PANELS - 1)) * 1000 + 60);
    return () => {
      window.clearTimeout(cover);
      window.clearTimeout(done);
    };
  }, [reduced, onCover, onDone]);

  if (reduced) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex" aria-hidden="true">
      {Array.from({ length: PANELS }).map((_, i) => (
        <motion.div
          key={i}
          className="h-full flex-1 bg-gradient-to-b from-slate-900 via-slate-950 to-black"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: phase === 'covering' ? 1 : 0 }}
          style={{
            originY: phase === 'covering' ? 1 : 0,
            // A hairline of the accent on the leading edge, so the sweep reads
            // as a deliberate motion rather than a rendering glitch.
            boxShadow: 'inset 0 1px 0 0 rgba(34,211,238,0.35)',
          }}
          transition={{
            duration: SWEEP,
            delay: (phase === 'covering' ? i : PANELS - 1 - i) * STAGGER,
            ease: [0.76, 0, 0.24, 1],
          }}
        />
      ))}

      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'covering' ? 1 : 0 }}
        transition={{ duration: 0.3, delay: phase === 'covering' ? 0.28 : 0 }}
      >
        <div className="text-center">
          <div className="text-sm font-extrabold tracking-[0.3em] text-slate-200">VALUATIONPRO</div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-cyan-400/70">memuat terminal</div>
        </div>
      </motion.div>
    </div>
  );
};
