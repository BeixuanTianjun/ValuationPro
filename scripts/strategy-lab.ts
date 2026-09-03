/**
 * strategy-lab.ts — searches combinations of mechanical entry rules for ones
 * that hold a high win rate on data they were never fitted to.
 *
 *   npm run strategy:lab
 *
 * ── WHY THE OUT-OF-SAMPLE SPLIT IS THE WHOLE POINT ────────────────────────
 *
 * The first version of this file ranked ~4,700 rule sets on expectancy over
 * the full history and reported the winner. Every number in it was computed on
 * data the search had already seen, which makes the leaderboard a record of
 * what happened to work, not a prediction. Search enough combinations and a
 * 70% win rate appears by chance alone: with 20,000 rule sets tested, dozens
 * will clear any threshold you name purely on luck.
 *
 * So the history is cut in two by DATE. Rule sets are searched and ranked on
 * the first 70% of sessions (TRAIN). The last 30% (TEST) is never used to
 * choose anything — it only judges what the search already picked. A rule that
 * wins 75% in train and 45% in test was curve-fitted, and this file drops it.
 * What survives has been asked to work on sessions it was not fitted to.
 *
 * ── WHY WIN RATE ALONE IS NOT ALLOWED TO DECIDE ───────────────────────────
 *
 * Win rate is trivially inflatable: target 0.5×ATR against a 3×ATR stop wins
 * about 80% of the time and still loses money, because the 20% pays for all of
 * it. Those combinations ARE in the grid — deliberately, since that is where
 * high win rates live — but a rule set only ships if its TEST expectancy is
 * positive too. Win rate is the ranking; expectancy is the veto.
 *
 * ── WHAT IS SEARCHED ──────────────────────────────────────────────────────
 *
 *   12 triggers × 67 filter combinations × 72 exits = 57,888 rule sets
 *
 * A trigger is a fresh EVENT (a crossing, a breakout) — never a standing state,
 * or the same position would re-enter every session. Filters are standing
 * conditions AND-ed onto it, drawn 0, 1 or 2 at a time from a pool of 11; this
 * is the "dikombinasikan" part, and it is where most of the improvement comes
 * from: a moving-average cross with no context is a coin flip, the same cross
 * filtered to stocks above their 100-day average with foreign money buying is
 * a different animal. (The counts above are what the constants below currently
 * produce; the run prints the real numbers, which is what to trust.)
 *
 * ── BUYING WEAKNESS IS SEARCHED TOO, NOT JUST STRENGTH ────────────────────
 *
 * Every original trigger fired on strength: a cross up, a breakout, a reclaim.
 * That made the whole leaderboard incapable of saying anything about the two
 * setups the screener now runs — buying a dip while the long trend holds, and
 * buying a stock that stood still while its index ran. Four triggers and three
 * filters were added for them (`dipBelowMa20`, `rsiDown40`, `drawdown10`,
 * `laggardGap`; `belowMa20`, `indexUp10`, `lagging10`), so the two new screens
 * are measured on sessions they were never fitted to rather than shipped on the
 * strength of the idea. If they do not survive the gates, that is the finding,
 * and it belongs on the same board as everything else.
 *
 * THE INDEX SERIES IS READ BY DATE. `db.indexSeries` sits on `db.indexDates`
 * while a stock's series sits on `db.dates`, and those two arrays are NOT
 * interchangeable — that mismatch is the exact shape of the macro alignment bug
 * in HANDOVER. Every index used here is re-projected onto the price grid by
 * date and forward-filled before a single return is computed.
 *
 * ── WHAT IS STILL NOT TESTED ──────────────────────────────────────────────
 *
 * Bandarmology (average ticket size = value ÷ trade count). It needs per-session
 * trade counts, and that field only started being recorded recently — see
 * RawSeries.f in types/market.ts. It is NaN for the whole backtest window, so
 * it is used live only and is honestly absent here rather than faked.
 *
 * Entry is the signal session's CLOSE, matching the inclusive-average
 * convention stockScreener.ts uses, so the two screens cannot disagree about
 * what "above the MA" means. When one session's range covers both the stop and
 * the target, the STOP is assumed to have hit first — daily bars cannot say
 * which came first, so the pessimistic reading is taken every time.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { rsi, atr } from '../src/models/factorEngine';
import { SECTOR_TO_INDEX } from '../src/data/idxIndexCatalog';
import { CscvResult, renderLogitHistogram, runCscv } from './cscv';
import { MarketDatabase } from '../src/data/marketRepository';
import { PriceSeries } from '../src/types/market';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');
const OUT_FILE = join(DATA_DIR, 'strategies.json');

/**
 * Sessions of runway before a stock may produce its first signal.
 *
 * DERIVED FROM THE DATA, NOT FIXED, and the first version's bug is why. It hard-
 * coded 200 while the stored history was 286 sessions and the train/test cut
 * fell at session 200 — so the train window was sessions 200..199, i.e. empty,
 * every rule set failed the minimum-trades gate, and the run reported "nothing
 * survived" as though that were a finding about the market rather than about
 * an off-by-a-whole-window mistake. The floor of 105 keeps MA100 defined; the
 * ceiling of 150 stops a long history from spending all its runway warming up.
 */
/** Terjemahan PBO ke keputusan, mengikuti kalibrasi di sumbernya. */
function verdictPbo(pbo: number): string {
  if (pbo < 0.1) return '— kokoh: pemenang IS unggul konsisten di potongan lain';
  if (pbo < 0.3) return '— risiko sedang: kecilkan modal, perketat kill-switch';
  if (pbo < 0.5) return '— risiko TINGGI: pemenang IS setara pilihan acak di luar sampel';
  return '— TOLAK: pemenang IS di bawah median pada mayoritas potongan';
}

function warmupFor(sessions: number): number {
  return Math.min(150, Math.max(105, Math.floor(sessions * 0.25)));
}
/** Fraction of the history used to search. The rest only ever judges. */
const TRAIN_FRACTION = 0.7;

/**
 * Jumlah blok CSCV (2S). Enam belas memberi C(16,8) = 12.870 kombinasi.
 *
 * Sumbernya menyarankan blok minimal 30 hari; 716 sesi dibagi 16 memberi ~44
 * sesi per blok, jadi ambang itu terpenuhi. Menaikkannya ke 18 melipatgandakan
 * kombinasi jadi 48.620 sekaligus memendekkan blok ke 39 sesi — lebih mahal
 * tanpa menambah informasi.
 */
const CSCV_BLOCKS = 16;
/** A stock must turn over this much on median to be considered tradeable. */
const MIN_MEDIAN_TURNOVER_IDR_MN = 1_000;

const MIN_TRADES_TOTAL = 100;
const MIN_TRADES_TEST = 30;
const MIN_TRADES_TRAIN = 50;
/** The bar the user asked for, enforced on TEST data only. */
const MIN_TEST_WIN_RATE = 0.65;
/** Train must also be respectable, or the pick was noise the test got lucky on. */
const MIN_TRAIN_WIN_RATE = 0.55;
/**
 * Expectancy floor, in R per trade.
 *
 * "Greater than zero" is not a floor, it is a rounding error — see the stress
 * test note in the selection block. A rule set has to actually pay for the
 * spread, the slippage and the attention it costs to run.
 */
const MIN_TEST_EXPECTANCY = 0.15;

const TOP_N = 25;

// ───────────────────────────────────────────────────────────── indicators ──

const SMA_PERIODS = [5, 10, 20, 50, 100];

