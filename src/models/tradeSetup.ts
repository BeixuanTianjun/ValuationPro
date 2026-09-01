// Trade setup — a mechanical entry/stop/target reference level.
//
// WHY ATR AND NOT A FIXED PERCENTAGE. A flat "stop 5% below entry" means
// something different for a stock that moves 1% a day than for one that moves
// 6% a day: the quiet one gets stopped out on ordinary noise less often, the
// volatile one gets stopped out on noise constantly. ATR14 already measures
// each stock's own daily range (see factorEngine.ts), so sizing the stop and
// target off it scales with how that specific name actually moves.
//
// THE MULTIPLES ARE FIXED, NOT FITTED. 1.5x ATR for the stop and 2.5x for the
// target (roughly 1.7:1 reward-to-risk) is a common, unremarkable convention —
// chosen for legibility, not because it was optimised on this dataset. Where a
// backtested rule set (strategyLab.ts) actually measured a matching entry's
// historical win rate, that number is shown alongside this one, never folded
// into it — a mechanical level and a measured statistic are different kinds of
// claim and the UI keeps them visibly separate.
//
// THIS IS NOT A RECOMMENDATION. It is a reference level computed the same way
// for every row, so two traders looking at the same stock see the same
// numbers to argue with — not a signal to act on unread.

export interface TradeSetup {
  code: string;
  entry: number;
  stop: number;
  target: number;
  atr14: number;
  /** (entry - stop) / entry, as a fraction. */
  riskPercent: number;
  /** (target - entry) / (entry - stop). */
  rewardRiskRatio: number;
}

export const STOP_ATR_MULT = 1.5;
export const TARGET_ATR_MULT = 2.5;

/**
 * Builds an ATR-based entry/stop/target. Returns null when there isn't enough
 * live data to compute one (no close, or ATR not yet measurable) — the caller
 * shows "belum bisa dihitung", never a setup built on a placeholder number.
 */
export function buildTradeSetup(input: { code: string; close: number; atr14: number }): TradeSetup | null {
  const { code, close, atr14 } = input;
  if (!(close > 0) || !Number.isFinite(atr14) || atr14 <= 0) return null;

  const stop = close - STOP_ATR_MULT * atr14;
  if (!(stop > 0)) return null;
  const target = close + TARGET_ATR_MULT * atr14;
  const risk = close - stop;

  return {
    code,
    entry: close,
    stop,
    target,
    atr14,
    riskPercent: risk / close,
    rewardRiskRatio: (target - close) / risk,
  };
}
