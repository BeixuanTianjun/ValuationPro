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
  strategies: RankedStrategy[];
}

export async function loadStrategyFile(): Promise<StrategyFile | null> {
  try {
    const url = `${import.meta.env.BASE_URL || '/'}data/idx/strategies.json`.replace(/\/{2,}/g, '/');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as StrategyFile;
  } catch {
    return null;
  }
}
