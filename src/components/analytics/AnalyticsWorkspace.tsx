import React from 'react';
import { Calculator, Globe, Landmark, Network, Scale, ServerCrash, Users } from 'lucide-react';
import { MarketDataState } from '../../hooks/useMarketData';
import { LeadersLaggards } from './LeadersLaggards';
import { ConglomerateRotation } from './ConglomerateRotation';
import { BrokerFlow } from './BrokerFlow';
import { AutoValuation } from './AutoValuation';
import { MutualFundTracker } from './MutualFundTracker';
import { MacroMonitor } from './MacroMonitor';
import { EmptyState, Segmented, SegmentedOption, Spinner } from '../common/ui';

export type AnalyticsSubTab = 'leaders' | 'conglo' | 'funds' | 'broker' | 'valuation' | 'macro';

interface Props {
  market: MarketDataState;
  subTab: AnalyticsSubTab;
  onSubTabChange: (tab: AnalyticsSubTab) => void;
  onSelectEmiten: (code: string) => void;
  onModelEmiten: (code: string) => void;
  /** Emiten to open in the ownership tracker on arrival. */
  focusEmiten?: string | null;
}

const TABS: SegmentedOption<AnalyticsSubTab>[] = [
  { id: 'leaders', label: 'Leaders & Laggards', shortLabel: 'Leaders', icon: Scale },
  { id: 'conglo', label: 'Rotasi Konglomerasi', shortLabel: 'Konglo', icon: Network },
  { id: 'funds', label: 'Mutual Fund Tracker', shortLabel: 'Fund', icon: Landmark },
  { id: 'valuation', label: 'Valuasi Otomatis', shortLabel: 'Valuasi', icon: Calculator },
  { id: 'broker', label: 'Broker Summary', shortLabel: 'Broker', icon: Users },
  { id: 'macro', label: 'Dunia Luar', shortLabel: 'Makro', icon: Globe },
];

/**
 * Two of these tools read their own data file — the ownership register and the
 * broker tape — and neither needs the price database. They stay usable while
 * the rest of the terminal is still parsing 280 sessions of history, so the
 * loading branch renders them rather than a spinner.
 */
const SELF_LOADING: AnalyticsSubTab[] = ['broker', 'funds'];

export const AnalyticsWorkspace: React.FC<Props> = ({
  market,
  subTab,
  onSubTabChange,
  onSelectEmiten,
  onModelEmiten,
  focusEmiten,
}) => {
  const { db, fundamentals, factors, loading, error, reload } = market;

  const nav = (
    <Segmented options={TABS} value={subTab} onChange={onSubTabChange} ariaLabel="Alat analitik" />
  );

  if (loading || (!db && !error)) {
    return (
      <div className="space-y-4 sm:space-y-5">
        {nav}
        {SELF_LOADING.includes(subTab) ? (
          subTab === 'broker' ? (
            <BrokerFlow db={db} onSelectEmiten={onSelectEmiten} />
          ) : (
            <MutualFundTracker db={db} onSelectEmiten={onSelectEmiten} focusEmiten={focusEmiten} />
          )
        ) : (
          <Spinner label="Memuat basis data pasar…" />
        )}
      </div>
    );
  }

  if (error || !db) {
    return (
      <div className="space-y-4 sm:space-y-5">
        {nav}
        <EmptyState icon={ServerCrash} title="Database pasar belum tersedia" tone="error">
          <p>{error}</p>
          <button
            onClick={reload}
            className="mt-4 cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500 touch-target"
          >
            Coba muat ulang
          </button>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {nav}

      {subTab === 'leaders' && <LeadersLaggards db={db} onSelectEmiten={onSelectEmiten} />}
      {subTab === 'conglo' && <ConglomerateRotation db={db} factors={factors} onSelectEmiten={onSelectEmiten} />}
      {subTab === 'funds' && (
        <MutualFundTracker db={db} onSelectEmiten={onSelectEmiten} focusEmiten={focusEmiten} />
      )}
      {subTab === 'broker' && <BrokerFlow db={db} onSelectEmiten={onSelectEmiten} />}
      {subTab === 'macro' && <MacroMonitor db={db} />}
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
