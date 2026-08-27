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
import { mkdir, writeFile, stat } from 'node:fs/promises';
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

  // `indexFrom` is a 1-BASED PAGE NUMBER, not a row offset — indexFrom=2 with
  // pageSize=1000 returns rows 1001-2000, and passing a row offset returns an
  // empty result set with ResultCount 0 rather than an error.
  const url = (page, pageSize) =>
    `${IDX_BASE}/ListedCompany/GetAnnouncement?indexFrom=${page}&pageSize=${pageSize}` +
    `&dateFrom=${ymd(from)}&dateTo=${ymd(to)}&lang=id&keyword=&emitenType=s`;

  const first = await getJson(url(1, PAGE), { timeoutMs: 90000 });
  const total = Number(first.ResultCount) || 0;
  const pages = Math.ceil(total / PAGE);
  log(`${total} pengumuman dalam ${DAYS} hari terakhir (${pages} halaman)`);

  const replies = [...(first.Replies || [])];
  for (let page = 2; page <= pages; page++) {
    const res = await getJson(url(page, PAGE), { timeoutMs: 90000 });
    const batch = res.Replies || [];
    if (!batch.length) break;
    replies.push(...batch);
    log(`  halaman ${page}/${pages} — ${replies.length}/${total}`);
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
  const { size } = await stat(file);
  log(
    `wrote announcements.json — ${rows.length} pengumuman dari ${payload.emitenCount} emiten (${payload.from} → ${payload.to}), ${(size / 1024).toFixed(0)} KB`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
