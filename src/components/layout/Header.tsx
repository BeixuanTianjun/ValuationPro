import React from 'react';
import { ActiveModelTab } from '../../types/common';
import { DEAL_PRESETS } from '../../presets/deals';
import {
  Building2,
  CandlestickChart,
  FileSpreadsheet,
  Gauge,
  Layers,
  LogIn,
  LogOut,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { AccountUser } from '../../data/authClient';

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

const NAV: { id: WorkspaceTab; label: string; icon: React.ElementType; active: string }[] = [
  { id: 'market', label: 'Pasar IDX', icon: CandlestickChart, active: 'bg-emerald-600 shadow-emerald-900/40' },
  { id: 'analytics', label: 'Analitik', icon: Gauge, active: 'bg-cyan-600 shadow-cyan-900/40' },
  { id: 'dcf', label: 'DCF', icon: TrendingUp, active: 'bg-blue-600 shadow-blue-900/40' },
  { id: 'lbo', label: 'LBO', icon: Layers, active: 'bg-indigo-600 shadow-indigo-900/40' },
];

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
  const badgeFor = (id: WorkspaceTab): string | null => {
    if (id === 'dcf') return `${currency.trim()} ${dcfTargetPrice.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
    if (id === 'lbo') return `${(lboIrr * 100).toFixed(1)}%`;
    return null;
  };

  return (
    <header className="sticky top-0 z-50 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800 px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-3">
        <button
          onClick={onHome}
          className="flex items-center gap-3 group cursor-pointer"
          aria-label="Kembali ke halaman depan"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-900/30 transition-transform duration-200 group-hover:scale-105">
            <TrendingUp className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="text-left">
            <div className="text-base font-extrabold tracking-tight text-white">
              Valuation<span className="text-blue-500">Pro</span>
            </div>
            <p className="text-[10px] text-slate-500 -mt-0.5">Terminal Pasar Modal Indonesia</p>
          </div>
        </button>

        <nav aria-label="Ruang kerja" className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
          {NAV.map(({ id, label, icon: Icon, active }) => {
            const badge = badgeFor(id);
            const on = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer ${
                  on ? `${active} text-white shadow-md` : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                <span>{label}</span>
                {badge && (
                  <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded bg-black/25 tabular-nums">{badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={onOpenChat}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 text-xs font-bold rounded-lg border border-indigo-500/30 transition-all duration-200 cursor-pointer"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Tanya Emiten</span>
          </button>

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <label htmlFor="preset-select" className="sr-only">
              Pilih emiten preset
            </label>
            <select
              id="preset-select"
              value={selectedPresetId}
              onChange={(e) => onSelectPreset(e.target.value)}
              className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer max-w-[130px] truncate"
            >
              {DEAL_PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onExportExcel}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-900/30 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isExporting ? 'Mengekspor…' : 'Export .xlsx'}</span>
          </button>

          {serviceUp &&
            (account ? (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg pl-2.5 pr-1.5 py-1.5">
                <span
                  className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                    account.role === 'administrator' ? 'bg-blue-600/20 text-blue-400' : 'bg-slate-800 text-slate-400'
                  }`}
                  title={account.role === 'administrator' ? 'Administrator' : 'Anggota'}
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
                <div className="leading-tight max-w-[130px]">
                  <div className="text-[11px] font-bold text-slate-200 truncate">{account.name}</div>
                  <div className="text-[9px] text-slate-500 truncate">{account.email}</div>
                </div>
                <button
                  onClick={onSignOut}
                  aria-label="Keluar"
                  title="Keluar"
                  className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-bold rounded-lg transition-all duration-200 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Masuk</span>
              </button>
            ))}
        </div>
      </div>
    </header>
  );
};
