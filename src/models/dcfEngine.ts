import {
  DcfAssumptions,
  DcfDiagnostic,
  DcfValuationSummary,
  UfcfYearData,
  WaccBreakdown,
} from '../types/dcf';
import { SensitivityMatrix } from '../types/common';
import { formatCurrency } from '../utils/formatters';

export function calculateWacc(assumptions: DcfAssumptions): WaccBreakdown {
  const costOfEquity = assumptions.riskFreeRate + (assumptions.beta * assumptions.equityRiskPremium) + assumptions.sizePremium;
  const afterTaxCostOfDebt = assumptions.preTaxCostOfDebt * (1 - assumptions.taxRate);
  const debtWeight = Math.min(Math.max(assumptions.targetDebtWeight, 0), 0.99);
  const equityWeight = 1 - debtWeight;

  const calculatedWacc = (equityWeight * costOfEquity) + (debtWeight * afterTaxCostOfDebt);
  const finalWacc = assumptions.useManualWacc ? assumptions.manualWacc : calculatedWacc;

  // A risky equity cannot be discounted below the sovereign yield: that would
  // say the business is safer than the government that taxes it. A low measured
  // beta plus a heavy debt weight can produce exactly that, so the floor is
  // enforced here rather than left to produce a silently inflated valuation.
  const floor = assumptions.riskFreeRate + 0.01;

  return {
    costOfEquity,
    afterTaxCostOfDebt,
    equityWeight,
    debtWeight,
    wacc: Math.max(finalWacc, floor, 0.001),
    waccFloored: !assumptions.useManualWacc && calculatedWacc < floor,
  };
}

