/**
 * ingest-announcements.mjs — IDX keterbukaan informasi, per emiten.
 *
 *   node scripts/ingest-announcements.mjs [--days 45] [--page 1000]
 *
 * WHAT THIS IS. Every material disclosure a listed company files with IDX comes
 * through `/primary/ListedCompany/GetAnnouncement`: RUPS notices, dividends,
 * rights issues, material transactions, contract wins, and the exchange's own
 * requests for explanation. It is the narrative layer the watchlist starts from
 * — the answer to "is anything actually happening at this company", asked
 * against a filing rather than against a rumour.
 *
 * WHAT IT IS NOT. It is not a news feed. A government project announcement —
 * "PLTS 100 GW diresmikan" — is not an IDX filing and will never appear here
 * unless a listed company files about its own role in it. Those themes are
 * curated by hand in src/data/narratives.ts, with a source link, and the UI says
 * which of the two a signal came from.
 *
 * CLASSIFICATION HAPPENS AT READ TIME, not here. This script keeps the filing
 * verbatim — title, subject, date, PDF link — so that changing how a title is
 * categorised never requires re-crawling. src/models/announcements.ts owns the
 * taxonomy.
 *
 * Writes public/data/idx/announcements.json
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDX_BASE, getJson, setRequestGap } from './idx-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DAYS = Number(argVal('--days', 45));
const PAGE = Number(argVal('--page', 1000));
setRequestGap(Number(argVal('--gap', 400)));

const PDF_BASE = 'https://www.idx.co.id/StaticData/NewsAndAnnouncement/';

const log = (...a) => console.log(`[announcements ${new Date().toISOString().slice(11, 19)}]`, ...a);

const ymd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 86400000);

  // `indexFrom` is a PAGE NUMBER and it is ZERO-BASED. indexFrom=0 is the
  // newest `pageSize` filings, indexFrom=1 is the next block down. Passing a row
  // offset (1001, 2001, …) answers ResultCount 0 with an empty Replies and no
  // error at all, so a wrong pagination does not fail — it goes quiet.
  //
  // STARTING AT 1 IS THE EXPENSIVE MISTAKE. It does not shift the window by one
  // filing, it discards the newest `pageSize` of them: with pageSize=1000 the
  // crawl came back with 3,261 of 4,261 rows and NOTHING from the most recent
  // seventeen days, while every log line and the file's own `to` field still
  // claimed the window ran to today. The narrative layer of the watchlist —
  // which decays on a 7-day half-life — was scoring a market whose freshest
  // filing was already 17 days old, and the email digest inherited it.
  //
  // The guard after the crawl is what makes that impossible to repeat quietly.
  const url = (page, pageSize) =>
    `${IDX_BASE}/ListedCompany/GetAnnouncement?indexFrom=${page}&pageSize=${pageSize}` +
    `&dateFrom=${ymd(from)}&dateTo=${ymd(to)}&lang=id&keyword=&emitenType=s`;

  const first = await getJson(url(0, PAGE), { timeoutMs: 90000 });
  const total = Number(first.ResultCount) || 0;
  const pages = Math.ceil(total / PAGE);
  log(`${total} pengumuman dalam ${DAYS} hari terakhir (${pages} halaman)`);

  const replies = [...(first.Replies || [])];
  for (let page = 1; page < pages; page++) {
    const res = await getJson(url(page, PAGE), { timeoutMs: 90000 });
    const batch = res.Replies || [];
    if (!batch.length) break;
    replies.push(...batch);
    log(`  halaman ${page + 1}/${pages} — ${replies.length}/${total}`);
  }

  // What the exchange said it had, versus what came back. A shortfall here is
  // always pagination, never the market being quiet.
  if (total && replies.length < total * 0.95) {
    throw new Error(
      `paginasi tidak lengkap: ${replies.length} dari ${total} baris terambil. ` +
        'Periksa indexFrom (berbasis nol) dan pageSize sebelum menulis berkas.'
    );
  }

  // The feed can repeat a filing across pages when new ones land mid-crawl, so
  // dedupe on the announcement id rather than trusting page boundaries.
  const seen = new Set();
  const rows = [];

  for (const r of replies) {
    const p = r?.pengumuman;
    if (!p) continue;
    const id = p.Id2 || `${p.NoPengumuman}-${p.TglPengumuman}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const code = (p.Kode_Emiten || '').trim().toUpperCase();
    if (!code || code.length > 6) continue;

    // Titles arrive with stray whitespace and occasional double spaces.
    const title = (p.JudulPengumuman || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const attachment = (r.attachments || []).find((a) => a.FullSavePath) || null;
    // Every PDF sits under the same static prefix; storing the suffix keeps
    // ~60 bytes per filing out of a file that is rewritten weekly.
    const url = attachment ? String(attachment.FullSavePath).replace(PDF_BASE, '') : '';

    // PerihalPengumuman is the filer's own subject line and is nearly always a
    // truncation of the title, so it is kept only when it says something else.
    const subject = (p.PerihalPengumuman || '').replace(/\s+/g, ' ').trim();

    rows.push({
      code,
      date: String(p.TglPengumuman || '').slice(0, 10),
      title,
      ...(subject && !title.startsWith(subject) ? { subject } : {}),
      ...(url ? { url } : {}),
    });
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));

  // The second half of the same guard, and the one that would have caught the
  // zero-based bug on its own: a 45-day window whose newest filing is a week old
  // is not a quiet market, it is a crawl that lost its front page. IDX files on
  // every trading day. Weekends and holidays make a three-day gap normal, so the
  // alarm sits above that.
  const newest = rows[0]?.date ?? '';
  const gapDays = newest ? Math.round((to - Date.parse(newest + 'T00:00:00')) / 86400000) : 999;
  if (gapDays > 5) {
    throw new Error(
      `pengajuan terbaru berumur ${gapDays} hari (${newest || 'tidak ada'}) padahal jendela berakhir ` +
        `${to.toISOString().slice(0, 10)}. Feed IDX tidak setertinggal itu — hampir pasti paginasi.`
    );
  }

  const byCode = {};
  for (const r of rows) (byCode[r.code] ||= []).push(r);

  const payload = {
    generatedAt: new Date().toISOString(),
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    count: rows.length,
    emitenCount: Object.keys(byCode).length,
    source: 'IDX /primary/ListedCompany/GetAnnouncement (keterbukaan informasi)',
    pdfBase: PDF_BASE,
    scope:
      'Pengajuan resmi emiten ke bursa. Bukan feed berita: proyek pemerintah atau berita media hanya muncul di sini kalau emitennya sendiri yang melaporkannya.',
    announcements: rows,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, 'announcements.json');
  await writeFile(file, JSON.stringify(payload));

  await archive(rows);
  const { size } = await stat(file);
  log(
    `wrote announcements.json — ${rows.length} pengumuman dari ${payload.emitenCount} emiten (${payload.from} → ${payload.to}), ${(size / 1024).toFixed(0)} KB`
  );
}

/**
 * Arsip pengumuman yang bersifat MENAMBAH, bukan menimpa.
 *
 * KENAPA ADA. `announcements.json` adalah jendela bergulir 45 hari: tiap kali
 * ingest jalan, apa pun yang lebih tua dari itu hilang untuk selamanya. Itu
 * baru terasa mahal pada 2026-09-03, ketika pertanyaannya menjadi "sinyal apa
 * yang mendahului lonjakan IATA?" dan jawabannya ternyata ada di judul
 * pengajuan tertanggal 2026-07-30 — sehari sebelum harganya naik 33%.
 * Pengajuannya masih ada. Tiga bulan sebelumnya tidak, jadi polanya tidak bisa
 * diuji atas apa pun selain satu contoh.
 *
 * Arsipnya dipecah per bulan dan digabung berdasarkan kunci (kode, tanggal,
 * judul). IDX kadang menerbitkan ulang pengajuan yang sama dengan URL berbeda,
 * jadi URL SENGAJA tidak masuk kunci: memasukkannya akan menyimpan dua baris
 * untuk satu peristiwa dan menggandakan tiap event study yang membacanya.
 *
 * Ia tidak pernah menghapus. Sebuah bulan yang crawl-nya pulang setengah tidak
 * boleh memangkas bulan yang sudah lengkap.
 */
async function archive(rows) {
  const dir = join(OUT_DIR, 'announcements-archive');
  await mkdir(dir, { recursive: true });

  const byMonth = new Map();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(r);
  }

  let added = 0;
  for (const [month, fresh] of byMonth) {
    const file = join(dir, month + '.json');
    let existing = [];
    try {
      existing = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }

    const seen = new Set(existing.map((r) => r.code + '|' + r.date + '|' + r.title));
    for (const r of fresh) {
      const key = r.code + '|' + r.date + '|' + r.title;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.push(r);
      added++;
    }

    existing.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
    await writeFile(file, JSON.stringify(existing));
  }

  log(`arsip: +${added} pengajuan baru di ${byMonth.size} berkas bulanan`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