interface Ind {
  code: string;
  n: number;
  close: Float64Array;
  high: Float64Array;
  low: Float64Array;
  sma: Map<number, Float64Array>;
  rsi14: Float64Array;
  atr14: Float64Array;
  atrPct: Float64Array;
  volSurge: Float64Array;
  flow5: Float64Array;
  flow20: Float64Array;
  /** Highest close over the 20 sessions BEFORE i — for breakout detection. */
  priorHigh20: Float64Array;
  /** Highest close over the 60 sessions ending at i — for drawdown detection. */
  high60: Float64Array;
  /** The stock's own return over the last GAP_WINDOW sessions. */
  ret60: Float64Array;
  /** Its reference index's return over the same window, aligned by date. */
  idxRet60: Float64Array;
  /** Index return minus stock return, as a FRACTION (0.10 = 10 percentage points). */
  gap60: Float64Array;
  /** Lowest close over the 60 sessions ending at i. */
  low60: Float64Array;
  /** Return from that low — how much of the move has ALREADY happened. */
  runup60: Float64Array;
  /** Distance above the 20-session mean in ATR units — how stretched it is. */
  extAtr: Float64Array;
  /** Lowest ATR% over the trailing 60 sessions — the squeeze reference. */
  atrPctFloor60: Float64Array;
  /** Highest close over the 10 sessions BEFORE i. */
  priorHigh10: Float64Array;
}

/** Sessions the laggard comparison looks back over — matches the screener. */
const GAP_WINDOW = 60;

function rollingSma(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const win: number[] = [];
  let sum = 0;
  let finite = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    win.push(v);
    if (Number.isFinite(v)) {
      sum += v;
      finite++;
    }
    if (win.length > period) {
      const gone = win.shift()!;
      if (Number.isFinite(gone)) {
        sum -= gone;
        finite--;
      }
    }
    if (win.length === period && finite === period) out[i] = sum / period;
  }
  return out;
}

/** Rolling mean treating a non-trading session as zero — matches stockScreener.ts. */
function rollingMeanZero(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const win: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(src[i]) ? src[i] : 0;
    win.push(v);
    sum += v;
    if (win.length > period) sum -= win.shift()!;
    if (win.length === period) out[i] = sum / period;
  }
  return out;
}

function rollingSum(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const win: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(src[i]) ? src[i] : 0;
    win.push(v);
    sum += v;
    if (win.length > period) sum -= win.shift()!;
    if (win.length === period) out[i] = sum;
  }
  return out;
}

/** Min of the `period` values ending AT i (inclusive), ignoring non-positive. */
function rollingMin(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let lo = Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) {
      const v = src[j];
      if (Number.isFinite(v) && v > 0 && v < lo) lo = v;
    }
    out[i] = lo === Infinity ? NaN : lo;
  }
  return out;
}

/** Max of the `period` values ending AT i (inclusive). */
function rollingMax(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let hi = -Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) {
      const v = src[j];
      if (Number.isFinite(v) && v > hi) hi = v;
    }
    out[i] = hi === -Infinity ? NaN : hi;
  }
  return out;
}

/** Return over `period` sessions, forward-filled so a halt does not read as 0%. */
function rollingReturn(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  const ff = new Float64Array(n).fill(NaN);
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(src[i]) && src[i] > 0) last = src[i];
    ff[i] = last;
  }
  for (let i = period; i < n; i++) {
    const then = ff[i - period];
    const now = ff[i];
    if (Number.isFinite(then) && then > 0 && Number.isFinite(now)) out[i] = now / then - 1;
  }
  return out;
}

/**
 * Every index re-projected onto the PRICE grid, by date.
 *
 * `db.indexSeries` is indexed by `db.indexDates`; a stock's series is indexed by
 * `db.dates`. Reading one with the other's offsets is the alignment bug this
 * repo has already paid for once — see the file header. Missing sessions are
 * forward-filled, and the leading run before the index has any value at all
 * stays NaN so nothing downstream invents a return out of it.
 */
function alignIndicesToPriceGrid(db: MarketDatabase): Map<string, Float64Array> {
  const pos = new Map<string, number>();
  db.indexDates.forEach((d, i) => pos.set(d, i));

  const out = new Map<string, Float64Array>();
  for (const [code, series] of db.indexSeries) {
    const arr = new Float64Array(db.dates.length).fill(NaN);
    let last = NaN;
    for (let i = 0; i < db.dates.length; i++) {
      const p = pos.get(db.dates[i]);
      if (p !== undefined && Number.isFinite(series.close[p]) && series.close[p] > 0) last = series.close[p];
      arr[i] = last;
    }
    out.set(code, arr);
  }
  return out;
}

/** Max of the `period` values ending at i-1 (strictly before i). */
function priorRollingMax(src: Float64Array, period: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    let hi = -Infinity;
    for (let j = Math.max(0, i - period); j < i; j++) {
      const v = src[j];
      if (Number.isFinite(v) && v > hi) hi = v;
    }
    out[i] = hi === -Infinity ? NaN : hi;
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * factorEngine's rsi()/atr() read the TAIL of whatever array they are given, so
 * handing them a growing subarray view (no copy) turns a single-point function
 * into a full series while keeping the definitions identical to the ones the
 * live screens use. A divergence there would be the worst kind of bug: a
 * backtest that validates a signal the app does not actually compute.
 */
function buildIndicators(code: string, s: PriceSeries, indexClose: Float64Array | null): Ind {
  const n = s.close.length;
  const sma = new Map<number, Float64Array>();
  for (const p of SMA_PERIODS) sma.set(p, rollingSma(s.close, p));

  const rsi14 = new Float64Array(n).fill(NaN);
  const atr14 = new Float64Array(n).fill(NaN);
  const atrPct = new Float64Array(n).fill(NaN);
  for (let i = 14; i < n; i++) {
    rsi14[i] = rsi(s.close.subarray(0, i + 1), 14);
    const a = atr(s.high.subarray(0, i + 1), s.low.subarray(0, i + 1), s.close.subarray(0, i + 1), 14);
    atr14[i] = a;
    atrPct[i] = Number.isFinite(a) && s.close[i] > 0 ? a / s.close[i] : NaN;
  }

  const volAvg20 = rollingMeanZero(s.volume, 20);
  const volSurge = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    volSurge[i] = volAvg20[i] > 0 && Number.isFinite(s.volume[i]) ? s.volume[i] / volAvg20[i] : NaN;
  }

  const ret60 = rollingReturn(s.close, GAP_WINDOW);
  const idxRet60 = indexClose ? rollingReturn(indexClose, GAP_WINDOW) : new Float64Array(n).fill(NaN);
  const gap60 = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(ret60[i]) && Number.isFinite(idxRet60[i])) gap60[i] = idxRet60[i] - ret60[i];
  }

  const low60 = rollingMin(s.close, GAP_WINDOW);
  const runup60 = new Float64Array(n).fill(NaN);
  const extAtr = new Float64Array(n).fill(NaN);
  const sma20 = sma.get(20)!;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(low60[i]) && low60[i] > 0 && Number.isFinite(s.close[i])) {
      runup60[i] = s.close[i] / low60[i] - 1;
    }
    if (Number.isFinite(atr14[i]) && atr14[i] > 0 && Number.isFinite(sma20[i]) && Number.isFinite(s.close[i])) {
      extAtr[i] = (s.close[i] - sma20[i]) / atr14[i];
    }
  }

  return {
    code,
    n,
    close: s.close,
    high: s.high,
    low: s.low,
    sma,
    rsi14,
    atr14,
    atrPct,
    volSurge,
    flow5: rollingSum(s.foreignNet, 5),
    flow20: rollingSum(s.foreignNet, 20),
    priorHigh20: priorRollingMax(s.close, 20),
    high60: rollingMax(s.close, GAP_WINDOW),
    ret60,
    idxRet60,
    gap60,
    low60,
    runup60,
    extAtr,
    atrPctFloor60: rollingMin(atrPct, GAP_WINDOW),
    priorHigh10: priorRollingMax(s.close, 10),
  };
}

// ─────────────────────────────────────────────────────────────── triggers ──

interface Trigger {
  id: string;
  label: string;
  family: 'trend' | 'momentum' | 'breakout' | 'pullback' | 'dip' | 'laggard' | 'early';
  fires(d: Ind, i: number): boolean;
}

