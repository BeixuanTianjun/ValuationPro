// Automated financial modelling — run the DCF across the whole market.
//
// The single-emiten bridge already builds a calibrated model from real
// statements. This runs that same path over every emiten that has usable
// financials and ranks the results by implied upside, so a valuation screen
// covers the market instead of one name at a time.
//
// It is deliberately conservative about what it will report:
//   - banks and insurers are excluded, because an unlevered FCF model does not
//     describe them (they need residual income or a dividend discount);
//   - any model whose DCF engine raised an error diagnostic is marked unusable
//     rather than being ranked on a number the engine itself distrusts;
//   - upside beyond a sane band is flagged, because on IDX an "800% upside"
//     almost always means a broken input, not an opportunity.

import { DcfValuationSummary } from '../types/dcf';
import { Emiten, FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { FundamentalsDatabase } from '../data/fundamentalsRepository';
import { runDcfModel } from './dcfEngine';
import { buildEmitenModel } from './idxCompanyBridge';

export interface AutoValuation {
  emiten: Emiten;
  price: number;
  targetGordon: number;
  targetExitMultiple: number;
  /** Average of the two methods, which is what the ranking uses. */
  targetBlended: number;
  upside: number;
  wacc: number;
  beta: number;
  terminalGrowth: number;
  terminalValueShare: number;
  marketCapIdrBn: number;
  liquidityIdrBn: number;
  revenueCagr: number;
  ebitdaMargin: number;
  /** True when the engine raised no errors and the output is in a sane band. */
  usable: boolean;
  errors: number;
  warnings: number;
  flags: string[];
}

export interface AutoValuationRun {
  session: string;
  attempted: number;
  modelled: number;
  usable: number;
  excludedFinancials: number;
  excludedNoStatements: number;
  results: AutoValuation[];
  /** Median upside across usable models — a market-level valuation read. */
  medianUpside: number;
}

export interface AutoValuationFilters {
  minMarketCapIdrBn: number;
  minLiquidityIdrBn: number;
  /** Reject models implying more than this much upside as almost certainly broken. */
  maxPlausibleUpside: number;
  sectors: string[];
  onlyUsable: boolean;
  limit: number;
}

export const DEFAULT_AUTO_FILTERS: AutoValuationFilters = {
  minMarketCapIdrBn: 1000,
  minLiquidityIdrBn: 2,
  maxPlausibleUpside: 4, // +400%
  sectors: [],
  onlyUsable: true,
  limit: 40,
};

function summarise(
  emiten: Emiten,
  summary: DcfValuationSummary,
  factors: FactorSnapshot | undefined,
  beta: number,
  price: number,
  revenueCagr: number,
  ebitdaMargin: number,
  maxPlausibleUpside: number
): AutoValuation {
  const errors = summary.diagnostics.filter((d) => d.level === 'error').length;
  const warnings = summary.diagnostics.filter((d) => d.level === 'warning').length;

  const gordon = summary.impliedSharePriceGordon;
  const exit = summary.impliedSharePriceMultiple;

  // Blend only the methods that produced a value: if the terminal cash flow was
  // negative, Gordon returns zero and averaging it in would halve the answer
  // for no reason.
  const parts = [gordon, exit].filter((v) => v > 0);
  const blended = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  const upside = price > 0 ? blended / price - 1 : 0;

  const flags: string[] = [];
  if (errors) flags.push(`${errors} kesalahan model`);
  if (summary.equityFlooredGordon || summary.equityFlooredMultiple) flags.push('Ekuitas dibatasi nol oleh utang bersih');
  if (upside > maxPlausibleUpside) flags.push(`Upside ${(upside * 100).toFixed(0)}% tidak masuk akal — periksa asumsinya`);
  if (summary.terminalValueShareGordon > 0.9) flags.push('Lebih dari 90% nilai berasal dari terminal value');
  if (!(blended > 0)) flags.push('Model tidak menghasilkan nilai positif');

  const usable = errors === 0 && blended > 0 && upside <= maxPlausibleUpside && summary.terminalValueShareGordon <= 0.95;

  return {
    emiten,
    price,
    targetGordon: gordon,
    targetExitMultiple: exit,
    targetBlended: blended,
    upside,
    wacc: summary.wacc.wacc,
    beta,
    terminalGrowth: summary.effectiveTerminalGrowth,
    terminalValueShare: summary.terminalValueShareGordon,
    marketCapIdrBn: factors?.marketCapIdrBn ?? NaN,
    liquidityIdrBn: factors?.medianValue20IdrBn ?? NaN,
    revenueCagr,
    ebitdaMargin,
    usable,
    errors,
    warnings,
    flags,
  };
}

export function runAutoValuation(
  db: MarketDatabase,
  fundamentals: FundamentalsDatabase,
  factors: Map<string, FactorSnapshot>,
  filters: Partial<AutoValuationFilters> = {}
): AutoValuationRun {
  const f: AutoValuationFilters = { ...DEFAULT_AUTO_FILTERS, ...filters };

  let attempted = 0;
  let excludedFinancials = 0;
  let excludedNoStatements = 0;
  const results: AutoValuation[] = [];

  for (const emiten of db.emiten) {
    if (f.sectors.length && !f.sectors.includes(emiten.sector)) continue;

    const snapshot = factors.get(emiten.code);
    const cap = snapshot?.marketCapIdrBn ?? 0;
    const liq = snapshot?.medianValue20IdrBn ?? 0;
    if (!(cap >= f.minMarketCapIdrBn) || !(liq >= f.minLiquidityIdrBn)) continue;

    attempted++;

    const statements = fundamentals.fundamentals?.companies?.[emiten.code];
    if (!statements) {
      excludedNoStatements++;
      continue;
    }
    if (!statements.quality.suitableForUfcf) {
      excludedFinancials++;
      continue;
    }

    const bundle = buildEmitenModel(emiten, db, fundamentals);
    if (!bundle) {
      excludedNoStatements++;
      continue;
    }

    const summary = runDcfModel(bundle.dcf);
    const latest = bundle.report.historicalData[bundle.report.historicalData.length - 1];

    results.push(
      summarise(
        emiten,
        summary,
        snapshot,
        bundle.beta,
        bundle.dcf.currentSharePrice,
        bundle.calibrated.revenueCagr,
        latest?.ebitdaMargin ?? NaN,
        f.maxPlausibleUpside
      )
    );
  }

  const usable = results.filter((r) => r.usable);
  const upsides = usable.map((r) => r.upside).sort((a, b) => a - b);
  const medianUpside = upsides.length
    ? upsides.length % 2
      ? upsides[(upsides.length - 1) / 2]
      : (upsides[upsides.length / 2 - 1] + upsides[upsides.length / 2]) / 2
    : NaN;

  const shown = (f.onlyUsable ? usable : results).sort((a, b) => b.upside - a.upside).slice(0, f.limit);

  return {
    session: db.meta.latestSession,
    attempted,
    modelled: results.length,
    usable: usable.length,
    excludedFinancials,
    excludedNoStatements,
    results: shown,
    medianUpside,
  };
}
