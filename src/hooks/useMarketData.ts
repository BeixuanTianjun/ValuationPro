import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MarketDatabase,
  computeBreadth,
  invalidateMarketDatabase,
  loadMarketDatabase,
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
}

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

  useEffect(() => {
    if (!enabled || db) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadMarketDatabase(), loadFundamentalsDatabase()])
      .then(([market, funds]) => {
        if (cancelled) return;
        setDb(market);
        setFundamentals(funds);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, db, nonce]);

  const reload = useCallback(() => {
    invalidateMarketDatabase();
    invalidateFundamentalsDatabase();
    setDb(null);
    setFundamentals(null);
    setNonce((n) => n + 1);
  }, []);

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

  return { db, fundamentals, factors, indices, breadth, loading, error, reload };
}
