import React from 'react';
import { Calculator, Loader2, Network, Scale, ServerCrash, Users } from 'lucide-react';
import { MarketDataState } from '../../hooks/useMarketData';
import { LeadersLaggards } from './LeadersLaggards';
import { ConglomerateRotation } from './ConglomerateRotation';
import { BrokerFlow } from './BrokerFlow';
import { AutoValuation } from './AutoValuation';

export type AnalyticsSubTab = 'leaders' | 'conglo' | 'broker' | 'valuation';

interface Props {
  market: MarketDataState;
  subTab: AnalyticsSubTab;
  onSubTabChange: (tab: AnalyticsSubTab) => void;
  onSelectEmiten: (code: string) => void;
  onModelEmiten: (code: string) => void;
}

const TABS: { id: AnalyticsSubTab; label: string; icon: React.ElementType }[] = [
  { id: 'leaders', label: 'Leaders & Laggards', icon: Scale },
  { id: 'conglo', label: 'Rotasi Konglomerasi', icon: Network },
  { id: 'valuation', label: 'Valuasi Otomatis', icon: Calculator },
  { id: 'broker', label: 'Broker Flow', icon: Users },
];

export const AnalyticsWorkspace: React.FC<Props> = ({
  market,
  subTab,
  onSubTabChange,
  onSelectEmiten,
  onModelEmiten,
}) => {
  const { db, fundamentals, factors, loading, error, reload } = market;

  const nav = (
    <nav
      aria-label="Alat analitik"
      className="flex bg-slate-900/70 p-1.5 rounded-xl border border-slate-800 gap-1 w-fit overflow-x-auto"
    >
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onSubTabChange(id)}
          aria-current={subTab === id ? 'page' : undefined}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer whitespace-nowrap ${
            subTab === id
              ? 'bg-cyan-600 text-white shadow-md shadow-cyan-900/40'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
          }`}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );

  // Broker flow reads its own file and does not need the market database, so it
  // stays usable even while the rest is still loading.
  if (loading || (!db && !error)) {
    return (
      <div className="space-y-5">
        {nav}
        {subTab === 'broker' ? (
          <BrokerFlow />
        ) : (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-6 h-6 text-cyan-500 animate-spin" aria-hidden="true" />
            <div className="text-sm text-slate-300">Memuat basis data pasar…</div>
          </div>
        )}
      </div>
    );
  }

  if (error || !db) {
    return (
      <div className="space-y-5">
        {nav}
        <div className="rounded-2xl border border-rose-900/50 bg-slate-900 p-8 text-center max-w-2xl mx-auto">
          <ServerCrash className="w-8 h-8 text-rose-400 mx-auto mb-3" aria-hidden="true" />
          <div className="text-sm font-bold text-white">Database pasar belum tersedia</div>
          <p className="text-xs text-slate-400 mt-2">{error}</p>
          <button
            onClick={reload}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            Coba muat ulang
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {nav}

      {subTab === 'leaders' && <LeadersLaggards db={db} onSelectEmiten={onSelectEmiten} />}
      {subTab === 'conglo' && <ConglomerateRotation db={db} factors={factors} onSelectEmiten={onSelectEmiten} />}
      {subTab === 'broker' && <BrokerFlow />}
      {subTab === 'valuation' && (
        <AutoValuation
          db={db}
          fundamentals={fundamentals}
          factors={factors}
          onSelectEmiten={onSelectEmiten}
          onModelEmiten={onModelEmiten}
        />
      )}
    </div>
  );
};
