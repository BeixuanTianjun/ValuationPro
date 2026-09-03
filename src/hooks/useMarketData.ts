import { useCallback, useEffect, useMemo, useState } from 'react';
import { invalidateIdxFiles } from '../data/idxFiles';
import {
  MarketDatabase,
  computeBreadth,
  invalidateMarketDatabase,
  loadMarketDatabase,
  loadRecentMarketDatabase,
} from '../data/marketRepository';
import {
  FundamentalsDatabase,
  invalidateFundamentalsDatabase,
  loadFundamentalsDatabase,
} from '../data/fundamentalsRepository';
import { computeAllFactors, forwardFill } from '../models/factorEngine';
import { FactorSnapshot, IndexQuote, MarketBreadth } from '../types/market';
import { describeIndex } from '../data/idxIndexCatalog';

export interface MarketDataState {
  db: MarketDatabase | null;
  fundamentals: FundamentalsDatabase | null;
  factors: Map<string, FactorSnapshot> | null;
  indices: IndexQuote[];
  breadth: MarketBreadth | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Epoch ms of the last successful load. Drives the "x detik lalu" readout. */
  loadedAt: number;
  /** Whether the polling loop is currently armed. */
  autoRefresh: boolean;
  setAutoRefresh: (on: boolean) => void;
  /** True while a background refresh is in flight — never blanks the screen. */
  refreshing: boolean;
}

/**
 * How often the terminal re-quotes while IDX is open.
 *
 * WHY 45 SECONDS AND NOT 5. The quote source is Yahoo, which publishes IDX on a
 * roughly 15-minute delay; TradingView's IDX feed is delayed too. Polling faster
 * than the upstream refreshes cannot produce a newer price — it only burns the
 * serverless function's budget and the user's data to receive the same numbers
 * again. Genuine tick-by-tick IDX data is a licensed exchange feed that brokers
 * like Stockbit pay for and redistribute under a data agreement; there is no
 * public endpoint for it at any polling rate. 45s keeps the screen visibly
 * moving without pretending the underlying feed is faster than it is, and the
 * status bar always prints how old the data actually is.
 */
const LIVE_POLL_MS = 45_000;

/** Phases where a new quote can actually exist. */
const LIVE_PHASES = new Set(['sesi-1', 'sesi-2', 'break', 'pre-open']);

const PERIODS = { m1: 21, m3: 63, m6: 126, m12: 252 };

function buildIndexQuotes(db: MarketDatabase): IndexQuote[] {
  const yearStart = db.indexDates.findIndex((d) => d.slice(0, 4) === db.meta.latestSession.slice(0, 4));

  return [...db.indexSeries.entries()]
    .map(([code, series]) => {
      const closes = forwardFill(series.close);
      const n = closes.length;
      const close = closes[n - 1];
      const prevClose = n > 1 ? closes[n - 2] : close;
      const back = (k: number) => (n > k && closes[n - 1 - k] > 0 ? close / closes[n - 1 - k] - 1 : NaN);
      const meta = describeIndex(code);

      let ytd = NaN;
      if (yearStart > 0 && closes[yearStart - 1] > 0) ytd = close / closes[yearStart - 1] - 1;
      else if (yearStart === 0 && closes[0] > 0) ytd = close / closes[0] - 1;

      const lastFinite = (arr: Float64Array): number => {
        for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i];
        return 0;
      };

      return {
        code,
        name: meta.name,
        group: meta.group,
        members: series.members,
        close,
        prevClose,
        changePercent: prevClose > 0 ? close / prevClose - 1 : 0,
        return1m: back(PERIODS.m1),
        return3m: back(PERIODS.m3),
        return6m: back(PERIODS.m6),
        return12m: back(PERIODS.m12),
        ytd,
        turnoverIdrBn: lastFinite(series.value) / 1e3,
        marketCapIdrTn: lastFinite(series.marketCap) / 1e3,
        closes,
      } as IndexQuote;
    })
    .filter((q) => q.close > 0);
}

