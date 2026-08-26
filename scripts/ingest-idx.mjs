/**
 * ingest-idx.mjs — builds the bundled IDX market database.
 *
 *   node scripts/ingest-idx.mjs [--days 400] [--concurrency 4] [--no-cache]
 *
 * Sources (all IDX's own primary API — no third-party aggregator):
 *   /StockData/GetSecuritiesStock      full listed universe + per-sector membership
 *   /ListedCompany/GetCompanyProfiles  industry / sub-industry / business description
 *   /TradingSummary/GetStockSummary    daily OHLC, turnover, foreign buy/sell for every emiten
 *   /TradingSummary/GetIndexSummary    daily close for all IDX indices
 *
 * Writes public/data/idx/{universe,indices,history,daily,meta}.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDX_BASE,
  IDX_SECTORS,
  SECTOR_SLUG,
  getJson,
  mapPool,
  enc,
  ymd,
  isoDay,
  tradingCalendar,
  setRequestGap,
} from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const CACHE_DIR = join(ROOT, '.cache', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Number(argVal('--days', 400));
// IDX's Cloudflare edge starts serving challenge pages to bursty clients, so
// the crawl runs almost serially with a fixed gap between requests. Raising
// these makes the run faster right up until the point where it fails wholesale.
const CONCURRENCY = Number(argVal('--concurrency', 2));
const GAP_MS = Number(argVal('--gap', 350));
const USE_CACHE = !argv.includes('--no-cache');

setRequestGap(GAP_MS);

const log = (...a) => console.log(`[ingest ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function cached(key, fn) {
  const file = join(CACHE_DIR, `${key}.json`);
  if (USE_CACHE) {
    try {
      await stat(file);
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      /* cache miss */
    }
  }
  const data = await fn();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------- universe

