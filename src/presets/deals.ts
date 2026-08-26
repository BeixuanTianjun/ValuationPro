import { DealPreset } from '../types/common';
import { DcfAssumptions } from '../types/dcf';
import { LboAssumptions } from '../types/lbo';
import { ParsedFinancialReport } from '../types/statements';
import { EMITEN_PRESETS } from './emitenPresets';
import {
  calibrateFinancialReport,
  convertCalibratedToDcf,
  convertCalibratedToLbo,
} from '../models/statementCalibrator';

/**
 * Indonesian market cost-of-capital baseline.
 *
 * Every preset in this file is an IDX-listed emiten, so the WACC inputs are set
 * from Indonesian market data rather than US defaults:
 *   - risk-free: 10-year Indonesian government bond (SUN / INDOGB)
 *   - ERP: mature-market premium plus Indonesia's country risk premium
 *   - tax: 22% PPh Badan
 *   - terminal growth: long-run nominal GDP for Indonesia
 *
 * These are assumptions, not observations — override them per deal when you
 * have a live yield curve in front of you.
 */
export const IDX_MARKET_PARAMS = {
  riskFreeRate: 0.0675,
  equityRiskPremium: 0.0755,
  preTaxCostOfDebt: 0.0875,
  corporateTaxRate: 0.22,
  perpetualGrowthRate: 0.04,
  currency: 'Rp ',
} as const;

/** Levered beta vs IHSG. Recomputed from live prices once the market database loads. */
const DEFAULT_BETA: Record<string, number> = {
  TLKM: 0.85,
  ASII: 1.05,
};

/** Entry / exit EV-EBITDA anchors reflecting where IDX large caps actually trade. */
const DEAL_ANCHORS: Record<string, { entry: number; exit: number; debtWeight: number; size: number }> = {
  TLKM: { entry: 4.5, exit: 5.0, debtWeight: 0.3, size: 0.0 },
  ASII: { entry: 5.0, exit: 5.5, debtWeight: 0.35, size: 0.0 },
};

const BASE_DCF: DcfAssumptions = {
  companyName: '',
  currency: IDX_MARKET_PARAMS.currency,
  units: 'billions',
  currentSharePrice: 0,
  sharesOutstanding: 0,
  balanceSheetCash: 0,
  balanceSheetDebt: 0,
  minorityInterest: 0,
  equityInvestments: 0,
  baseRevenue: 0,
  forecastYears: 5,
  revenueGrowthRates: [0.05, 0.05, 0.04, 0.04, 0.03],
  grossMargins: [0.4, 0.4, 0.4, 0.4, 0.4],
  ebitdaMargins: [0.25, 0.25, 0.25, 0.25, 0.25],
  ebitMargins: [0.15, 0.15, 0.15, 0.15, 0.15],
  taxRate: IDX_MARKET_PARAMS.corporateTaxRate,
  capexPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  useManualWacc: false,
  manualWacc: 0.12,
  riskFreeRate: IDX_MARKET_PARAMS.riskFreeRate,
  beta: 1.0,
  equityRiskPremium: IDX_MARKET_PARAMS.equityRiskPremium,
  sizePremium: 0.0,
  preTaxCostOfDebt: IDX_MARKET_PARAMS.preTaxCostOfDebt,
  targetDebtWeight: 0.3,
  perpetualGrowthRate: IDX_MARKET_PARAMS.perpetualGrowthRate,
  exitMultiple: 5.0,
  discountConvention: 'mid-year',
};

const BASE_LBO: LboAssumptions = {
  dealName: '',
  currency: IDX_MARKET_PARAMS.currency,
  targetLtmRevenue: 0,
  targetLtmEbitda: 0,
  entryEvEbitdaMultiple: 5.0,
  holdPeriodYears: 5,
  exitEvEbitdaMultiple: 5.5,
  advisoryFeePercent: 0.015,
  financingFeePercent: 0.02,
  seniorDebtMultiple: 2.5,
  seniorDebtInterest: 0.0875,
  seniorDebtAmort: 0.05,
  subDebtMultiple: 1.0,
  subDebtInterest: 0.125,
  subDebtAmort: 0.0,
  minCashBalance: 0,
  revenueGrowthRates: [0.05, 0.05, 0.04, 0.04, 0.03],
  ebitdaMargins: [0.25, 0.25, 0.25, 0.25, 0.25],
  capexPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  taxRate: IDX_MARKET_PARAMS.corporateTaxRate,
  cashSweepPercent: 1.0,
};

export const IDX_BASE_DCF = BASE_DCF;
export const IDX_BASE_LBO = BASE_LBO;

const tickerCode = (report: ParsedFinancialReport): string =>
  (report.ticker || report.companyName).replace('.JK', '').toUpperCase();

/**
 * Build a deal preset straight from an emiten's reported financials rather than
 * hand-keyed assumptions — the historical CAGR, margins, CapEx and NWC ratios
 * all come out of the statements themselves.
 */
export function buildDealPresetFromReport(
  report: ParsedFinancialReport,
  meta: { industry: string; description: string }
): DealPreset {
  const code = tickerCode(report);
  const calibrated = calibrateFinancialReport(report);
  const anchor = DEAL_ANCHORS[code] || { entry: 6.0, exit: 6.5, debtWeight: 0.3, size: 0.005 };

  const dcf: DcfAssumptions = {
    ...convertCalibratedToDcf(calibrated, BASE_DCF),
    beta: DEFAULT_BETA[code] ?? 1.0,
    sizePremium: anchor.size,
    targetDebtWeight: anchor.debtWeight,
    exitMultiple: anchor.exit,
  };

  const lbo: LboAssumptions = {
    ...convertCalibratedToLbo(calibrated, BASE_LBO),
    dealName: `Project ${code} Buyout`,
    entryEvEbitdaMultiple: anchor.entry,
    exitEvEbitdaMultiple: anchor.exit,
  };

  return {
    id: code.toLowerCase(),
    name: `${code} — ${report.companyName}`,
    industry: meta.industry,
    description: meta.description,
    dcf,
    lbo,
  };
}

const PRESET_META: Record<string, { industry: string; description: string }> = {
  TLKM: {
    industry: 'Infrastructures / Telekomunikasi',
    description:
      'BUMN telekomunikasi terbesar di Indonesia. Arus kas kuat dan stabil, CapEx berat, pertumbuhan pendapatan satu digit rendah.',
  },
  ASII: {
    industry: 'Consumer Cyclicals / Konglomerasi Otomotif',
    description:
      'Konglomerasi otomotif, alat berat, jasa keuangan, dan agribisnis. Siklikal, terdiversifikasi, historisnya diperdagangkan pada multiple rendah.',
  },
};

/**
 * Deal presets — IDX-listed emiten only.
 *
 * The generic sample deals (SaaS / industrials / healthcare) and the non-IDX
 * listing were removed. Every preset here is a real emiten with real reported
 * financials; the full 900+ emiten universe lives in the market database and is
 * reachable from the Emiten browser.
 */
export const DEAL_PRESETS: DealPreset[] = EMITEN_PRESETS.map((report) =>
  buildDealPresetFromReport(
    report,
    PRESET_META[tickerCode(report)] || {
      industry: 'IDX Listed',
      description: 'Emiten tercatat di Bursa Efek Indonesia.',
    }
  )
);
