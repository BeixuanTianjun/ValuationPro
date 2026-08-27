/**
 * ingest-ownership.mjs — who actually owns each listed share.
 *
 *   node scripts/ingest-ownership.mjs [--months 24] [--replace]
 *
 * SOURCE: KSEI publishes a monthly "Balance Posisi Efek" file — the custody
 * balance of every registered security, split across nine investor types and
 * again across local and foreign holders. It is the only public, per-stock
 * ownership feed in the Indonesian market, and it is what makes a mutual-fund
 * tracker possible at all: IDX's own broker feed is market-wide only, with no
 * per-stock attribution (see scripts/ingest-brokers.mjs for why).
 *
 *   https://www.ksei.co.id/storage/Download/BalanceposEfek<YYYYMMDD>.zip
 *
 * The date in the filename is the last SETTLEMENT day of the month, which is
 * not always the last calendar day, so each month is probed backwards from the
 * month end until a URL answers 200. A wrong date answers 302 to a 404 page.
 *
 * WHAT THE NUMBERS ARE: share counts held in custody at month end, per investor
 * type. They are positions, not flows — the flow is the month-over-month
 * difference, which is what the tracker charts. Monthly resolution is the
 * ceiling here; KSEI publishes no daily ownership cut, and anything claiming
 * daily fund positions for IDX is inferring, not reporting.
 *
 * TRANSPORT: curl for the download (same as every other ingest here), then the
 * zip is inflated in-process with zlib rather than shelling out to `unzip`,
 * which is not reliably on PATH for a Node process on Windows.
 *
 * Writes public/data/idx/ownership.json
 */
import { execFile } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UA } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');
const CACHE_DIR = join(ROOT, '.cache', 'ownership');
const BASE = 'https://www.ksei.co.id/storage/Download';

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MONTHS = Number(argVal('--months', 24));
const REPLACE = argv.includes('--replace');

const log = (...a) => console.log(`[ownership ${new Date().toISOString().slice(11, 19)}]`, ...a);

/**
 * The nine KSEI investor types.
 *
 * `institutional` marks the ones that are a professional pool of somebody
 * else's money — the population the tracker follows. Individuals are retail.
 * Securities companies and corporates are neither: a broker's own custody line
 * is largely inventory and nominee, and a corporate line is usually the
 * controlling shareholder. Forcing either onto the institutional side would
 * make every founder-controlled emiten look institution-owned, so they are
 * kept in their own bucket and shown separately.
 */
export const OWNER_TYPES = [
  { key: 'MF', label: 'Reksa Dana', short: 'Reksa Dana', side: 'institusi' },
  { key: 'IS', label: 'Asuransi', short: 'Asuransi', side: 'institusi' },
  { key: 'PF', label: 'Dana Pensiun', short: 'Dapen', side: 'institusi' },
  { key: 'IB', label: 'Bank & lembaga keuangan', short: 'Bank', side: 'institusi' },
  { key: 'FD', label: 'Yayasan', short: 'Yayasan', side: 'institusi' },
  { key: 'ID', label: 'Individu', short: 'Individu', side: 'ritel' },
  { key: 'CP', label: 'Korporasi', short: 'Korporasi', side: 'strategis' },
  { key: 'SC', label: 'Perusahaan efek', short: 'Sekuritas', side: 'strategis' },
  { key: 'OT', label: 'Lain-lain', short: 'Lain-lain', side: 'strategis' },
];

// Column order inside the pipe-delimited file, after Date|Code|Type|SecNum|Price.
const FILE_ORDER = ['IS', 'CP', 'PF', 'IB', 'ID', 'MF', 'SC', 'FD', 'OT'];

const MONTH_NUM = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curl(args, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024, encoding }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

/** HEAD a candidate URL. Headers are discarded to a file so stdout is just the code. */
async function exists(url) {
  const sink = join(CACHE_DIR, '.head');
  const out = await curl(['-s', '-m', '25', '-I', '--compressed', '-A', UA, '-o', sink, '-w', '%{http_code}', url]);
  return String(out).trim() === '200';
}

/**
 * Read the single member out of a zip buffer.
 *
 * Done here rather than via `unzip` because a Node process launched from
 * PowerShell or a CI runner cannot count on unzip being on PATH. The archive
 * KSEI ships holds exactly one deflated text file, so the central directory's
 * first entry is all we need.
 */