export function runDcfModel(assumptions: DcfAssumptions): DcfValuationSummary {
  const waccResult = calculateWacc(assumptions);
  const wacc = waccResult.wacc;
  const numYears = Math.min(assumptions.forecastYears || 5, assumptions.revenueGrowthRates.length);

  let prevRevenue = assumptions.baseRevenue;
  let prevNwc = assumptions.baseRevenue * (assumptions.nwcPercentOfRev[0] || 0.08);
  const cashFlows: UfcfYearData[] = [];
  let pvDiscreteCashFlows = 0;

  for (let i = 0; i < numYears; i++) {
    const year = i + 1;
    const growth = assumptions.revenueGrowthRates[i] ?? 0.05;
    const rev = prevRevenue * (1 + growth);
    const grossMargin = assumptions.grossMargins[i] ?? 0.65;
    const grossProfit = rev * grossMargin;

    const ebitdaMargin = assumptions.ebitdaMargins[i] ?? 0.25;
    const ebitda = rev * ebitdaMargin;

    const daMargin = assumptions.daPercentOfRev[i] ?? 0.05;
    const da = rev * daMargin;

    const ebitMargin = assumptions.ebitMargins[i] ?? (ebitdaMargin - daMargin);
    const ebit = rev * ebitMargin;

    const taxesOnEbit = Math.max(0, ebit * assumptions.taxRate);
    const nopat = ebit - taxesOnEbit;

    const capexMargin = assumptions.capexPercentOfRev[i] ?? 0.04;
    const capex = rev * capexMargin;

    const nwcMargin = assumptions.nwcPercentOfRev[i] ?? 0.08;
    const currentNwc = rev * nwcMargin;
    const deltaNwc = currentNwc - prevNwc;

    const ufcf = nopat + da - capex - deltaNwc;

    const discountPeriod = assumptions.discountConvention === 'mid-year' ? year - 0.5 : year;
    const discountFactor = 1 / Math.pow(1 + wacc, discountPeriod);
    const presentValueUfcf = ufcf * discountFactor;

    pvDiscreteCashFlows += presentValueUfcf;

    cashFlows.push({
      year,
      yearLabel: `Year ${year}`,
      revenue: rev,
      revenueGrowth: growth,
      grossProfit,
      ebitda,
      ebit,
      taxesOnEbit,
      nopat,
      da,
      capex,
      nwc: currentNwc,
      deltaNwc,
      ufcf,
      discountPeriod,
      discountFactor,
      presentValueUfcf,
    });

    prevRevenue = rev;
    prevNwc = currentNwc;
  }

  const diagnostics: DcfDiagnostic[] = [];
  const lastYear = cashFlows[cashFlows.length - 1];

  // The terminal value is a value AS OF the end of year N regardless of which
  // convention the discrete flows use, so it is discounted over the full N
  // periods. Applying the mid-year haircut to it as well would credit the model
  // with half a year of discounting it never earned, lifting every valuation by
  // roughly 4-6%.
  const terminalDiscountFactor = 1 / Math.pow(1 + wacc, numYears);

  // --- Gordon Growth
  const requestedG = assumptions.perpetualGrowthRate;
  // A growing perpetuity only converges while g < WACC. The previous code
  // divided by a hardcoded 0.001 when that failed, silently producing a
  // terminal value ~1000x the cash flow. Clamp instead, and say so out loud.
  const MIN_SPREAD = 0.005;
  let g = requestedG;
  if (requestedG >= wacc - MIN_SPREAD) {
    g = wacc - MIN_SPREAD;
    diagnostics.push({
      level: 'error',
      message: `Pertumbuhan terminal ${fmtPct(requestedG)} tidak boleh menyamai atau melampaui WACC ${fmtPct(
        wacc
      )} — perpetuitasnya tidak konvergen. Nilai dibatasi ke ${fmtPct(g)}; turunkan g atau naikkan WACC agar hasilnya bermakna.`,
    });
  }

  const baseUfcf = lastYear ? lastYear.ufcf : 0;
  const terminalYearUfcf = baseUfcf * (1 + g);

  let terminalGrowthValue = 0;
  if (baseUfcf > 0 && wacc > g) {
    terminalGrowthValue = terminalYearUfcf / (wacc - g);
  } else if (baseUfcf <= 0) {
    // A perpetuity on a negative cash flow yields a negative terminal value,
    // which is not a meaningful business value. Report zero and flag it.
    diagnostics.push({
      level: 'error',
      message:
        'Arus kas bebas tahun terminal negatif, sehingga Gordon Growth tidak dapat dipakai. Perpanjang horizon proyeksi hingga arus kas positif, atau gunakan metode Exit Multiple.',
    });
  }

  const pvTerminalGrowthValue = terminalGrowthValue * terminalDiscountFactor;
  const evGordonGrowth = pvDiscreteCashFlows + pvTerminalGrowthValue;

  const netDebtAdjustment =
    assumptions.balanceSheetCash -
    assumptions.balanceSheetDebt -
    assumptions.minorityInterest +
    assumptions.equityInvestments;

  const gordon = deriveEquity(evGordonGrowth, netDebtAdjustment, assumptions);
  const terminalValueShareGordon = evGordonGrowth > 0 ? pvTerminalGrowthValue / evGordonGrowth : 0;

  // --- Exit Multiple
  const terminalEbitda = lastYear ? lastYear.ebitda : 0;
  const terminalMultipleValue = Math.max(0, terminalEbitda * assumptions.exitMultiple);
  const pvTerminalMultipleValue = terminalMultipleValue * terminalDiscountFactor;
  const evExitMultiple = pvDiscreteCashFlows + pvTerminalMultipleValue;
  const exit = deriveEquity(evExitMultiple, netDebtAdjustment, assumptions);
  const terminalValueShareMultiple = evExitMultiple > 0 ? pvTerminalMultipleValue / evExitMultiple : 0;

  collectDiagnostics(diagnostics, {
    assumptions,
    cashFlows,
    waccFloored: !!waccResult.waccFloored,
    terminalValueShareGordon,
    terminalValueShareMultiple,
    gordonFloored: gordon.floored,
    exitFloored: exit.floored,
    terminalEbitda,
  });

  return {
    wacc: waccResult,
    cashFlows,
    pvDiscreteCashFlows,
    diagnostics,
    effectiveTerminalGrowth: g,
    terminalValueShareGordon,
    terminalValueShareMultiple,
    equityFlooredGordon: gordon.floored,
    equityFlooredMultiple: exit.floored,
    terminalYearUfcf,
    terminalGrowthValue,
    pvTerminalGrowthValue,
    evGordonGrowth,
    equityValueGordonGrowth: gordon.equityValue,
    impliedSharePriceGordon: gordon.sharePrice,
    upsideGordonPercent: gordon.upside,
    terminalEbitda,
    terminalMultipleValue,
    pvTerminalMultipleValue,
    evExitMultiple,
    equityValueExitMultiple: exit.equityValue,
    impliedSharePriceMultiple: exit.sharePrice,
    upsideMultiplePercent: exit.upside,
  };
}

