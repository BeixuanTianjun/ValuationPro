// The pick journal — what OUR OWN screens actually said, and what happened next.
//
// ── WHY THIS EXISTS ALONGSIDE THE STRATEGY LAB ────────────────────────────
//
// strategy-lab.ts already measures mechanical rules over 715 sessions, and it
// is the better instrument for the question "does this rule work". It cannot
// answer a different question that matters just as much: does the list this
// terminal PRINTED, ranked the way it ranks it, with the thresholds it actually
// ships, make money. Those differ for reasons the lab cannot simulate — the
// watchlist reads announcements and KSEI ownership that only exist for the last
// 45 days and 24 months, the conviction ordering decides which five names a
// human ever sees, and the screener's thresholds change the moment somebody
// edits them on screen.
//
// So this records the real output, forward, and grades it later. It is a
// measurement, not a backtest, and the distinction is the whole point: nothing
// here is fitted to anything.
//
// ── NO BACKFILL, DELIBERATELY ─────────────────────────────────────────────
//
// Reconstructing two years of "what the screener would have said" was available
// and was rejected. The conviction formula changed on 2026-09-02, the narrative
// stage depends on an announcements file that only reaches back 45 days, and
// the ownership stage on a register that starts in 2024 — a reconstructed 2024
// pick would be graded against inputs it never had. That produces a win rate
// with a real number attached and no meaning, which is worse than an empty
// table saying "not enough data yet".
//
// ── HOW A PICK IS GRADED ──────────────────────────────────────────────────
//
// Entry is the close of the session it was recorded on: a price that actually
// printed and that somebody could have paid. From the NEXT session onward the
// mechanical ATR stop and target from tradeSetup.ts are walked forward bar by
// bar. When one bar's range covers both, the STOP is assumed to have hit first
// — daily bars cannot say which came first, so the pessimistic reading is taken
// every time, exactly as strategy-lab.ts does.
//
// A pick that has hit neither by the 63rd session is closed at that session's
// close and marked `expired`. Three months is the horizon the owner asked
// about; leaving positions open forever would let losers sit unresolved and
// quietly inflate the win rate of everything that did resolve.
//
// ── WHAT THE WIN RATE MAY AND MAY NOT COUNT ───────────────────────────────
//
// Resolved picks only. An open position is not a half-win, and counting it as
// one is the easiest way to make this exercise lie: early on almost everything
// is open, and the few that resolve fastest are the most volatile. `open` is
// reported beside the win rate, never inside it.

import { MarketDatabase } from '../data/marketRepository';
import { STOP_ATR_MULT, TARGET_ATR_MULT } from './tradeSetup';

/** Which screen produced the pick. A plain string so old files stay readable. */
export type PickSource =
  | 'screener:momentum'
  | 'screener:pullback'
  | 'screener:laggard'
  | 'watchlist:mingguan'
  | 'watchlist:bulanan';

export const PICK_SOURCES: { id: PickSource; label: string }[] = [
  { id: 'screener:momentum', label: 'Screener · Momentum' },
  { id: 'screener:pullback', label: 'Screener · Antre Beli' },
  { id: 'screener:laggard', label: 'Screener · Tertinggal' },
  { id: 'watchlist:mingguan', label: 'Watchlist · Mingguan' },
  { id: 'watchlist:bulanan', label: 'Watchlist · Bulanan' },
];

export interface Pick {
  /** `session:source:code` — the same pick recorded twice is the same row. */
  id: string;
  recordedAt: string;
  /** The IDX session whose close is the entry price. */
  session: string;
  source: PickSource;
  code: string;
  name: string;
  sector: string;
  /** Position in that day's list. 1 is what the screen showed first. */
  rank: number;
  /** Conviction (screener) or composite score (watchlist), 0-1. */
  score: number;
  entry: number;
  stop: number;
  target: number;
  atr14: number;
  /** Readings kept so a review can explain the pick without re-deriving it. */
  runupFromLow: number;
  extensionAtr: number;
  gapToIndexPp: number;
  dipFromHigh: number;
  /**
   * False when the entry price came from a session that was still trading.
   *
   * The recorder refuses mid-session runs unless forced, so this is normally
   * true. It is stored anyway rather than assumed, because the day somebody
   * forces a run for testing is the day a hand-typed entry price quietly joins
   * the sample, and a flag that only exists when it is false is a flag nobody
   * remembers to check.
   */
  entryIsFinalClose: boolean;
  /**
   * True when this row was reconstructed from history instead of recorded on
   * the day, by `npm run picks:backfill`.
   *
   * It exists because the two kinds of row are NOT the same measurement and
   * must never be averaged into one number without saying so. A backfilled row
   * is drawn from today's universe, so any emiten delisted since is absent —
   * and delistings skew towards failures, which makes a backfilled win rate an
   * optimistic one. A forward-recorded row has no such hole.
   *
   * Optional rather than required so every row written before this existed
   * stays valid and reads as false.
   */
  backfilled?: boolean;
}

