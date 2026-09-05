import React, { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Terminal } from 'lucide-react';
import { TerminalFunction, findFunction } from '../../data/functions';
import { cx } from '../common/ui';
import { ScrambleText } from '../landing/motionKit';

interface Props {
  active: TerminalFunction | null;
  onOpenMenu: () => void;
  onRun: (fn: TerminalFunction) => void;
  /** Right-hand slot: market phase, clock, quote age. */
  children?: React.ReactNode;
}

/**
 * The command line.
 *
 * Bloomberg's bar is the whole interaction model compressed into one row: what
 * you are looking at, on the left, and a place to type where you want to go, in
 * the middle. Typing `SCR` and pressing Enter is the fastest navigation this app
 * has, and unlike a tab row it does not get slower as functions are added.
 *
 * DELIBERATELY NOT A SEARCH BOX. It accepts a mnemonic and nothing else, and it
 * says so when it does not recognise one. A field that sometimes searches and
 * sometimes navigates teaches you to distrust it; the fuzzy search lives one
 * keystroke away in the menu panel, where results are visible before you commit.
 */
export const FunctionBar: React.FC<Props> = ({ active, onOpenMenu, onRun, children }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `/` focuses the command line the way it does in a terminal, but only when
  // the user is not already typing into something else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fn = findFunction(value);
    if (!fn) {
      setError(`"${value.trim().toUpperCase()}" bukan kode fungsi. Tekan Ctrl+K untuk melihat daftarnya.`);
      window.setTimeout(() => setError(null), 4000);
      return;
    }
    setValue('');
    setError(null);
    onRun(fn);
  };

  return (
    <div className="border-b border-amber-500/20 bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-1.5 sm:px-6">
        <button
          type="button"
          onClick={onOpenMenu}
          title="Function menu (Ctrl+K)"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 touch-target"
        >
          <LayoutGrid className="w-3 h-3" aria-hidden="true" />
          Menu
        </button>

        {/* KODE DAN NAMA FUNGSINYA MENGACAK TIAP KALI LAYARNYA GANTI.
            Dari semua tempat efek scramble bisa dipasang, ini yang paling
            beralasan: baris ini SATU-SATUNYA yang mengatakan "kamu sekarang ada
            di layar mana", dan sebelumnya ia berganti tanpa suara — tulisannya
            tiba-tiba sudah lain, dan mata yang sedang membaca tabel di bawahnya
            tidak punya alasan untuk kembali ke atas. Sekarang perubahannya
            terlihat sebagai sebuah peristiwa.

            `key` pada kodenya memaksa remount tiap ganti fungsi, jadi acakannya
            dijamin jalan lagi dan bukan menumpang pada efek yang kebetulan
            dijalankan ulang. */}
        {active && (
          <span className="hidden shrink-0 items-center gap-2 sm:flex">
            <ScrambleText
              key={`kode-${active.code}`}
              text={active.code}
              pemicu="segera"
              jeda={34}
              className={cx('rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-bold', active.tone)}
            />
            <ScrambleText
              key={`nama-${active.code}`}
              text={active.name}
              pemicu="segera"
              jeda={16}
              tunda={90}
              className="text-[11px] font-semibold text-slate-300"
            />
          </span>
        )}

        <form onSubmit={submit} className="relative min-w-[140px] flex-1">
          <label htmlFor="fn-cmd" className="sr-only">
            Jalankan kode fungsi
          </label>
          <Terminal
            className="pointer-events-none absolute left-2 top-1/2 w-3 h-3 -translate-y-1/2 text-amber-500/60"
            aria-hidden="true"
          />
          <input
            id="fn-cmd"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Ketik kode + Enter  ·  / untuk fokus"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded border border-slate-800 bg-slate-900 py-1 pl-7 pr-2 font-mono text-[11px] uppercase tracking-wider text-amber-200 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none"
          />
          {error && (
            <span className="absolute left-0 top-full z-20 mt-1 rounded border border-rose-800 bg-slate-950 px-2 py-1 text-[10px] text-rose-300 shadow-lg">
              {error}
            </span>
          )}
        </form>

        {children && <div className="flex shrink-0 items-center gap-3">{children}</div>}
      </div>
    </div>
  );
};
