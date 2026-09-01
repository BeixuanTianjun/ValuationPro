// Rule-based stock screener.
//
// This deliberately replaced an earlier weighted-composite factor model, which
// ranked the whole universe and handed back the top of a distribution — useful,
// but it always returned something, and it could not be checked by hand. This
// one applies three hard rules and reports pass or fail for each, so the answer
// to "why is this stock here" is a row of ticks rather than a score you have to
// trust.
//
// THE RULES, as specified:
//
//   1. Close above both the 3-session and the 5-session moving average.
//   2. Volume above 1,000,000 shares.
//   3. Turnover value above Rp 1,000,000,000.
//
// WHY RULES 2 AND 3 ARE BOTH NEEDED, and are not the same rule twice: they bind
// at different ends of the price range. On IDX a Rp 50 stock can print
// 40,000,000 shares and still turn over only Rp 2bn, while a Rp 30,000 stock
// turning over Rp 9bn trades 300,000 shares. Rule 2 throws out the illiquid
// high-priced names, rule 3 throws out the penny-stock churn. Keeping only one
// of them lets a whole class of untradeable stock through.
//
// UNITS — THE TRAP IN THIS FILE. `PriceSeries.volume` is in LOTS (the repository
// divides shares by 100 on the way in) and `PriceSeries.value` is in IDR
// MILLION. The rule thresholds are in shares and rupiah. Every conversion in
// this file is explicit for that reason; comparing a lot count against
// 1,000,000 would silently screen for 100 million shares and return almost
// nothing on a quiet session.