export function useMarketData(enabled: boolean): MarketDataState {
  const [db, setDb] = useState<MarketDatabase | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsDatabase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled || db) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    // TWO PHASES, AND THE SECOND ONE MUST NOT BLANK THE FIRST.
    //
    // history.json is 5.2 MB over the wire and nothing can be drawn until it
    // arrives. The 400-session cut is 3.1 MB, so the terminal comes alive
    // roughly 40% sooner and the full history is swapped in behind it — the
    // same swap-in-place `refreshLive` does, and for the same reason: dropping
    // `db` back to null would send every panel to a spinner it had already
    // left.
    //
    // The lists do not change across the swap. That was measured, not hoped
    // for; see `loadRecentMarketDatabase`. What can change is a trade setup on
    // one of the ~7% of emiten with sparse high/low, which shows nothing until
    // the full file lands rather than showing a level built on air.
    Promise.all([loadRecentMarketDatabase(), loadFundamentalsDatabase()])
      .then(([market, funds]) => {
        if (cancelled) return;
        setDb(market);
        setFundamentals(funds);
        setLoadedAt(Date.now());
        setLoading(false);

        // Phase two. A failure here is not an error the user needs to see: the
        // recent database on screen is complete enough for every list, so the
        // only cost is that a handful of thin names keep their missing ATR.
        void loadMarketDatabase()
          .then((full) => {
            if (!cancelled && full !== market) setDb(full);
          })
          .catch(() => undefined);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, db, nonce]);

  const reload = useCallback(() => {
    invalidateMarketDatabase();
    invalidateFundamentalsDatabase();
    // Berkas sampingan ikut dibuang. Tombol ini ada untuk membaca ulang apa yang
    // ada di disk, dan pengumuman atau kepemilikan yang selamat dari penekanannya
    // akan membuat refresh-nya benar separuh — bentuk kegagalan yang paling sulit
    // dilihat, karena layarnya tetap memuat ulang dan sebagian angkanya berubah.
    invalidateIdxFiles();
    setDb(null);
    setFundamentals(null);
    setNonce((n) => n + 1);
  }, []);

  /**
   * Background re-quote.
   *
   * Deliberately NOT `reload()`: that blanks `db` and every panel falls back to
   * its spinner, which on a 45-second cadence would mean the terminal spends
   * its life loading. This swaps the database in only once the new one is
   * fully built, so the numbers change in place and nothing flickers.
   */
  const refreshLive = useCallback(async () => {
    // Berkas JSON-nya DIPERTAHANKAN. Yang dicari panggilan ini cuma harga baru,
    // dan harga datang dari /api/live yang memang selalu diambil segar.
    invalidateMarketDatabase({ keepFiles: true });
    setRefreshing(true);
    try {
      const market = await loadMarketDatabase();
      setDb(market);
      setLoadedAt(Date.now());
      setError(null);
    } catch {
      // A failed re-quote leaves the previous prices on screen. They are stale,
      // and the status bar's age readout is what says so — replacing a working
      // screen with an error because one poll timed out would be worse.
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Poll only while a new quote could exist. Outside market hours the price is
  // final and re-fetching it is pure noise.
  useEffect(() => {
    if (!enabled || !autoRefresh || !db) return;
    const phase = db.live?.sessionPhase;
    if (phase && !LIVE_PHASES.has(phase)) return;

    const timer = setInterval(() => {
      // Nothing is gained by re-quoting a tab nobody is looking at.
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshLive();
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, autoRefresh, db, refreshLive]);

  // Factor computation touches every emiten's full history, so it is memoised
  // against the database identity and never recomputed on a re-render.
  const factors = useMemo(() => (db ? computeAllFactors(db) : null), [db]);
  const indices = useMemo(() => (db ? buildIndexQuotes(db) : []), [db]);

  const breadth = useMemo(() => {
    if (!db || !factors) return null;
    const sma50 = new Map<string, number>();
    const sma200 = new Map<string, number>();
    for (const [code, f] of factors) {
      sma50.set(code, f.sma50);
      sma200.set(code, f.sma200);
    }
    return computeBreadth(db, sma50, sma200);
  }, [db, factors]);

  return {
    db,
    fundamentals,
    factors,
    indices,
    breadth,
    loading,
    error,
    reload,
    loadedAt,
    autoRefresh,
    setAutoRefresh,
    refreshing,
  };
}
