export interface DcfAssumptions {
  companyName: string;
  currency: string;
  units: 'billions' | 'millions' | 'thousands' | 'exact';
  currentSharePrice: number;
  // Share count, expressed in the SAME scale as `units`. The engine divides
  // equity value by this number directly, so with units='billions' the count
  // must be in billions of shares (TLKM = 99.06), not millions.
  sharesOutstanding: number;
  balanceSheetCash: number;
  balanceSheetDebt: number;
  minorityInterest: number;
  equityInvestments: number;

  // Historical Base
  baseRevenue: number;
  forecastYears: number; // 5 default

  // Operating Forecast
  revenueGrowthRates: number[];
  grossMargins: number[];
  ebitdaMargins: number[];
  ebitMargins: number[];
  taxRate: number;
  capexPercentOfRev: number[];
  nwcPercentOfRev: number[];
  daPercentOfRev: number[];

  // WACC Parameters
  useManualWacc: boolean;
  manualWacc: number;
  riskFreeRate: number;
  beta: number;
  equityRiskPremium: number;
  sizePremium: number;
  preTaxCostOfDebt: number;
  targetDebtWeight: number;

  // Terminal Value Parameters
  perpetualGrowthRate: number;
  exitMultiple: number;
  discountConvention: 'mid-year' | 'end-year';
}

export interface WaccBreakdown {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  wacc: number;
  /** True when CAPM produced a WACC below the sovereign yield and it was floored. */
  waccFloored?: boolean;
}

export interface UfcfYearData {
  year: number;
  yearLabel: string;
  revenue: number;
  revenueGrowth: number;
  grossProfit: number;
  ebitda: number;
  ebit: number;
  taxesOnEbit: number;
  nopat: number;
  da: number;
  capex: number;
  nwc: number;
  deltaNwc: number;
  ufcf: number;
  discountPeriod: number;
  discountFactor: number;
  presentValueUfcf: number;
}

export type DcfDiagnosticLevel = 'error' | 'warning' | 'info';

export interface DcfDiagnostic {
  level: DcfDiagnosticLevel;
  message: string;
}

export interface DcfValuationSummary {
  wacc: WaccBreakdown;
  cashFlows: UfcfYearData[];
  pvDiscreteCashFlows: number;

  /** Anything that makes the output unreliable, surfaced rather than hidden. */
  diagnostics: DcfDiagnostic[];
  /** Terminal growth actually used — clamped below WACC when the input was not. */
  effectiveTerminalGrowth: number;
  /** Share of enterprise value contributed by the terminal value. */
  terminalValueShareGordon: number;
  terminalValueShareMultiple: number;
  /** True when equity value was floored at zero because claims exceeded EV. */
  equityFlooredGordon: boolean;
  equityFlooredMultiple: boolean;

  // Gordon Growth
  terminalYearUfcf: number;
  terminalGrowthValue: number;
  pvTerminalGrowthValue: number;
  evGordonGrowth: number;
  equityValueGordonGrowth: number;
  impliedSharePriceGordon: number;
  upsideGordonPercent: number;

  // Exit Multiple
  terminalEbitda: number;
  terminalMultipleValue: number;
  pvTerminalMultipleValue: number;
  evExitMultiple: number;
  equityValueExitMultiple: number;
  impliedSharePriceMultiple: number;
  upsideMultiplePercent: number;
}