import { Emiten, FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';

const SHARES_PER_LOT = 100;
const IDR_MN = 1e6;
const IDR_BN = 1e9;

export interface ScreenerSettings {
  /** Short moving average in sessions. */
  maShort: number;
  /** Long moving average in sessions. */
  maLong: number;
  /** Minimum traded volume, in SHARES. */
  minVolumeShares: number;
  /** Minimum traded value, in IDR. */
  minValueIdr: number;
  /** Optional board restriction; empty means every board. */
  boards: string[];
  /** Optional sector restriction; empty means every sector. */
  sectors: string[];
}

export const DEFAULT_SCREENER_SETTINGS: ScreenerSettings = {
  maShort: 3,
  maLong: 5,
  minVolumeShares: 1_000_000,
  minValueIdr: 1_000_000_000,
  boards: [],
  sectors: [],
};

export interface ScreenerRow {
  code: string;
  name: string;
  sector: string;
  board: string;
  close: number;
  prevClose: number;
  changePercent: number;
  maShort: number;
  maLong: number;
  aboveMaShort: boolean;
  aboveMaLong: boolean;
  /** MA(short) above MA(long): the short-term averages stacked in order. */
  maStacked: boolean;
  /** How far the close sits above the longer average, as a fraction. */
  premiumToMaLong: number;
  volumeShares: number;
  valueIdr: number;
  freq: number;
  foreignNetIdrBn: number;
  marketCapIdrBn: number;
  /** Consecutive sessions the close has held above the longer average. */
  sessionsAboveMaLong: number;
  /** Today's volume over the 20-session average. */
  volumeSurge: number;
  passMa: boolean;
  passVolume: boolean;
  passValue: boolean;
  passAll: boolean;
}

export interface FunnelStage {
  id: string;
  label: string;
  /** How many emiten remain after this stage. */
  remaining: number;
  /** How many this stage removed. */
  removed: number;
}

export interface ScreenerResult {
  session: string;
  /** True when the newest row came from the intraday overlay, not an IDX close. */
  live: boolean;
  settings: ScreenerSettings;
  universe: number;
  rows: ScreenerRow[];
  funnel: FunnelStage[];
  /** Every evaluated row, passing or not — for the "why did X fail" lookup. */
  all: Map<string, ScreenerRow>;
}

/** Mean of the last `k` finite values, or NaN if the window is not complete. */
function tailMean(arr: Float64Array, k: number): number {
  let sum = 0;
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && n < k; i--) {
    const v = arr[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n === k ? sum / k : NaN;
}

/** Mean over the last `k` slots, treating a non-trading session as zero. */
function tailMeanZero(arr: Float64Array, k: number): number {
  let sum = 0;
  const from = Math.max(0, arr.length - k);
  for (let i = from; i < arr.length; i++) if (Number.isFinite(arr[i])) sum += arr[i];
  return arr.length > from ? sum / (arr.length - from) : NaN;
}

/**
 * Moving average ending at the session BEFORE the last one is not what we want:
 * "close above MA3" on IDX conventionally includes today's close in the
 * average. Both readings are defensible; this uses the inclusive one because it
 * is what a charting package draws, and a screener that disagrees with the
 * user's chart is worse than useless.
 */
function movingAverage(close: Float64Array, k: number): number {
  return tailMean(close, k);
}

function countSessionsAbove(close: Float64Array, k: number): number {
  // Walk back while each session's close was above its own trailing average.
  let count = 0;
  const finite: number[] = [];
  for (let i = 0; i < close.length; i++) if (Number.isFinite(close[i])) finite.push(close[i]);
  for (let i = finite.length - 1; i >= k - 1; i--) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += finite[i - j];
    const ma = sum / k;
    if (finite[i] > ma) count++;
    else break;
  }
  return count;
}

export function runStockScreener(db: MarketDatabase, partial: Partial<ScreenerSettings> = {}): ScreenerResult {
  const settings: ScreenerSettings = { ...DEFAULT_SCREENER_SETTINGS, ...partial };

  const universe: Emiten[] = db.emiten;
  let afterFilter = 0;
  let afterMa = 0;
  let afterVolume = 0;
  let afterValue = 0;

  const rows: ScreenerRow[] = [];
  const all = new Map<string, ScreenerRow>();

  for (const e of universe) {
    if (settings.boards.length && !settings.boards.includes(e.board)) continue;
    if (settings.sectors.length && !settings.sectors.includes(e.sector)) continue;
    afterFilter++;

    const series = db.series.get(e.code);
    const quote = db.daily.get(e.code);
    if (!series || !quote) continue;

    const close = series.close;
    const n = close.length;
    if (!n) continue;

    const last = quote.close;
    if (!(last > 0)) continue;

    const maS = movingAverage(close, settings.maShort);
    const maL = movingAverage(close, settings.maLong);
    // Compare on the adjusted scale the averages are computed on. Using the
    // raw traded close against an adjusted average would flag every emiten
    // that had a split in the window.
    const adjustedLast = Number.isFinite(close[n - 1]) ? close[n - 1] : last;

    const aboveMaShort = Number.isFinite(maS) && adjustedLast > maS;
    const aboveMaLong = Number.isFinite(maL) && adjustedLast > maL;

    const volumeShares = quote.volume;
    const valueIdr = quote.value;

    const passMa = aboveMaShort && aboveMaLong;
    const passVolume = volumeShares > settings.minVolumeShares;
    const passValue = valueIdr > settings.minValueIdr;

    if (passMa) afterMa++;
    if (passMa && passVolume) afterVolume++;
    if (passMa && passVolume && passValue) afterValue++;

    const row: ScreenerRow = {
      code: e.code,
      name: e.name,
      sector: e.sector,
      board: e.board,
      close: last,
      prevClose: quote.prev,
      changePercent: quote.prev > 0 ? last / quote.prev - 1 : NaN,
      maShort: maS,
      maLong: maL,
      aboveMaShort,
      aboveMaLong,
      maStacked: Number.isFinite(maS) && Number.isFinite(maL) && maS > maL,
      premiumToMaLong: Number.isFinite(maL) && maL > 0 ? adjustedLast / maL - 1 : NaN,
      volumeShares,
      valueIdr,
      freq: quote.freq,
      foreignNetIdrBn: quote.foreignNet / IDR_BN,
      marketCapIdrBn: quote.marketCap / IDR_BN,
      sessionsAboveMaLong: countSessionsAbove(close, settings.maLong),
      volumeSurge: (() => {
        // series.volume is in lots; the ratio is unitless so no conversion is
        // needed here, only consistency.
        const avg20 = tailMeanZero(series.volume, 20);
        const today = volumeShares / SHARES_PER_LOT;
        return avg20 > 0 ? today / avg20 : NaN;
      })(),
      passMa,
      passVolume,
      passValue,
      passAll: passMa && passVolume && passValue,
    };

    all.set(e.code, row);
    if (row.passAll) rows.push(row);
  }

  // Strongest first by turnover: among stocks that all pass the same three
  // rules, the one the market is actually transacting in is the one you can
  // get filled in.
  rows.sort((a, b) => b.valueIdr - a.valueIdr);

  const funnel: FunnelStage[] = [
    { id: 'universe', label: 'Emiten tercatat', remaining: afterFilter, removed: universe.length - afterFilter },
    {
      id: 'ma',
      label: `Di atas MA${settings.maShort} dan MA${settings.maLong}`,
      remaining: afterMa,
      removed: afterFilter - afterMa,
    },
    {
      id: 'volume',
      label: `Volume > ${(settings.minVolumeShares / 1e6).toLocaleString('id-ID')} juta saham`,
      remaining: afterVolume,
      removed: afterMa - afterVolume,
    },
    {
      id: 'value',
      label: `Nilai transaksi > Rp ${(settings.minValueIdr / IDR_BN).toLocaleString('id-ID')} miliar`,
      remaining: afterValue,
      removed: afterVolume - afterValue,
    },
  ];

  return {
    session: db.meta.latestSession,
    live: Boolean(db.live?.applied),
    settings,
    universe: universe.length,
    rows,
    funnel,
    all,
  };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * Conviction score, 0..1 — orders the rows that already passed the three hard
 * rules, it never decides which ones pass.
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A FIELD ON ScreenerRow. The rest of
 * this file is deliberately a gate, not a score — see the file header. Folding
 * a composite number into passAll's neighbourhood would make it look like a
 * fourth rule. This stays a ranking the UI applies on top, so "why did X pass"
 * still has three checkable answers and "why is X ranked first among the ones
 * that passed" has this one, kept visibly separate.
 *
 * Inputs: today's volume surge and trend premium (from the row itself, always
 * present), plus RSI/trend-quality/relative-strength when a factor snapshot is
 * available (it usually is, but the screener can run before factors finish
 * computing — this degrades gracefully to the row-only signals instead of
 * throwing).
 */
export function convictionScore(row: ScreenerRow, f?: FactorSnapshot): number {
  const surge = clamp01(((row.volumeSurge ?? 1) - 1) / 1.5); // 1x -> 0, 2.5x+ -> 1
  const flow = clamp01(row.foreignNetIdrBn / 5); // Rp 5bn+ net foreign buy saturates
  const trend = clamp01(row.premiumToMaLong / 0.08); // 8%+ above the long MA saturates
  const persistence = clamp01(row.sessionsAboveMaLong / 10);
  // RSI rewards strength without punishing it as "overbought" until it is
  // actually stretched — 60 is the sweet spot, both 20 and 100 score 0.
  const rsi = Number.isFinite(f?.rsi14) ? clamp01(1 - Math.abs((f!.rsi14 - 60) / 40)) : 0.4;
  const quality = Number.isFinite(f?.trendQuality) ? clamp01(f!.trendQuality) : 0;
  const relStrength = Number.isFinite(f?.relativeStrength3m) ? clamp01((f!.relativeStrength3m + 0.1) / 0.3) : 0;
  return clamp01(
    surge * 0.2 + flow * 0.2 + trend * 0.15 + persistence * 0.1 + rsi * 0.15 + quality * 0.1 + relStrength * 0.1
  );
}

export { IDR_BN, IDR_MN, SHARES_PER_LOT };
