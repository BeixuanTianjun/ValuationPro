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
// By default a run MERGES into whatever history already exists, so a short
// `--days 20` catch-up appends recent sessions instead of throwing away the
// year that came before it. `--replace` forces a clean rebuild.
const REPLACE = argv.includes('--replace');
// Escape hatch for the missing-session guard below. It does NOT write the
// suspect factors — it writes none for that session — so a session IDX never
// publishes cannot lock the pipeline for good.
const ALLOW_GAP = argv.includes('--allow-gap');

setRequestGap(GAP_MS);

const log = (...a) => console.log(`[ingest ${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * Disk-memoised fetch. `durable` decides whether an answer is worth remembering.
 *
 * A day that came back with no rows is NOT durable. "This was an exchange
 * holiday" and "IDX has not published this session yet" are the same response,
 * and only the first one stays true tomorrow — the EOD feed runs 1-2 calendar
 * days behind, so any run asks for weekdays IDX has not got to yet. Storing
 * that answer turns a publication lag into a permanent hole in the calendar:
 * 2026-08-26 was cached empty at 12:00 WIB on the 26th, every later run read
 * the cache instead of asking again, and the session was written up as a market
 * holiday. Nothing errored. What broke was two steps downstream — `Previous` on
 * 2026-08-27 quoted a close that was never stored, the ratio between them was
 * read as a corporate action for 701 of 962 emiten, and the whole 283-session
 * history was back-adjusted by a factor that does not exist.
 *
 * An unstored answer costs one request per genuine holiday per run.
 */
async function cached(key, fn, durable = () => true) {
  const file = join(CACHE_DIR, `${key}.json`);
  if (USE_CACHE) {
    try {
      await stat(file);
      const stored = JSON.parse(await readFile(file, 'utf8'));
      // A stored non-durable answer is treated as a miss, so a cache already
      // poisoned by an earlier run heals itself on the next one.
      if (durable(stored)) return stored;
    } catch {
      /* cache miss */
    }
  }
  const data = await fn();
  if (durable(data)) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }
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
  return cached(
    `day-${key}`,
    async () => {
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
    },
    // A day with rows is a fact that never changes. A day without them is only
    // "not yet", so it is re-asked on every run instead of being remembered.
    (day) => !!day?.actual
  );
}

// ------------------------------------------------------------------- build

const csv = (arr) => arr.map((x) => (x === null || x === undefined ? '' : x)).join(',');

/** Weekday ISO dates strictly between two sessions — the candidates for a hole. */
function weekdaysBetween(fromIso, toIso) {
  const out = [];
  const d = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  for (d.setUTCDate(d.getUTCDate() + 1); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** "9800,,9725" -> ['9800', '', '9725'] padded/truncated to `length`. */
function splitSeries(text, length) {
  const parts = (text || '').split(',');
  const out = new Array(length).fill('');
  for (let i = 0; i < Math.min(parts.length, length); i++) out[i] = parts[i];
  return out;
}

async function readExisting(name) {
  try {
    return JSON.parse(await readFile(join(OUT_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fold newly crawled sessions into whatever is already stored.
 *
 * `byDate` maps an ISO date to an array of per-code string values for one
 * field. Existing values are kept for dates the crawl did not cover, and a
 * freshly crawled date always wins over a stored one.
 */
function mergeField(dates, existingDates, existingText, freshByDate, code) {
  const existing = existingText ? splitSeries(existingText, existingDates.length) : null;
  const existingIndex = new Map(existingDates.map((d, i) => [d, i]));
  return dates.map((d) => {
    const fresh = freshByDate.get(d);
    if (fresh !== undefined) return fresh;
    if (!existing) return '';
    const i = existingIndex.get(d);
    return i === undefined ? '' : existing[i];
  });
}

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

  const priorHistory = REPLACE ? null : await readExisting('history.json');
  const priorIndices = REPLACE ? null : await readExisting('indices.json');
  const priorMeta = REPLACE ? null : await readExisting('meta.json');
  const priorDates = priorHistory?.dates || [];
  if (priorDates.length) {
    log(`menggabung dengan ${priorDates.length} sesi yang sudah tersimpan (${priorDates[0]} -> ${priorDates[priorDates.length - 1]})`);
  }

  const series = {};
  for (const c of codes) series[c] = { c: [], h: [], l: [], v: [], t: [], fn: [], f: [], adj: [] };

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

  // One entry per crawled session: how many emiten produced a factor, out of
  // how many could have. Read after the loop by the missing-session guard.
  const adjTally = sessions.map((s) => ({ date: s.actual, comparable: 0, factors: 0 }));

  for (const [sessionIdx, s] of sessions.entries()) {
    const tally = adjTally[sessionIdx];
    const seen = new Set();
    for (const row of s.stocks) {
      if (!codeSet.has(row.c)) continue;
      seen.add(row.c);
      const S = series[row.c];
      const close = row.cl || row.pv || 0;

      const prior = lastClose[row.c];
      let factor = '';
      if (prior > 0 && row.pv > 0) {
        tally.comparable++;
        const ratio = row.pv / prior;
        if (Math.abs(ratio - 1) > ADJ_THRESHOLD) {
          factor = Number(ratio.toFixed(6));
          tally.factors++;
        }
      }
      S.adj.push(factor);
      if (close > 0) lastClose[row.c] = close;
      S.c.push(close || '');
      S.h.push(row.h || '');
      S.l.push(row.l || '');
      S.v.push(row.v ? Math.round(row.v / 100) : ''); // lots
      S.t.push(row.t ? Math.round(row.t / 1e6) : ''); // IDR million turnover
      S.fn.push(row.fb || row.fs ? Math.round(((row.fb - row.fs) * close) / 1e6) : ''); // IDR mn net foreign
      S.f.push(row.f ? Math.round(row.f) : ''); // trade count — see types/market.ts RawSeries.f
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
        S.f.push('');
        S.adj.push('');
      }
    }
  }

  // A corporate action happens to ONE emiten at a time. A factor that fires for
  // a large share of the market on the same session is not a wave of splits — it
  // means `Previous` quotes a close this run never stored, which is what a
  // MISSING TRADING SESSION looks like from here. Writing those factors would
  // back-adjust the whole stored history by an event that never happened, and
  // every number downstream (momentum, beta, index attribution, the 20-session
  // windows) would stay entirely plausible while being wrong. It has happened
  // once already: 701 of 962 emiten "split" on 2026-08-27 because 2026-08-26
  // was cached empty and dropped out of the calendar.
  const GAP_SHARE = 0.05;
  const gaps = adjTally.filter((t) => t.comparable >= 100 && t.factors / t.comparable > GAP_SHARE);
  if (gaps.length) {
    const detail = gaps
      .map((g) => {
        const prior = adjTally[adjTally.indexOf(g) - 1];
        const missing = prior ? weekdaysBetween(prior.date, g.date) : [];
        const pct = ((g.factors / g.comparable) * 100).toFixed(0);
        return `${g.date}: ${g.factors}/${g.comparable} emiten (${pct}%)${
          missing.length ? `, hari kerja yang hilang di antaranya: ${missing.join(', ')}` : ''
        }`;
      })
      .join(' · ');
    if (!ALLOW_GAP) {
      throw new Error(
        `Sesi bursa hilang dari crawl — ${detail}. Aksi korporasi tidak pernah serentak sepasar, ` +
          `jadi rasio Previous/close sebesar ini berarti ada sesi yang tidak ikut tertarik. ` +
          `Hapus .cache/idx/day-<YYYYMMDD>.json untuk tanggal itu lalu jalankan ulang. ` +
          `Kalau IDX memang tidak pernah menerbitkannya, pakai --allow-gap: run akan lanjut ` +
          `TANPA faktor apa pun pada sesi tersebut.`
      );
    }
    log(`!! sesi hilang dilanjutkan atas permintaan --allow-gap — ${detail}`);
    log('!! faktor pada sesi itu TIDAK ditulis; aksi korporasi asli pada tanggal tersebut akan terlewat');
    for (const g of gaps) {
      const i = adjTally.indexOf(g);
      for (const c of codes) series[c].adj[i] = '';
    }
  }

  // The crawl produced values for `dates`; fold them into the stored history so
  // a short catch-up run never shortens the series.
  const mergedDates = [...new Set([...priorDates, ...dates])].sort();
  const FIELDS = ['c', 'h', 'l', 'v', 't', 'fn', 'f', 'adj'];

  const historySeries = {};
  let withData = 0;
  let corporateActions = 0;

  for (const c of codes) {
    const S = series[c];
    const prior = priorHistory?.series?.[c];
    if (!prior && !S.c.some((x) => x !== '')) continue; // never seen at all

    const out = {};
    for (const field of FIELDS) {
      const freshByDate = new Map();
      dates.forEach((d, i) => freshByDate.set(d, S[field][i]));
      const merged = mergeField(mergedDates, priorDates, prior?.[field], freshByDate, c);
      if (field === 'adj') {
        if (merged.some((x) => x !== '')) {
          out.adj = csv(merged);
          corporateActions += merged.filter((x) => x !== '').length;
        }
      } else {
        out[field] = csv(merged);
      }
    }

    if (!out.c || !out.c.split(',').some((x) => x !== '')) continue;
    withData++;
    historySeries[c] = out;
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
  const priorIndexDates = priorIndices?.dates || [];
  const mergedIndexDates = [...new Set([...priorIndexDates, ...dates])].sort();
  const allIndexCodes = new Set([...indexCodes, ...Object.keys(priorIndices?.indices || {})]);

  const indexOut = {};
  for (const code of allIndexCodes) {
    const I = indices[code];
    const prior = priorIndices?.indices?.[code];
    const out = { members: I?.n || prior?.members || 0 };
    for (const field of ['c', 'v', 't', 'mc']) {
      const freshByDate = new Map();
      if (I) dates.forEach((d, i) => freshByDate.set(d, I[field][i]));
      out[field] = csv(mergeField(mergedIndexDates, priorIndexDates, prior?.[field], freshByDate, code));
    }
    indexOut[code] = out;
  }

  // --- latest session snapshot
  //
  // A short catch-up run can end up older than what is already stored (IDX
  // publishes late). In that case the stored snapshot is newer and is kept,
  // rather than being overwritten with stale prices.
  const last = sessions[sessions.length - 1];
  const priorDaily = REPLACE ? null : await readExisting('daily.json');
  const keepPriorDaily = !!priorDaily?.session && priorDaily.session > last.actual;
  if (keepPriorDaily) {
    log(`snapshot tersimpan (${priorDaily.session}) lebih baru dari hasil crawl (${last.actual}) — snapshot lama dipertahankan`);
  }

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
  const sessionSet = new Set(mergedDates);
  const holidaySet = new Set(REPLACE ? [] : priorMeta?.holidays || []);
  let pendingSessions = 0;
  for (const d of calendar) {
    const iso = `${ymd(d).slice(0, 4)}-${ymd(d).slice(4, 6)}-${ymd(d).slice(6, 8)}`;
    if (sessionSet.has(iso)) continue;
    if (iso < mergedDates[0]) continue;
    if (iso > last.actual) pendingSessions++;
    else holidaySet.add(iso);
  }
  // A date that turned out to have a session is not a holiday after all.
  for (const d of sessionSet) holidaySet.delete(d);
  const holidays = [...holidaySet].sort();
  log(`derived ${holidays.length} hari libur bursa dalam rentang, ${pendingSessions} hari kerja belum diterbitkan IDX`);
  log(`detected ${corporateActions} aksi korporasi (split/reverse split/rights) dari selisih Previous vs close`);

  // Everything downstream keys off the MERGED calendar, not the slice this run
  // happened to crawl. Writing the crawl-only dates here is exactly what would
  // truncate a year of history down to a fortnight on a short catch-up run.
  const latestSession = keepPriorDaily ? priorDaily.session : last.actual;

  const meta = {
    generatedAt: new Date().toISOString(),
    latestSession,
    holidays,
    pendingSessions,
    sessions: mergedDates.length,
    firstSession: mergedDates[0],
    sessionsCrawledThisRun: dates.length,
    merged: !REPLACE && priorDates.length > 0,
    emitenListed: emiten.length,
    emitenWithHistory: withData,
    corporateActions,
    // Non-empty only when --allow-gap was used: sessions written without any
    // corporate-action factor because a trading day is missing before them.
    gapSessions: gaps.map((g) => g.date),
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
    'indices.json': { generatedAt: meta.generatedAt, dates: mergedIndexDates, indices: indexOut },
    'history.json': { generatedAt: meta.generatedAt, dates: mergedDates, series: historySeries },
    'daily.json': keepPriorDaily
      ? priorDaily
      : { generatedAt: meta.generatedAt, session: last.actual, count: daily.length, stocks: daily },
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
