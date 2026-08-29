/**
 * ingest-gdelt.mjs — Indonesian slice of the GDELT 2.0 event stream.
 *
 *   node scripts/ingest-gdelt.mjs [--hours 72] [--keep-days 45] [--replace] [--no-cache]
 *
 * WHY THE RAW FILES AND NOT THE API. The handover said for weeks that GDELT was
 * unreachable from this host — every request answered HTTP 000. That was true of
 * exactly one host. `api.gdeltproject.org` is still dead from here (retested from
 * the home machine 2026-08-29, still 000), while `data.gdeltproject.org` answers
 * 200 and serves the complete bulk feed: an export/mentions/gkg triple every 15
 * minutes, roughly a thousand events a slice, the full 61-column Events 2.0
 * schema. The bulk files are richer than the API would have been — Goldstein
 * scale, tone, quad class and the source URL for every row — so the layer this
 * project kept saying it could not build is buildable, for free, from the
 * primary source.
 *
 * WHAT THIS IS NOT. It is a news-event stream, not a market feed. Nothing here
 * has been shown to move an Indonesian share price, and the JSON says so in its
 * own `note` field so no downstream reader can quietly assume otherwise.
 *
 * Writes public/data/idx/gdelt.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSingle } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const CACHE_DIR = join(ROOT, '.cache', 'gdelt');
const BASE = 'http://data.gdeltproject.org/gdeltv2/';

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const HOURS = Number(argVal('--hours', 72));
const USE_CACHE = !argv.includes('--no-cache');
// Retention. The merge below keeps every event it has ever seen, which on a
// 15-minute feed is unbounded growth — and `history.json` alone already rewrites
// 6 MB into git on every data pull, so this repo's history grows ~130 MB a month
// before adding anything. A rolling window keeps the file a fixed size.
const KEEP_DAYS = Number(argVal('--keep-days', 45));
const REPLACE = argv.includes('--replace');

const log = (...a) => console.log(`[gdelt ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Events 2.0 column positions. Named because a bare c[53] in the filter below is
// exactly the kind of line that silently starts reading the wrong country.
const COL = {
  id: 0,
  day: 1,
  actor1Name: 6,
  actor1Country: 7,
  actor2Name: 16,
  actor2Country: 17,
  eventCode: 26,
  eventRoot: 28,
  quadClass: 29,
  goldstein: 30,
  numMentions: 31,
  numSources: 32,
  numArticles: 33,
  avgTone: 34,
  actionGeoName: 52,
  actionGeoCountry: 53,
  actionGeoLat: 56,
  actionGeoLong: 57,
  sourceUrl: 60,
};
const COLUMN_COUNT = 61;

// GDELT mixes two country vocabularies in the same row: actor codes are CAMEO
// 3-letter (IDN), while the geography columns are FIPS 2-letter (ID). Matching
// on the wrong one silently returns either nothing or half the story. And a
// substring search over the whole line — the obvious shortcut — matches any
// field that happens to equal "ID", which on a first pass pulled in a US
// wildfire story as an Indonesian event.
const ACTOR_CODE = 'IDN';
const GEO_CODE = 'ID';

/** Quad class 1-4, the axis that makes this an escalation signal at all. */
const QUAD_LABEL = {
  1: 'kerja sama verbal',
  2: 'kerja sama material',
  3: 'konflik verbal',
  4: 'konflik material',
};

/** CAMEO root codes, collapsed to the twenty buckets GDELT itself defines. */
const ROOT_LABEL = {
  '01': 'pernyataan publik',
  '02': 'imbauan',
  '03': 'niat kerja sama',
  '04': 'konsultasi',
  '05': 'kerja sama diplomatik',
  '06': 'kerja sama material',
  '07': 'bantuan',
  '08': 'konsesi',
  '09': 'penyelidikan',
  10: 'tuntutan',
  11: 'penolakan',
  12: 'penolakan tegas',
  13: 'ancaman',
  14: 'protes',
  15: 'unjuk kekuatan',
  16: 'pengurangan hubungan',
  17: 'pemaksaan',
  18: 'serangan',
  19: 'pertempuran',
  20: 'kekerasan massal',
};