export interface PickFile {
  version: 1;
  startedOn: string;
  note: string;
  picks: Pick[];
}

export type PickOutcome = 'target' | 'stop' | 'expired' | 'open';

export interface EvaluatedPick extends Pick {
  outcome: PickOutcome;
  /** Sessions held. For an open pick, sessions elapsed so far. */
  sessionsHeld: number;
  /** The session the outcome landed on, or the last one available. */
  exitSession: string;
  exitPrice: number;
  /** Profit in units of the risk taken. -1 is a full stop loss. */
  rMultiple: number;
  returnPercent: number;
  /** Return after 5 / 21 / 63 sessions regardless of stop and target. */
  return1w: number;
  return1m: number;
  return3m: number;
  /** True once the outcome can no longer change. */
  resolved: boolean;
}

/** Sessions before an unresolved pick is closed at market. */
export const MAX_HOLD_SESSIONS = 63;
const W1 = 5;
const M1 = 21;
const M3 = 63;

/**
 * Grade one pick against the sessions that came AFTER it.
 *
 * The entry session is located by DATE, never by counting back from the end of
 * the array: the price grid grows every session and gains a live overlay
 * intraday, so any offset computed today is wrong tomorrow.
 */
export function evaluatePick(pick: Pick, db: MarketDatabase): EvaluatedPick | null {
  const series = db.series.get(pick.code);
  const start = db.dates.indexOf(pick.session);
  if (!series || start < 0) return null;

  const risk = pick.entry - pick.stop;

  // ── EVERYTHING BELOW READS ONE SCALE, AND THAT TOOK A BUG TO LEARN ───────
  //
  // `entry`, `stop` and `target` were written in the price AS TRADED on the
  // entry session. `series.close/high/low` are back-adjusted against the NEWEST
  // session, so a corporate action AFTER the entry moves the whole history onto
  // a different scale. Comparing the two directly is comparing rupiah before a
  // split with rupiah after one.
  //
  // Measured over a 22,770-row journal: 673 picks (3.0%) sat on the wrong side
  // of an action, the median 1-month return was overstated as a loss by 0.43pp
  // and the 3-month by 0.81pp — and one row, PACK on 2025-05-21, was recorded
  // as -81.7% when the holder was actually up 142.4%. A reverse split read as a
  // collapse. The outcome flags were wrong too, not only the returns: `stop`
  // and `target` are tested against `high`/`low` in the same mismatched scale,
  // so a pick could be marked stopped out on a bar that never touched the stop.
  //
  // `k` puts the adjusted series back into the entry session's traded scale.
  // It is read off the data rather than recomputed from the adjustment factors,
  // so there is only one implementation of this arithmetic to be wrong.
  const k =
    series.rawClose[start] > 0 && series.close[start] > 0
      ? series.rawClose[start] / series.close[start]
      : 1;

  const priceAt = (i: number): number => {
    for (let j = Math.min(i, series.close.length - 1); j >= 0; j--) {
      if (Number.isFinite(series.close[j]) && series.close[j] > 0) return series.close[j] * k;
    }
    return NaN;
  };
  const retAfter = (n: number): number => {
    const i = start + n;
    if (i >= db.dates.length) return NaN;
    const p = priceAt(i);
    return Number.isFinite(p) && pick.entry > 0 ? p / pick.entry - 1 : NaN;
  };

  let outcome: PickOutcome = 'open';
  let exitIdx = db.dates.length - 1;
  let exitPrice = priceAt(exitIdx);

  for (let h = 1; h <= MAX_HOLD_SESSIONS && start + h < db.dates.length; h++) {
    const i = start + h;
    const hi = (Number.isFinite(series.high[i]) ? series.high[i] : series.close[i]) * k;
    const lo = (Number.isFinite(series.low[i]) ? series.low[i] : series.close[i]) * k;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) continue;

    // Stop first: a bar spanning both is scored as the loss.
    if (lo <= pick.stop) {
      outcome = 'stop';
      exitIdx = i;
      exitPrice = pick.stop;
      break;
    }
    if (hi >= pick.target) {
      outcome = 'target';
      exitIdx = i;
      exitPrice = pick.target;
      break;
    }
    if (h === MAX_HOLD_SESSIONS) {
      outcome = 'expired';
      exitIdx = i;
      exitPrice = priceAt(i);
    }
  }

  const sessionsHeld = exitIdx - start;
  return {
    ...pick,
    outcome,
    sessionsHeld,
    exitSession: db.dates[exitIdx] ?? pick.session,
    exitPrice,
    rMultiple: risk > 0 && Number.isFinite(exitPrice) ? (exitPrice - pick.entry) / risk : NaN,
    returnPercent: pick.entry > 0 && Number.isFinite(exitPrice) ? exitPrice / pick.entry - 1 : NaN,
    return1w: retAfter(W1),
    return1m: retAfter(M1),
    return3m: retAfter(M3),
    resolved: outcome !== 'open',
  };
}

