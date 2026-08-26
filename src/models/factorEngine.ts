// Factor engine — turns raw IDX daily bars into the momentum / trend / risk /
// liquidity / foreign-flow readings the alpha screener ranks on.
//
// All windows are expressed in trading sessions, not calendar days:
//   1w = 5   1m = 21   3m = 63   6m = 126   12m = 252

import { FactorSnapshot, PriceSeries } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { SECTOR_TO_INDEX } from '../data/idxIndexCatalog';

export const W = { w1: 5, m1: 21, m3: 63, m6: 126, m12: 252 } as const;

// ------------------------------------------------------------- array helpers

/** Carry the last traded price across suspended / untraded sessions. */
export function forwardFill(src: Float64Array): Float64Array {
  const out = new Float64Array(src.length);
  let last = NaN;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isFinite(v) && v > 0) last = v;
    out[i] = last;
  }
  // Back-fill the leading gap so early windows do not poison the averages.
  let first = NaN;
  for (let i = 0; i < out.length; i++) {
    if (Number.isFinite(out[i])) {
      first = out[i];
      break;
    }
  }
  for (let i = 0; i < out.length && !Number.isFinite(out[i]); i++) out[i] = first;
  return out;
}

function tailMean(arr: Float64Array, k: number): number {
  const n = arr.length;
  if (n < k || k <= 0) return NaN;
  let sum = 0;
  let count = 0;
  for (let i = n - k; i < n; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  return count ? sum / count : NaN;
}

/** Sum over the last k sessions treating "no trade" as zero. */
function tailSumZero(arr: Float64Array, k: number): number {
  const n = arr.length;
  let sum = 0;
  for (let i = Math.max(0, n - k); i < n; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

function tailMeanZero(arr: Float64Array, k: number): number {
  const n = arr.length;
  const start = Math.max(0, n - k);
  const len = n - start;
  return len ? tailSumZero(arr, k) / len : NaN;
}

function tailMedianZero(arr: Float64Array, k: number): number {
  const n = arr.length;
  const start = Math.max(0, n - k);
  const buf: number[] = [];
  for (let i = start; i < n; i++) buf.push(Number.isFinite(arr[i]) ? arr[i] : 0);
  if (!buf.length) return NaN;
  buf.sort((a, b) => a - b);
  const mid = buf.length >> 1;
  return buf.length % 2 ? buf[mid] : (buf[mid - 1] + buf[mid]) / 2;
}

function pctReturn(ff: Float64Array, k: number): number {
  const n = ff.length;
  if (n <= k) return NaN;
  const now = ff[n - 1];
  const then = ff[n - 1 - k];
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return NaN;
  return now / then - 1;
}

/** Return between two points in the past, e.g. 12-month excluding last month. */
function pctReturnBetween(ff: Float64Array, fromBack: number, toBack: number): number {
  const n = ff.length;
  if (n <= fromBack) return NaN;
  const start = ff[n - 1 - fromBack];
  const end = ff[n - 1 - toBack];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return NaN;
  return end / start - 1;
}

// ------------------------------------------------------------- indicators

export function rsi(ff: Float64Array, period = 14): number {
  const n = ff.length;
  if (n < period + 1) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = n - period; i < n; i++) {
    const d = ff[i] - ff[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(high: Float64Array, low: Float64Array, close: Float64Array, period = 14): number {
  const n = close.length;
  if (n < period + 1) return NaN;
  let sum = 0;
  let count = 0;
  for (let i = n - period; i < n; i++) {
    const c0 = close[i - 1];
    const h = Number.isFinite(high[i]) && high[i] > 0 ? high[i] : close[i];
    const l = Number.isFinite(low[i]) && low[i] > 0 ? low[i] : close[i];
    if (!Number.isFinite(c0) || !Number.isFinite(h) || !Number.isFinite(l)) continue;
    sum += Math.max(h - l, Math.abs(h - c0), Math.abs(l - c0));
    count++;
  }
  return count ? sum / count : NaN;
}

/** Annualised stdev of daily log returns over the last `period` sessions. */
export function annualisedVol(ff: Float64Array, period = 60): number {
  const n = ff.length;
  if (n < period + 1) return NaN;
  const rets: number[] = [];
  for (let i = n - period; i < n; i++) {
    const a = ff[i - 1];
    const b = ff[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return NaN;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * R^2 of a straight line fitted to log price over `period` sessions.
 * High values mean a smooth, persistent trend rather than a jagged one —
 * it is the "quality" half of momentum, and it filters out one-day spikes.
 */
export function trendQuality(ff: Float64Array, period = 90): number {
  const n = ff.length;
  if (n < period) return NaN;
  const start = n - period;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const price = ff[i];
    if (!(price > 0)) continue;
    const x = i - start;
    const y = Math.log(price);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
    count++;
  }
  if (count < 20) return NaN;
  const numerator = count * sumXY - sumX * sumY;
  const denominator = Math.sqrt((count * sumXX - sumX * sumX) * (count * sumYY - sumY * sumY));
  if (denominator === 0) return NaN;
  const r = numerator / denominator;
  // Signed R^2: a smooth downtrend should score as badly as a jagged one.
  return Math.sign(numerator) * r * r;
}

export function maxDrawdown(ff: Float64Array, period: number): number {
  const n = ff.length;
  const start = Math.max(1, n - period);
  let peak = ff[start - 1] || ff[start];
  let worst = 0;
  for (let i = start; i < n; i++) {
    const v = ff[i];
    if (!(v > 0)) continue;
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function extremes(ff: Float64Array, period: number): { high: number; low: number } {
  const n = ff.length;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = Math.max(0, n - period); i < n; i++) {
    const v = ff[i];
    if (!(v > 0)) continue;
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  return { high: Number.isFinite(hi) ? hi : NaN, low: Number.isFinite(lo) ? lo : NaN };
}

// ------------------------------------------------------------------ engine

export interface IndexReturns {
  compositeReturn3m: number;
  sectorReturn3m: Map<string, number>;
}

/** 3-month returns for IHSG and every IDX-IC sector index, computed once per run. */
export function computeIndexReturns(db: MarketDatabase): IndexReturns {
  const ret = (code: string): number => {
    const s = db.indexSeries.get(code);
    if (!s) return NaN;
    return pctReturn(forwardFill(s.close), W.m3);
  };
  const sectorReturn3m = new Map<string, number>();
  for (const [sector, indexCode] of Object.entries(SECTOR_TO_INDEX)) {
    sectorReturn3m.set(sector, ret(indexCode));
  }
  return { compositeReturn3m: ret('COMPOSITE'), sectorReturn3m };
}

function countTraded(volume: Float64Array, k: number): number {
  const n = volume.length;
  let c = 0;
  for (let i = Math.max(0, n - k); i < n; i++) if (Number.isFinite(volume[i]) && volume[i] > 0) c++;
  return c;
}

function foreignStreak(fn: Float64Array): number {
  let streak = 0;
  for (let i = fn.length - 1; i >= 0; i--) {
    const v = fn[i];
    if (!Number.isFinite(v) || v === 0) continue;
    if (v > 0) streak++;
    else break;
  }
  return streak;
}

/** How many sessions this emiten has actually traded, from its first print. */
function sessionsAvailable(close: Float64Array): number {
  for (let i = 0; i < close.length; i++) {
    if (Number.isFinite(close[i]) && close[i] > 0) return close.length - i;
  }
  return 0;
}

export function computeFactors(
  series: PriceSeries,
  listedShares: number,
  sector: string,
  indexReturns: IndexReturns
): FactorSnapshot | null {
  const available = sessionsAvailable(series.close);
  if (available < 30) return null;

  const ff = forwardFill(series.close);
  const close = ff[ff.length - 1];
  if (!(close > 0)) return null;

  const ffHigh = forwardFill(series.high);
  const ffLow = forwardFill(series.low);

  const sma20 = tailMean(ff, W.m1);
  const sma50 = tailMean(ff, 50);
  const sma200 = tailMean(ff, 200);

  const yearHigh = extremes(ff, W.m12);
  const atr14 = atr(ffHigh, ffLow, ff, 14);

  // 20-session dispersion for the pullback z-score.
  let z20 = NaN;
  if (Number.isFinite(sma20) && ff.length >= W.m1) {
    let sq = 0;
    for (let i = ff.length - W.m1; i < ff.length; i++) sq += (ff[i] - sma20) ** 2;
    const sd = Math.sqrt(sq / W.m1);
    z20 = sd > 0 ? (close - sma20) / sd : 0;
  }

  const medianValue20IdrBn = tailMedianZero(series.value, W.m1) / 1e3; // stored in IDR million
  const marketCapIdrBn = (listedShares * close) / 1e9;
  const value20Total = tailSumZero(series.value, W.m1); // IDR million
  const foreign20 = tailSumZero(series.foreignNet, W.m1); // IDR million

  const return3m = pctReturn(ff, W.m3);
  const sectorRef = indexReturns.sectorReturn3m.get(sector);

  return {
    code: series.code,
    close,
    marketCapIdrBn,

    return1w: pctReturn(ff, W.w1),
    return1m: pctReturn(ff, W.m1),
    return3m,
    return6m: pctReturn(ff, W.m6),
    return12m: pctReturn(ff, W.m12),
    momentum12_1: pctReturnBetween(ff, W.m12, W.m1),

    sma20,
    sma50,
    sma200,
    priceVsSma20: Number.isFinite(sma20) ? close / sma20 - 1 : NaN,
    priceVsSma50: Number.isFinite(sma50) ? close / sma50 - 1 : NaN,
    priceVsSma200: Number.isFinite(sma200) ? close / sma200 - 1 : NaN,
    goldenCross: Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 > sma200,
    distanceFrom52wHigh: Number.isFinite(yearHigh.high) ? close / yearHigh.high - 1 : NaN,
    distanceFrom52wLow: Number.isFinite(yearHigh.low) && yearHigh.low > 0 ? close / yearHigh.low - 1 : NaN,
    trendQuality: trendQuality(ff, 90),

    rsi14: rsi(ff, 14),
    zScore20: z20,

    annualisedVol: annualisedVol(ff, 60),
    atr14,
    atrPercent: Number.isFinite(atr14) ? atr14 / close : NaN,
    maxDrawdown6m: maxDrawdown(ff, W.m6),

    medianValue20IdrBn,
    tradedSessions20: countTraded(series.volume, W.m1),
    turnoverRatio: marketCapIdrBn > 0 ? medianValue20IdrBn / marketCapIdrBn : 0,

    foreignNet5IdrBn: tailSumZero(series.foreignNet, W.w1) / 1e3,
    foreignNet20IdrBn: foreign20 / 1e3,
    foreignNet60IdrBn: tailSumZero(series.foreignNet, W.m3) / 1e3,
    foreignIntensity: value20Total > 0 ? foreign20 / value20Total : 0,
    foreignStreak: foreignStreak(series.foreignNet),

    volumeSurge: (() => {
      const v20 = tailMeanZero(series.volume, W.m1);
      const v60 = tailMeanZero(series.volume, W.m3);
      return v60 > 0 ? v20 / v60 : NaN;
    })(),

    relativeStrength3m:
      Number.isFinite(return3m) && Number.isFinite(indexReturns.compositeReturn3m)
        ? return3m - indexReturns.compositeReturn3m
        : NaN,
    sectorRelativeStrength3m:
      Number.isFinite(return3m) && Number.isFinite(sectorRef as number)
        ? return3m - (sectorRef as number)
        : NaN,

    sessionsAvailable: available,
  };
}

export interface BetaResult {
  /** OLS slope against IHSG. */
  rawBeta: number;
  /**
   * Blume-adjusted beta — 0.33 + 0.67 x raw. This is what Bloomberg reports as
   * "adjusted beta" and what should feed a cost of capital: a beta estimated
   * from one year of noisy daily data is a poor forecast of the next five
   * years, and betas empirically drift toward 1 over time.
   */
  beta: number;
  correlation: number;
  rSquared: number;
  observations: number;
  /**
   * False when the regression explains too little to be informative. A stock
   * that simply does not co-move with the index yields a near-zero slope, and
   * feeding that into CAPM produces a cost of capital below the government bond
   * yield — an impossibility that quietly inflates every valuation.
   */
  reliable: boolean;
}

/**
 * OLS beta of an emiten's daily returns against IHSG over `period` sessions.
 * Sessions where the emiten did not trade are dropped rather than forward
 * filled — a carried-forward flat price would bias beta towards zero.
 */
export function computeBeta(db: MarketDatabase, code: string, period = W.m12): BetaResult | null {
  const stock = db.series.get(code);
  const index = db.indexSeries.get('COMPOSITE');
  if (!stock || !index) return null;

  const n = Math.min(stock.close.length, index.close.length);
  const start = Math.max(1, n - period);
  const xs: number[] = [];
  const ys: number[] = [];

  for (let i = start; i < n; i++) {
    const s0 = stock.close[i - 1];
    const s1 = stock.close[i];
    const m0 = index.close[i - 1];
    const m1 = index.close[i];
    if (!(s0 > 0 && s1 > 0 && m0 > 0 && m1 > 0)) continue;
    xs.push(Math.log(m1 / m0));
    ys.push(Math.log(s1 / s0));
  }
  if (xs.length < 40) return null;

  const k = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / k;
  const my = ys.reduce((a, b) => a + b, 0) / k;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < k; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX <= 0) return null;

  const rawBeta = cov / varX;
  const correlation = varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
  const rSquared = correlation * correlation;

  // Below ~4% explained variance the slope carries essentially no information
  // about systematic risk.
  const reliable = rSquared >= 0.04 && k >= 60;

  return {
    rawBeta,
    // An unreliable regression falls back to the market beta rather than to a
    // number that happens to have come out of the arithmetic.
    beta: reliable ? 0.33 + 0.67 * rawBeta : 1,
    correlation,
    rSquared,
    observations: k,
    reliable,
  };
}

/** Factor snapshots for every emiten that has enough history to score. */
export function computeAllFactors(db: MarketDatabase): Map<string, FactorSnapshot> {
  const indexReturns = computeIndexReturns(db);
  const out = new Map<string, FactorSnapshot>();
  for (const e of db.emiten) {
    const s = db.series.get(e.code);
    if (!s) continue;
    const f = computeFactors(s, e.listedShares, e.sector, indexReturns);
    if (f) out.set(e.code, f);
  }
  return out;
}
