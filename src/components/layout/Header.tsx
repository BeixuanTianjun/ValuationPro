import React, { useEffect, useState } from 'react';
import { ActiveModelTab } from '../../types/common';
import { DEAL_PRESETS } from '../../presets/deals';
import {
  Building2,
  CandlestickChart,
  FileSpreadsheet,
  Gauge,
  Layers,
  LayoutGrid,
  LogIn,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  ShieldCheck,
  TrendingUp,
  X,
} from 'lucide-react';
import { AccountUser } from '../../data/authClient';
import { recentFunctions } from '../../data/functions';
import { cx } from '../common/ui';

type WorkspaceTab = ActiveModelTab | 'market' | 'analytics';

interface HeaderProps {
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onExportExcel: () => void;
  onOpenChat: () => void;
  onHome: () => void;
  isExporting: boolean;
  dcfTargetPrice: number;
  lboIrr: number;
  currency: string;
  account: AccountUser | null;
  serviceUp: boolean;
  onOpenAuth: () => void;
  onSignOut: () => void;
}

export const NAV: { id: WorkspaceTab; label: string; short: string; icon: React.ElementType; active: string }[] = [
  { id: 'market', label: 'IDX Market', short: 'Market', icon: CandlestickChart, active: 'bg-emerald-600 shadow-emerald-900/40' },
  { id: 'analytics', label: 'Analytics', short: 'Analytics', icon: Gauge, active: 'bg-cyan-600 shadow-cyan-900/40' },
  { id: 'dcf', label: 'DCF', short: 'DCF', icon: TrendingUp, active: 'bg-blue-600 shadow-blue-900/40' },
  { id: 'lbo', label: 'LBO', short: 'LBO', icon: Layers, active: 'bg-indigo-600 shadow-indigo-900/40' },
];

/**
 * The top bar.
 *
 * Below `lg` it carries only identity and an overflow button: on a 390px screen
 * there is no honest way to fit four workspace tabs, a preset picker, an export
 * button and an account chip, and cramming them produces 28px tap targets that
 * miss. Workspace switching moves to the bottom tab bar (`MobileTabBar`), which
 * is where a thumb already is, and everything else lives in the sheet.
 */