async function fetchUniverse() {
  log('fetching listed universe...');
  const all = await getJson(
    `${IDX_BASE}/StockData/GetSecuritiesStock?start=0&length=3000&code=&sector=&board=&language=en-us`
  );

  const bySector = {};
  for (const sector of IDX_SECTORS) {
    const res = await getJson(
      `${IDX_BASE}/StockData/GetSecuritiesStock?start=0&length=3000&code=&sector=${enc(
        sector
      )}&board=&language=en-us`
    );
    for (const row of res.data || []) bySector[row.Code] = sector;
    log(`  sector ${sector}: ${(res.data || []).length}`);
  }

  log('fetching company profiles...');
  const profiles = await getJson(`${IDX_BASE}/ListedCompany/GetCompanyProfiles?start=0&length=3000&code=`);
  const profileByCode = {};
  for (const p of profiles.data || []) profileByCode[p.KodeEmiten] = p;

  const emiten = (all.data || []).map((row) => {
    const p = profileByCode[row.Code] || {};
    const sector = bySector[row.Code] || 'Unclassified';
    return {
      code: row.Code,
      name: (row.Name || '').trim(),
      fullName: (p.NamaEmiten || row.Name || '').trim(),
      sector,
      sectorSlug: SECTOR_SLUG[sector] || 'other',
      industry: p.Industri || '',
      subIndustry: p.SubIndustri || '',
      business: (p.KegiatanUsahaUtama || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      board: row.ListingBoard || '',
      listingDate: isoDay(row.ListingDate),
      listedShares: Number(row.Shares) || 0,
      website: p.Website || '',
      yahoo: `${row.Code}.JK`,
    };
  });

  emiten.sort((a, b) => a.code.localeCompare(b.code));
  return emiten;
}

// ---------------------------------------------------------- daily crawling

async function fetchDay(date) {
  const key = ymd(date);
  return cached(`day-${key}`, async () => {
    const [stocks, indices] = await Promise.all([
      getJson(`${IDX_BASE}/TradingSummary/GetStockSummary?length=3000&start=0&date=${key}`),
      getJson(`${IDX_BASE}/TradingSummary/GetIndexSummary?length=100&start=0&date=${key}`),
    ]);
    const sRows = stocks.data || [];
    const iRows = indices.data || [];
    // IDX serves the most recent trading day when asked for a holiday; keep the
    // date the API actually reports so we never duplicate a session.
    const actual = sRows.length ? isoDay(sRows[0].Date) : iRows.length ? isoDay(iRows[0].Date) : null;
    return {
      requested: `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`,
      actual,
      stocks: sRows.map((r) => ({
        c: r.StockCode,
        o: Number(r.OpenPrice) || 0,
        h: Number(r.High) || 0,
        l: Number(r.Low) || 0,
        cl: Number(r.Close) || 0,
        pv: Number(r.Previous) || 0,
        v: Number(r.Volume) || 0,
        t: Number(r.Value) || 0,
        f: Number(r.Frequency) || 0,
        fb: Number(r.ForeignBuy) || 0,
        fs: Number(r.ForeignSell) || 0,
        ls: Number(r.ListedShares) || 0,
        // Free-float adjusted share count IDX uses to weight its indices.
        // This is what makes exact index-point attribution possible.
        wi: Number(r.WeightForIndex) || 0,
      })),
      indices: iRows.map((r) => ({
        c: r.IndexCode,
        cl: Number(r.Close) || 0,
        pv: Number(r.Previous) || 0,
        h: Number(r.Highest) || 0,
        l: Number(r.Lowest) || 0,
        v: Number(r.Volume) || 0,
        t: Number(r.Value) || 0,
        n: Number(r.NumberOfStock) || 0,
        mc: Number(r.MarketCapital) || 0,
      })),
    };
  });
}

// ------------------------------------------------------------------- build

const csv = (arr) => arr.map((x) => (x === null || x === undefined ? '' : x)).join(',');

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const emiten = await fetchUniverse();
  log(`universe: ${emiten.length} emiten across ${new Set(emiten.map((e) => e.sector)).size} sectors`);

  const calendar = tradingCalendar(new Date(), DAYS);
  log(
    `crawling ${calendar.length} weekday sessions (${DAYS} calendar days back), concurrency ${CONCURRENCY}, gap ${GAP_MS}ms...`
  );

  let done = 0;
  let failures = 0;
  const raw = await mapPool(calendar, CONCURRENCY, async (d) => {
    try {
      const r = await fetchDay(d);
      if (++done % 25 === 0) log(`  ${done}/${calendar.length} sessions (${failures} gagal)`);
      return r;
    } catch (err) {
      failures++;
      done++;
      if (failures <= 10) log(`  !! ${ymd(d)} failed: ${err.message}`);
      return null;
    }
  });
  if (failures) log(`${failures}/${calendar.length} sessions could not be fetched`);

  // Deduplicate on the date IDX actually returned, then order oldest -> newest.
  const byActual = new Map();
  for (const day of raw) {
    if (!day || !day.actual || !day.stocks.length) continue;
    if (!byActual.has(day.actual)) byActual.set(day.actual, day);
  }
  const sessions = [...byActual.values()].sort((a, b) => a.actual.localeCompare(b.actual));
  const dates = sessions.map((s) => s.actual);
  log(`resolved ${dates.length} unique trading sessions: ${dates[0]} -> ${dates[dates.length - 1]}`);

  // --- per-emiten price/flow series (comma-joined strings; blank = no trade)
  const codes = emiten.map((e) => e.code);
  const codeSet = new Set(codes);
  const series = {};
  for (const c of codes) series[c] = { c: [], h: [], l: [], v: [], t: [], fn: [], adj: [] };

  // Corporate-action factors, derived from IDX's own data.
  //
  // IDX reports `Previous` already adjusted for splits, reverse splits and
  // rights issues, while `Close` is the raw traded price. So whenever
  // Previous[i] differs from the close we recorded for session i-1, the ratio
  // between them IS the adjustment factor — MLPT's 1:25 split shows up as
  // exactly 0.0401, RAJA's and RMKE's 1:5 as exactly 0.2000.
  //
  // Without this, a 1:25 split reads as a 96% crash: it would poison every
  // momentum factor, the beta regression, and the index attribution.
  const lastClose = {};
  const ADJ_THRESHOLD = 0.005;

  for (const s of sessions) {
    const seen = new Set();
    for (const row of s.stocks) {
      if (!codeSet.has(row.c)) continue;
      seen.add(row.c);
      const S = series[row.c];
      const close = row.cl || row.pv || 0;

      const prior = lastClose[row.c];
      let factor = '';
      if (prior > 0 && row.pv > 0) {
        const ratio = row.pv / prior;
        if (Math.abs(ratio - 1) > ADJ_THRESHOLD) factor = Number(ratio.toFixed(6));
      }
      S.adj.push(factor);
      if (close > 0) lastClose[row.c] = close;
      S.c.push(close || '');
      S.h.push(row.h || '');
      S.l.push(row.l || '');
      S.v.push(row.v ? Math.round(row.v / 100) : ''); // lots
      S.t.push(row.t ? Math.round(row.t / 1e6) : ''); // IDR million turnover
      S.fn.push(row.fb || row.fs ? Math.round(((row.fb - row.fs) * close) / 1e6) : ''); // IDR mn net foreign
    }
    for (const c of codes) {
      if (!seen.has(c)) {
        const S = series[c];
        S.c.push('');
        S.h.push('');
        S.l.push('');
        S.v.push('');
        S.t.push('');
        S.fn.push('');
        S.adj.push('');
      }
    }
  }

  const historySeries = {};
  let withData = 0;
  let corporateActions = 0;
  for (const c of codes) {
    const S = series[c];
    if (!S.c.some((x) => x !== '')) continue; // never traded in window — omit entirely
    withData++;
    historySeries[c] = { c: csv(S.c), h: csv(S.h), l: csv(S.l), v: csv(S.v), t: csv(S.t), fn: csv(S.fn) };
    // Almost always empty, so it costs nothing to carry.
    if (S.adj.some((x) => x !== '')) {
      historySeries[c].adj = csv(S.adj);
      corporateActions += S.adj.filter((x) => x !== '').length;
    }
  }

  // --- index history
  const indexCodes = new Set();
  for (const s of sessions) for (const r of s.indices) indexCodes.add(r.c);
  const indices = {};
  for (const code of indexCodes) indices[code] = { c: [], v: [], t: [], mc: [], n: 0 };
  for (const s of sessions) {
    const seen = new Set();
    for (const r of s.indices) {
      const I = indices[r.c];
      if (!I) continue;
      seen.add(r.c);
      I.c.push(r.cl ? Number(r.cl.toFixed(3)) : '');
      I.v.push(r.v ? Math.round(r.v / 1e3) : '');
      I.t.push(r.t ? Math.round(r.t / 1e6) : '');
      I.mc.push(r.mc ? Math.round(r.mc / 1e9) : ''); // IDR billion market cap
      I.n = r.n || I.n;
    }
    for (const code of indexCodes) {
      if (!seen.has(code)) {
        const I = indices[code];
        I.c.push('');
        I.v.push('');
        I.t.push('');
        I.mc.push('');
      }
    }
  }
  const indexOut = {};
  for (const [code, I] of Object.entries(indices)) {
    indexOut[code] = { members: I.n, c: csv(I.c), v: csv(I.v), t: csv(I.t), mc: csv(I.mc) };
  }

  // --- latest session snapshot
  const last = sessions[sessions.length - 1];
  const daily = last.stocks
    .filter((r) => codeSet.has(r.c))
    .map((r) => ({
      code: r.c,
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.cl,
      prev: r.pv,
      change: r.pv ? Number((((r.cl - r.pv) / r.pv) * 100).toFixed(2)) : 0,
      volume: r.v,
      value: r.t,
      freq: r.f,
      foreignNet: Math.round((r.fb - r.fs) * (r.cl || r.pv || 0)),
      listedShares: r.ls,
      indexShares: r.wi || 0,
      marketCap: (r.ls || 0) * (r.cl || r.pv || 0),
    }));

  // IDX publishes no trading-holiday calendar through its API, so it is derived
  // from the crawl itself: a weekday inside the covered range that produced no
  // session is a holiday. Weekdays AFTER the latest published session are not
  // holidays — IDX simply has not published them yet, and conflating the two
  // would make the scheduler skip real trading days.
  const sessionSet = new Set(dates);
  const holidays = [];
  let pendingSessions = 0;
  for (const d of calendar) {
    const iso = `${ymd(d).slice(0, 4)}-${ymd(d).slice(4, 6)}-${ymd(d).slice(6, 8)}`;
    if (sessionSet.has(iso)) continue;
    if (iso < dates[0]) continue;
    if (iso > last.actual) pendingSessions++;
    else holidays.push(iso);
  }
  log(`derived ${holidays.length} hari libur bursa dalam rentang, ${pendingSessions} hari kerja belum diterbitkan IDX`);
  log(`detected ${corporateActions} aksi korporasi (split/reverse split/rights) dari selisih Previous vs close`);

  const meta = {
    generatedAt: new Date().toISOString(),
    latestSession: last.actual,
    holidays,
    pendingSessions,
    sessions: dates.length,
    firstSession: dates[0],
    emitenListed: emiten.length,
    emitenWithHistory: withData,
    corporateActions,
    indexCount: Object.keys(indexOut).length,
    calendarDaysRequested: DAYS,
    sources: [
      'IDX /primary/StockData/GetSecuritiesStock',
      'IDX /primary/ListedCompany/GetCompanyProfiles',
      'IDX /primary/TradingSummary/GetStockSummary',
      'IDX /primary/TradingSummary/GetIndexSummary',
    ],
  };

  const files = {
    'universe.json': { generatedAt: meta.generatedAt, count: emiten.length, emiten },
    'indices.json': { generatedAt: meta.generatedAt, dates, indices: indexOut },
    'history.json': { generatedAt: meta.generatedAt, dates, series: historySeries },
    'daily.json': { generatedAt: meta.generatedAt, session: last.actual, count: daily.length, stocks: daily },
    'meta.json': meta,
  };

  for (const [name, payload] of Object.entries(files)) {
    const file = join(OUT_DIR, name);
    await writeFile(file, JSON.stringify(payload));
    const { size } = await stat(file);
    log(`wrote ${name} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  }

  log('done.', JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
