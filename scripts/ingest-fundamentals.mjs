/**
 * ingest-fundamentals.mjs — annual financial statements for the IDX universe.
 *
 *   node scripts/ingest-fundamentals.mjs [--concurrency 3] [--codes TLKM,ASII] [--limit 200]
 *
 * Reads public/data/idx/universe.json (produced by ingest-idx.mjs) and pulls the
 * annual income statement / balance sheet / cash flow lines each emiten needs to
 * drive the DCF and LBO engines, from Yahoo's fundamentals-timeseries endpoint.
 *
 * Everything is converted to IDR billions so it lines up with how the modelling
 * suite already expects Indonesian statements to be scaled.
 *
 * Writes public/data/idx/fundamentals.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, mapPool, setRequestGap } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const CACHE_DIR = join(ROOT, '.cache', 'fundamentals');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const CONCURRENCY = Number(argVal('--concurrency', 3));
const ONLY = (argVal('--codes', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(argVal('--limit', 0));
const USE_CACHE = !argv.includes('--no-cache');
// Yahoo tolerates a faster cadence than IDX's Cloudflare edge does.
setRequestGap(Number(argVal('--gap', 120)));

const log = (...a) => console.log(`[fundamentals ${new Date().toISOString().slice(11, 19)}]`, ...a);

const FIELDS = [
  'annualTotalRevenue',
  'annualGrossProfit',
  'annualEBITDA',
  'annualOperatingIncome',
  'annualNetIncome',
  'annualReconciledDepreciation',
  'annualCapitalExpenditure',
  'annualCashAndCashEquivalents',
  'annualTotalDebt',
  'annualCurrentAssets',
  'annualCurrentLiabilities',
  'annualOrdinarySharesNumber',
  'annualTaxRateForCalcs',
  'annualStockholdersEquity',
  'annualTotalAssets',
  // Banks and other financials do not report EBITDA / operating income / a
  // current-vs-non-current split in this feed, so pre-tax income stands in as
  // the operating profit measure for them.
  'annualPretaxIncome',
  'annualInterestExpense',
];

const BN = 1e9;

async function fetchRaw(code) {
  const file = join(CACHE_DIR, `${code}.json`);
  if (USE_CACHE) {
    try {
      await stat(file);
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      /* miss */
    }
  }
  const url =
    `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${code}.JK` +
    `?symbol=${code}.JK&type=${FIELDS.join(',')}&period1=1262304000&period2=${Math.floor(Date.now() / 1000)}&merge=false`;
  const data = await getJson(url, { retries: 3, pauseMs: 700 });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** Flatten Yahoo's per-field arrays into { 'YYYY': { field: value } }. */
function pivotByYear(payload) {
  const byYear = {};
  for (const block of payload?.timeseries?.result || []) {
    const field = Object.keys(block).find((k) => k !== 'meta' && k !== 'timestamp');
    if (!field) continue;
    for (const point of block[field] || []) {
      if (!point || !point.asOfDate) continue;
      const year = String(point.asOfDate).slice(0, 4);
      const raw = point.reportedValue?.raw;
      if (raw === undefined || raw === null) continue;
      (byYear[year] ||= {})[field] = raw;
    }
  }
  return byYear;
}

const ratio = (num, den) => (den ? num / den : 0);
const round = (v, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);

