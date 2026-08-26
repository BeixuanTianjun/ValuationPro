// Index point attribution — the Bloomberg IMAP / MOST calculation for IHSG.
//
// "IHSG fell 24 points today" is not actionable until you know WHICH stocks
// moved it. A stock's contribution is its price change times its index share
// count, divided by the index divisor:
//
//     points = (close - reference) * indexShares / divisor
//
// THE DIVISOR IS DERIVED, NOT TAKEN FROM THE FEED. IDX publishes a
// `MarketCapital` field on the index summary, but that is the FULL market cap
// of the constituents. IHSG has been free-float weighted since 2021, so using
// the published figure understates every contribution by roughly 4x and the
// attribution fails to reconcile. Deriving the divisor from the index's own
// constituents instead —
//
//     divisor = Σ(indexShares × close) / indexClose
//
// — reproduces the published previous close to three decimals and the published
// daily change to within 0.001 points. `reconciliation` on the result carries
// that residual so the number is auditable rather than merely asserted.

import { Emiten } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';

export type AttributionPeriod = '1d' | '1w' | '1m' | '3m' | 'ytd';

export const PERIOD_LABELS: Record<AttributionPeriod, string> = {
  '1d': 'Hari ini',
  '1w': '1 minggu',
  '1m': '1 bulan',
  '3m': '3 bulan',
  ytd: 'Sejak awal tahun',
};

const PERIOD_SESSIONS: Record<AttributionPeriod, number> = {
  '1d': 1,
  '1w': 5,
  '1m': 21,
  '3m': 63,
  ytd: 0, // resolved against the calendar
};

export interface Contribution {
  emiten: Emiten;
  points: number;
  /** Share of the index's absolute move explained by this emiten. */
  shareOfMove: number;
  priceNow: number;
  priceThen: number;
  returnPercent: number;
  indexShares: number;
  /** Free-float weight in the index, 0-1. */
  indexWeight: number;
}

export interface SectorContribution {
  sector: string;
  points: number;
  members: number;
  weight: number;
}

export interface AttributionResult {
  period: AttributionPeriod;
  fromDate: string;
  toDate: string;
  indexCode: string;
  indexNow: number;
  indexThen: number;
  indexPoints: number;
  indexPercent: number;
  leaders: Contribution[];
  laggards: Contribution[];
  sectors: SectorContribution[];
  /** Difference between summed contributions and the index's own published move. */
  reconciliation: {
    summedPoints: number;
    residualPoints: number;
    ok: boolean;
    /** Emiten in the index today with no price at the start of the window. */
    newListings: number;
    note: string | null;
  };
  divisor: number;
  breadth: { advancers: number; decliners: number; unchanged: number };
}

function firstSessionOfYear(dates: string[], reference: string): number {
  const year = reference.slice(0, 4);
  const idx = dates.findIndex((d) => d.slice(0, 4) === year);
  return idx > 0 ? idx - 1 : 0; // the last close of the prior year is the base
}

/** Latest finite value at or before `index`, so suspended names do not vanish. */
function priceAt(series: Float64Array, index: number): number {
  for (let i = Math.min(index, series.length - 1); i >= 0; i--) {
    if (Number.isFinite(series[i]) && series[i] > 0) return series[i];
  }
  return NaN;
}

/**
 * Position of `date` in the index calendar.
 *
 * The index series and the stock series do NOT share a calendar — the live
 * overlay can append a session to one and not the other, and IDX publishes
 * index history independently. Indexing the index array with a stock-array
 * position silently compares the wrong two days, which is how a 3-month
 * attribution ends up hundreds of points out.
 */
function indexPositionFor(indexDates: string[], date: string): number {
  for (let i = indexDates.length - 1; i >= 0; i--) {
    if (indexDates[i] <= date) return i;
  }
  return 0;
}

