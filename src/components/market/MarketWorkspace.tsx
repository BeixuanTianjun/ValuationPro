import React, { useEffect, useState } from 'react';
import { Building2, LineChart, Loader2, MessageSquare, ServerCrash, Target } from 'lucide-react';
import { MarketDataState } from '../../hooks/useMarketData';
import { MarketOverview } from './MarketOverview';
import { EmitenBrowser } from './EmitenBrowser';
import { EmitenDetail } from './EmitenDetail';
import { AlphaScreener } from './AlphaScreener';
import { EmitenChat } from '../chat/EmitenChat';
import { EmitenModelBundle, buildEmitenModel } from '../../models/idxCompanyBridge';

export type MarketSubTab = 'overview' | 'emiten' | 'screener' | 'chat';

interface Props {
  market: MarketDataState;
  subTab: MarketSubTab;
  onSubTabChange: (tab: MarketSubTab) => void;
  onApplyModel: (bundle: EmitenModelBundle) => void;
  /** Emiten to open on arrival, set when navigating in from another workspace. */
  focusEmiten?: string | null;
  onFocusHandled?: () => void;
}

const TABS: { id: MarketSubTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Ikhtisar Pasar', icon: LineChart },
  { id: 'screener', label: 'Stock Pick Harian', icon: Target },
  { id: 'chat', label: 'Tanya Emiten', icon: MessageSquare },
  { id: 'emiten', label: 'Basis Data Emiten', icon: Building2 },
];

export const MarketWorkspace: React.FC<Props> = ({
  market,
  subTab,
  onSubTabChange,
  onApplyModel,
  focusEmiten,
  onFocusHandled,
}) => {
  const { db, fundamentals, factors, indices, breadth, loading, error, reload } = market;
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!focusEmiten) return;
    setSelectedCode(focusEmiten);
    onFocusHandled?.();
  }, [focusEmiten, onFocusHandled]);

  const openEmiten = (code: string) => {
    setSelectedCode(code);
    onSubTabChange('emiten');
  };

  const applyModel = (code: string) => {
    if (!db || !fundamentals) return;
    const emiten = db.byCode.get(code);
    if (!emiten) return;
    const bundle = buildEmitenModel(emiten, db, fundamentals);
    if (bundle) onApplyModel(bundle);
  };

  if (loading || (!db && !error)) {
    return (
      <div className="flex flex-col items-center justify-center py-28 gap-4">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl border border-slate-800 bg-slate-900 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" aria-hidden="true" />
          </div>
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div className="h-full w-8 bg-gradient-to-r from-transparent via-blue-500/20 to-transparent animate-sweep" />
          </div>
        </div>
        <div className="text-sm font-semibold text-slate-300">Memuat basis data pasar IDX…</div>
        <div className="text-[11px] text-slate-500">962 emiten, 45 indeks, dan riwayat harga harian sedang diuraikan.</div>
      </div>
    );
  }

  if (error || !db) {
    return (
      <div className="bg-slate-900 border border-rose-900/50 rounded-2xl p-8 text-center max-w-2xl mx-auto animate-rise">
        <ServerCrash className="w-8 h-8 text-rose-400 mx-auto mb-3" aria-hidden="true" />
        <div className="text-sm font-bold text-white">Database pasar belum tersedia</div>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">{error}</p>
        <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:all</code>
          <p className="text-[10px] text-slate-500 mt-1">
            Menarik semesta emiten, 45 indeks, ~280 sesi perdagangan, dan laporan keuangan tahunan.
          </p>
        </div>
        <button
          onClick={reload}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
        >
          Coba muat ulang
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <nav
        aria-label="Bagian pasar"
        className="flex bg-slate-900/70 p-1.5 rounded-xl border border-slate-800 gap-1 w-fit overflow-x-auto"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSubTabChange(id)}
            aria-current={subTab === id ? 'page' : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer whitespace-nowrap ${
              subTab === id
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {subTab === 'overview' && (
        <MarketOverview db={db} indices={indices} breadth={breadth} onReload={reload} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'screener' && (
        <AlphaScreener
          db={db}
          factors={factors}
          breadth={breadth}
          onSelectEmiten={openEmiten}
          onModelEmiten={applyModel}
        />
      )}

      {subTab === 'chat' && (
        <EmitenChat db={db} factors={factors} fundamentals={fundamentals} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'emiten' && (
        <div className="space-y-5">
          {selectedCode && (
            <EmitenDetail
              code={selectedCode}
              db={db}
              fundamentals={fundamentals}
              factors={factors}
              onClose={() => setSelectedCode(null)}
              onApplyToModels={applyModel}
            />
          )}
          <EmitenBrowser
            db={db}
            factors={factors}
            fundamentals={fundamentals}
            selectedCode={selectedCode}
            onSelect={setSelectedCode}
          />
        </div>
      )}
    </div>
  );
};