const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

interface EquityBridge {
  equityValue: number;
  sharePrice: number;
  upside: number;
  /** Set when claims on the business exceeded enterprise value. */
  floored: boolean;
}

/**
 * Enterprise value -> equity value -> per-share value.
 *
 * Equity is a residual claim with limited liability: a shareholder can lose
 * their stake but cannot owe more than it, so neither equity value nor the
 * implied share price is allowed below zero. When net debt and other claims
 * exceed enterprise value the correct reading is "the equity is worth nothing
 * on these assumptions", not a negative price — and the caller is told the
 * floor was applied so it can be shown rather than passed off as a real number.
 */
function deriveEquity(
  enterpriseValue: number,
  netDebtAdjustment: number,
  assumptions: DcfAssumptions
): EquityBridge {
  const raw = enterpriseValue + netDebtAdjustment;
  const floored = raw < 0;
  const equityValue = Math.max(0, raw);

  const shares = assumptions.sharesOutstanding;
  const sharePrice = shares > 0 && Number.isFinite(equityValue / shares) ? Math.max(0, equityValue / shares) : 0;

  const price = assumptions.currentSharePrice;
  const upside = price > 0 ? (sharePrice - price) / price : 0;

  return { equityValue, sharePrice, upside, floored };
}

interface DiagnosticContext {
  assumptions: DcfAssumptions;
  cashFlows: UfcfYearData[];
  waccFloored: boolean;
  terminalValueShareGordon: number;
  terminalValueShareMultiple: number;
  gordonFloored: boolean;
  exitFloored: boolean;
  terminalEbitda: number;
}

/** Sanity checks a reviewer would run before trusting the output. */
function collectDiagnostics(out: DcfDiagnostic[], ctx: DiagnosticContext): void {
  const { assumptions, cashFlows } = ctx;

  if (ctx.gordonFloored || ctx.exitFloored) {
    out.push({
      level: 'warning',
      message:
        'Utang bersih dan klaim lain melampaui nilai perusahaan, sehingga nilai ekuitas dibatasi di nol. Pada asumsi ini ekuitas tidak bernilai — bukan bernilai negatif.',
    });
  }

  if (assumptions.sharesOutstanding <= 0) {
    out.push({
      level: 'error',
      message: 'Jumlah saham beredar nol — harga per saham tidak dapat dihitung.',
    });
  }

  if (assumptions.baseRevenue <= 0) {
    out.push({ level: 'error', message: 'Pendapatan dasar nol atau negatif — seluruh proyeksi tidak bermakna.' });
  }

  const negativeYears = cashFlows.filter((c) => c.ufcf < 0).length;
  if (negativeYears > 0 && negativeYears < cashFlows.length) {
    out.push({
      level: 'info',
      message: `${negativeYears} dari ${cashFlows.length} tahun proyeksi memiliki arus kas bebas negatif.`,
    });
  } else if (negativeYears === cashFlows.length && cashFlows.length > 0) {
    out.push({
      level: 'error',
      message: 'Seluruh tahun proyeksi memiliki arus kas bebas negatif — model tidak menghasilkan nilai fundamental.',
    });
  }

  const share = Math.max(ctx.terminalValueShareGordon, ctx.terminalValueShareMultiple);
  if (share > 0.85) {
    out.push({
      level: 'warning',
      message: `${(share * 100).toFixed(0)}% nilai perusahaan berasal dari terminal value. Valuasinya hampir seluruhnya bergantung pada asumsi setelah tahun ke-${cashFlows.length}, bukan pada proyeksi arus kas itu sendiri.`,
    });
  }

  // Long-run growth above nominal GDP implies the company eventually becomes
  // the whole economy. ~6% is a generous ceiling for nominal Indonesian GDP.
  if (assumptions.perpetualGrowthRate > 0.06) {
    out.push({
      level: 'warning',
      message: `Pertumbuhan terminal ${fmtPct(
        assumptions.perpetualGrowthRate
      )} melampaui pertumbuhan PDB nominal Indonesia jangka panjang — secara implisit emiten ini akan menjadi seluruh perekonomian.`,
    });
  }

  if (ctx.terminalEbitda <= 0) {
    out.push({
      level: 'warning',
      message: 'EBITDA tahun terminal nol atau negatif — metode Exit Multiple tidak menghasilkan nilai.',
    });
  }

  if (ctx.waccFloored) {
    out.push({
      level: 'warning',
      message:
        'CAPM menghasilkan WACC di bawah imbal hasil obligasi negara — biasanya karena beta hasil regresi terlalu rendah. WACC dinaikkan ke lantai suku bunga bebas risiko + 1%; periksa beta dan bobot utangnya sebelum memakai valuasi ini.',
    });
  }

  if (assumptions.taxRate < 0 || assumptions.taxRate >= 1) {
    out.push({ level: 'error', message: 'Tarif pajak harus berada antara 0% dan 100%.' });
  }
}

