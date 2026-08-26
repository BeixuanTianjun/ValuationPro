export interface DebtTrancheInput {
  name: string;
  type: 'senior' | 'subordinated' | 'revolver';
  leverageMultiple: number; // e.g. 3.5x EBITDA
  interestRate: number;     // e.g. 0.075 (7.5%)
  amortizationRate: number; // e.g. 0.05 (5% mandatory amort per year)
  isPik?: boolean;          // Payment-in-kind interest
}

export interface LboAssumptions {
  dealName: string;
  currency: string;
  targetLtmRevenue: number;
  targetLtmEbitda: number;
  entryEvEbitdaMultiple: number;
  holdPeriodYears: number;   // 1 - 7 years (default 5)
  exitEvEbitdaMultiple: number;

  // Transaction Fees
  advisoryFeePercent: number; // e.g. 0.015 (1.5% of EV)
  financingFeePercent: number;// e.g. 0.02 (2.0% of Debt)

  // Financing Structure
  seniorDebtMultiple: number; // e.g. 3.5x
  seniorDebtInterest: number; // e.g. 0.07
  seniorDebtAmort: number;    // e.g. 0.05 (5%/yr)

  subDebtMultiple: number;    // e.g. 1.5x
  subDebtInterest: number;    // e.g. 0.11
  subDebtAmort: number;       // e.g. 0.0 (bullet)

  minCashBalance: number;

  // Operating Projections
  revenueGrowthRates: number[];
  ebitdaMargins: number[];
  capexPercentOfRev: number[];
  nwcPercentOfRev: number[];
  daPercentOfRev: number[];
  taxRate: number;
  cashSweepPercent: number;  // e.g. 1.0 (100% sweep of excess cash)
}

export interface SourcesAndUses {
  // Uses
  enterpriseValue: number;
  refinanceOldDebt: number;
  advisoryFees: number;
  financingFees: number;
  totalUses: number;

  // Sources
  seniorDebtAmount: number;
  subDebtAmount: number;
  totalDebtRaised: number;
  sponsorEquity: number;
  totalSources: number;
  sponsorEquityPercent: number;
  totalDebtMultiple: number;
}

export interface DebtTrancheSchedule {
  beginningBalance: number;
  mandatoryAmortization: number;
  optionalPrepayment: number;
  endingBalance: number;
  interestExpense: number;
  effectiveRate: number;
}

export interface LboYearSchedule {
  year: number;
  revenue: number;
  ebitda: number;
  da: number;
  ebit: number;
  totalInterestExpense: number;
  ebt: number;
  tax: number;
  netIncome: number;
  capex: number;
  deltaNwc: number;
  freeCashFlowBeforeDebt: number;

  // Debt Schedule
  seniorDebt: DebtTrancheSchedule;
  subDebt: DebtTrancheSchedule;
  totalEndingDebt: number;
  cashBeginning: number;
  cashGenerated: number;
  totalDebtService: number;
  cashEnding: number;
  netDebt: number;
  leverageRatio: number; // Net Debt / EBITDA
  interestCoverageRatio: number; // EBITDA / Interest
}

export interface LboReturnsSummary {
  sourcesAndUses: SourcesAndUses;
  schedules: LboYearSchedule[];
  exitYear: number;
  exitEbitda: number;
  exitMultiple: number;
  exitEnterpriseValue: number;
  endingNetDebt: number;
  exitEquityValue: number;

  initialSponsorEquity: number;
  sponsorMoIC: number; // Multiple on Invested Capital (e.g. 2.85x)
  sponsorIRR: number;  // Internal Rate of Return (e.g. 23.4%)

  // Attribution
  ebitdaGrowthImpact: number;
  multipleExpansionImpact: number;
  debtPaydownImpact: number;
}
