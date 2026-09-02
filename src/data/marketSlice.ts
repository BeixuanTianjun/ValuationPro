/**
 * marketSlice.ts — view the market database as it stood at an earlier session.
 *
 * WHY THIS EXISTS. `recordTodaysPicks` writes the journal from
 * `db.meta.latestSession` and nothing else, so a session the laptop slept
 * through is gone for good. That is not merely a hole: the surviving sample is
 * the set of days this machine happened to be awake, which is not a random
 * sample of trading days, and a win rate computed from it would be biased in a
 * direction nobody can measure afterwards.
 *
 * Slicing the database to session N lets the SAME screener and watchlist code
 * run against the market as it looked then, so the journal can be filled
 * backwards from history rather than only forwards from today.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SLICE GETS RIGHT
 *
 * Prices, volumes, turnover, foreign flow and the index series are all real
 * values recorded for the sessions at or before N. Nothing is interpolated.
 *
 * Adjusted prices are RE-BASED to the sliced session, and that correction is
 * not cosmetic. `series.close` arrives back-adjusted against today, so a split
 * after N scales the sliced window too. Shape is unharmed — the factor is one
 * constant across the whole window, so averages, dips, run-ups and crossovers
 * are identical either way — but the LEVEL is not, and a pick reads both scales
 * at once: `entry` from the traded price, `atr14` from the adjusted series.
 * Left alone, an emiten that later split 1:2 would get a stop half as far from
 * entry as the rule says, with every number still finite and plausible. See
 * `rebaseFactor` below for how the live relationship is restored.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SLICE GETS WRONG, AND CALLERS MUST KNOW BOTH
 *
 * 1. SURVIVORSHIP. The universe is today's universe. An emiten that traded on
 *    session N but has since been delisted is not in `db.emiten` at all, so a
 *    backfill can never pick it. Every omission of this kind is a name that was
 *    available then and is missing now, and delistings are not random — they
 *    skew towards failures. A win rate measured over backfilled sessions is
 *    therefore an OPTIMISTIC estimate, and anything displaying it must say so
 *    rather than putting it beside a forward-recorded number as though the two
 *    were the same measurement.
 *
 * 2. SHARE COUNTS. `Emiten.listedShares` is today's count, so a reconstructed
 *    market cap is today's shares at that day's price. This is not a new
 *    compromise introduced here — `factorEngine` already computes every
 *    historical factor the same way — and market cap gates nothing in the
 *    screener, the watchlist, or any of the three conviction functions. It is a
 *    displayed number, and it is wrong for any emiten that has since issued
 *    shares.
 *
 * 3. TRADE COUNT BEFORE IT WAS RECORDED. `RawSeries.f` started being stored
 *    only recently; earlier sessions carry NaN. Anything reading `freq` gets
 *    NaN rather than a plausible zero, which is the honest failure — a zero
 *    would read as "nobody traded".
 */

import type { DailyQuote, Emiten, PriceSeries } from '../types/market';
import type { IndexSeries, MarketDatabase } from './marketRepository';

/** history stores volume in lots, turnover and foreign flow in IDR million. */
const SHARES_PER_LOT = 100;
const IDR_MN = 1e6;

/** Position of `session` in `db.dates`, or -1 when it never traded. */
export function sessionIndex(db: MarketDatabase, session: string): number {
  return db.dates.indexOf(session);
}

/**
 * The sessions a backfill may target: every session with at least `minHistory`
 * bars behind it and — when `excludeLast` is true — never the newest one, which
 * has no future to be graded against.
 */
export function backfillableSessions(
  db: MarketDatabase,
  minHistory: number,
  excludeLast = true,
): string[] {
  const end = excludeLast ? db.dates.length - 1 : db.dates.length;
  const out: string[] = [];
  for (let i = minHistory; i < end; i++) out.push(db.dates[i]);
  return out;
}

function cut(a: Float64Array, n: number): Float64Array {
  // slice(), not subarray(): a view would share the original buffer, and every
  // consumer here is free to write into what it is handed.
  return a.slice(0, n);
}

/**
 * Re-base the adjusted series so the slice's own last session is unadjusted.
 *
 * THIS IS THE ONE PLACE FUTURE DATA REALLY DOES REACH BACKWARDS. Back-adjustment
 * runs over the whole array before any slicing, and a factor stored at position
 * j scales every position before it — so a split that happens AFTER the slice
 * still scales the sliced window. The window stays internally consistent, which
 * is why moving averages and percentage dips are unaffected, but the level is
 * wrong in a way that matters exactly once: `close[i]` no longer equals
 * `rawClose[i]`.
 *
 * The live path never has that gap. At the newest session there are no later
 * factors, so adjusted and traded agree there by construction. A pick mixes the
 * two — `entry` comes from the traded price while `atr14` is computed from the
 * adjusted series — so leaving the gap in place would hand `levelsFor` an ATR
 * measured on a different scale than the entry. For an emiten that later split
 * 1:2 the stop and target would sit half as far from entry as the rule says,
 * and nothing downstream would look wrong: the numbers are all finite,
 * plausible, and quietly mis-scaled. 75 of the 962 emiten carry at least one
 * factor, so this is not a corner case.
 *
 * Dividing the window by the product of the later factors restores the live
 * relationship. The factor is read off the data rather than recomputed from
 * `adj`: at the newest usable session the ratio of traded to adjusted IS that
 * product, and reading it avoids a second implementation of the same maths
 * disagreeing with the first.
 */