export function generateDcfSensitivityWaccVsGrowth(assumptions: DcfAssumptions): SensitivityMatrix {
  const baseWacc = calculateWacc(assumptions).wacc;
  const baseGrowth = assumptions.perpetualGrowthRate;

  const rowOffsets = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015];
  const colOffsets = [-0.01, -0.005, 0, 0.005, 0.01];

  const rowValues = rowOffsets.map(o => Math.max(0.01, baseWacc + o));
  const colValues = colOffsets.map(o => Math.max(0.0, baseGrowth + o));

  const matrix = rowValues.map((w, rIdx) => {
    return colValues.map((g, cIdx) => {
      const clonedAssumptions: DcfAssumptions = {
        ...assumptions,
        useManualWacc: true,
        manualWacc: w,
        perpetualGrowthRate: g,
      };
      const res = runDcfModel(clonedAssumptions);
      const isBase = rowOffsets[rIdx] === 0 && colOffsets[cIdx] === 0;
      return {
        rowValue: w,
        colValue: g,
        resultValue: res.impliedSharePriceGordon,
        formattedResult: formatCurrency(res.impliedSharePriceGordon, assumptions.currency, 2),
        isBaseCase: isBase,
      };
    });
  });

  return {
    rowHeader: 'Discount Rate (WACC)',
    colHeader: 'Perpetual Growth Rate (g)',
    rowValues,
    colValues,
    matrix,
    metricName: 'Implied Share Price (Gordon Growth)',
  };
}

export function generateDcfSensitivityWaccVsMultiple(assumptions: DcfAssumptions): SensitivityMatrix {
  const baseWacc = calculateWacc(assumptions).wacc;
  const baseMultiple = assumptions.exitMultiple;

  const rowOffsets = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015];
  const colOffsets = [-3.0, -2.0, -1.0, 0, 1.0, 2.0, 3.0];

  const rowValues = rowOffsets.map(o => Math.max(0.01, baseWacc + o));
  const colValues = colOffsets.map(o => Math.max(1.0, baseMultiple + o));

  const matrix = rowValues.map((w, rIdx) => {
    return colValues.map((m, cIdx) => {
      const clonedAssumptions: DcfAssumptions = {
        ...assumptions,
        useManualWacc: true,
        manualWacc: w,
        exitMultiple: m,
      };
      const res = runDcfModel(clonedAssumptions);
      const isBase = rowOffsets[rIdx] === 0 && colOffsets[cIdx] === 0;
      return {
        rowValue: w,
        colValue: m,
        resultValue: res.impliedSharePriceMultiple,
        formattedResult: formatCurrency(res.impliedSharePriceMultiple, assumptions.currency, 2),
        isBaseCase: isBase,
      };
    });
  });

  return {
    rowHeader: 'Discount Rate (WACC)',
    colHeader: 'Exit EV/EBITDA Multiple',
    rowValues,
    colValues,
    matrix,
    metricName: 'Implied Share Price (Exit Multiple)',
  };
}
