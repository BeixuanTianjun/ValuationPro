/**
 * wake-report.mjs — what happened while you were asleep.
 *
 *   node scripts/wake-report.mjs [--since <ISO>]
 *
 * Pairs with the voice sleep switch (~/.claude/hooks/sleepctl.mjs). When
 * "Daddy's home" lifts the mute, sleepctl prints the `since` stamp and this
 * reads the window between then and now.
 *
 * WHY THIS IS NOT JUST "TAIL THE LOG". The scheduler's own failure history
 * lives in memory in the running service and is gone the moment it restarts —
 * which is exactly what happens overnight if the laptop sleeps or the process
 * is killed. So this reconstructs the picture from what survives on disk: the
 * job-state file, the mtimes and internal timestamps of each data file, and the
 * news feed's own publication times.
 *
 * WHAT IT WILL NOT DO IS GUESS. A feed that cannot be read is reported as
 * unreadable, not as unchanged — an overnight report whose failure mode is
 * looking calm is worse than no report, because the whole reason to read it is
 * to find out whether something broke while nobody was watching.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const DATA = join(ROOT, 'public', 'data', 'idx');

const argv = process.argv.slice(2);
const sinceArg = argv.indexOf('--since');
const SINCE = sinceArg >= 0 && argv[sinceArg + 1] ? Date.parse(argv[sinceArg + 1]) : NaN;

const wib = (d) => new Date(d + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const gap = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} menit` : `${Math.floor(m / 60)} jam ${m % 60} menit`;
};
const age = (iso) => (iso ? gap(Date.now() - Date.parse(iso)) : '?');

async function readJson(name) {
  try {
    return JSON.parse(await readFile(join(DATA, name), 'utf8'));
  } catch (err) {
    return { __error: err.message };
  }
}

async function main() {
  const out = [];
  const p = (s = '') => out.push(s);

  p('════════ LAPORAN SELAMA ANDA PERGI ════════');
  if (Number.isFinite(SINCE)) {
    p(`Jendela : ${wib(SINCE)} → ${wib(Date.now())} WIB  (${gap(Date.now() - SINCE)})`);
  } else {
    p(`Waktu   : ${wib(Date.now())} WIB  (jendela tidak diketahui — tanpa --since)`);
  }
  p();

  // ---- pasar
  const [meta, intraday, daily] = await Promise.all([
    readJson('meta.json'),
    readJson('intraday.json'),
    readJson('daily.json'),
  ]);

  p('── PASAR ──');
  if (intraday.__error) {
    p(`  intraday.json TIDAK TERBACA: ${intraday.__error}`);
  } else {
    const idx = intraday.indices?.COMPOSITE;
    p(`  Sesi        : ${intraday.tradingDate} · ${intraday.marketState} · ${intraday.sessionPhase}`);
    if (idx) {
      const ch = idx.changePercent;
      p(`  IHSG        : ${idx.close?.toLocaleString('id-ID')} ${ch >= 0 ? '+' : ''}${ch?.toFixed(2)}%`);
    }
    p(`  Kuotasi     : ${Object.keys(intraday.quotes || {}).length} emiten · disegarkan ${age(intraday.generatedAt)} lalu`);
  }
  if (!meta.__error) p(`  Sesi resmi  : ${meta.latestSession}`);
  if (!daily.__error) p(`  daily.json  : ${daily.stocks?.length ?? '?'} baris`);
  p();

  // ---- penjadwal
  p('── JOB TERJADWAL ──');
  let jobs = null;
  try {
    jobs = JSON.parse(await readFile(join(ROOT, '.data', 'job-state.json'), 'utf8'));
  } catch (err) {
    p(`  job-state.json tidak terbaca: ${err.message}`);
  }
  if (jobs) {
    const hariIni = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    for (const [job, key] of Object.entries(jobs)) {
      const today = String(key).startsWith(hariIni);
      p(`  ${job.padEnd(13)} ${today ? '✔ jalan hari ini' : `terakhir ${key}`}`);
    }
  }
  p();

  // ---- kesegaran feed
  p('── KESEGARAN DATA ──');
  for (const f of ['history.json', 'quotes.json', 'ownership.json', 'announcements.json', 'macro.json', 'news.json', 'tanker.json', 'strategies.json']) {
    try {
      const st = await stat(join(DATA, f));
      const umur = Date.now() - st.mtimeMs;
      const tanda = umur < 26 * 3600e3 ? ' ' : '!';
      p(`  ${tanda} ${f.padEnd(20)} ${gap(umur).padStart(14)} lalu`);
    } catch {
      p(`  ! ${f.padEnd(20)}      TIDAK ADA`);
    }
  }
  p('  (! = lebih tua dari 26 jam)');
  p();

  // ---- berita dalam jendela
  const news = await readJson('news.json');
  p('── BERITA SELAMA ANDA PERGI ──');
  if (news.__error) {
    p(`  news.json TIDAK TERBACA: ${news.__error}`);
  } else {
    const items = (news.items || []).filter(
      (n) => n.publishedAt && (!Number.isFinite(SINCE) || Date.parse(n.publishedAt) >= SINCE)
    );
    const tagged = items.filter((n) => n.emiten?.length);
    p(`  ${items.length} berita baru · ${tagged.length} menyebut emiten IDX`);
    for (const n of tagged.slice(0, 8)) p(`   [${n.emiten.join(',')}] ${n.title.slice(0, 88)}`);
    if (!tagged.length && items.length) for (const n of items.slice(0, 5)) p(`   ${n.source}: ${n.title.slice(0, 88)}`);
  }
  p();

  // ---- papan strategi
  const strat = await readJson('strategies.json');
  p('── PAPAN STRATEGI ──');
  if (strat.__error) {
    p(`  strategies.json TIDAK TERBACA: ${strat.__error}`);
  } else {
    p(`  Dibangun    : ${age(strat.generatedAt)} lalu · ${strat.survivors} lolos dari ${strat.ruleSetsTested?.toLocaleString('id-ID')} diuji`);
    const b = strat.strategies?.[0];
    if (b) p(`  Terbaik     : WR uji ${(b.test.winRate * 100).toFixed(0)}% · expectancy ${b.test.expectancyR >= 0 ? '+' : ''}${b.test.expectancyR.toFixed(2)}R`);
  }

  console.log(out.join('\n'));
}

main().catch((e) => {
  console.error('wake-report gagal:', e.message);
  process.exit(1);
});
