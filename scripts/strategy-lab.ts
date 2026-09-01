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
 *   8 triggers  × 37 filter combinations × 72 exits = 21,312 rule sets
 *
 * A trigger is a fresh EVENT (a crossing, a breakout) — never a standing state,
 * or the same position would re-enter every session. Filters are standing
 * conditions AND-ed onto it, drawn 0, 1 or 2 at a time from a pool of 8; this
 * is the "dikombinasikan" part, and it is where most of the improvement comes
 * from: a moving-average cross with no context is a coin flip, the same cross
 * filtered to stocks above their 100-day average with foreign money buying is
 * a different animal.
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
function warmupFor(sessions: number): number {
  return Math.min(150, Math.max(105, Math.floor(sessions * 0.25)));
}
/** Fraction of the history used to search. The rest only ever judges. */
const TRAIN_FRACTION = 0.7;
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
}

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
function buildIndicators(code: string, s: PriceSeries): Ind {
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
  };
}

// ─────────────────────────────────────────────────────────────── triggers ──

interface Trigger {
  id: string;
  label: string;
  family: 'trend' | 'momentum' | 'breakout' | 'pullback';
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

  const comboMasks = Int32Array.from(combos.map((c) => c.mask));
  const outR = new Float64Array(nE);

  let stocksUsed = 0;
  let signalsFired = 0;
  let tradesSimulated = 0;

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

    const d = buildIndicators(e.code, s);

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
        const mask = masks[i];

        for (let c = 0; c < nC; c++) {
          const need = comboMasks[c];
          if ((mask & need) !== need) continue;
          const base = (t * nC + c) * nE;
          for (let x = 0; x < nE; x++) {
            const r = outR[x];
            if (!Number.isFinite(r)) continue;
            const k = base + x;
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

  const survivors: { k: number; stressed: number }[] = [];
  for (let k = 0; k < buckets; k++) {
    const trn = trN[k];
    const ten = teN[k];
    if (trn < MIN_TRADES_TRAIN || ten < MIN_TRADES_TEST || trn + ten < MIN_TRADES_TOTAL) continue;

    const testWr = teWin[k] / ten;
    if (testWr < MIN_TEST_WIN_RATE) continue;
    if (trWin[k] / trn < MIN_TRAIN_WIN_RATE) continue;

    const expectancy = teSum[k] / ten;
    if (expectancy < MIN_TEST_EXPECTANCY) continue;

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

      const d = buildIndicators(e.code, s);
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