/**
 * Disk-memoised slice fetch.
 *
 * A published GDELT slice never changes, so caching one is safe forever. A slice
 * that is MISSING is a different thing entirely — the feed publishes on a delay
 * and occasionally skips — and remembering that answer is the mistake that cost
 * this repo a whole trading session earlier today: an empty response cached
 * before the source had published turned into a permanent hole that every later
 * run trusted. So only a slice with rows is written to disk.
 */
async function cachedSlice(stamp) {
  const file = join(CACHE_DIR, `${stamp}.json`);
  if (USE_CACHE) {
    try {
      await stat(file);
      const stored = JSON.parse(await readFile(file, 'utf8'));
      if (stored?.rows?.length) return stored;
    } catch {
      /* miss */
    }
  }

  const url = `${BASE}${stamp}.export.CSV.zip`;
  let rows = [];
  let ok = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (res.status === 200) {
      const buf = Buffer.from(await res.arrayBuffer());
      const { text } = unzipSingle(buf);
      rows = text.split('\n').filter((l) => l.trim());
      ok = true;
    } else if (res.status !== 404) {
      log(`  !! ${stamp} HTTP ${res.status}`);
    }
  } catch (err) {
    log(`  !! ${stamp} ${String(err.message).slice(0, 70)}`);
  }

  const payload = { stamp, rows: ok ? rows : [] };
  if (payload.rows.length) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(payload));
  }
  return payload;
}

