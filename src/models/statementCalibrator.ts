import { ParsedFinancialReport, CalibratedModelParams } from '../types/statements';
import { DcfAssumptions } from '../types/dcf';
import { LboAssumptions } from '../types/lbo';

export function calibrateFinancialReport(report: ParsedFinancialReport): CalibratedModelParams {
  const data = report.historicalData;
  const n = data.length;

  if (n === 0) {
    return {
      companyName: report.companyName,
      currency: report.currency,
      units: report.units,
      revenueCagr: 0.10,
      avgGrossMargin: 0.65,
      avgEbitdaMargin: 0.25,
      avgEbitMargin: 0.18,
      avgCapexPercent: 0.04,
      avgNwcPercent: 0.08,
      avgDaPercent: 0.06,
      baseRevenue: 100,
      baseEbitda: 25,
      baseCash: 15,
      baseDebt: 40,
      forecastGrowthRates: [0.10, 0.09, 0.08, 0.07, 0.06],
      forecastGrossMargins: [0.65, 0.65, 0.65, 0.65, 0.65],
      forecastEbitdaMargins: [0.25, 0.25, 0.25, 0.25, 0.25],
      forecastEbitMargins: [0.18, 0.18, 0.18, 0.18, 0.18],
      forecastCapexPercents: [0.04, 0.04, 0.04, 0.04, 0.04],
      forecastNwcPercents: [0.08, 0.08, 0.08, 0.08, 0.08],
      forecastDaPercents: [0.06, 0.06, 0.06, 0.06, 0.06],
      sharesOutstanding: report.sharesOutstanding,
      currentSharePrice: report.currentSharePrice,
      taxRate: report.taxRate,
    };
  }

  // 1. Calculate CAGR
  const firstRev = data[0].revenue;
  const latestData = data[n - 1];
  const lastRev = latestData.revenue;
  const periods = n - 1;

  let cagr = 0.08;
  if (periods > 0 && firstRev > 0 && lastRev > 0) {
    cagr = Math.pow(lastRev / firstRev, 1 / periods) - 1;
  } else {
    const growths = data.slice(1).map(d => d.revenueGrowth || 0);
    cagr = growths.length > 0 ? growths.reduce((a, b) => a + b, 0) / growths.length : 0.08;
  }

  // Bound CAGR to a projection range that survives one freak year.
  //
  // Angkanya -5% sampai +35%, dan komentar di sini sempat menyebut -10% sampai
  // +40% — angka di komentar yang tidak sama dengan angka di kode adalah cara
  // sebuah asumsi diwarisi salah oleh orang yang membaca komentarnya dan tidak
  // membaca barisnya. Batas ini konvensi, bukan hasil optimasi: ia hanya ada
  // supaya satu tahun ganjil tidak diproyeksikan lima tahun ke depan.
  const boundedCagr = Math.min(Math.max(cagr, -0.05), 0.35);

  // 2. Calculate average margins
  const validRevs = data.filter(d => d.revenue > 0);
  const mCount = validRevs.length || 1;

  const avgGrossMargin = validRevs.reduce((acc, d) => acc + (d.grossMargin || 0.65), 0) / mCount;
  const avgEbitdaMargin = validRevs.reduce((acc, d) => acc + (d.ebitdaMargin || 0.25), 0) / mCount;
  const avgEbitMargin = validRevs.reduce((acc, d) => acc + (d.ebitMargin || 0.18), 0) / mCount;
  const avgCapexPercent = validRevs.reduce((acc, d) => acc + (d.capexPercent || 0.04), 0) / mCount;
  const avgNwcPercent = validRevs.reduce((acc, d) => acc + (d.nwcPercent || 0.08), 0) / mCount;
  const avgDaPercent = validRevs.reduce((acc, d) => acc + (d.daPercent || 0.06), 0) / mCount;

  // 3. Generate 5-year forecast trajectories (tapering growth towards mature stage)
  const forecastGrowthRates = [
    boundedCagr,
    boundedCagr * 0.90,
    boundedCagr * 0.80,
    Math.max(0.04, boundedCagr * 0.70),
    Math.max(0.03, boundedCagr * 0.60),
  ];

  const forecastGrossMargins = Array(5).fill(Math.min(Math.max(avgGrossMargin, 0.1), 0.95));
  const forecastEbitdaMargins = Array(5).fill(Math.min(Math.max(avgEbitdaMargin, 0.05), 0.8));
  const forecastEbitMargins = Array(5).fill(Math.min(Math.max(avgEbitMargin, 0.03), 0.7));
  const forecastCapexPercents = Array(5).fill(Math.min(Math.max(avgCapexPercent, 0.01), 0.25));
  const forecastNwcPercents = Array(5).fill(Math.min(Math.max(avgNwcPercent, 0.01), 0.30));
  const forecastDaPercents = Array(5).fill(Math.min(Math.max(avgDaPercent, 0.01), 0.20));

  return {
    companyName: report.companyName,
    currency: report.currency,
    units: report.units,
    revenueCagr: boundedCagr,
    avgGrossMargin,
    avgEbitdaMargin,
    avgEbitMargin,
    avgCapexPercent,
    avgNwcPercent,
    avgDaPercent,
    baseRevenue: latestData.revenue,
    baseEbitda: latestData.ebitda,
    baseCash: latestData.cash,
    baseDebt: latestData.totalDebt,
    forecastGrowthRates,
    forecastGrossMargins,
    forecastEbitdaMargins,
    forecastEbitMargins,
    forecastCapexPercents,
    forecastNwcPercents,
    forecastDaPercents,
    sharesOutstanding: report.sharesOutstanding,
    currentSharePrice: report.currentSharePrice,
    taxRate: report.taxRate || 0.22,
  };
}