function buildReport(code, name, payload) {
  const byYear = pivotByYear(payload);
  const years = Object.keys(byYear).sort();
  if (years.length < 2) return null;

  const recent = years.slice(-5);
  const rows = [];
  let sharesOutstanding = 0;
  let taxRate = 0.22;
  const coverage = { grossProfit: 0, ebitda: 0, ebit: 0, workingCapital: 0, derivedOperatingProfit: 0 };

  for (let i = 0; i < recent.length; i++) {
    const y = recent[i];
    const r = byYear[y];
    const revenue = (r.annualTotalRevenue || 0) / BN;
    if (!(revenue > 0)) continue;

    const grossProfit = (r.annualGrossProfit || 0) / BN;
    const netIncome = (r.annualNetIncome || r.annualNetIncomeContinuousOperations || 0) / BN;
    const da = Math.abs(r.annualReconciledDepreciation || 0) / BN;
    const capex = Math.abs(r.annualCapitalExpenditure || 0) / BN;
    const cash = (r.annualCashAndCashEquivalents || 0) / BN;
    const totalDebt = (r.annualTotalDebt || 0) / BN;
    const currentAssets = (r.annualCurrentAssets || 0) / BN;
    const currentLiabilities = (r.annualCurrentLiabilities || 0) / BN;
    const pretax = (r.annualPretaxIncome || 0) / BN;

    let ebit = (r.annualOperatingIncome || 0) / BN;
    let ebitda = (r.annualEBITDA || 0) / BN;
    let derived = false;
    if (!(ebit > 0) && ebitda > 0 && da > 0) ebit = ebitda - da;
    if (!(ebit > 0) && pretax > 0) {
      // Financials: interest is a cost of goods sold, so pre-tax income is the
      // closest honest analogue to operating profit.
      ebit = pretax;
      derived = true;
    }
    if (!(ebitda > 0) && ebit > 0) {
      ebitda = ebit + da;
      derived = derived || true;
    }

    // Operating net working capital, cash excluded. Only meaningful when the
    // balance sheet actually carries a current / non-current split.
    const hasWorkingCapital = currentAssets > 0 && currentLiabilities > 0;
    const nwc = hasWorkingCapital ? currentAssets - cash - currentLiabilities : 0;

    if (grossProfit > 0) coverage.grossProfit++;
    if (ebitda > 0) coverage.ebitda++;
    if (ebit > 0) coverage.ebit++;
    if (hasWorkingCapital) coverage.workingCapital++;
    if (derived) coverage.derivedOperatingProfit++;

    // Share count is kept on the same scale as the statements (IDR billions),
    // because the DCF engine divides equity value by it without rescaling.
    if (r.annualOrdinarySharesNumber) sharesOutstanding = r.annualOrdinarySharesNumber / 1e9; // billions of shares
    if (r.annualTaxRateForCalcs > 0 && r.annualTaxRateForCalcs < 0.6) taxRate = r.annualTaxRateForCalcs;

    const prev = rows.length ? rows[rows.length - 1] : null;

    rows.push({
      year: y,
      revenue: round(revenue, 2),
      revenueGrowth: prev && prev.revenue ? round(revenue / prev.revenue - 1, 4) : 0,
      grossProfit: round(grossProfit, 2),
      grossMargin: round(ratio(grossProfit, revenue), 4),
      ebitda: round(ebitda, 2),
      ebitdaMargin: round(ratio(ebitda, revenue), 4),
      ebit: round(ebit, 2),
      ebitMargin: round(ratio(ebit, revenue), 4),
      netIncome: round(netIncome, 2),
      netMargin: round(ratio(netIncome, revenue), 4),
      capex: round(capex, 2),
      capexPercent: round(ratio(capex, revenue), 4),
      da: round(da, 2),
      daPercent: round(ratio(da, revenue), 4),
      nwc: round(nwc, 2),
      nwcPercent: round(ratio(nwc, revenue), 4),
      cash: round(cash, 2),
      totalDebt: round(totalDebt, 2),
      netDebt: round(totalDebt - cash, 2),
    });
  }

  if (rows.length < 2) return null;

  const n = rows.length;
  return {
    companyName: name,
    ticker: `${code}.JK`,
    currency: 'IDR',
    units: 'billions',
    years: rows.map((r) => r.year),
    historicalData: rows,
    sharesOutstanding: round(sharesOutstanding, 4),
    currentSharePrice: 0, // filled at runtime from the latest IDX session
    taxRate: round(taxRate, 4),
    quality: {
      years: n,
      hasGrossProfit: coverage.grossProfit === n,
      hasReportedEbitda: coverage.ebitda === n,
      hasOperatingIncome: coverage.ebit === n,
      hasWorkingCapital: coverage.workingCapital === n,
      operatingProfitDerived: coverage.derivedOperatingProfit > 0,
      // An unlevered-FCF DCF needs an operating profit line and a working
      // capital split. Banks and insurers report neither, and are valued with
      // residual income / DDM instead — flag them rather than pretend.
      suitableForUfcf: coverage.ebit === n && coverage.workingCapital === n,
    },
  };
}

async function main() {
  const universe = JSON.parse(await readFile(join(OUT_DIR, 'universe.json'), 'utf8'));
  let list = universe.emiten;
  if (ONLY.length) list = list.filter((e) => ONLY.includes(e.code));
  if (LIMIT > 0) list = list.slice(0, LIMIT);

  log(`fetching annual statements for ${list.length} emiten, concurrency ${CONCURRENCY}...`);

  const companies = {};
  let ok = 0;
  let empty = 0;
  let failed = 0;
  let done = 0;

  await mapPool(list, CONCURRENCY, async (e) => {
    try {
      const payload = await fetchRaw(e.code);
      const report = buildReport(e.code, e.fullName || e.name, payload);
      if (report) {
        companies[e.code] = report;
        ok++;
      } else {
        empty++;
      }
    } catch {
      failed++;
    }
    if (++done % 50 === 0) log(`  ${done}/${list.length} (ok ${ok} / kosong ${empty} / gagal ${failed})`);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    currency: 'IDR',
    units: 'billions',
    covered: ok,
    attempted: list.length,
    source: 'Yahoo Finance fundamentals-timeseries (annual)',
    companies,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'fundamentals.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(`wrote fundamentals.json — ${ok} emiten with statements, ${empty} without, ${failed} failed (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