function unzipSingle(buf) {
  // End of central directory, scanned from the tail (no zip comment expected,
  // but allow for one).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Bukan berkas zip yang sah (EOCD tidak ditemukan)');

  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(centralOffset) !== 0x02014b50) throw new Error('Central directory rusak');

  const method = buf.readUInt16LE(centralOffset + 10);
  const compSize = buf.readUInt32LE(centralOffset + 20);
  const nameLen = buf.readUInt16LE(centralOffset + 28);
  const extraLen = buf.readUInt16LE(centralOffset + 30);
  const commentLen = buf.readUInt16LE(centralOffset + 32);
  void extraLen;
  void commentLen;
  const localOffset = buf.readUInt32LE(centralOffset + 42);
  const name = buf.toString('latin1', centralOffset + 46, centralOffset + 46 + nameLen);

  if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Local header rusak');
  const lNameLen = buf.readUInt16LE(localOffset + 26);
  const lExtraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + lNameLen + lExtraLen;
  const data = buf.subarray(start, start + compSize);

  if (method === 0) return { name, text: data.toString('utf8') };
  if (method === 8) return { name, text: inflateRawSync(data).toString('utf8') };
  throw new Error(`Metode kompresi zip ${method} tidak didukung`);
}

/** Business days of `month` (0-indexed), latest first. */
function monthEndCandidates(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const out = [];
  for (let back = 0; back < 8 && out.length < 4; back++) {
    const d = new Date(last.getTime() - back * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    );
  }
  return out;
}

/**
 * Download + inflate one month, returning the raw text.
 *
 * Cached on disk: a published month never changes, so a rebuild costs one
 * filesystem read per month after the first run, and only the newest month is
 * ever fetched on a scheduled update.
 */
async function fetchMonth(year, month) {
  const tag = `${year}-${String(month + 1).padStart(2, '0')}`;
  const cached = join(CACHE_DIR, `${tag}.txt`);
  try {
    await stat(cached);
    return readFile(cached, 'utf8');
  } catch {
    /* miss */
  }

  for (const key of monthEndCandidates(year, month)) {
    const url = `${BASE}/BalanceposEfek${key}.zip`;
    if (!(await exists(url))) continue;

    const zipPath = join(CACHE_DIR, `${tag}.zip`);
    await curl(['-s', '-m', '180', '-L', '--compressed', '-A', UA, '-o', zipPath, url]);
    const buf = await readFile(zipPath);
    const { text } = unzipSingle(buf);
    await writeFile(cached, text, 'utf8');
    await rm(zipPath, { force: true });
    log(`${tag} ← BalanceposEfek${key}.zip (${(text.length / 1024).toFixed(0)} KB teks)`);
    await sleep(400);
    return text;
  }
  return null;
}