/** 15-minute slice stamps covering the last `hours`, oldest first. */
function sliceStamps(latest, hours) {
  const out = [];
  const slices = Math.round((hours * 60) / 15);
  for (let i = slices; i >= 0; i--) {
    const d = new Date(latest.getTime() - i * 15 * 60000);
    const p = (n) => String(n).padStart(2, '0');
    out.push(
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(
        Math.floor(d.getUTCMinutes() / 15) * 15
      )}00`
    );
  }
  return [...new Set(out)];
}

/** The newest published slice, read from the feed's own index. */
async function latestSlice() {
  const res = await fetch(`${BASE}lastupdate.txt`, { signal: AbortSignal.timeout(40000) });
  if (!res.ok) throw new Error(`lastupdate.txt HTTP ${res.status}`);
  const text = await res.text();
  const m = text.match(/gdeltv2\/(\d{14})\.export\.CSV\.zip/);
  if (!m) throw new Error('lastupdate.txt tidak memuat stempel slice');
  const s = m[1];
  return new Date(
    Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12))
  );
}

const iso = (day) => `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function readExisting(name) {
  try {
    return JSON.parse(await readFile(join(OUT_DIR, name), 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const latest = await latestSlice();
  const stamps = sliceStamps(latest, HOURS);
  log(`slice terbaru ${latest.toISOString()}, menarik ${stamps.length} slice (${HOURS} jam)`);

  let scanned = 0;
  let missing = 0;
  let totalRows = 0;
  const events = [];

  for (const [i, stamp] of stamps.entries()) {
    const { rows } = await cachedSlice(stamp);
    if (!rows.length) {
      missing++;
    } else {
      scanned++;
      totalRows += rows.length;
      for (const line of rows) {
        const c = line.split('\t');
        // A row that is not the shape we think it is gets dropped rather than
        // read at the wrong offsets — a shifted column is how a filter starts
        // answering about the wrong country while still returning plausible rows.
        if (c.length < COLUMN_COUNT) continue;
        const hit =
          c[COL.actor1Country] === ACTOR_CODE ||
          c[COL.actor2Country] === ACTOR_CODE ||
          c[COL.actionGeoCountry] === GEO_CODE;
        if (!hit) continue;
        events.push({
          id: c[COL.id],
          date: iso(c[COL.day]),
          actor1: c[COL.actor1Name] || '',
          actor1Country: c[COL.actor1Country] || '',
          actor2: c[COL.actor2Name] || '',
          actor2Country: c[COL.actor2Country] || '',
          root: c[COL.eventRoot],
          code: c[COL.eventCode],
          quad: num(c[COL.quadClass]),
          goldstein: num(c[COL.goldstein]),
          tone: num(c[COL.avgTone]),
          mentions: num(c[COL.numMentions]),
          sources: num(c[COL.numSources]),
          articles: num(c[COL.numArticles]),
          place: c[COL.actionGeoName] || '',
          lat: num(c[COL.actionGeoLat]),
          lon: num(c[COL.actionGeoLong]),
          url: c[COL.sourceUrl] || '',
        });
      }
    }
    if ((i + 1) % 48 === 0) log(`  ${i + 1}/${stamps.length} slice · ${events.length} event Indonesia`);
    await sleep(60);
  }

  log(`${scanned} slice terbaca (${missing} kosong/belum terbit), ${totalRows} event global`);

  // Merge with what is stored, keyed on GDELT's own global event id so a re-run
  // over an overlapping window cannot double-count.
  const prior = REPLACE ? null : await readExisting('gdelt.json');
  const byId = new Map();
  for (const e of prior?.events || []) byId.set(e.id, e);
  let fresh = 0;
  for (const e of events) {
    if (!byId.has(e.id)) fresh++;
    byId.set(e.id, e);
  }
  const all = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const merged = all.filter((e) => e.date >= cutoff);
  const dropped = all.length - merged.length;
  log(
    `${events.length} event Indonesia di jendela ini, ${fresh} baru, ${merged.length} tersimpan` +
      (dropped ? `, ${dropped} dibuang di luar ${KEEP_DAYS} hari` : '')
  );

  // Per-day rollup. `conflict` is quad class 3+4 — GDELT's own split, not a
  // threshold invented here.
  const dayMap = new Map();
  for (const e of merged) {
    const d = dayMap.get(e.date) || {
      date: e.date,
      events: 0,
      conflict: 0,
      cooperation: 0,
      toneSum: 0,
      toneN: 0,
      goldsteinSum: 0,
      goldsteinN: 0,
      byRoot: {},
    };
    d.events++;
    if (e.quad === 3 || e.quad === 4) d.conflict++;
    if (e.quad === 1 || e.quad === 2) d.cooperation++;
    if (e.tone !== null) {
      d.toneSum += e.tone;
      d.toneN++;
    }
    if (e.goldstein !== null) {
      d.goldsteinSum += e.goldstein;
      d.goldsteinN++;
    }
    d.byRoot[e.root] = (d.byRoot[e.root] || 0) + 1;
    dayMap.set(e.date, d);
  }
  const days = [...dayMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      events: d.events,
      conflict: d.conflict,
      cooperation: d.cooperation,
      avgTone: d.toneN ? Number((d.toneSum / d.toneN).toFixed(3)) : null,
      avgGoldstein: d.goldsteinN ? Number((d.goldsteinSum / d.goldsteinN).toFixed(3)) : null,
      byRoot: d.byRoot,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'GDELT 2.0 Events — data.gdeltproject.org/gdeltv2/ (berkas mentah, 15 menit)',
    note:
      'Aliran peristiwa berita, BUKAN feed pasar. Belum ada satu pun kaitan terukur ' +
      'dari angka di sini ke harga emiten mana pun; pakai sebagai konteks, jangan ' +
      'sebagai penggerak harga. api.gdeltproject.org tidak bisa dijangkau dari host ' +
      'ini (HTTP 000); yang dipakai berkas mentahnya.',
    filter: `Actor1CountryCode=${ACTOR_CODE} OR Actor2CountryCode=${ACTOR_CODE} OR ActionGeo_CountryCode=${GEO_CODE}`,
    quadClasses: QUAD_LABEL,
    rootCodes: ROOT_LABEL,
    windowHours: HOURS,
    keepDays: KEEP_DAYS,
    slicesRead: scanned,
    slicesMissing: missing,
    globalEventsScanned: totalRows,
    from: days[0]?.date ?? null,
    to: days[days.length - 1]?.date ?? null,
    eventCount: merged.length,
    days,
    events: merged,
  };

  const file = join(OUT_DIR, 'gdelt.json');
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(`wrote gdelt.json (${(size / 1024).toFixed(0)} KB) — ${merged.length} event, ${days.length} hari`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