/** A moving-average stack that formed on THIS session — an event, not a state. */
function maCross(fast: number, slow: number): Trigger {
  return {
    id: `ma${fast}x${slow}`,
    label: `MA${fast} memotong ke atas MA${slow}`,
    family: 'trend',
    fires(d, i) {
      const f = d.sma.get(fast)!;
      const s = d.sma.get(slow)!;
      if (!Number.isFinite(f[i]) || !Number.isFinite(s[i]) || !Number.isFinite(f[i - 1]) || !Number.isFinite(s[i - 1]))
        return false;
      return f[i - 1] <= s[i - 1] && f[i] > s[i];
    },
  };
}

function rsiCross(level: number): Trigger {
  return {
    id: `rsi${level}`,
    label: `RSI14 memotong ke atas ${level}`,
    family: 'momentum',
    fires(d, i) {
      const r = d.rsi14[i];
      const p = d.rsi14[i - 1];
      return Number.isFinite(r) && Number.isFinite(p) && p < level && r >= level;
    },
  };
}

const TRIGGERS: Trigger[] = [
  maCross(5, 20),
  maCross(10, 50),
  maCross(20, 50),
  maCross(50, 100),
  rsiCross(50),
  rsiCross(60),
  {
    id: 'breakout20',
    label: 'Harga menembus tertinggi 20 sesi',
    family: 'breakout',
    fires(d, i) {
      const h = d.priorHigh20[i];
      return Number.isFinite(h) && Number.isFinite(d.close[i]) && d.close[i] > h;
    },
  },
  {
    id: 'pullback20',
    label: 'Harga balik ke atas MA20 saat MA20 masih di atas MA50',
    family: 'pullback',
    fires(d, i) {
      const m20 = d.sma.get(20)!;
      const m50 = d.sma.get(50)!;
      if (!Number.isFinite(m20[i]) || !Number.isFinite(m50[i]) || !Number.isFinite(m20[i - 1])) return false;
      if (!(m20[i] > m50[i])) return false; // uptrend still intact
      return d.close[i - 1] <= m20[i - 1] && d.close[i] > m20[i];
    },
  },

  // ── buying weakness ──────────────────────────────────────────────────────
  //
  // `pullback20` above waits for the price to come BACK. These three enter
  // while it is still falling, which is what the screener's "antre beli" mode
  // actually lists, and they are here to find out whether that is a worse
  // trade — not to be assumed either way. Pair them with `aboveMa100` in the
  // filter pool to get the screener's structure rule.
  {
    id: 'dipBelowMa20',
    label: 'Harga jatuh ke bawah MA20 untuk pertama kalinya',
    family: 'dip',
    fires(d, i) {
      const m20 = d.sma.get(20)!;
      if (!Number.isFinite(m20[i]) || !Number.isFinite(m20[i - 1])) return false;
      return d.close[i - 1] >= m20[i - 1] && d.close[i] < m20[i];
    },
  },
  {
    id: 'rsiDown40',
    label: 'RSI14 memotong ke bawah 40',
    family: 'dip',
    fires(d, i) {
      const r = d.rsi14[i];
      const p = d.rsi14[i - 1];
      return Number.isFinite(r) && Number.isFinite(p) && p >= 40 && r < 40;
    },
  },
  {
    id: 'drawdown10',
    label: `Harga turun 10% dari puncak ${GAP_WINDOW} sesi untuk pertama kalinya`,
    family: 'dip',
    fires(d, i) {
      const nowHi = d.high60[i];
      const prevHi = d.high60[i - 1];
      if (!Number.isFinite(nowHi) || !Number.isFinite(prevHi) || !(nowHi > 0) || !(prevHi > 0)) return false;
      if (!Number.isFinite(d.close[i]) || !Number.isFinite(d.close[i - 1])) return false;
      // Fresh event only: 10% below the high today, not yet 10% below yesterday.
      return d.close[i] / nowHi - 1 <= -0.1 && d.close[i - 1] / prevHi - 1 > -0.1;
    },
  },
  {
    id: 'laggardGap',
    label: `Indeks acuannya naik ≥10% dalam ${GAP_WINDOW} sesi sementara sahamnya ≤2%`,
    family: 'laggard',
    fires(d, i) {
      const held = (k: number) =>
        Number.isFinite(d.idxRet60[k]) && Number.isFinite(d.ret60[k]) && d.idxRet60[k] >= 0.1 && d.ret60[k] <= 0.02;
      // The condition is a STATE, so only the session it becomes true counts.
      // Without the i-1 check this would re-enter every session for weeks and
      // report one long divergence as a hundred independent wins.
      return held(i) && !held(i - 1);
    },
  },

  // ── entering EARLY ───────────────────────────────────────────────────────
  //
  // Every trigger above this line, including the dip ones, needs the price to
  // have already done something before it can fire — a cross needs the move
  // that caused it, a breakout needs the level to be taken out. Measured on
  // this history, the average signal arrives after the stock is already 30-50%
  // off its 60-session low (the `avgRunupAtEntry` column in the run output).
  //
  // These three fire on a condition that can be true BEFORE the price moves:
  // volatility compressing, volume arriving while the price is still flat, and
  // foreign money accumulating into a stock that is going nowhere. Whether that
  // is worth anything is exactly the question the out-of-sample gates exist to
  // answer, and the answer is allowed to be no.
  {
    id: 'squeezeBreak',
    label: 'Volatilitas termampat ke titik terendah 60 sesi lalu harga menembus tertinggi 10 sesi',
    family: 'early',
    fires(d, i) {
      const floor = d.atrPctFloor60[i - 1];
      const prevAtr = d.atrPct[i - 1];
      if (!Number.isFinite(floor) || !Number.isFinite(prevAtr)) return false;
      // "Compressed" = yesterday's range was within 15% of the quietest it has
      // been in 60 sessions. Requiring an exact equality would fire on almost
      // nothing; requiring less would stop meaning compression at all.
      if (!(prevAtr <= floor * 1.15)) return false;
      const h = d.priorHigh10[i];
      return Number.isFinite(h) && Number.isFinite(d.close[i]) && d.close[i] > h;
    },
  },
  {
    id: 'volumeLead',
    label: 'Volume ≥2,5× rata-rata sementara harga masih menempel MA20',
    family: 'early',
    fires(d, i) {
      const m20 = d.sma.get(20)!;
      if (!Number.isFinite(m20[i]) || !(m20[i] > 0) || !Number.isFinite(d.close[i])) return false;
      // Still at its own mean: the volume showed up before the price did.
      if (Math.abs(d.close[i] / m20[i] - 1) > 0.03) return false;
      const now = d.volSurge[i];
      const prev = d.volSurge[i - 1];
      return Number.isFinite(now) && Number.isFinite(prev) && prev < 2.5 && now >= 2.5;
    },
  },
  {
    id: 'flowLead',
    label: 'Asing net beli 5 sesi sementara harga 20 sesi masih di bawah +3%',
    family: 'early',
    fires(d, i) {
      const m20 = d.sma.get(20)!;
      const flat = (k: number) => {
        const then = d.close[k - 20];
        const now = d.close[k];
        return Number.isFinite(then) && then > 0 && Number.isFinite(now) && now / then - 1 < 0.03;
      };
      const held = (k: number) => Number.isFinite(d.flow5[k]) && d.flow5[k] > 0 && Number.isFinite(m20[k]) && flat(k);
      return held(i) && !held(i - 1);
    },
  },
  // ── DUA PEMICU DARI TEMUAN gate:ablate ─────────────────────────────────
  //
  // Ablasi menemukan hal yang tidak nyaman: dari dua puluh syarat yang diuji
  // sendiri-sendiri, hanya runup 60 sesi yang memuat sinyal, dan menambahkan
  // aturan MA di atasnya justru MENGURANGI hasilnya sambil memangkas keranjang
  // dari 60% ke 20%. Keduanya di bawah ini menerjemahkan itu jadi pemicu yang
  // bisa diuji lab, dan sengaja dibuat setipis mungkin: kalau sebuah aturan
  // hanya bekerja ketika ditumpuki syarat lain, yang bekerja bukan aturan itu.
  //
  // Perlu diingat saat membaca hasilnya: ablasi mengukur MEMEGANG dari sesi
  // mana pun yang syaratnya berlaku, sedangkan lab butuh peristiwa masuk yang
  // diskret. Terjemahan ini tidak pernah bisa persis, jadi kalau keduanya gagal
  // di sini, itu belum tentu membantah ablasinya — bisa juga berarti sinyal
  // lintas-emiten tidak bisa dinyatakan sebagai pemicu deret waktu.
  {
    id: 'quietBase',
    label: `Runup ${GAP_WINDOW} sesi turun ke bawah 15% — baru masuk fase tenang`,
    family: 'early',
    fires(d, i) {
      const now = d.runup60[i];
      const prev = d.runup60[i - 1];
      return Number.isFinite(now) && Number.isFinite(prev) && prev >= 0.15 && now < 0.15;
    },
  },
  {
    id: 'freshBreak',
    label: `Menembus tertinggi 20 sesi sementara runup ${GAP_WINDOW} sesi masih <15%`,
    family: 'early',
    fires(d, i) {
      const h = d.priorHigh20[i];
      const c = d.close[i];
      const p = d.close[i - 1];
      if (!Number.isFinite(h) || !Number.isFinite(c) || !Number.isFinite(p)) return false;
      // Tembusnya harus peristiwa hari ini, bukan keadaan yang sudah berlangsung.
      if (!(p <= h && c > h)) return false;
      const r = d.runup60[i];
      return Number.isFinite(r) && r < 0.15;
    },
  },
];

