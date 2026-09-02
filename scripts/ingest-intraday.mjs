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
import { mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { UA, mapPool } from './idx-lib.mjs';
import { fetchGoogleQuotes } from './gfinance-lib.mjs';

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

/**
 * A Yahoo cookie + crumb pair.
 *
 * `fresh` DELETES the stored jar before asking for a new one, and that is the
 * whole point of the option rather than a tidy-up. A crumb is validated here
 * only for SHAPE — non-empty, short, no HTML — and a perfectly well-formed
 * crumb paired with a stale cookie is still rejected by the quote endpoint with
 * an empty result rather than an error. Reusing the jar in that state produces
 * a second crumb bound to the same dead session, so the retry would fail
 * exactly like the first attempt. See the caller for how that showed up.
 */
async function getCrumb({ fresh = false } = {}) {
  await mkdir(dirname(COOKIE_JAR), { recursive: true });
  if (fresh) await rm(COOKIE_JAR, { force: true }).catch(() => {});
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

  let crumb = '';
  try {
    crumb = await getCrumb();
  } catch (err) {
    // A missing crumb is no longer fatal: the Google fallback below can still
    // produce a usable snapshot for the names that matter.
    log(`Gagal mendapat crumb Yahoo (${err.message}) — mengandalkan fallback.`);
  }
  const quotes = {};
  let marketState = 'UNKNOWN';
  let newestTime = 0;

  /** One full sweep of the universe with a given crumb. Fills `quotes`. */
  const sweep = async (activeCrumb) => {
    const wanted = codes.filter((c) => !quotes[c]);
    const passes = [];
    for (let i = 0; i < wanted.length; i += BATCH) passes.push(wanted.slice(i, i + BATCH));

    await mapPool(passes, 2, async (batch) => {
      let rows = [];
      for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
        try {
          rows = await fetchBatch(batch.map((c) => `${c}.JK`), activeCrumb);
        } catch {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      for (const q of rows) {
        const code = String(q.symbol || '').replace('.JK', '');
        // > 0, NOT Number.isFinite. Zero is finite, and Yahoo answers a
        // delisted or long-suspended ticker with an all-zeros quote: on
        // 2026-09-02 SCPI came back price 0, prevClose 0, stamped 2024-07-19,
        // against a last committed close of Rp 29.000. The finite check let it
        // straight into the overlay, so the terminal carried SCPI at Rp 0 and
        // -100% — no throw, no NaN, just a number that looks like a price.
        if (!code || !(q.regularMarketPrice > 0)) continue;
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
  };

  await sweep(crumb);

  // ---- ONE RETRY WITH A NEW SESSION, BEFORE GIVING UP ON YAHOO ------------
  //
  // Observed on 2026-09-02 09:24 WIB: Yahoo returned 0 of 962, the run fell
  // straight through to the bounded Google fallback and wrote a healthy-looking
  // file covering 120 emiten — 12% of the universe — with exit 0 and nothing in
  // the log that reads as a failure. Running the SAME command again immediately
  // returned 962/962.
  //
  // The three attempts inside the sweep above did not help and never could:
  // they all reuse one crumb, so a session Yahoo has stopped honouring fails
  // three identical times. `getCrumb()` had succeeded — the crumb was
  // well-formed — which is why nothing upstream complained. Only a NEW cookie
  // jar fixes it, which is precisely what re-running the process did by hand.
  //
  // Gated on losing more than half the universe so an ordinary handful of
  // untraded tickers never pays for a second sweep.
  if (codes.filter((c) => !quotes[c]).length > codes.length * 0.5) {
    const got = Object.keys(quotes).length;
    log(`Yahoo baru mengisi ${got}/${codes.length} — ambil sesi baru dan coba sekali lagi.`);
    try {
      crumb = await getCrumb({ fresh: true });
      await sweep(crumb);
      log(`Setelah sesi baru: ${Object.keys(quotes).length}/${codes.length}.`);
    } catch (err) {
      log(`Sesi baru juga gagal (${err.message}) — mengandalkan fallback.`);
    }
  }

  // ---- fallback -----------------------------------------------------------
  //
  // Yahoo's quote API sits behind a cookie+crumb pair that intermittently
  // answers "Unauthorized" — observed live on 2026-08-27. When that happens the
  // batch loop above returns nothing and the terminal would show a blank
  // market. Google Finance carries the same prices (verified: BBCA closed 6400
  // on both) but has no batch endpoint, so it is one HTML page per ticker.
  //
  // The fallback is therefore BOUNDED to the most liquid names, ranked by the
  // last committed session's turnover. Quoting all 962 from Google would take
  // longer than the session it is trying to report; quoting the 120 that carry
  // most of the day's value keeps the screen honest and finishes in a minute.
  const missing = codes.filter((c) => !quotes[c]);
  let googleUsed = 0;
  if (missing.length > codes.length * 0.5) {
    log(`Yahoo hanya mengembalikan ${codes.length - missing.length}/${codes.length} — fallback ke Google Finance.`);
    let ranked = missing;
    try {
      const daily = JSON.parse(await readFile(join(OUT_DIR, 'daily.json'), 'utf8'));
      const turnover = new Map(daily.stocks.map((q) => [q.code, q.value || 0]));
      ranked = [...missing].sort((a, b) => (turnover.get(b) || 0) - (turnover.get(a) || 0));
    } catch {
      /* no committed session yet — take them in listing order */
    }

    const g = await fetchGoogleQuotes(ranked, { concurrency: 3, limit: 120 });
    for (const [code, q] of g) {
      // Google's blob carries no previous close, so it comes from the last
      // committed session. Without it a change percent would be invented.
      quotes[code] = {
        price: q.price,
        prevClose: null,
        open: q.open,
        high: q.high,
        low: q.low,
        volume: q.volume,
        changePercent: null,
        time: Math.floor(Date.parse(q.lastBarAt) / 1000),
        source: 'google',
      };
      googleUsed++;
    }
    log(`Google Finance mengisi ${googleUsed} emiten.`);
  }

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

  // ---- PHANTOM MOVES FROM STALE QUOTES ------------------------------------
  //
  // A quote stamped before today is not a quote for today. For most suspended
  // tickers that is harmless — Yahoo repeats the same price the exchange last
  // published, so folding it in changes nothing. It stops being harmless when
  // the two disagree: FASW is stamped 2025-01-30 at 5.450 while IDX last closed
  // it at 5.275, so the overlay invents a +3,3% move for a stock that has not
  // traded in nineteen months, and every breadth count, index attribution and
  // "biggest gainer" list downstream believes it.
  //
  // ONLY the disagreeing ones are dropped, deliberately. Removing every stale
  // quote would also empty the file on a holiday or a weekend run, where the
  // whole point is that the last price IS the current price — a much larger
  // behaviour change than the bug being fixed. A dropped quote falls back to
  // the last committed close, which is what the terminal shows for any emiten
  // it has no live price for.
  let phantom = 0;
  try {
    const daily = JSON.parse(await readFile(join(OUT_DIR, 'daily.json'), 'utf8'));
    const lastClose = new Map(daily.stocks.map((r) => [r.code, r.close]));
    for (const [code, q] of Object.entries(quotes)) {
      if (!Number.isFinite(q.time)) continue;
      if (wibParts(new Date(q.time * 1000)).date >= tradingDate) continue;
      const prev = lastClose.get(code);
      if (!(prev > 0) || !(q.price > 0)) continue;
      if (Math.abs(q.price / prev - 1) < 1e-9) continue;
      delete quotes[code];
      phantom++;
    }
  } catch {
    /* no committed session to compare against yet — leave the quotes alone */
  }
  if (phantom) log(`${phantom} kuotasi basi dibuang: stempelnya sebelum ${tradingDate} dan harganya beda dari penutupan resmi.`);

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