export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  selectedPresetId,
  onSelectPreset,
  onExportExcel,
  onOpenChat,
  onHome,
  isExporting,
  dcfTargetPrice,
  lboIrr,
  currency,
  account,
  serviceUp,
  onOpenAuth,
  onSignOut,
}) => {
  const [sheetOpen, setSheetOpen] = useState(false);

  // A route change must never leave the sheet hanging over the new screen.
  useEffect(() => {
    setSheetOpen(false);
  }, [activeTab]);

  const badgeFor = (id: WorkspaceTab): string | null => {
    if (id === 'dcf') return `${currency.trim()} ${dcfTargetPrice.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
    if (id === 'lbo') return `${(lboIrr * 100).toFixed(1)}%`;
    return null;
  };

  const presetPicker = (
    <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
      <Building2 className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden="true" />
      <label htmlFor="preset-select" className="sr-only">
        Pilih emiten preset
      </label>
      <select
        id="preset-select"
        value={selectedPresetId}
        onChange={(e) => onSelectPreset(e.target.value)}
        className="w-full cursor-pointer truncate bg-transparent text-xs font-medium text-slate-200 focus:outline-none lg:max-w-[130px]"
      >
        {DEAL_PRESETS.map((p) => (
          <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );

  const chatButton = (
    <button
      onClick={onOpenChat}
      className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-600/15 px-3 py-2 text-xs font-bold text-indigo-300 transition-colors hover:bg-indigo-600/25 touch-target"
    >
      <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
      <span>Tanya Emiten</span>
    </button>
  );

  const exportButton = (
    <button
      onClick={onExportExcel}
      disabled={isExporting}
      className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 touch-target"
    >
      <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{isExporting ? 'Mengekspor…' : 'Export .xlsx'}</span>
    </button>
  );

  const accountBlock =
    serviceUp &&
    (account ? (
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 py-1.5 pl-2.5 pr-1.5">
        <span
          className={cx(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            account.role === 'administrator' ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-800 text-slate-400'
          )}
          title={account.role === 'administrator' ? 'Administrator' : 'Anggota'}
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 leading-tight lg:max-w-[130px]">
          <div className="truncate text-[11px] font-bold text-slate-200">{account.name}</div>
          <div className="truncate text-[9px] text-slate-500">{account.email}</div>
        </div>
        <button
          onClick={onSignOut}
          aria-label="Keluar"
          title="Keluar"
          className="cursor-pointer rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    ) : (
      <button
        onClick={onOpenAuth}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-800 touch-target"
      >
        <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Masuk</span>
      </button>
    ));

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <button
          onClick={onHome}
          className="group flex shrink-0 cursor-pointer items-center gap-2.5"
          aria-label="Kembali ke halaman depan"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 shadow-none transition-transform duration-200 group-hover:scale-105">
            <TrendingUp className="h-5 w-5 text-black" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="text-sm font-extrabold tracking-tight text-white sm:text-base">
              Valuation<span className="text-amber-500">Pro</span>
            </div>
            <p className="-mt-0.5 hidden text-[10px] text-slate-500 sm:block">Terminal Pasar Modal Indonesia</p>
          </div>
        </button>

        {/* Desktop navigation ------------------------------------------- */}
        <nav
          aria-label="Ruang kerja"
          className="hidden rounded-xl border border-slate-800 bg-slate-900 p-1 lg:flex"
        >
          {NAV.map(({ id, label, icon: Icon, active }) => {
            const badge = badgeFor(id);
            const on = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors duration-200',
                  on ? `${active} text-white shadow-md` : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
                {badge && (
                  <span className="ml-0.5 rounded bg-black/25 px-1.5 py-0.5 text-[10px] tabular-nums">{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {chatButton}
          {presetPicker}
          {exportButton}
          {accountBlock}
        </div>

        {/* Mobile overflow ---------------------------------------------- */}
        <button
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Tutup menu' : 'Buka menu'}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 transition-colors hover:text-white lg:hidden"
        >
          {sheetOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>

      {sheetOpen && (
        <div className="border-t border-slate-800 bg-slate-950 px-4 py-4 lg:hidden">
          <div className="grid gap-2.5">
            {presetPicker}
            <div className="grid grid-cols-2 gap-2.5">
              {chatButton}
              {exportButton}
            </div>
            {accountBlock}
          </div>
        </div>
      )}
    </header>
  );
};

/**
 * The mobile workspace switcher.
 *
 * Fixed to the bottom because that is where a thumb rests, and because a
 * terminal is scrolled constantly — a top tab row would be off-screen exactly
 * when it is wanted.
 *
 * THE FIFTH BUTTON IS THE FUNCTION MENU, and it is the fix for a real
 * navigation dead end. Four workspaces cannot show fifteen screens: on a phone
 * the analytics sub-tabs scroll sideways, so the newest ones sit past the right
 * edge of a 390px viewport and simply are not there as far as anybody scrolling
 * vertically is concerned. The launcher lists every function on one screen, and
 * before this it was reachable only by Ctrl+K — a keystroke a phone does not
 * have — or by the small MENU chip in the command bar, which is above the fold
 * and easy to read as decoration. It carries a dot while any screen is still
 * flagged new, so "there is something here you have not seen" is visible
 * without opening anything.
 */
export const MobileTabBar: React.FC<{
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  onOpenMenu: () => void;
}> = ({ activeTab, setActiveTab, onOpenMenu }) => {
  const hasNew = recentFunctions().length > 0;
  return (
    <nav
      aria-label="Ruang kerja"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950 backdrop-blur-xl pb-safe lg:hidden"
    >
      <div className="grid grid-cols-5">
        {NAV.map(({ id, short, icon: Icon }) => {
          const on = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'flex cursor-pointer flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition-colors',
                on ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              <Icon className={cx('h-5 w-5', on && 'drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]')} aria-hidden="true" />
              <span>{short}</span>
            </button>
          );
        })}

        <button
          onClick={onOpenMenu}
          aria-label="Buka function menu"
          className="flex cursor-pointer flex-col items-center gap-1 py-2.5 text-[10px] font-bold text-amber-400 transition-colors hover:text-amber-300"
        >
          <span className="relative">
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            {hasNew && (
              <span
                className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-slate-950"
                aria-hidden="true"
              />
            )}
          </span>
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
};
