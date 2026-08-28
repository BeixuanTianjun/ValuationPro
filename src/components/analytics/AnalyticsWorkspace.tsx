import React from 'react';
import { Calculator, Globe, Globe2, Landmark, Network, Scale, ServerCrash, Users } from 'lucide-react';
import { MarketDataState } from '../../hooks/useMarketData';
import { LeadersLaggards } from './LeadersLaggards';
import { ConglomerateRotation } from './ConglomerateRotation';
import { BrokerFlow } from './BrokerFlow';
import { AutoValuation } from './AutoValuation';
import { MutualFundTracker } from './MutualFundTracker';
import { MacroMonitor } from './MacroMonitor';
import { WorldMap } from './WorldMap';
import { recentSubs } from '../../data/functions';
import { EmptyState, Segmented, SegmentedOption, Spinner } from '../common/ui';

export type AnalyticsSubTab = 'leaders' | 'conglo' | 'funds' | 'broker' | 'valuation' | 'macro' | 'map';

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
  { id: 'conglo', label: 'Conglomerate Rotation', shortLabel: 'Conglo', icon: Network },
  { id: 'funds', label: 'Mutual Fund Tracker', shortLabel: 'Fund', icon: Landmark },
  { id: 'valuation', label: 'Auto Valuation', shortLabel: 'Valuation', icon: Calculator },
  { id: 'broker', label: 'Broker Summary', shortLabel: 'Broker', icon: Users },
  { id: 'macro', label: 'Global Drivers', shortLabel: 'Macro', icon: Globe },
  { id: 'map', label: 'Chokepoint Map', shortLabel: 'Map', icon: Globe2 },
];

/*
 * Three of these tools read their own data file — the ownership register, the
 * broker tape and the chokepoint map — and none needs the price database. They
 * stay usable while the rest of the terminal is still parsing 280 sessions of
 * history, so the loading branch below renders them rather than a spinner.
 *
 * They are listed inline in that branch rather than in an array. The array
 * version paired with a two-way ternary, so adding a third member silently
 * rendered the second one's component for it.
 */

export const AnalyticsWorkspace: React.FC<Props> = ({
  market,
  subTab,
  onSubTabChange,
  onSelectEmiten,
  onModelEmiten,
  focusEmiten,
}) => {
  const { db, fundamentals, factors, loading, error, reload } = market;

  /*
   * The new-tab dots come from the function registry, not from a second list
   * kept in step by hand. Macro and the chokepoint map both shipped at the end
   * of this row, which on a phone means past the right edge of the screen — the
   * dot plus the edge fade is what says the row continues.
   */
  const fresh = recentSubs('analytics');
  const tabs = TABS.map((t) => (fresh.has(t.id) ? { ...t, isNew: true } : t));

  const nav = (
    <Segmented options={tabs} value={subTab} onChange={onSubTabChange} ariaLabel="Alat analitik" />
  );

  if (loading || (!db && !error)) {
    return (
      <div className="space-y-4 sm:space-y-5">
        {nav}
        {/*
          Each self-loading tab must be named explicitly. A two-branch ternary
          quietly rendered the fund tracker for any third member added to
          SELF_LOADING — the loading state would have shown the wrong screen
          entirely, and only while the price database was still parsing, which is
          exactly when nobody is looking closely.
        */}
        {subTab === 'broker' ? (
          <BrokerFlow db={db} onSelectEmiten={onSelectEmiten} />
        ) : subTab === 'funds' ? (
          <MutualFundTracker db={db} onSelectEmiten={onSelectEmiten} focusEmiten={focusEmiten} />
        ) : subTab === 'map' ? (
          <WorldMap />
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
      {subTab === 'map' && <WorldMap />}
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
