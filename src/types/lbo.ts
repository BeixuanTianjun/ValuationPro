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
  /**
   * Skala yang dipakai SEMUA angka rupiah di model ini.
   *
   * KENAPA ADA. Sebelumnya tidak ada, dan akibatnya terlihat di layar:
   * `convertCalibratedToLbo` menyalin `currency` dari laporan keuangan tetapi
   * tidak menyalin skalanya, jadi angkanya berskala laporan — biasanya miliar
   * untuk emiten IDX — sementara DebtWaterfall mencetak "(Millions)" dan panel
   * sensitivitas mencetak "Amounts in $m". Dua klaim yang keduanya salah, di
   * atas angka yang benar.
   *
   * Opsional supaya berkas model lama tetap terbaca; yang tidak menyebutkannya
   * diperlakukan sebagai 'billions', skala yang dipakai tiap preset dan tiap
   * kalibrasi dari laporan IDX.
   */
  units?: 'billions' | 'millions' | 'thousands' | 'exact';
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
  //
  // Keempatnya BERJUMLAH tepat ke `exitEquityValue - initialSponsorEquity`.
  // Itu bukan kebetulan melainkan syarat: sebuah jembatan nilai yang tidak
  // rekonsiliasi menyembunyikan selisihnya di tempat yang tidak dilihat siapa
  // pun. Sampai 2026-09-02 komponennya hanya tiga dan meleset persis sebesar
  // biaya transaksi — pada contoh uji, Rp 400 dari Rp 12.181 yang sebenarnya.
  ebitdaGrowthImpact: number;
  multipleExpansionImpact: number;
  debtPaydownImpact: number;
  /**
   * Biaya penasihat dan pembiayaan, SELALU negatif.
   *
   * Uang yang disetor sponsor pada penutupan tetapi tidak pernah menjadi nilai
   * perusahaan. Ia beban permanen terhadap hasil, dan menghilangkannya dari
   * jembatan membuat ketiga komponen lain terlihat lebih besar daripada yang
   * benar-benar mereka hasilkan.
   */
  transactionFeeImpact: number;
}
