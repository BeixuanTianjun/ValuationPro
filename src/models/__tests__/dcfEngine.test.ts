// Numeric checks for the DCF engine's guard rails.
// Run with: npm run test
//
// These are the cases that used to produce nonsense: a terminal growth rate at
// or above WACC, a negative terminal cash flow, and a balance sheet whose debt
// swamps enterprise value.

import { DcfAssumptions } from '../../types/dcf';
import { runDcfModel } from '../dcfEngine';

const BASE: DcfAssumptions = {
  companyName: 'Test Co',
  currency: 'Rp ',
  units: 'billions',
  currentSharePrice: 1000,
  sharesOutstanding: 10, // billions of shares, same scale as `units`
  balanceSheetCash: 5_000,
  balanceSheetDebt: 3_000,
  minorityInterest: 0,
  equityInvestments: 0,
  baseRevenue: 100_000,
  forecastYears: 5,
  revenueGrowthRates: [0.06, 0.05, 0.05, 0.04, 0.04],
  grossMargins: [0.4, 0.4, 0.4, 0.4, 0.4],
  ebitdaMargins: [0.25, 0.25, 0.25, 0.25, 0.25],
  ebitMargins: [0.17, 0.17, 0.17, 0.17, 0.17],
  taxRate: 0.22,
  capexPercentOfRev: [0.06, 0.06, 0.06, 0.06, 0.06],
  nwcPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  daPercentOfRev: [0.08, 0.08, 0.08, 0.08, 0.08],
  useManualWacc: true,
  manualWacc: 0.12,
  riskFreeRate: 0.0675,
  beta: 1,
  equityRiskPremium: 0.0755,
  sizePremium: 0,
  preTaxCostOfDebt: 0.0875,
  targetDebtWeight: 0.3,
  perpetualGrowthRate: 0.04,
  exitMultiple: 6,
  discountConvention: 'mid-year',
};

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
}

// 1. Baseline sanity — a healthy model still produces a positive price.
{
  const r = runDcfModel(BASE);
  check(
    'baseline produces a positive share price',
    r.impliedSharePriceGordon > 0 && Number.isFinite(r.impliedSharePriceGordon),
    `price=${r.impliedSharePriceGordon.toFixed(2)}`
  );
  check(
    'baseline has no error diagnostics',
    !r.diagnostics.some((d) => d.level === 'error'),
    r.diagnostics.map((d) => d.level).join(',') || 'none'
  );
}

// 2. g >= WACC used to divide by 0.001 and explode the terminal value.
{
  const r = runDcfModel({ ...BASE, perpetualGrowthRate: 0.15, manualWacc: 0.12 });
  const sane = r.impliedSharePriceGordon < 1e7;
  check('g above WACC does not explode the valuation', sane, `price=${r.impliedSharePriceGordon.toFixed(2)}`);
  check(
    'g above WACC is clamped below WACC',
    r.effectiveTerminalGrowth < 0.12,
    `g_eff=${(r.effectiveTerminalGrowth * 100).toFixed(2)}%`
  );
  check(
    'g above WACC raises an error diagnostic',
    r.diagnostics.some((d) => d.level === 'error'),
    r.diagnostics.filter((d) => d.level === 'error').length + ' errors'
  );
}

// 3. Debt far above enterprise value must not yield a negative share price.
{
  const r = runDcfModel({ ...BASE, balanceSheetDebt: 5_000_000, balanceSheetCash: 0 });
  check('massive debt floors the share price at zero', r.impliedSharePriceGordon === 0, `price=${r.impliedSharePriceGordon}`);
  check('massive debt floors equity value at zero', r.equityValueGordonGrowth === 0, `equity=${r.equityValueGordonGrowth}`);
  check('flooring is reported, not silent', r.equityFlooredGordon === true);
  check(
    'floored upside is -100%, never below',
    r.upsideGordonPercent >= -1.0000001,
    `upside=${(r.upsideGordonPercent * 100).toFixed(1)}%`
  );
}

// 4. Negative terminal cash flow must not create a negative terminal value.
{
  const r = runDcfModel({ ...BASE, capexPercentOfRev: [0.5, 0.5, 0.5, 0.5, 0.5] });
  check('negative terminal FCF gives zero terminal value', r.terminalGrowthValue === 0, `tv=${r.terminalGrowthValue}`);
  check('negative terminal FCF never yields a negative price', r.impliedSharePriceGordon >= 0);
  check(
    'negative terminal FCF is flagged',
    r.diagnostics.some((d) => d.level === 'error'),
    r.diagnostics.filter((d) => d.level === 'error').map((d) => d.message.slice(0, 40)).join(' | ')
  );
}

// 5. Zero shares outstanding must not produce Infinity or NaN.
{
  const r = runDcfModel({ ...BASE, sharesOutstanding: 0 });
  check('zero shares yields a finite price of zero', r.impliedSharePriceGordon === 0);
  check(
    'zero shares is flagged as an error',
    r.diagnostics.some((d) => d.level === 'error')
  );
}

// 6. Terminal value is discounted over the full N periods, not N-0.5.
{
  const r = runDcfModel(BASE);
  const wacc = r.wacc.wacc;
  const expectedPv = r.terminalGrowthValue / Math.pow(1 + wacc, r.cashFlows.length);
  const diff = Math.abs(expectedPv - r.pvTerminalGrowthValue);
  check(
    'terminal value discounts over the full horizon',
    diff < Math.max(1e-6, expectedPv * 1e-9),
    `pv=${r.pvTerminalGrowthValue.toFixed(2)} expected=${expectedPv.toFixed(2)}`
  );
}

// 7. Terminal-value dominance is surfaced.
{
  const r = runDcfModel({ ...BASE, perpetualGrowthRate: 0.055, manualWacc: 0.09 });
  check(
    'terminal value share is reported between 0 and 1',
    r.terminalValueShareGordon > 0 && r.terminalValueShareGordon <= 1,
    `share=${(r.terminalValueShareGordon * 100).toFixed(1)}%`
  );
}

// --- report
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