export function convertCalibratedToDcf(calibrated: CalibratedModelParams, prevDcf: DcfAssumptions): DcfAssumptions {
  return {
    ...prevDcf,
    companyName: calibrated.companyName,
    currency: calibrated.currency,
    units: calibrated.units,
    currentSharePrice: calibrated.currentSharePrice,
    sharesOutstanding: calibrated.sharesOutstanding,
    balanceSheetCash: calibrated.baseCash,
    balanceSheetDebt: calibrated.baseDebt,
    baseRevenue: calibrated.baseRevenue,
    revenueGrowthRates: calibrated.forecastGrowthRates,
    grossMargins: calibrated.forecastGrossMargins,
    ebitdaMargins: calibrated.forecastEbitdaMargins,
    ebitMargins: calibrated.forecastEbitMargins,
    capexPercentOfRev: calibrated.forecastCapexPercents,
    nwcPercentOfRev: calibrated.forecastNwcPercents,
    daPercentOfRev: calibrated.forecastDaPercents,
    taxRate: calibrated.taxRate,
  };
}

export function convertCalibratedToLbo(calibrated: CalibratedModelParams, prevLbo: LboAssumptions): LboAssumptions {
  const baseEbitda = Math.max(calibrated.baseEbitda, calibrated.baseRevenue * 0.1);
  const currentLeverage = calibrated.baseEbitda > 0 ? calibrated.baseDebt / calibrated.baseEbitda : 3.0;

  return {
    ...prevLbo,
    dealName: `Project ${calibrated.companyName} Buyout`,
    currency: calibrated.currency,
    targetLtmRevenue: calibrated.baseRevenue,
    targetLtmEbitda: baseEbitda,
    seniorDebtMultiple: Math.min(Math.max(currentLeverage * 0.7, 2.0), 4.5),
    subDebtMultiple: Math.min(Math.max(currentLeverage * 0.3, 1.0), 2.5),
    minCashBalance: Math.max(calibrated.baseCash * 0.5, 5.0),
    revenueGrowthRates: calibrated.forecastGrowthRates,
    ebitdaMargins: calibrated.forecastEbitdaMargins,
    capexPercentOfRev: calibrated.forecastCapexPercents,
    nwcPercentOfRev: calibrated.forecastNwcPercents,
    daPercentOfRev: calibrated.forecastDaPercents,
    taxRate: calibrated.taxRate,
  };
}