export interface PickSummary {
  source: PickSource | 'SEMUA';
  label: string;
  picks: number;
  resolved: number;
  open: number;
  wins: number;
  losses: number;
  /** wins / resolved. NaN when nothing has resolved — never 0. */
  winRate: number;
  /** Mean R across RESOLVED picks only. */
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  medianReturn1m: number;
  medianReturn3m: number;
  /** Sessions the oldest still-open pick has been running. */
  oldestOpenSessions: number;
}

const median = (xs: number[]): number => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function summarisePicks(rows: EvaluatedPick[], source: PickSource | 'SEMUA', label: string): PickSummary {
  const mine = source === 'SEMUA' ? rows : rows.filter((r) => r.source === source);
  const done = mine.filter((r) => r.resolved);
  // `expired` counts as a win only when it actually made money — closing at
  // market after three months is an outcome, not a neutral event.
  const wins = done.filter((r) => r.rMultiple > 0);
  const losses = done.filter((r) => !(r.rMultiple > 0));
  const open = mine.filter((r) => !r.resolved);

  return {
    source,
    label,
    picks: mine.length,
    resolved: done.length,
    open: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: done.length ? wins.length / done.length : NaN,
    expectancyR: done.length ? done.reduce((s, r) => s + r.rMultiple, 0) / done.length : NaN,
    avgWinR: wins.length ? wins.reduce((s, r) => s + r.rMultiple, 0) / wins.length : NaN,
    avgLossR: losses.length ? losses.reduce((s, r) => s + r.rMultiple, 0) / losses.length : NaN,
    medianReturn1m: median(mine.map((r) => r.return1m)),
    medianReturn3m: median(mine.map((r) => r.return3m)),
    oldestOpenSessions: open.length ? Math.max(...open.map((r) => r.sessionsHeld)) : 0,
  };
}

/**
 * How many resolved picks before a win rate is worth printing.
 *
 * Not a statistical test and it does not pretend to be one — it is a floor that
 * stops the screen reporting "100% win rate" off two trades in week one. Even
 * at 20 a single flip moves the rate five points, which is still noisy and is
 * said out loud on screen rather than implied by silence.
 */
export const MIN_RESOLVED_FOR_WINRATE = 20;

/**
 * Every summary, computed on FINAL entries only.
 *
 * A provisional row (recorded mid-session with `--force`) holds a price that
 * really printed, so it is not fake — but it was taken at an arbitrary moment
 * of the day while every other row is a close. Mixing the two makes the
 * protocol inconsistent in a way no column would reveal, so they are excluded
 * here and counted separately. They stay in the file: excluding a row from a
 * statistic is not the same as deleting it, and the second one destroys
 * evidence.
 */
/**
 * Summaries, with the two populations kept apart on purpose.
 *
 * `summaries` covers rows recorded on the day. `backfillSummaries` covers rows
 * reconstructed from history by `npm run picks:backfill`. They are never added
 * together, and no caller is given a total that spans both, because the two do
 * not measure the same thing:
 *
 *   - A backfilled row is drawn from TODAY's universe, so any emiten delisted
 *     since is missing. Delistings are not random — they skew towards failures
 *     — so a backfilled win rate is biased UPWARDS by an amount nobody can
 *     recover after the fact.
 *   - A live row is ranked on the intraday overlay, because IDX has not
 *     published the session when the recorder runs: Yahoo prices, with foreign
 *     flow and trade counts carried from the previous session. A backfilled row
 *     is ranked on the official figures. Same rules, different inputs.
 *
 * Neither is wrong. Averaging them produces a number that answers no question,
 * which is worse than either. Whichever surface displays these must label them.
 */
export function buildPickSummaries(rows: EvaluatedPick[]): {
  summaries: PickSummary[];
  backfillSummaries: PickSummary[];
  provisionalExcluded: number;
} {
  const final = rows.filter((r) => r.entryIsFinalClose);
  const live = final.filter((r) => !r.backfilled);
  const back = final.filter((r) => r.backfilled);
  const forGroup = (g: EvaluatedPick[]) =>
    g.length
      ? [summarisePicks(g, 'SEMUA', 'Semua sumber'), ...PICK_SOURCES.map((s) => summarisePicks(g, s.id, s.label))]
      : [];
  return {
    summaries: forGroup(live),
    backfillSummaries: forGroup(back),
    provisionalExcluded: rows.length - final.length,
  };
}

/** ATR stop and target, identical to what the screens print. */
export function levelsFor(entry: number, atr14: number): { stop: number; target: number } | null {
  if (!(entry > 0) || !Number.isFinite(atr14) || atr14 <= 0) return null;
  const stop = entry - STOP_ATR_MULT * atr14;
  if (!(stop > 0)) return null;
  return { stop, target: entry + TARGET_ATR_MULT * atr14 };
}

/** Month key `YYYY-MM` for grouping a monthly report. */
export const monthOf = (session: string) => session.slice(0, 7);