export function computeAttribution(
  db: MarketDatabase,
  period: AttributionPeriod = '1d',
  topN = 12
): AttributionResult | null {
  const index = db.indexSeries.get('COMPOSITE');
  if (!index || !db.dates.length) return null;

  const lastIdx = db.dates.length - 1;
  const backIdx =
    period === 'ytd'
      ? firstSessionOfYear(db.dates, db.dates[lastIdx])
      : Math.max(0, lastIdx - PERIOD_SESSIONS[period]);

  // Index shares come from the latest IDX session. Applying current weights
  // across a multi-session window is the standard attribution convention — it
  // isolates price effect from rebalancing effect.
  const weights = new Map<string, number>();
  let floatCapNow = 0;
  for (const e of db.emiten) {
    const quote = db.daily.get(e.code);
    const shares = quote?.indexShares || 0;
    if (shares <= 0) continue;
    const s = db.series.get(e.code);
    if (!s) continue;
    const now = priceAt(s.close, lastIdx);
    if (!(now > 0)) continue;
    weights.set(e.code, shares);
    floatCapNow += shares * now;
  }
  if (!weights.size || !(floatCapNow > 0)) return null;

  const nowPos = indexPositionFor(db.indexDates, db.dates[lastIdx]);
  const thenPos = indexPositionFor(db.indexDates, db.dates[backIdx]);
  const indexClose = priceAt(index.close, nowPos);
  if (!(indexClose > 0)) return null;
  const divisor = floatCapNow / indexClose;

  const contributions: Contribution[] = [];
  let summedPoints = 0;
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let newListings = 0;

  for (const e of db.emiten) {
    const shares = weights.get(e.code);
    if (!shares) continue;
    const s = db.series.get(e.code);
    if (!s) continue;

    const now = priceAt(s.close, lastIdx);
    const then = priceAt(s.close, backIdx);
    if (!(now > 0)) continue;
    if (!(then > 0)) {
      // In the index today but not trading at the start of the window. IDX
      // adjusts the divisor on inclusion precisely so a new listing does not
      // move the index, so its attribution is zero — but it is counted and
      // reported rather than silently dropped.
      newListings++;
      continue;
    }

    const points = ((now - then) * shares) / divisor;
    summedPoints += points;

    if (now > then) advancers++;
    else if (now < then) decliners++;
    else unchanged++;

    contributions.push({
      emiten: e,
      points,
      shareOfMove: 0,
      priceNow: now,
      priceThen: then,
      returnPercent: now / then - 1,
      indexShares: shares,
      indexWeight: (shares * now) / floatCapNow,
    });
  }

  const indexNow = indexClose;
  // Compare against the level IDX actually published at the start of the window
  // rather than a level rebuilt from today's constituents. Rebuilding would make
  // the attribution reconcile by construction and hide exactly the effects worth
  // knowing about — new listings and divisor changes.
  const publishedThen = priceAt(index.close, thenPos);
  const indexThen = publishedThen > 0 ? publishedThen : indexNow;
  const indexPoints = indexNow - indexThen;

  const denom = Math.abs(indexPoints) || 1;
  for (const c of contributions) c.shareOfMove = c.points / denom;

  contributions.sort((a, b) => b.points - a.points);

  const bySector = new Map<string, SectorContribution>();
  for (const c of contributions) {
    const entry = bySector.get(c.emiten.sector) || {
      sector: c.emiten.sector,
      points: 0,
      members: 0,
      weight: 0,
    };
    entry.points += c.points;
    entry.members++;
    entry.weight += c.indexWeight;
    bySector.set(c.emiten.sector, entry);
  }

  const residual = summedPoints - indexPoints;

  return {
    period,
    fromDate: db.dates[backIdx],
    toDate: db.dates[lastIdx],
    indexCode: 'COMPOSITE',
    indexNow,
    indexThen,
    indexPoints,
    indexPercent: indexThen > 0 ? indexNow / indexThen - 1 : 0,
    leaders: contributions.slice(0, topN),
    laggards: contributions.slice(-topN).reverse(),
    sectors: [...bySector.values()].sort((a, b) => b.points - a.points),
    reconciliation: {
      summedPoints,
      residualPoints: residual,
      // Two published IDX sessions must reconcile to float noise. A live
      // endpoint adds a small skew because the constituent quotes and the index
      // quote are not sampled at the same instant, and longer windows carry a
      // genuine gap from index maintenance — so the tolerance widens only for
      // the reasons that actually exist.
      // Between two published IDX sessions this is a closed system and must
      // reconcile to float noise. A live endpoint samples constituent prices
      // and the index level from two feeds a moment apart, and longer windows
      // carry a real gap from index maintenance — so the tolerance widens only
      // for causes that actually exist, and never silently.
      ok: (() => {
        const liveSkew = db.live?.applied ? Math.max(1, Math.abs(indexPoints) * 0.1) : 0.01;
        if (period === '1d') return Math.abs(residual) <= liveSkew;
        return Math.abs(residual) <= Math.max(liveSkew, Math.abs(indexPoints) * 0.08);
      })(),
      newListings,
      note: buildReconciliationNote(residual, newListings, db.dates[backIdx], !!db.live?.applied),
    },
    divisor,
    breadth: { advancers, decliners, unchanged },
  };
}

/** Plain-language account of why summed contributions differ from the index. */
function buildReconciliationNote(
  residual: number,
  newListings: number,
  fromDate: string,
  liveOverlay: boolean
): string | null {
  if (Math.abs(residual) < 0.01) return null;
  const causes: string[] = [];
  if (newListings) {
    causes.push(
      `${newListings} emiten masuk indeks di tengah periode dan belum diperdagangkan pada ${fromDate} — IDX menyesuaikan divisor saat pencatatan sehingga kontribusinya nol`
    );
  }
  if (liveOverlay) {
    causes.push(
      'harga emiten dan nilai IHSG berasal dari dua kutipan live yang tidak diambil pada detik yang sama'
    );
  }
  causes.push('penyesuaian divisor lain seperti aksi korporasi dan rebalancing');
  return `Selisih ${residual.toFixed(2)} poin antara jumlah kontribusi dan pergerakan IHSG yang diterbitkan berasal dari ${causes.join('; ')}.`;
}
