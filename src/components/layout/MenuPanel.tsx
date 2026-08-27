import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, LayoutGrid, Search, X } from 'lucide-react';
import {
  FUNCTION_GROUPS,
  TERMINAL_FUNCTIONS,
  TerminalFunction,
  searchFunctions,
} from '../../data/functions';
import { cx } from '../common/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (fn: TerminalFunction) => void;
  /** Code of the function currently on screen, so the launcher can mark it. */
  activeCode: string | null;
}

/**
 * The function launcher.
 *
 * WHAT IT REPLACES. Twelve screens across four workspaces is more than a tab row
 * can hold honestly — the terminal was already scrolling its tabs sideways on a
 * laptop. Bloomberg's answer is not more tabs, it is a mnemonic you type, and
 * this is that: one panel that lists every function, searchable, keyboard-first,
 * with the codes visible so they get learned by use rather than by reading a
 * manual.
 *
 * KEYBOARD IS THE POINT. Ctrl+K or `/` opens it, typing filters, arrows move,
 * Enter goes. A launcher you have to reach for with a mouse saves nobody
 * anything over the tabs it replaced.
 *
 * The animation is the same vocabulary as the entry curtain — a fast sweep with
 * the same easing — so the app has one motion language rather than a collection
 * of effects.
 */
export const MenuPanel: React.FC<Props> = ({ open, onClose, onPick, activeCode }) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchFunctions(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // The panel animates in; focusing on the next frame avoids the browser
    // scrolling the page to an element that has not been laid out yet.
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(results.length - 1, c + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = results[cursor];
        if (pick) onPick(pick);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, cursor, onPick, onClose]);

  const grouped = useMemo(() => {
    if (query.trim()) return null;
    return FUNCTION_GROUPS.map((g) => ({
      group: g,
      items: TERMINAL_FUNCTIONS.filter((f) => f.group === g),
    })).filter((g) => g.items.length);
  }, [query]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Menu fungsi terminal"
            className="fixed inset-x-0 top-0 z-[91] mx-auto flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden border border-amber-500/30 bg-slate-950 shadow-2xl sm:top-[8vh] sm:rounded-xl"
            initial={{ y: -28, opacity: 0, scaleY: 0.96 }}
            animate={{ y: 0, opacity: 1, scaleY: 1 }}
            exit={{ y: -20, opacity: 0, scaleY: 0.97 }}
            transition={{ duration: 0.24, ease: [0.76, 0, 0.24, 1] }}
            style={{ originY: 0 }}
          >
            {/* title bar, in the terminal's chrome grammar */}
            <div className="flex items-center justify-between gap-2 border-b border-amber-500/25 bg-slate-900 px-3 py-2">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-300">Menu Fungsi</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup menu"
                className="rounded p-1 text-slate-500 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="relative border-b border-slate-800">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-amber-500/70"
                aria-hidden="true"
              />
              <label htmlFor="fn-search" className="sr-only">
                Cari fungsi
              </label>
              <input
                id="fn-search"
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ketik kode fungsi atau nama — mis. SCR, FUND, konglomerasi"
                className="w-full bg-slate-950 py-3 pl-10 pr-3 font-mono text-sm uppercase tracking-wide text-amber-200 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-600 focus:outline-none"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              {results.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-slate-500">
                  Tidak ada fungsi yang cocok dengan "{query}".
                </p>
              )}

              {grouped
                ? grouped.map((g) => (
                    <div key={g.group}>
                      <div className="sticky top-0 border-y border-slate-800/70 bg-slate-900/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 backdrop-blur">
                        {g.group}
                      </div>
                      {g.items.map((f) => (
                        <Row
                          key={f.code}
                          fn={f}
                          active={f.code === activeCode}
                          selected={results[cursor]?.code === f.code}
                          onPick={onPick}
                          onHover={() => setCursor(results.findIndex((r) => r.code === f.code))}
                        />
                      ))}
                    </div>
                  ))
                : results.map((f, i) => (
                    <Row
                      key={f.code}
                      fn={f}
                      active={f.code === activeCode}
                      selected={i === cursor}
                      onPick={onPick}
                      onHover={() => setCursor(i)}
                    />
                  ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <Key>↑</Key>
                <Key>↓</Key> pilih
              </span>
              <span className="flex items-center gap-1">
                <Key>
                  <CornerDownLeft className="w-2.5 h-2.5" aria-hidden="true" />
                </Key>{' '}
                buka
              </span>
              <span className="flex items-center gap-1">
                <Key>Esc</Key> tutup
              </span>
              <span className="ml-auto hidden sm:inline">
                <Key>Ctrl</Key> <Key>K</Key> membukanya dari mana saja
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[9px] text-slate-400">
    {children}
  </kbd>
);

const Row: React.FC<{
  fn: TerminalFunction;
  active: boolean;
  selected: boolean;
  onPick: (fn: TerminalFunction) => void;
  onHover: () => void;
}> = ({ fn, active, selected, onPick, onHover }) => (
  <button
    type="button"
    onClick={() => onPick(fn)}
    onMouseEnter={onHover}
    className={cx(
      'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer',
      selected ? 'bg-amber-500/10' : 'hover:bg-slate-900'
    )}
  >
    <span
      className={cx(
        'mt-0.5 w-14 shrink-0 rounded border px-1.5 py-0.5 text-center font-mono text-[11px] font-bold',
        selected ? 'border-amber-500/50 bg-amber-500/15 text-amber-200' : `border-slate-700 bg-slate-900 ${fn.tone}`
      )}
    >
      {fn.code}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-100">{fn.name}</span>
        {active && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
            di layar
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{fn.hint}</span>
    </span>
  </button>
);