// ──────────────────────────────────────────────────────────────── filters ──

interface Filter {
  id: string;
  label: string;
  holds(d: Ind, i: number): boolean;
}

const FILTERS: Filter[] = [
  { id: 'vol15', label: 'volume ≥1,5× rata-rata 20 sesi', holds: (d, i) => d.volSurge[i] >= 1.5 },
  { id: 'vol25', label: 'volume ≥2,5× rata-rata 20 sesi', holds: (d, i) => d.volSurge[i] >= 2.5 },
  { id: 'flow5pos', label: 'asing net beli 5 sesi', holds: (d, i) => d.flow5[i] > 0 },
  { id: 'flow20pos', label: 'asing net beli 20 sesi', holds: (d, i) => d.flow20[i] > 0 },
  {
    id: 'aboveMa100',
    label: 'harga di atas MA100',
    holds: (d, i) => {
      const m = d.sma.get(100)![i];
      return Number.isFinite(m) && d.close[i] > m;
    },
  },
  { id: 'calm', label: 'ATR harian <5% harga', holds: (d, i) => d.atrPct[i] < 0.05 },
  { id: 'notOverbought', label: 'RSI14 <70', holds: (d, i) => d.rsi14[i] < 70 },
  {
    id: 'ma50up',
    label: 'MA50 sedang naik',
    holds: (d, i) => {
      const m = d.sma.get(50)!;
      return Number.isFinite(m[i]) && Number.isFinite(m[i - 5]) && m[i] > m[i - 5];
    },
  },
  {
    id: 'belowMa20',
    label: 'harga di bawah MA20',
    holds: (d, i) => {
      const m = d.sma.get(20)![i];
      return Number.isFinite(m) && d.close[i] < m;
    },
  },
  {
    id: 'indexUp10',
    label: `indeks acuannya naik ≥10% dalam ${GAP_WINDOW} sesi`,
    holds: (d, i) => Number.isFinite(d.idxRet60[i]) && d.idxRet60[i] >= 0.1,
  },
  {
    id: 'lagging10',
    label: `tertinggal ≥10 pp dari indeks acuannya dalam ${GAP_WINDOW} sesi`,
    holds: (d, i) => Number.isFinite(d.gap60[i]) && d.gap60[i] >= 0.1,
  },
  // The two filters that say "and do not be late". They can be AND-ed onto any
  // trigger in the grid, including the old crossings, which is the point: it
  // asks whether the SAME rule improves when it refuses the extended entries,
  // instead of only asking whether a brand-new early trigger works.
  {
    id: 'notExtended',
    label: 'harga <1,5 ATR di atas MA20',
    holds: (d, i) => Number.isFinite(d.extAtr[i]) && d.extAtr[i] < 1.5,
  },
  {
    id: 'earlyRunup',
    label: `belum naik 25% dari dasar ${GAP_WINDOW} sesi`,
    holds: (d, i) => Number.isFinite(d.runup60[i]) && d.runup60[i] < 0.25,
  },
  // Dua ambang yang lebih ketat, ditambahkan sesudah gate:ablate menemukan
  // dosis-respons runup yang monoton di sepuluh desil: desil terendah +1,40pp
  // pada tiga bulan, desil tertinggi -8,63pp, bertahan di kedua paruh waktu.
  //
  // JUJUR SOAL DARI MANA ANGKANYA: keduanya dipilih setelah melihat data yang
  // JUGA memuat jendela test lab ini, jadi lolosnya gerbang di sini bukan
  // konfirmasi out-of-sample yang bersih. Yang menyelamatkan sedikit: yang
  // dipakai bukan ambang runcing hasil pencarian, melainkan titik pada hubungan
  // yang monoton sepanjang rentangnya — mana pun potongannya di paruh bawah
  // memberi arah yang sama. Kalau ada yang menambah data baru, jalankan ulang
  // dan yang berlaku adalah hasil di situ, bukan catatan ini.
  {
    id: 'earlyRunup15',
    label: `belum naik 15% dari dasar ${GAP_WINDOW} sesi`,
    holds: (d, i) => Number.isFinite(d.runup60[i]) && d.runup60[i] < 0.15,
  },
  {
    id: 'notFlown',
    label: `belum naik 50% dari dasar ${GAP_WINDOW} sesi`,
    holds: (d, i) => Number.isFinite(d.runup60[i]) && d.runup60[i] < 0.5,
  },
];

