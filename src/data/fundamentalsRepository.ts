// Annual statements and valuation ratios for the IDX universe, produced by
// scripts/ingest-fundamentals.mjs and scripts/ingest-quotes.mjs.

import { HistoricalYearData, ParsedFinancialReport } from '../types/statements';

export interface StatementQuality {
  years: number;
  hasGrossProfit: boolean;
  hasReportedEbitda: boolean;
  hasOperatingIncome: boolean;
  hasWorkingCapital: boolean;
  operatingProfitDerived: boolean;
  /** False for banks and insurers — they need residual income / DDM, not UFCF. */
  suitableForUfcf: boolean;
}

export interface EmitenStatements extends ParsedFinancialReport {
  quality: StatementQuality;
}

export interface FundamentalsFile {
  generatedAt: string;
  currency: string;
  units: string;
  covered: number;
  attempted: number;
  source: string;
  companies: Record<string, EmitenStatements>;
}

export interface EmitenQuote {
  financialCurrency: string;
  tradingCurrency: string;
  price: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  bookValuePerShare: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  averageVolume3M: number | null;
}

export interface QuotesFile {
  generatedAt: string;
  covered: number;
  attempted: number;
  usdReporters: number;
  source: string;
  fxUsdIdr: { yearly: Record<string, number>; spot: number };
  quotes: Record<string, EmitenQuote>;
}

export interface FundamentalsDatabase {
  fundamentals: FundamentalsFile | null;
  quotes: QuotesFile | null;
}

// `import.meta.env` only exists under Vite. This module is also pulled into the
// Node server bundle, where touching it unguarded throws at import time.
const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
const DATA_BASE = `${BASE_URL}data/idx`.replace(/\/{2,}/g, '/');

async function tryJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

let cache: Promise<FundamentalsDatabase> | null = null;

/** Both files are optional — the market screener works without them. */
export function loadFundamentalsDatabase(): Promise<FundamentalsDatabase> {
  if (!cache) {
    cache = Promise.all([
      tryJson<FundamentalsFile>('fundamentals.json'),
      tryJson<QuotesFile>('quotes.json'),
    ]).then(([fundamentals, quotes]) => ({ fundamentals, quotes }));
  }
  return cache;
}

export function invalidateFundamentalsDatabase(): void {
  cache = null;
}

const scaleRow = (row: HistoricalYearData, fx: number): HistoricalYearData => ({
  ...row,
  revenue: row.revenue * fx,
  grossProfit: row.grossProfit * fx,
  ebitda: row.ebitda * fx,
  ebit: row.ebit * fx,
  netIncome: row.netIncome * fx,
  capex: row.capex * fx,
  da: row.da * fx,
  nwc: row.nwc * fx,
  cash: row.cash * fx,
  totalDebt: row.totalDebt * fx,
  netDebt: (row.netDebt ?? row.totalDebt - row.cash) * fx,
});

export interface ResolvedStatements {
  report: EmitenStatements;
  quality: StatementQuality;
  /** Set when the emiten reports in a currency other than IDR. */
  translatedFrom?: { currency: string; ratesUsed: Record<string, number> };
  /**
   * Set when the emiten reports in a foreign currency and the translation could
   * NOT be done — no fx table, or no rate for a given year.
   *
   * Callers must surface this. The numbers in `report` are then raw foreign
   * currency while `report.currency` still says rupiah.
   */
  untranslated?: { currency: string; reason: string; years: string[] };
}

/**
 * Statements for one emiten, translated into IDR billions and stamped with the
 * live IDX close.
 *
 * Coal and oil names such as ADRO, ITMG, MEDC and INDY report in USD while
 * trading in IDR. Their statements are translated at the calendar-year average
 * USD/IDR rate for each reporting year, so a per-share value derived from them
 * is comparable to the rupiah price on screen.
 */
export function resolveStatements(
  code: string,
  db: FundamentalsDatabase,
  livePriceIdr: number,
  liveSharesOutstandingMn?: number
): ResolvedStatements | null {
  const base = db.fundamentals?.companies?.[code];
  if (!base) return null;

  const quote = db.quotes?.quotes?.[code];
  const reportingCurrency = quote?.financialCurrency || 'IDR';
  const fxTable = db.quotes?.fxUsdIdr;

  let historicalData = base.historicalData;
  let translatedFrom: ResolvedStatements['translatedFrom'];
  let untranslated: ResolvedStatements['untranslated'];

  // THE FAILURE THIS GUARDS IS SILENT AND ENORMOUS. `report.currency` is stamped
  // 'Rp ' unconditionally a few lines below. If the fx table is missing — the
  // quotes ingest never ran, or `fxUsdIdr` gets renamed on the other side of a
  // contract nothing type-checks, since scripts/ and src/ never import each
  // other — the old code skipped this block entirely and handed back raw dollars
  // labelled as rupiah. One hundred emiten report in USD; at ~16,000 IDR/USD
  // every one of them would read plausible and be wrong by four orders of
  // magnitude, with `translatedFrom` unset so the UI printed no caveat either.
  // Failing loudly is not an option here (the app must still show the emiten),
  // so it fails VISIBLY: the numbers still come through, flagged.
  if (reportingCurrency !== 'IDR') {
    if (!fxTable) {
      untranslated = {
        currency: reportingCurrency,
        reason: 'Tabel kurs USD/IDR tidak ada di quotes.json — jalankan npm run data:quotes.',
        years: base.historicalData.map((r) => r.year),
      };
    } else {
      const ratesUsed: Record<string, number> = {};
      const missing: string[] = [];
      historicalData = base.historicalData.map((row) => {
        const rate = fxTable.yearly[row.year] || fxTable.spot || 0;
        if (rate > 0) {
          ratesUsed[row.year] = rate;
          return scaleRow(row, rate);
        }
        missing.push(row.year);
        return row;
      });
      if (Object.keys(ratesUsed).length) translatedFrom = { currency: reportingCurrency, ratesUsed };
      if (missing.length) {
        untranslated = {
          currency: reportingCurrency,
          reason: 'Tidak ada kurs untuk tahun tersebut, angkanya masih dalam mata uang asli.',
          years: missing,
        };
      }
    }
  }

  const report: EmitenStatements = {
    ...base,
    currency: 'Rp ',
    units: 'billions',
    historicalData,
    currentSharePrice: livePriceIdr || base.currentSharePrice,
    sharesOutstanding: liveSharesOutstandingMn || base.sharesOutstanding,
  };

  return { report, quality: base.quality, translatedFrom, untranslated };
}