function rebaseFactor(s: PriceSeries, i: number): number {
  for (let t = i; t >= 0; t--) {
    const raw = s.rawClose[t];
    const adj = s.close[t];
    if (raw > 0 && adj > 0) return raw / adj;
  }
  return 1;
}

function scaleInPlace(a: Float64Array, k: number): void {
  if (k === 1) return;
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

function cutSeries(s: PriceSeries, n: number): PriceSeries {
  const close = cut(s.close, n);
  const high = cut(s.high, n);
  const low = cut(s.low, n);

  const k = rebaseFactor(s, n - 1);
  scaleInPlace(close, k);
  scaleInPlace(high, k);
  scaleInPlace(low, k);

  return {
    code: s.code,
    close,
    high,
    low,
    volume: cut(s.volume, n),
    value: cut(s.value, n),
    foreignNet: cut(s.foreignNet, n),
    freq: cut(s.freq, n),
    rawClose: cut(s.rawClose, n),
    // Only the factors at or before the cut are still folded into these arrays.
    adjustments: s.adjustments,
  };
}

function cutIndex(s: IndexSeries, n: number): IndexSeries {
  return {
    code: s.code,
    members: s.members,
    close: cut(s.close, n),
    value: cut(s.value, n),
    marketCap: cut(s.marketCap, n),
  };
}

/**
 * Rebuild the one-day quote snapshot from the stored series.
 *
 * THE UNITS ARE THE WHOLE JOB. `history.json` stores volume in LOTS and both
 * turnover and foreign flow in IDR MILLION, while `DailyQuote` — which is what
 * the screener's liquidity gates read — is in SHARES and IDR. Skipping either
 * conversion moves `minVolumeShares` by 100x and `minValueIdr` by a million,
 * and the funnel would still return a plausible-looking list of emiten.
 *
 * Fields that genuinely do not exist in the stored history are NaN, never 0.
 * A zero close is a real price this screener has already been burned by (SCPI
 * quoted at Rp 0 against a Rp 29,000 last close), and a zero share count would
 * read as a fact rather than an absence.
 */
function quoteAt(e: Emiten, s: PriceSeries, i: number): DailyQuote | null {
  const close = s.rawClose[i];
  if (!(close > 0)) return null;

  const prev = i > 0 ? s.rawClose[i - 1] : NaN;
  const volumeLots = s.volume[i];
  const valueMn = s.value[i];
  const foreignMn = s.foreignNet[i];

  return {
    code: e.code,
    // Never recorded per session in history; NaN so nothing mistakes it for a
    // real opening print.
    open: NaN,
    high: s.high[i],
    low: s.low[i],
    close,
    prev,
    change: prev > 0 ? ((close - prev) / prev) * 100 : NaN,
    volume: Number.isFinite(volumeLots) ? volumeLots * SHARES_PER_LOT : NaN,
    value: Number.isFinite(valueMn) ? valueMn * IDR_MN : NaN,
    freq: s.freq[i],
    foreignNet: Number.isFinite(foreignMn) ? foreignMn * IDR_MN : NaN,
    // Today's share count, as documented at the top of this file.
    listedShares: e.listedShares,
    // Free float is not stored per session and cannot be reconstructed.
    indexShares: NaN,
    marketCap: e.listedShares > 0 ? e.listedShares * close : NaN,
  };
}

/**
 * The market database as it stood at the close of `db.dates[upToIndex]`.
 *
 * Throws rather than clamping on a bad index: a silently shifted window would
 * produce a journal that looks fine while grading the wrong day.
 */
export function sliceMarketDatabase(db: MarketDatabase, upToIndex: number): MarketDatabase {
  if (!Number.isInteger(upToIndex)) {
    throw new Error(`sliceMarketDatabase: indeks harus bilangan bulat, dapat ${upToIndex}`);
  }
  if (upToIndex < 0 || upToIndex >= db.dates.length) {
    throw new Error(`sliceMarketDatabase: indeks ${upToIndex} di luar 0..${db.dates.length - 1}`);
  }

  const n = upToIndex + 1;
  const session = db.dates[upToIndex];

  const series = new Map<string, PriceSeries>();
  for (const [code, s] of db.series) series.set(code, cutSeries(s, n));

  // The index series has its own date axis; keep every index session at or
  // before this one rather than assuming the two arrays line up.
  let indexCount = 0;
  while (indexCount < db.indexDates.length && db.indexDates[indexCount] <= session) indexCount++;
  const indexSeries = new Map<string, IndexSeries>();
  for (const [code, s] of db.indexSeries) indexSeries.set(code, cutIndex(s, indexCount));

  const daily = new Map<string, DailyQuote>();
  for (const e of db.emiten) {
    const s = series.get(e.code);
    if (!s) continue;
    const q = quoteAt(e, s, upToIndex);
    if (q) daily.set(e.code, q);
  }

  return {
    ...db,
    meta: {
      ...db.meta,
      latestSession: session,
      officialSession: session,
      sessions: n,
      // Nothing about a historical slice is pending; leaving today's count here
      // would make a freshness check read the wrong thing.
      pendingSessions: 0,
    },
    daily,
    dates: db.dates.slice(0, n),
    series,
    indexDates: db.indexDates.slice(0, indexCount),
    indexSeries,
    // A historical slice has no live quote by construction. Leaving today's
    // LiveStatus here would make the screener stamp `live: true` on a pick
    // recorded for a session months ago.
    live: null,
  };
}
