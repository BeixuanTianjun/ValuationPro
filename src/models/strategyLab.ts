// Loads the output of scripts/strategy-lab.ts — mechanical entry/exit rule
// sets that held a high win rate on sessions they were never fitted to.
//
// WHY EVERY NUMBER HERE IS THE *TEST* NUMBER. The lab searches ~21,000 rule
// sets on the first 70% of the history and then judges the winners on the last
// 30%, which the search never saw. Reporting the full-history figure would
// quietly re-import the overfitting the split exists to remove, so the panel
// leads with `test` and shows `train` beside it: the gap between the two is
// the reader's own overfitting check, and hiding it would be the whole problem.
//
// WHY THIS DOES NOT AUTO-MATCH A STOCK TO A STRATEGY. It was tempting to print
// "this row currently satisfies Strategy #3" next to every screener line. That
// needs the exact entry condition re-evaluated live — freshly CROSSED, not
// merely currently stacked — and several winning pairs (MA10/MA50, MA50/MA100)
// have no equivalent in FactorSnapshot, which carries sma20/50/200 only.
// Building the match for the reconstructable rules and skipping it for the rest
// would let an accident of which averages happen to be cached decide which
// stocks get cited. So this stays a reference leaderboard: read the rule, then
// look at the chart — the same division of labour the watchlist's own final
// stage already insists on.

import { loadIdxFile } from '../data/idxFiles';

export interface RankedStrategy {
  id: string;
  family: string;
  triggerLabel: string;
  filterLabels: string[];
  exitLabel: string;
  entryParams: Record<string, number>;
  exitParams: { stopMult: number; targetMult: number; maxHold: number };
  /** Trades across train and test combined. */
  trades: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
  /** Target multiple ÷ stop multiple. Below ~1 the win rate is doing all the work. */
  rewardRisk: number;
  /** Test expectancy re-priced with the win rate cut 10pp — the fragility check. */
  stressedExpectancyR: number;
  train: { trades: number; winRate: number; expectancyR: number };
  test: {
    trades: number;
    winRate: number;
    expectancyR: number;
    profitFactor: number;
    avgWinR: number;
    avgLossR: number;
  };
}

/**
 * One trigger's walk through the gates, published whether or not it survived.
 *
 * WHY A FAILING FAMILY IS SHOWN AT ALL. The leaderboard on its own answers
 * "what worked" and stays silent about everything that was tried and did not —
 * which is indistinguishable from never having tried it. When the screener
 * gained a dip mode and a laggard mode, the honest question was whether buying
 * weakness holds up out of sample; the answer was no, and a board that only
 * lists winners would have quietly implied the opposite by omission.
 *
 * The counts are a funnel, left to right, so the reader can see WHICH gate
 * killed a family. Hundreds of rule sets clearing the win-rate bar and none
 * clearing expectancy is a completely different finding from a family that
 * never won anything.
 */
export interface TriggerDiagnostic {
  id: string;
  family: string;
  label: string;
  ruleSetsTested: number;
  /** Rule sets with enough trades in both splits to be judged at all. */
  ruleSetsWithEnoughTrades: number;
  passedWinRate: number;
  passedTrainWinRate: number;
  passedExpectancy: number;
  /** Cleared every gate including the win-rate haircut. */
  survivors: number;
  /**
   * Mean % the stock had ALREADY risen from its 60-session low when this
   * trigger fired — how late it is, measured over every signal it ever gave.
   *
   * This is the number that answers "the stocks had already flown by the time
   * we caught them". It is not a gate and nothing is rejected for it; it is
   * simply the fact that was missing. `breakout20` fires after an 87% run and
   * survives nothing; `laggardGap` fires after 12% and also survives nothing.
   * Being early is necessary, not sufficient, and the column shows both halves.
   */
  avgRunupAtEntry: number | null;
  /** Mean distance above the 20-session mean at entry, in ATR units. */
  avgExtensionAtr: number | null;
  bestTestWinRate: number | null;
  bestTestExpectancyR: number | null;
  bestStressedExpectancyR: number | null;
}

export interface StrategyFile {
  generatedAt: string;
  sessions: number;
  universe: number;
  ruleSetsTested: number;
  signalsFired: number;
  totalTradesSimulated: number;
  split: {
    trainFrom: string;
    trainTo: string;
    testFrom: string;
    testTo: string;
    trainFraction: number;
  };
  gates: {
    minTradesTotal: number;
    minTradesTrain: number;
    minTradesTest: number;
    minTestWinRate: number;
    minTrainWinRate: number;
    minTestExpectancyR: number;
    stressWinRateHaircut: number;
  };
  /** How many rule sets cleared every gate — the pool the top N came from. */
  survivors: number;
  /**
   * Optional because a strategies.json written before this field existed is
   * still a valid file, and the panel must render it rather than crash on a
   * deployment whose data has not been rebuilt yet.
   */
  perTrigger?: TriggerDiagnostic[];
  strategies: RankedStrategy[];
}

/**
 * Memoised through `loadIdxFile`, which is why this is a one-liner now.
 *
 * Both this file's panel and the watchlist call it, and before the shared
 * loader existed one pass through the Market tabs pulled strategies.json four
 * separate times.
 */
export function loadStrategyFile(): Promise<StrategyFile | null> {
  return loadIdxFile<StrategyFile>('strategies.json');
}
