/**
 * ingest-intraday.mjs — live prices for the whole IDX universe during the session.
 *
 *   node scripts/ingest-intraday.mjs [--batch 60]
 *
 * WHY THIS EXISTS: IDX's own TradingSummary feed is end-of-day and lags one to
 * two calendar days — during a Wednesday session the latest published session is
 * often still Monday. It can therefore never drive a "refresh after Sesi I"
 * workflow. Yahoo does quote IDX tickers live (marketState REGULAR, ~10 minute
 * delay), so the intraday tier is sourced there.
 *
 * WHAT IT CANNOT DO: foreign buy/sell volume is published only by IDX, and only
 * end-of-day. Intraday refreshes carry fresh price, volume and momentum but
 * foreign-flow factors stay as of the last IDX session. The app labels this.
 *
 * Writes public/data/idx/intraday.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { UA, mapPool } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const COOKIE_JAR = join(ROOT, '.cache', 'yahoo-cookies.txt');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BATCH = Number(argVal('--batch', 60));
const QUIET = argv.includes('--quiet');

const log = (...a) => {
  if (!QUIET) console.log(`[intraday ${new Date().toISOString().slice(11, 19)}]`, ...a);
};

function curl(args) {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function getCrumb() {
  await mkdir(dirname(COOKIE_JAR), { recursive: true });
  // fc.yahoo.com answers with an error page but sets the session cookie we need.
  // No `-o /dev/null` — Windows curl.exe cannot write there and exits 23.
  await curl(['-s', '-m', '25', '-A', UA, '-c', COOKIE_JAR, 'https://fc.yahoo.com']).catch(() => '');
  const crumb = (
    await curl(['-s', '-m', '25', '-A', UA, '-b', COOKIE_JAR, 'https://query1.finance.yahoo.com/v1/test/getcrumb'])
  ).trim();
  if (!crumb || crumb.length > 32 || crumb.includes('<')) throw new Error(`Could not obtain a Yahoo crumb (got "${crumb}")`);
  return crumb;
}

async function fetchBatch(symbols, crumb) {
  const url =
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&crumb=${encodeURIComponent(crumb)}`;
  const text = await curl(['-s', '-m', '40', '-A', UA, '-b', COOKIE_JAR, url]);
  return JSON.parse(text).quoteResponse?.result || [];
}

const num = (v) => (Number.isFinite(v) ? v : null);

// Yahoo carries live quotes for only two IDX indices. Their previous closes
// match IDX's published closes exactly, which is what makes the overlay safe.
// The eleven IDX-IC sector indices are not quoted anywhere live; they stay at
// their last official close, and a two-day lag on a three-month sector return
// does not move the screener.
const LIVE_INDEX_SYMBOLS = { '^JKSE': 'COMPOSITE', '^JKLQ45': 'LQ45' };

/** Jakarta wall-clock parts for a given instant. */
export function wibParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday, // Mon..Sun
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * IDX trading calendar, current regime:
 *   Mon-Thu  Sesi I 09:00-12:00, Sesi II 13:30-15:49 (closing auction to 16:15)
 *   Fri      Sesi I 09:00-11:30, Sesi II 14:00-15:49
 * Public holidays are not modelled — on a holiday Yahoo simply reports the
 * previous close and marketState CLOSED, which the app shows as stale.
 */
export function sessionPhase(now = new Date()) {
  const { weekday, minutesOfDay, date } = wibParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return { phase: 'weekend', date };

  const isFriday = weekday === 'Fri';
  const sesi1End = isFriday ? 11 * 60 + 30 : 12 * 60;
  const sesi2Start = isFriday ? 14 * 60 : 13 * 60 + 30;
  const sesi2End = 16 * 60 + 15;

  if (minutesOfDay < 9 * 60) return { phase: 'pre-open', date };
  if (minutesOfDay < sesi1End) return { phase: 'sesi-1', date };
  if (minutesOfDay < sesi2Start) return { phase: 'break', date };
  if (minutesOfDay < sesi2End) return { phase: 'sesi-2', date };
  return { phase: 'closed', date };
}

export async function buildIntradaySnapshot() {
  const universe = JSON.parse(await readFile(join(OUT_DIR, 'universe.json'), 'utf8'));
  const codes = universe.emiten.map((e) => e.code);

  const crumb = await getCrumb();
  const batches = [];
  for (let i = 0; i < codes.length; i += BATCH) batches.push(codes.slice(i, i + BATCH));

  const quotes = {};
  let marketState = 'UNKNOWN';
  let newestTime = 0;

  await mapPool(batches, 2, async (batch) => {
    let rows = [];
    for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
      try {
        rows = await fetchBatch(batch.map((c) => `${c}.JK`), crumb);
      } catch {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    for (const q of rows) {
      const code = String(q.symbol || '').replace('.JK', '');
      if (!code || !Number.isFinite(q.regularMarketPrice)) continue;
      if (q.marketState) marketState = q.marketState;
      if (q.regularMarketTime > newestTime) newestTime = q.regularMarketTime;
      quotes[code] = {
        price: num(q.regularMarketPrice),
        prevClose: num(q.regularMarketPreviousClose),
        open: num(q.regularMarketOpen),
        high: num(q.regularMarketDayHigh),
        low: num(q.regularMarketDayLow),
        volume: num(q.regularMarketVolume),
        changePercent: num(q.regularMarketChangePercent),
        time: num(q.regularMarketTime),
      };
    }
  });

  const indices = {};
  try {
    const rows = await fetchBatch(Object.keys(LIVE_INDEX_SYMBOLS), crumb);
    for (const q of rows) {
      const code = LIVE_INDEX_SYMBOLS[q.symbol];
      if (!code || !Number.isFinite(q.regularMarketPrice)) continue;
      indices[code] = {
        close: num(q.regularMarketPrice),
        prevClose: num(q.regularMarketPreviousClose),
        changePercent: num(q.regularMarketChangePercent),
      };
    }
  } catch {
    /* index overlay is optional — stock quotes still stand on their own */
  }

  const phase = sessionPhase();
  const tradingDate = newestTime ? wibParts(new Date(newestTime * 1000)).date : phase.date;

  return {
    generatedAt: new Date().toISOString(),
    tradingDate,
    marketState,
    sessionPhase: phase.phase,
    covered: Object.keys(quotes).length,
    attempted: codes.length,
    source: 'Yahoo Finance v7 quote (live, ~10 min delayed)',
    // Stated plainly so the UI never implies foreign flow is live.
    foreignFlowAsOf: 'IDX end-of-day only — not available intraday',
    quotes,
    indices,
  };
}

async function main() {
  log('fetching live quotes for the IDX universe...');
  const payload = await buildIntradaySnapshot();
  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'intraday.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote intraday.json — ${payload.covered}/${payload.attempted} emiten, ${payload.tradingDate}, ` +
      `state ${payload.marketState}, fase ${payload.sessionPhase} (${(size / 1024).toFixed(0)} KB)`
  );
  return payload;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ingest-intraday.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