/** Parse one monthly file into { date, rows: Map<code, {secNum, price, local, foreign}> }. */
function parseMonth(text) {
  const lines = text.split(/\r?\n/);
  const rows = new Map();
  let date = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const p = line.split('|');
    if (p.length < 25) continue;
    if ((p[2] || '').trim().toUpperCase() !== 'EQUITY') continue;

    const code = (p[1] || '').trim().toUpperCase();
    if (!code) continue;

    if (!date) {
      const [dd, mon, yyyy] = (p[0] || '').trim().split('-');
      const m = MONTH_NUM[(mon || '').toUpperCase()];
      if (m) date = `${yyyy}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    const n = (idx) => {
      const v = Number(p[idx]);
      return Number.isFinite(v) ? v : 0;
    };

    const local = {};
    const foreign = {};
    FILE_ORDER.forEach((key, k) => {
      local[key] = n(5 + k);
      foreign[key] = n(15 + k);
    });

    rows.set(code, { secNum: n(3), price: n(4), local, foreign });
  }

  return date ? { date, rows } : null;
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  const now = new Date();
  const wanted = [];
  // Start from last month: the current month is only published after it closes.
  for (let back = 1; back <= MONTHS; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    wanted.push([d.getUTCFullYear(), d.getUTCMonth()]);
  }
  wanted.reverse();

  const months = [];
  for (const [y, m] of wanted) {
    let text = null;
    try {
      text = await fetchMonth(y, m);
    } catch (err) {
      log(`${y}-${String(m + 1).padStart(2, '0')} gagal: ${err.message}`);
    }
    if (!text) {
      log(`${y}-${String(m + 1).padStart(2, '0')} tidak tersedia — dilewati`);
      continue;
    }
    const parsed = parseMonth(text);
    if (parsed) months.push(parsed);
  }

  if (!months.length) throw new Error('Tidak ada satu pun berkas kepemilikan KSEI yang berhasil diambil.');
  months.sort((a, b) => a.date.localeCompare(b.date));

  // Restrict to the tradable universe so the file does not carry delisted or
  // non-IDX instruments that the rest of the terminal cannot resolve.
  let universe = null;
  try {
    const u = JSON.parse(await readFile(join(OUT_DIR, 'universe.json'), 'utf8'));
    universe = new Set(u.emiten.map((e) => e.code));
  } catch {
    log('universe.json belum ada — memuat seluruh kode ekuitas apa adanya.');
  }

  const codes = new Set();
  for (const m of months) for (const code of m.rows.keys()) if (!universe || universe.has(code)) codes.add(code);

  const csv = (arr) => arr.join(',');
  const emiten = {};
  let seriesKept = 0;

  for (const code of [...codes].sort()) {
    const tot = [];
    const px = [];
    const sec = [];
    const local = {};
    const foreign = {};
    for (const t of OWNER_TYPES) {
      local[t.key] = [];
      foreign[t.key] = [];
    }
    let lastIssued = null;

    for (const m of months) {
      const row = m.rows.get(code);
      if (!row) {
        tot.push('');
        px.push('');
        sec.push('');
        for (const t of OWNER_TYPES) {
          local[t.key].push('');
          foreign[t.key].push('');
        }
        continue;
      }
      let total = 0;
      for (const t of OWNER_TYPES) total += row.local[t.key] + row.foreign[t.key];

      tot.push(Math.round(total));
      px.push(Math.round(row.price));
      // Issued shares, run-length encoded: an empty cell repeats the previous
      // value, and this number moves only on a rights issue or a buyback.
      const issued = Math.round(row.secNum);
      sec.push(lastIssued === issued ? '' : issued);
      lastIssued = issued;
      // Parts per million of the custody balance. Absolute share counts are
      // recoverable as ppm / 1e6 * total, and ppm still resolves a holding of
      // 0.03% of the register to three significant figures — enough to watch a
      // fund build a position — at roughly a third of the bytes of raw counts.
      const ppm = (v) => (total > 0 && v > 0 ? Math.round((v / total) * 1e6) : '');
      for (const t of OWNER_TYPES) {
        local[t.key].push(ppm(row.local[t.key]));
        foreign[t.key].push(ppm(row.foreign[t.key]));
      }
    }

    // Drop all-empty category series — most emiten carry no foreign pension
    // fund or foundation on the register at all, and those zeros are pure bytes.
    const pack = (bucket) => {
      const out = {};
      for (const t of OWNER_TYPES) {
        if (bucket[t.key].some((v) => v !== '')) {
          out[t.key] = csv(bucket[t.key]);
          seriesKept++;
        }
      }
      return out;
    };

    emiten[code] = { tot: csv(tot), sec: csv(sec), px: csv(px), l: pack(local), f: pack(foreign) };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    months: months.map((m) => m.date),
    latestMonth: months[months.length - 1].date,
    emitenCount: Object.keys(emiten).length,
    types: OWNER_TYPES,
    unit: 'ppm',
    source: 'KSEI Balance Posisi Efek (bulanan) — https://www.ksei.co.id/id/publikasi/data-dan-statistik/kepemilikan-efek',
    scope:
      'Saldo kustodian akhir bulan per jenis investor, dipisah lokal dan asing. Ini posisi, bukan arus harian — arus adalah selisih antar bulan. KSEI tidak menerbitkan potongan harian.',
    emiten,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'ownership.json');
  if (REPLACE) await rm(file, { force: true });
  await writeFile(file, JSON.stringify(payload));
  const { size } = await stat(file);
  log(
    `wrote ownership.json — ${payload.emitenCount} emiten × ${months.length} bulan (${months[0].date} → ${payload.latestMonth}), ${seriesKept} seri (${(size / 1024 / 1024).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