/** Every combination of 0, 1 or 2 filters, as bitmasks. */
function buildFilterCombos(): { mask: number; ids: string[]; labels: string[] }[] {
  const out: { mask: number; ids: string[]; labels: string[] }[] = [{ mask: 0, ids: [], labels: [] }];
  for (let a = 0; a < FILTERS.length; a++) {
    out.push({ mask: 1 << a, ids: [FILTERS[a].id], labels: [FILTERS[a].label] });
    for (let b = a + 1; b < FILTERS.length; b++) {
      out.push({
        mask: (1 << a) | (1 << b),
        ids: [FILTERS[a].id, FILTERS[b].id],
        labels: [FILTERS[a].label, FILTERS[b].label],
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────── exits ──

const STOP_MULTS = [1.0, 1.5, 2.0, 3.0];
// Small targets are here ON PURPOSE: that is where high win rates come from.
// The expectancy veto downstream is what stops them being reported as free money.
const TARGET_MULTS = [0.5, 0.75, 1.0, 1.5, 2.5, 4.0];
const MAX_HOLDS = [5, 10, 20];

interface Exit {
  id: string;
  label: string;
  stopMult: number;
  targetMult: number;
  maxHold: number;
}

function buildExits(): Exit[] {
  const out: Exit[] = [];
  for (const stopMult of STOP_MULTS)
    for (const targetMult of TARGET_MULTS)
      for (const maxHold of MAX_HOLDS)
        out.push({
          id: `s${stopMult}t${targetMult}h${maxHold}`,
          label: `stop ${stopMult}×ATR, target ${targetMult}×ATR, maksimal ${maxHold} sesi`,
          stopMult,
          targetMult,
          maxHold,
        });
  return out;
}

/** R-multiple of one trade, or NaN when it cannot be simulated. */
function simulate(d: Ind, i: number, exit: Exit): number {
  const entry = d.close[i];
  const a = d.atr14[i];
  if (!(entry > 0) || !Number.isFinite(a) || a <= 0) return NaN;

  const stop = entry - exit.stopMult * a;
  if (!(stop > 0)) return NaN;
  const target = entry + exit.targetMult * a;
  const risk = entry - stop;

  for (let h = 1; h <= exit.maxHold && i + h < d.n; h++) {
    const j = i + h;
    const hi = Number.isFinite(d.high[j]) ? d.high[j] : d.close[j];
    const lo = Number.isFinite(d.low[j]) ? d.low[j] : d.close[j];
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    // Stop checked first: a bar spanning both is scored as the loss.
    if (lo <= stop) return -1;
    if (hi >= target) return (target - entry) / risk;
  }

  const last = Math.min(i + exit.maxHold, d.n - 1);
  if (last === i) return NaN;
  const out = d.close[last];
  return Number.isFinite(out) ? (out - entry) / risk : NaN;
}

// ────────────────────────────────────────────────────────────────── output ──

interface RankedStrategy {
  id: string;
  family: string;
  triggerLabel: string;
  filterLabels: string[];
  exitLabel: string;
  entryParams: Record<string, number>;
  exitParams: { stopMult: number; targetMult: number; maxHold: number };
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  /** Reward-to-risk of the exit rule: target multiple / stop multiple. */
  rewardRisk: number;
  /** Test expectancy re-priced with the win rate cut 10pp. Must stay positive. */
  stressedExpectancyR: number;
  train: { trades: number; winRate: number; expectancyR: number };
  test: { trades: number; winRate: number; expectancyR: number; profitFactor: number; avgWinR: number; avgLossR: number };
}

async function main() {
  const t0 = Date.now();
  const db = await loadMarketDatabaseFromDisk(DATA_DIR);

  const alignedIndices = alignIndicesToPriceGrid(db);
  /**
   * The reference index for one emiten — its own IDX-IC sector index where IDX
   * publishes one, IHSG where it does not. Defined once and used by BOTH the
   * search pass and the drawdown re-run: the two must build byte-identical
   * indicators or the finalists' drawdowns describe a different rule than the
   * one that was selected. `scripts/` is outside tsconfig's `include`, so a
   * mismatched call here is not a compile error — it is a silent NaN.
   */
  const refIndexFor = (sector: string): Float64Array | null => {
    const code = SECTOR_TO_INDEX[sector];
    return (code ? alignedIndices.get(code) : undefined) ?? alignedIndices.get('COMPOSITE') ?? null;
  };

  const combos = buildFilterCombos();
  const exits = buildExits();
  const nT = TRIGGERS.length;
  const nC = combos.length;
  const nE = exits.length;
  const buckets = nT * nC * nE;

  const WARMUP = warmupFor(db.dates.length);
  const splitIdx = Math.floor(db.dates.length * TRAIN_FRACTION);
  const splitDate = db.dates[splitIdx];

  console.log(
    `universe ${db.emiten.length} emiten · ${db.dates.length} sesi · ${nT} trigger × ${nC} kombinasi filter × ${nE} exit = ${buckets.toLocaleString('id-ID')} rule set`
  );
  console.log(`train: ${db.dates[0]} → ${splitDate} · test: ${splitDate} → ${db.dates[db.dates.length - 1]}`);

  // Flat accumulators — one slot per rule set, per split.
  const trN = new Float64Array(buckets);
  const trWin = new Float64Array(buckets);
  const trSum = new Float64Array(buckets);
  const teN = new Float64Array(buckets);
  const teWin = new Float64Array(buckets);
  const teSum = new Float64Array(buckets);
  const teGain = new Float64Array(buckets);
  const teLoss = new Float64Array(buckets);

  // ── AKUMULATOR PER BLOK, untuk CSCV ────────────────────────────────────
  //
  // Pembagian 70/30 tunggal punya satu cacat yang tidak bisa diperbaiki dengan
  // memindahkan batasnya: batas ITU SENDIRI adalah derajat kebebasan, dan di
  // repo ini batasnya kebetulan mendarat tepat sebelum crash 2026 sehingga
  // SELURUH jendela test berada di dalam satu rezim penurunan 41,5%.
  //
  // CSCV menggantinya dengan 12.870 pembagian sekaligus. Yang dibutuhkannya
  // bukan return per sesi melainkan agregat per BLOK, karena kedua metrik yang
  // dipakai aditif atas blok — 16 slot per rule set, bukan 716. Untuk 148.104
  // rule set itu 19 MB per larik, bukan 847 MB.
  const blockSum = new Float64Array(buckets * CSCV_BLOCKS);
  const blockSq = new Float64Array(buckets * CSCV_BLOCKS);
  const blockN = new Float64Array(buckets * CSCV_BLOCKS);

  // Sesi -> blok. Dibagi rata atas sesi yang BISA menghasilkan sinyal (setelah
  // warmup), bukan atas seluruh larik tanggal: blok yang isinya nol trade
  // membuat metrik OOS-nya NaN dan merusak peringkat.
  const firstSignal = WARMUP;
  const usable = db.dates.length - firstSignal;
  const blockOf = (i: number): number => {
    const b = Math.floor(((i - firstSignal) * CSCV_BLOCKS) / usable);
    return b < 0 ? 0 : b >= CSCV_BLOCKS ? CSCV_BLOCKS - 1 : b;
  };

  const comboMasks = Int32Array.from(combos.map((c) => c.mask));
  const outR = new Float64Array(nE);

  let stocksUsed = 0;
  let signalsFired = 0;
  let tradesSimulated = 0;

  // How LATE each trigger is, accumulated over every signal it ever fires —
  // not just the ones that survive the gates. This is the number the whole
  // "the stock had already flown by the time we caught it" complaint is about,
  // and it did not exist before: the board could tell you a rule's win rate
  // and could not tell you that the rule only ever fires after a 50% move.
  const runupSum = new Float64Array(nT);
  const extSum = new Float64Array(nT);
  const lateN = new Float64Array(nT);

  for (const e of db.emiten) {
    const s = db.series.get(e.code);
    if (!s || s.close.length < WARMUP + 30) continue;

    // Liquidity floor: a rule validated on stocks nobody can get filled in is
    // not a rule anybody can trade.
    const vals: number[] = [];
    for (let i = Math.max(0, s.value.length - 60); i < s.value.length; i++) {
      if (Number.isFinite(s.value[i]) && s.value[i] > 0) vals.push(s.value[i]);
    }
    if (!(median(vals) >= MIN_MEDIAN_TURNOVER_IDR_MN)) continue;
    stocksUsed++;

    // The same reference the screener's laggard mode uses, so a rule validated
    // here is a rule about the list the screen actually produces.
    const d = buildIndicators(e.code, s, refIndexFor(e.sector));

    // Filter states as a bitmask per session — computed once, reused by every
    // trigger and every combination.
    const masks = new Int32Array(d.n);
    for (let i = WARMUP; i < d.n; i++) {
      let m = 0;
      for (let f = 0; f < FILTERS.length; f++) if (FILTERS[f].holds(d, i)) m |= 1 << f;
      masks[i] = m;
    }

    for (let t = 0; t < nT; t++) {
      const trig = TRIGGERS[t];
      for (let i = WARMUP; i < d.n - 1; i++) {
        if (!trig.fires(d, i)) continue;
        signalsFired++;

        if (Number.isFinite(d.runup60[i]) && Number.isFinite(d.extAtr[i])) {
          runupSum[t] += d.runup60[i];
          extSum[t] += d.extAtr[i];
          lateN[t]++;
        }

        // The exit outcome depends only on (stock, entry session, exit rule) —
        // never on which filters selected the entry. Simulating once here and
        // reusing across all passing combinations is what keeps this tractable.
        let any = false;
        for (let x = 0; x < nE; x++) {
          const r = simulate(d, i, exits[x]);
          outR[x] = r;
          if (Number.isFinite(r)) any = true;
        }
        if (!any) continue;
        tradesSimulated += nE;

        const isTrain = i < splitIdx;
        const blk = blockOf(i);
        const mask = masks[i];

        for (let c = 0; c < nC; c++) {
          const need = comboMasks[c];
          if ((mask & need) !== need) continue;
          const base = (t * nC + c) * nE;
          for (let x = 0; x < nE; x++) {
            const r = outR[x];
            if (!Number.isFinite(r)) continue;
            const k = base + x;
            const bi = k * CSCV_BLOCKS + blk;
            blockSum[bi] += r;
            blockSq[bi] += r * r;
            blockN[bi]++;
            if (isTrain) {
              trN[k]++;
              trSum[k] += r;
              if (r > 0) trWin[k]++;
            } else {
              teN[k]++;
              teSum[k] += r;
              if (r > 0) {
                teWin[k]++;
                teGain[k] += r;
              } else {
                teLoss[k] -= r;
              }
            }
          }
        }
      }
    }
  }

  // ── selection ───────────────────────────────────────────────────────────
  //
  // Gates are applied to TEST results. Train only had to be respectable; it is
  // not allowed to decide anything, because it is what the search saw.
  //
  // THE STRESS TEST IS THE GATE THAT MATTERS, and the first run of this file is
  // why it exists. With only "expectancy > 0" as the veto, the top rule set was
  // a 3×ATR stop chasing a 0.5×ATR target: 94% win rate, +0.10R expectancy. It
  // passed every gate and it is still a bad trade, because at that reward-to-
  // risk each loss costs six wins — drop the win rate nine points and it turns
  // negative. A win rate that has to stay above 85% forever to break even is not
  // an edge, it is a short options position wearing a costume.
  //
  // So every candidate is re-priced with its win rate cut by ten percentage
  // points, using its own measured average win and average loss. If it still
  // makes money after that haircut, the edge has somewhere to fall. If it does
  // not, the win rate was carrying the whole strategy and it is dropped no
  // matter how pretty the headline number is.
  const STRESS_WR_HAIRCUT = 0.1;

  /**
   * Why a trigger failed, not just that it did.
   *
   * "Zero survivors" is two completely different findings wearing one number:
   * a trigger whose rule sets LOSE money, and a trigger that makes money at a
   * 55% win rate against a gate that demands 65%. The first says the idea is
   * wrong; the second says the gate was written for a different kind of trade.
   * Both are worth publishing and they lead to opposite decisions, so the best
   * win rate and the best expectancy among rule sets with enough trades are
   * recorded per trigger BEFORE any gate is applied.
   */
  interface TriggerDiag {
    enoughTrades: number;
    passedWinRate: number;
    passedTrainWinRate: number;
    passedExpectancy: number;
    bestTestWinRate: number;
    bestTestExpectancyR: number;
  }
  const diag: TriggerDiag[] = TRIGGERS.map(() => ({
    enoughTrades: 0,
    passedWinRate: 0,
    passedTrainWinRate: 0,
    passedExpectancy: 0,
    bestTestWinRate: -Infinity,
    bestTestExpectancyR: -Infinity,
  }));

  const survivors: { k: number; stressed: number }[] = [];
  for (let k = 0; k < buckets; k++) {
    const trn = trN[k];
    const ten = teN[k];
    if (trn < MIN_TRADES_TRAIN || ten < MIN_TRADES_TEST || trn + ten < MIN_TRADES_TOTAL) continue;

    const testWr = teWin[k] / ten;
    const testExp = teSum[k] / ten;
    const dg = diag[Math.floor(k / (nC * nE))];
    dg.enoughTrades++;
    if (testWr > dg.bestTestWinRate) dg.bestTestWinRate = testWr;
    if (testExp > dg.bestTestExpectancyR) dg.bestTestExpectancyR = testExp;

    if (testWr < MIN_TEST_WIN_RATE) continue;
    dg.passedWinRate++;
    if (trWin[k] / trn < MIN_TRAIN_WIN_RATE) continue;
    dg.passedTrainWinRate++;

    const expectancy = teSum[k] / ten;
    if (expectancy < MIN_TEST_EXPECTANCY) continue;
    dg.passedExpectancy++;

    const losses = ten - teWin[k];
    const avgWin = teWin[k] > 0 ? teGain[k] / teWin[k] : 0;
    const avgLoss = losses > 0 ? teLoss[k] / losses : 0;
    const wrStressed = Math.max(0, testWr - STRESS_WR_HAIRCUT);
    const stressed = wrStressed * avgWin - (1 - wrStressed) * avgLoss;
    if (stressed <= 0) continue;

    survivors.push({ k, stressed });
  }

  // Ranked by the STRESSED number, not the headline win rate. Sorting on win
  // rate puts the most fragile rule set first by construction, since the
  // highest win rates belong to the smallest targets.
  survivors.sort((a, b) => b.stressed - a.stressed);

  const chosen = survivors.slice(0, TOP_N);

  // ── drawdown, for the finalists only ────────────────────────────────────
  // Needs the trade SEQUENCE, which the flat accumulators deliberately do not
  // keep. Re-running a couple of dozen rule sets is cheap; keeping 21,312
  // trade lists in memory would not be.
  const ddByBucket = new Map<number, number>();
  if (chosen.length) {
    const wanted = new Set(chosen.map((c) => c.k));
    const seq = new Map<number, number[]>();
    for (const k of wanted) seq.set(k, []);

    for (const e of db.emiten) {
      const s = db.series.get(e.code);
      if (!s || s.close.length < WARMUP + 30) continue;
      const vals: number[] = [];
      for (let i = Math.max(0, s.value.length - 60); i < s.value.length; i++) {
        if (Number.isFinite(s.value[i]) && s.value[i] > 0) vals.push(s.value[i]);
      }
      if (!(median(vals) >= MIN_MEDIAN_TURNOVER_IDR_MN)) continue;

      const d = buildIndicators(e.code, s, refIndexFor(e.sector));
      const masks = new Int32Array(d.n);
      for (let i = WARMUP; i < d.n; i++) {
        let m = 0;
        for (let f = 0; f < FILTERS.length; f++) if (FILTERS[f].holds(d, i)) m |= 1 << f;
        masks[i] = m;
      }

      for (const k of wanted) {
        const x = k % nE;
        const c = ((k - x) / nE) % nC;
        const t = Math.floor(k / (nC * nE));
        const need = comboMasks[c];
        const trig = TRIGGERS[t];
        const list = seq.get(k)!;
        for (let i = WARMUP; i < d.n - 1; i++) {
          if ((masks[i] & need) !== need) continue;
          if (!trig.fires(d, i)) continue;
          const r = simulate(d, i, exits[x]);
          if (Number.isFinite(r)) list.push(r);
        }
      }
    }

    for (const [k, list] of seq) {
      let cum = 0;
      let peak = 0;
      let dd = 0;
      for (const r of list) {
        cum += r;
        if (cum > peak) peak = cum;
        dd = Math.max(dd, peak - cum);
      }
      ddByBucket.set(k, dd);
    }
  }

  const stressedByBucket = new Map(chosen.map((c) => [c.k, c.stressed]));
  const survivorStress = new Map(survivors.map((c) => [c.k, c.stressed]));

  const strategies: RankedStrategy[] = chosen.map(({ k }) => {
    const x = k % nE;
    const c = ((k - x) / nE) % nC;
    const t = Math.floor(k / (nC * nE));
    const trig = TRIGGERS[t];
    const combo = combos[c];
    const exit = exits[x];

    const trn = trN[k];
    const ten = teN[k];
    const all = trn + ten;
    const allWin = trWin[k] + teWin[k];
    const allSum = trSum[k] + teSum[k];

    return {
      id: `${trig.id}+${combo.ids.join('+') || 'nofilter'}__${exit.id}`,
      family: trig.family,
      triggerLabel: trig.label,
      filterLabels: combo.labels,
      exitLabel: exit.label,
      entryParams: { filters: combo.ids.length },
      exitParams: { stopMult: exit.stopMult, targetMult: exit.targetMult, maxHold: exit.maxHold },
      trades: all,
      winRate: allWin / all,
      expectancyR: allSum / all,
      profitFactor: teLoss[k] > 0 ? teGain[k] / teLoss[k] : teGain[k] > 0 ? Infinity : 0,
      maxDrawdownR: ddByBucket.get(k) ?? NaN,
      rewardRisk: exit.targetMult / exit.stopMult,
      stressedExpectancyR: stressedByBucket.get(k) ?? NaN,
      train: { trades: trn, winRate: trWin[k] / trn, expectancyR: trSum[k] / trn },
      test: {
        trades: ten,
        winRate: teWin[k] / ten,
        expectancyR: teSum[k] / ten,
        profitFactor: teLoss[k] > 0 ? teGain[k] / teLoss[k] : teGain[k] > 0 ? Infinity : 0,
        avgWinR: teWin[k] > 0 ? teGain[k] / teWin[k] : 0,
        avgLossR: ten - teWin[k] > 0 ? teLoss[k] / (ten - teWin[k]) : 0,
      },
    };
  });

  /**
   * Survivors per trigger, whether or not they made the top 25.
   *
   * Without this the board answers "what is the best rule" and nothing else,
   * and a whole family can fail every gate while the leaderboard looks healthy
   * — which is exactly the question asked when the dip and laggard triggers
   * were added. A family with zero survivors is a finding and gets published as
   * one; the alternative is silence that reads like it was never tried.
   */
  const perTrigger = TRIGGERS.map((trig, t) => {
    let tested = 0;
    let passed = 0;
    let best = -Infinity;
    for (let c = 0; c < nC; c++) {
      for (let x = 0; x < nE; x++) {
        tested++;
        const k = (t * nC + c) * nE + x;
        const s = survivorStress.get(k);
        if (s === undefined) continue;
        passed++;
        if (s > best) best = s;
      }
    }
    const dg = diag[t];
    return {
      id: trig.id,
      family: trig.family,
      label: trig.label,
      ruleSetsTested: tested,
      /** Rule sets with enough trades to be judged at all. */
      ruleSetsWithEnoughTrades: dg.enoughTrades,
      /** Of those, how many cleared the win-rate bar. */
      passedWinRate: dg.passedWinRate,
      /** Of those, how many ALSO held up in train, then on expectancy. */
      passedTrainWinRate: dg.passedTrainWinRate,
      passedExpectancy: dg.passedExpectancy,
      survivors: passed,
      /** Mean % the stock had already risen from its 60-session low at entry. */
      avgRunupAtEntry: lateN[t] > 0 ? runupSum[t] / lateN[t] : null,
      /** Mean distance above the 20-session mean at entry, in ATR. */
      avgExtensionAtr: lateN[t] > 0 ? extSum[t] / lateN[t] : null,
      bestTestWinRate: Number.isFinite(dg.bestTestWinRate) ? dg.bestTestWinRate : null,
      bestTestExpectancyR: Number.isFinite(dg.bestTestExpectancyR) ? dg.bestTestExpectancyR : null,
      bestStressedExpectancyR: Number.isFinite(best) ? best : null,
    };
  }).sort((a, b) => b.survivors - a.survivors);

  // ── TINGKAT KELOLOSAN PER FILTER ─────────────────────────────────────────
  //
  // Melihat filter apa yang muncul di daftar teratas tidak membuktikan apa pun:
  // filter yang hadir di banyak kombinasi grid akan muncul lebih sering hanya
  // karena jumlahnya. Yang menjawab adalah TINGKAT kelolosan — berapa persen
  // rule set yang memuat filter itu bertahan sampai gerbang terakhir,
  // dibandingkan tingkat kelolosan keseluruhan.
  //
  // Ditambahkan ketika gate:ablate mengusulkan bahwa satu-satunya pembacaan
  // yang memuat sinyal adalah runup. Usulan itu lahir dari data yang sama yang
  // dipakai lab ini, jadi ia tidak bisa dikonfirmasi di sini — tapi kalau
  // filternya justru MENURUNKAN tingkat kelolosan, itu bantahan yang sah, dan
  // sebuah usulan yang tidak bisa dibantah tidak layak disebut hipotesis.
  // ── CSCV: seberapa besar 485 pemenang itu hasil pencarian belaka ────────
  //
  // Kandidatnya disaring LEBIH DULU dan bukan berdasarkan kinerja: hanya rule
  // set yang punya cukup trade di CUKUP BANYAK blok yang ikut. Alasannya bukan
  // efisiensi melainkan kebenaran — sebuah kandidat yang kosong di separuh blok
  // akan memberi metrik OOS NaN pada separuh kombinasi, dan NaN yang
  // diperingkat diam-diam menjadi peringkat terburuk. Menyaring SESUDAH melihat
  // metrik adalah anti-pola nomor 2 di sumbernya (cherry-picking K).
  const MIN_BLOCKS_WITH_TRADES = CSCV_BLOCKS - 2;
  const MIN_TRADES_PER_CANDIDATE = 100;
  const cscvIdx: number[] = [];
  for (let k = 0; k < buckets; k++) {
    let filled = 0;
    let total = 0;
    for (let b = 0; b < CSCV_BLOCKS; b++) {
      const n = blockN[k * CSCV_BLOCKS + b];
      if (n > 0) filled++;
      total += n;
    }
    if (filled >= MIN_BLOCKS_WITH_TRADES && total >= MIN_TRADES_PER_CANDIDATE) cscvIdx.push(k);
  }

  let cscv: CscvResult | null = null;
  if (cscvIdx.length >= 2) {
    const K = cscvIdx.length;
    const mSum = new Float64Array(K * CSCV_BLOCKS);
    const mSq = new Float64Array(K * CSCV_BLOCKS);
    const mN = new Float64Array(K * CSCV_BLOCKS);
    for (let i = 0; i < K; i++) {
      const src = cscvIdx[i] * CSCV_BLOCKS;
      const dst = i * CSCV_BLOCKS;
      for (let b = 0; b < CSCV_BLOCKS; b++) {
        mSum[dst + b] = blockSum[src + b];
        mSq[dst + b] = blockSq[src + b];
        mN[dst + b] = blockN[src + b];
      }
    }
    cscv = runCscv({ k: K, blocks: CSCV_BLOCKS, sum: mSum, sq: mSq, n: mN }, 'expectancy');
  }

  const overallRate = survivors.length / buckets;
  const perFilter = FILTERS.map((f, fi) => {
    const bit = 1 << fi;
    let tested = 0;
    let passed = 0;
    for (let c = 0; c < nC; c++) {
      if (!(combos[c].mask & bit)) continue;
      for (let x = 0; x < nE; x++) {
        for (let t = 0; t < TRIGGERS.length; t++) {
          tested++;
          if (survivorStress.has((t * nC + c) * nE + x)) passed++;
        }
      }
    }
    return {
      id: f.id,
      label: f.label,
      ruleSetsTested: tested,
      survivors: passed,
      survivalRate: tested ? passed / tested : 0,
      /** Berapa kali lipat tingkat kelolosan keseluruhan. 1,0 = tidak berpengaruh. */
      lift: tested && overallRate > 0 ? passed / tested / overallRate : null,
    };
  }).sort((a, b) => b.survivalRate - a.survivalRate);

  const out = {
    generatedAt: new Date().toISOString(),
    sessions: db.dates.length,
    universe: stocksUsed,
    ruleSetsTested: buckets,
    signalsFired,
    totalTradesSimulated: tradesSimulated,
    split: {
      trainFrom: db.dates[0],
      trainTo: splitDate,
      testFrom: splitDate,
      testTo: db.dates[db.dates.length - 1],
      trainFraction: TRAIN_FRACTION,
    },
    gates: {
      minTradesTotal: MIN_TRADES_TOTAL,
      minTradesTrain: MIN_TRADES_TRAIN,
      minTradesTest: MIN_TRADES_TEST,
      minTestWinRate: MIN_TEST_WIN_RATE,
      minTrainWinRate: MIN_TRAIN_WIN_RATE,
      minTestExpectancyR: MIN_TEST_EXPECTANCY,
      stressWinRateHaircut: STRESS_WR_HAIRCUT,
    },
    survivors: survivors.length,
    overallSurvivalRate: overallRate,
    perTrigger,
    perFilter,
    strategies,
  };

  await writeFile(OUT_FILE, JSON.stringify(out, null, 2));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `${buckets.toLocaleString('id-ID')} rule set atas ${stocksUsed} emiten · ${signalsFired.toLocaleString('id-ID')} sinyal · ${tradesSimulated.toLocaleString('id-ID')} trade tersimulasi · ${secs}s`
  );
  console.log(
    `${survivors.length} lolos semua gerbang (WR test ≥${(MIN_TEST_WIN_RATE * 100).toFixed(0)}%, expectancy test ≥${MIN_TEST_EXPECTANCY}R, tetap positif setelah winrate dipotong ${(STRESS_WR_HAIRCUT * 100).toFixed(0)}pp, ≥${MIN_TRADES_TOTAL} trade) — ${strategies.length} ditulis`
  );
  if (!strategies.length) {
    console.log(
      'TIDAK ADA yang lolos. Itu jawaban yang sah: tidak ada kombinasi di grid ini yang mempertahankan winrate setinggi itu di data yang belum pernah dilihatnya.'
    );
  } else {
    const b = strategies[0];
    console.log(
      `terbaik: ${b.triggerLabel}${b.filterLabels.length ? ' + ' + b.filterLabels.join(' + ') : ''} / ${b.exitLabel}`
    );
    console.log(
      `  test: WR ${(b.test.winRate * 100).toFixed(0)}% dari ${b.test.trades} trade, expectancy ${b.test.expectancyR >= 0 ? '+' : ''}${b.test.expectancyR.toFixed(2)}R, R:R ${b.rewardRisk.toFixed(2)} · train: WR ${(b.train.winRate * 100).toFixed(0)}% dari ${b.train.trades}`
    );
    console.log(
      `  setelah winrate dipotong 10pp: ${b.stressedExpectancyR >= 0 ? '+' : ''}${b.stressedExpectancyR.toFixed(2)}R — masih positif, itu syaratnya`
    );
  }
  console.log('');
  console.log('lolos gerbang per trigger (nol pun dilaporkan):');
  // ── laporan CSCV ────────────────────────────────────────────────────────
  console.log('');
  if (!cscv) {
    console.log('CSCV dilewati — kurang dari dua kandidat punya trade di cukup banyak blok.');
  } else {
    // DUA rasio, dan yang pertama menyanjung diri sendiri.
    //
    // `tradesSimulated` adalah total di SELURUH rule set, dan trade antar rule
    // set saling tumpang tindih berat: satu sinyal yang sama disimulasikan 72
    // kali untuk 72 exit, dan kombinasi filter yang beda satu bit berbagi
    // hampir semua sinyalnya. Membaginya dengan angka itu memberi rasio yang
    // rendah karena penyebutnya dihitung berkali-kali, bukan karena buktinya
    // banyak.
    //
    // Penyebut yang jujur adalah jumlah SINYAL berbeda — berapa peristiwa
    // masuk yang benar-benar ada di data untuk membedakan 148.104 konfigurasi.
    const dofNaive = buckets / Math.max(1, tradesSimulated);
    const dof = buckets / Math.max(1, signalsFired);
    console.log('CSCV — probabilitas papan ini hasil pencarian belaka');
    console.log(`  kandidat  ${cscv.k.toLocaleString('id-ID')} dari ${buckets.toLocaleString('id-ID')} rule set`);
    console.log(`            (disaring SEBELUM metrik dilihat: >= ${MIN_TRADES_PER_CANDIDATE} trade, terisi di >= ${MIN_BLOCKS_WITH_TRADES}/${CSCV_BLOCKS} blok)`);
    console.log(`  kombinasi ${cscv.combinations.toLocaleString('id-ID')} pembagian ${CSCV_BLOCKS / 2}-lawan-${CSCV_BLOCKS / 2}`);
    console.log('');
    console.log(`  PBO       ${(100 * cscv.pbo).toFixed(1)}%  ${verdictPbo(cscv.pbo)}`);
    console.log(`  logit     median ${cscv.medianLogit.toFixed(3)} · rata-rata ${cscv.meanLogit.toFixed(3)}`);
    console.log(`  peringkat relatif pemenang IS di OOS: ${cscv.medianRelativeRank.toFixed(3)} (0,500 = lemparan koin)`);
    console.log('');
    console.log(`  pemenang IS berbeda: ${cscv.distinctWinners.toLocaleString('id-ID')} dari ${cscv.combinations.toLocaleString('id-ID')} kombinasi`);
    if (cscv.topWinner) {
      console.log(`  yang paling sering menang: ${(100 * cscv.topWinner.share).toFixed(1)}% kombinasi`);
    }
    console.log('  (banyak pemenang berbeda = tidak ada satu rule set yang benar-benar terbaik,');
    console.log('   yang ada hanya potongan data yang berbeda-beda — uji stabilitas parameter)');
    console.log('');
    for (const line of renderLogitHistogram(cscv)) console.log('  ' + line);
    console.log('');
    console.log('  DERAJAT KEBEBASAN (aturan 10%: di bawah sehat, di atas eksploratif)');
    console.log(
      `    naif  : ${buckets.toLocaleString('id-ID')} / ${tradesSimulated.toLocaleString('id-ID')} trade = ${(100 * dofNaive).toFixed(2)}%`,
    );
    console.log('            JANGAN dipakai — satu sinyal dihitung 72 kali untuk 72 exit.');
    console.log(
      `    jujur : ${buckets.toLocaleString('id-ID')} / ${signalsFired.toLocaleString('id-ID')} sinyal berbeda = ${(100 * dof).toFixed(1)}%`,
    );
    console.log(
      `    ${dof > 0.1 ? 'JAUH DI ATAS AMBANG. Papan ini alat eksplorasi, bukan alat keputusan.' : 'Di bawah ambang.'}`,
    );
  }

  console.log('');
  console.log('tingkat kelolosan per filter (lift 1,0 = tidak berpengaruh):');
  for (const f of perFilter) {
    console.log(
      `  ${f.label.padEnd(46)} ${(100 * f.survivalRate).toFixed(2).padStart(6)}%  lift ` +
        `${(f.lift ?? 0).toFixed(2).padStart(5)}  dari ${String(f.ruleSetsTested).padStart(6)} rule set`,
    );
  }
  console.log(`  ${'(keseluruhan)'.padEnd(46)} ${(100 * overallRate).toFixed(2).padStart(6)}%`);
  console.log('');

  for (const p of perTrigger) {
    const wr = p.bestTestWinRate === null ? '–' : `${(p.bestTestWinRate * 100).toFixed(0)}%`;
    const exp =
      p.bestTestExpectancyR === null
        ? '–'
        : `${p.bestTestExpectancyR >= 0 ? '+' : ''}${p.bestTestExpectancyR.toFixed(2)}R`;
    const late =
      p.avgRunupAtEntry === null
        ? '   –'
        : `${(p.avgRunupAtEntry * 100).toFixed(0).padStart(3)}%`;
    console.log(
      `  ${p.family.padEnd(8)} ${p.id.padEnd(14)} masuk setelah naik ${late} · dinilai ${p.ruleSetsWithEnoughTrades.toString().padStart(4)} → WR ${p.passedWinRate
        .toString()
        .padStart(4)} → train ${p.passedTrainWinRate.toString().padStart(4)} → expectancy ${p.passedExpectancy
        .toString()
        .padStart(4)} → tahan stres ${p.survivors.toString().padStart(3)} · WR terbaik ${wr.padStart(
        4
      )} · expectancy terbaik ${exp.padStart(6)}`
    );
  }
  console.log(
    '  (corong gerbang, kiri ke kanan. Angka terakhir nol padahal expectancy terbaiknya positif berarti idenya menghasilkan uang tapi tidak pada rule set yang sama yang lolos winrate — winrate-nya yang menanggung semuanya, dan itu justru yang dicari gerbang stres.)'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
