/**
 * ingest-quotes.mjs — valuation ratios, reporting currency, and USD/IDR history.
 *
 *   node scripts/ingest-quotes.mjs [--batch 60]
 *
 * IDX's own feeds carry price and flow but no valuation multiples, so P/E, P/BV,
 * EPS and dividend yield come from Yahoo's batch quote endpoint. That endpoint
 * needs a crumb + cookie pair, which is fetched first.
 *
 * It also returns `financialCurrency`, which matters a lot on IDX: coal and oil
 * names such as ADRO, ITMG, MEDC and INDY report in USD while trading in IDR.
 * Yahoo does not reconcile the two, so its P/BV for those tickers is meaningless
 * (price in IDR over book value in USD) and is dropped here rather than shown.
 *
 * Writes public/data/idx/quotes.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { getJson, mapPool, UA } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const COOKIE_JAR = join(ROOT, '.cache', 'yahoo-cookies.txt');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BATCH = Number(argVal('--batch', 60));

const log = (...a) => console.log(`[quotes ${new Date().toISOString().slice(11, 19)}]`, ...a);

function curl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Yahoo gates its quote API behind a cookie + crumb pair. */
async function getCrumb() {
  await mkdir(dirname(COOKIE_JAR), { recursive: true });
  // fc.yahoo.com answers with an error page but sets the session cookie we need,
  // so a non-zero exit here is expected and ignored. (Note: no `-o /dev/null` —
  // Windows curl.exe cannot write to that path and fails with exit 23.)
  await curl(['-s', '-m', '25', '-A', UA, '-c', COOKIE_JAR, 'https://fc.yahoo.com']).catch(() => '');
  const crumb = (
    await curl(['-s', '-m', '25', '-A', UA, '-b', COOKIE_JAR, 'https://query1.finance.yahoo.com/v1/test/getcrumb'])
  ).trim();
  if (!crumb || crumb.length > 32 || crumb.includes('<')) throw new Error(`Could not obtain a Yahoo crumb (got "${crumb}")`);
  return crumb;
}

async function fetchBatch(symbols, crumb) {
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}` +
    `&crumb=${encodeURIComponent(crumb)}`;
  const text = await curl(['-s', '-m', '40', '-A', UA, '-b', COOKIE_JAR, url]);
  const json = JSON.parse(text);
  return json.quoteResponse?.result || [];
}

/** Calendar-year average USD/IDR, used to translate USD-reporting statements. */
async function fetchFxHistory() {
  const chart = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/IDR=X?range=10y&interval=1d');
  const result = chart.chart?.result?.[0];
  if (!result) throw new Error('No USD/IDR series returned');
  const ts = result.timestamp || [];
  const close = result.indicators?.quote?.[0]?.close || [];
  const buckets = {};
  ts.forEach((t, i) => {
    const v = close[i];
    if (!v) return;
    const y = new Date(t * 1000).getUTCFullYear();
    (buckets[y] ||= []).push(v);
  });
  const yearly = {};
  for (const [y, vals] of Object.entries(buckets)) {
    yearly[y] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return { yearly, spot: Math.round(result.meta?.regularMarketPrice || 0) };
}

const num = (v) => (Number.isFinite(v) ? v : null);

async function main() {
  const universe = JSON.parse(await readFile(join(OUT_DIR, 'universe.json'), 'utf8'));
  const codes = universe.emiten.map((e) => e.code);

  log('obtaining Yahoo crumb...');
  const crumb = await getCrumb();

  log('fetching USD/IDR history...');
  const fx = await fetchFxHistory();
  log(`  spot ${fx.spot}, ${Object.keys(fx.yearly).length} calendar years`);

  const batches = [];
  for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH));
  log(`fetching quotes for ${codes.length} emiten in ${batches.length} batches of ${BATCH}...`);

  const quotes = {};
  let usdReporters = 0;
  let done = 0;

  await mapPool(batches, 2, async (batch) => {
    let rows = [];
    for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
      try {
        rows = await fetchBatch(batch.map((c) => `${c}.JK`), crumb);
      } catch {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    for (const q of rows) {
      const code = String(q.symbol || '').replace('.JK', '');
      if (!code) continue;
      const reportsInIdr = (q.financialCurrency || 'IDR') === 'IDR';
      if (!reportsInIdr) usdReporters++;
      quotes[code] = {
        financialCurrency: q.financialCurrency || 'IDR',
        tradingCurrency: q.currency || 'IDR',
        price: num(q.regularMarketPrice),
        marketCap: num(q.marketCap),
        sharesOutstanding: num(q.sharesOutstanding),
        trailingPE: num(q.trailingPE),
        forwardPE: num(q.forwardPE),
        // Book value is quoted in the reporting currency while price is in IDR,
        // so P/BV is only trustworthy for IDR reporters.
        priceToBook: reportsInIdr ? num(q.priceToBook) : null,
        bookValuePerShare: num(q.bookValue),
        epsTrailing: num(q.epsTrailingTwelveMonths),
        epsForward: num(q.epsForward),
        dividendYield: num(q.trailingAnnualDividendYield),
        fiftyTwoWeekHigh: num(q.fiftyTwoWeekHigh),
        fiftyTwoWeekLow: num(q.fiftyTwoWeekLow),
        averageVolume3M: num(q.averageDailyVolume3Month),
      };
    }
    done += batch.length;
    if (done % 300 < BATCH) log(`  ${Math.min(done, codes.length)}/${codes.length}`);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    covered: Object.keys(quotes).length,
    attempted: codes.length,
    usdReporters,
    source: 'Yahoo Finance v7 quote + IDR=X chart',
    fxUsdIdr: fx,
    quotes,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'quotes.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote quotes.json — ${payload.covered}/${codes.length} emiten, ${usdReporters} report in a non-IDR currency (${(
      size / 1024
    ).toFixed(0)} KB)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
