import React, { useEffect, useState } from 'react';
import { Briefcase, Building2, CalendarDays, LineChart, MessageSquare, Newspaper, ServerCrash, Target } from 'lucide-react';
import { MarketDataState } from '../../hooks/useMarketData';
import { MarketOverview } from './MarketOverview';
import { EmitenBrowser } from './EmitenBrowser';
import { EmitenDetail } from './EmitenDetail';
import { StockScreenerPanel } from './StockScreenerPanel';
import { StockWatchlist } from './StockWatchlist';
import { PortfolioTracker } from './PortfolioTracker';
import { AnnouncementFeed } from './AnnouncementFeed';
import { EmitenChat } from '../chat/EmitenChat';
import { EmitenModelBundle, buildEmitenModel } from '../../models/idxCompanyBridge';
import { recentSubs } from '../../data/functions';
import { EmptyState, Segmented, SegmentedOption, Spinner } from '../common/ui';

export type MarketSubTab = 'overview' | 'emiten' | 'screener' | 'watchlist' | 'portfolio' | 'news' | 'chat';

interface Props {
  market: MarketDataState;
  subTab: MarketSubTab;
  onSubTabChange: (tab: MarketSubTab) => void;
  onApplyModel: (bundle: EmitenModelBundle) => void;
  /** Emiten to open on arrival, set when navigating in from another workspace. */
  focusEmiten?: string | null;
  onFocusHandled?: () => void;
}

const TABS: SegmentedOption<MarketSubTab>[] = [
  { id: 'overview', label: 'Market Overview', shortLabel: 'Overview', icon: LineChart },
  { id: 'screener', label: 'Stock Screener', shortLabel: 'Screener', icon: Target },
  { id: 'watchlist', label: 'Stock Watchlist', shortLabel: 'Watchlist', icon: CalendarDays },
  { id: 'portfolio', label: 'Portofolio', shortLabel: 'Portofolio', icon: Briefcase },
  { id: 'news', label: 'Company Disclosures', shortLabel: 'Disclosures', icon: Newspaper },
  { id: 'chat', label: 'Ask a Company', shortLabel: 'Ask', icon: MessageSquare },
  { id: 'emiten', label: 'Company Database', shortLabel: 'Companies', icon: Building2 },
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
    return <Spinner label="Memuat basis data pasar IDX — 962 emiten, 45 indeks, dan riwayat harga harian." />;
  }

  if (error || !db) {
    return (
      <EmptyState icon={ServerCrash} title="Database pasar belum tersedia" tone="error">
        <p>{error}</p>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3 text-left">
          <code className="text-[11px] text-blue-400">npm run data:all</code>
          <p className="mt-1 text-[10px] text-slate-500">
            Menarik semesta emiten, 45 indeks, ~280 sesi perdagangan, laporan keuangan tahunan, dan register
            kepemilikan KSEI.
          </p>
        </div>
        <button
          onClick={reload}
          className="mt-4 cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-500 touch-target"
        >
          Coba muat ulang
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Segmented
        options={TABS.map((t) => (recentSubs('market').has(t.id) ? { ...t, isNew: true } : t))}
        value={subTab}
        onChange={onSubTabChange}
        ariaLabel="Bagian pasar"
        activeClass="bg-emerald-600 text-white shadow-md shadow-emerald-900/40"
      />

      {subTab === 'overview' && (
        <MarketOverview db={db} indices={indices} breadth={breadth} onReload={reload} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'screener' && (
        <StockScreenerPanel db={db} factors={factors} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'watchlist' && (
        <StockWatchlist db={db} factors={factors} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'portfolio' && (
        <PortfolioTracker db={db} factors={factors} onSelectEmiten={openEmiten} />
      )}

      {subTab === 'news' && (
        <AnnouncementFeed db={db} onSelectEmiten={openEmiten} />
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
