/**
 * backfill-picks.ts — fill the pick journal backwards from stored history.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * `recordTodaysPicks` writes one session: the newest one, at post-close, on a
 * machine that has to be awake. Measured 2026-09-02, it was not: the local
 * service had been killed and `post-sesi-1` sat two sessions behind. Every
 * session missed that way is gone, and what survives is the set of days this
 * laptop happened to be running — which is not a random sample of trading days.
 * A win rate computed from it measures uptime as much as it measures the rules.
 *
 * Running the same screener and watchlist code against a database sliced to an
 * earlier session fills those gaps, and fills the months before journalling
 * existed at all. That turns "ask again in December" into a number today.
 *
 * ── WHAT MAKES A BACKFILLED ROW HONEST ────────────────────────────────────
 *
 * Three things, and all three are load-bearing:
 *
 *   1. The market database is cut to the session (`sliceMarketDatabase`), so no
 *      future bar is visible to any moving average or ATR.
 *   2. The filing and ownership files are cut too (`sliceAnnouncements`,
 *      `sliceOwnership`). Skipping this is the failure that would not announce
 *      itself: the watchlist would read filings published after the session and
 *      score picks it could not have made.
 *   3. Every row is stamped `backfilled: true`, because it is NOT the same
 *      measurement as a row recorded on the day — see below.
 *
 * ── WHAT A BACKFILLED ROW CANNOT FIX ──────────────────────────────────────
 *
 * SURVIVORSHIP. The universe is today's. An emiten that traded then and has
 * since been delisted cannot be picked, and delistings skew towards failures.
 * A win rate over backfilled sessions is therefore OPTIMISTIC, and the report
 * must keep the two populations apart rather than averaging them into one
 * headline number.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   npm run picks:backfill -- --verify          bandingkan, jangan tulis apa pun
 *   npm run picks:backfill -- --sessions 250    isi ~1 tahun ke belakang
 *   npm run picks:backfill -- --sessions 60 --dry-run
 *
 * `--verify` is the one to run first and after any change to the ranking code.
 * It proves two things and reports a third: that a slice's adjusted prices sit
 * on the same scale as its traded prices, that picks for a session do not move
 * when the future is cut away first, and — for information only — how closely
 * the reconstruction matches rows that were recorded live. See the notes above
 * `verify()` for why the third one is not allowed to fail the run.
 */

import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadChatContextFromDisk, loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { buildPicksForSession, readJournal } from '../src/server/pickRecorder';
import { sliceMarketDatabase } from '../src/data/marketSlice';
import { sliceAnnouncements, sliceOwnership } from '../src/models/contextSlice';
import type { Pick, PickFile } from '../src/models/pickJournal';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'public', 'data', 'idx');
const JOURNAL = join(ROOT, '.data', 'picks.json');

/**
 * Sessions of history a slice must have before its picks mean anything.
 *
 * The pullback rule compares against a 200-session average and the laggard rule
 * against a 60-session index window; ATR needs 14. Below 200 the long average is
 * NaN, every pullback candidate fails the gate, and the session would contribute
 * a momentum-only sample that looks like a normal day in the file. Twenty bars
 * of slack on top so the averages are settled rather than just barely defined.
 */
const MIN_HISTORY = 220;

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Fields whose disagreement means the reconstruction is wrong, not merely different. */
const COMPARED: (keyof Pick)[] = ['code', 'rank', 'entry', 'stop', 'target', 'atr14', 'score'];

function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    const scale = Math.max(Math.abs(a), Math.abs(b), 1);
    return Math.abs(a - b) / scale < 1e-9;
  }
  return a === b;
}

async function main() {
  const [db, ctx] = await Promise.all([
    loadMarketDatabaseFromDisk(DATA_DIR),
    loadChatContextFromDisk(DATA_DIR),
  ]);
  const journal = await readJournal(JOURNAL);

  console.log(
    `universe ${db.emiten.length} emiten · ${db.dates.length} sesi · ` +
      `${db.dates[0]} sampai ${db.dates[db.dates.length - 1]}`,
  );
  console.log(`jurnal saat ini: ${journal.picks.length} pick`);

  // While an intraday overlay is applied, the LAST index is never official —
  // and not only when the overlay appended a new date. `assembleMarketDatabase`
  // writes today's quote into `series[last]` either way, so when IDX has already
  // published the session the overlay OVERWRITES it with the Yahoo print. A
  // slice ending there would be labelled with an official session date while
  // carrying a different feed's numbers, which is the kind of row that looks
  // ordinary forever. One session of caution costs nothing: the daily recorder
  // covers it, and tomorrow's run backfills it from real history.
  const lastOfficial = db.live?.applied ? db.dates.length - 2 : db.dates.length - 1;
  console.log(
    `sesi resmi terakhir: ${db.dates[lastOfficial]}` +
      (db.live?.applied ? ` (overlay live ${db.dates[db.dates.length - 1]} diabaikan)` : ''),
  );
  console.log('');

  if (has('verify')) return verify(db, ctx, journal);

  const nSessions = Number(arg('sessions', '250'));
  if (!Number.isInteger(nSessions) || nSessions < 1) {
    throw new Error(`--sessions harus bilangan bulat positif, dapat ${arg('sessions')}`);
  }

  const first = Math.max(MIN_HISTORY, lastOfficial - nSessions + 1);
  const existing = new Set(journal.picks.map((p) => p.id));
  const before = existing.size;
  const fresh: Pick[] = [];
  const recordedAt = new Date().toISOString();

  console.log(
    `mengisi sesi ${db.dates[first]} .. ${db.dates[lastOfficial]} ` +
      `(${lastOfficial - first + 1} sesi, minimal ${MIN_HISTORY} bar sejarah)`,
  );

  const t0 = Date.now();
  let done = 0;
  for (let i = first; i <= lastOfficial; i++) {
    const session = db.dates[i];
    const sliced = sliceMarketDatabase(db, i);
    const picks = buildPicksForSession({
      db: sliced,
      announcements: sliceAnnouncements(ctx.announcements ?? null, session),
      ownership: sliceOwnership(ctx.ownership ?? null, session),
      session,
      final: true,
      recordedAt,
      seen: existing,
      backfilled: true,
    });
    fresh.push(...picks);
    done++;
    if (done % 25 === 0 || i === lastOfficial) {
      const rate = (Date.now() - t0) / done;
      console.log(
        `  ${done}/${lastOfficial - first + 1} sesi · ${fresh.length} pick · ` +
          `${(rate / 1000).toFixed(2)} dtk/sesi`,
      );
    }
  }

  console.log('');
  const bySource: Record<string, number> = {};
  for (const p of fresh) bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  console.log(`pick baru: ${fresh.length}`);
  for (const [k, v] of Object.entries(bySource).sort()) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`id yang sudah ada dan TIDAK disentuh: ${before}`);

  if (has('dry-run')) {
    console.log('');
    console.log('--dry-run: tidak ada yang ditulis.');
    return;
  }

  const merged: PickFile = {
    ...journal,
    startedOn: fresh.length
      ? [journal.startedOn || fresh[0].session, ...fresh.map((p) => p.session)].sort()[0]
      : journal.startedOn,
    picks: [...journal.picks, ...fresh].sort((a, b) =>
      a.session === b.session ? a.id.localeCompare(b.id) : a.session.localeCompare(b.session),
    ),
  };
  await mkdir(dirname(JOURNAL), { recursive: true });
  await writeFile(JOURNAL, JSON.stringify(merged, null, 2));
  console.log('');
  console.log(`ditulis: ${merged.picks.length} pick di ${JOURNAL}`);
}

/**
 * Three checks, and only the first two are allowed to fail the run.
 *
 * ── 1. RE-BASE ────────────────────────────────────────────────────────────
 * On the session a slice ends at, the adjusted close must equal the traded
 * close, exactly as it does on the live path's newest bar. This is what caught
 * the corporate-action bug: before `rebaseFactor` existed, NETV came out 100%
 * off and BUAH 50%, which would have put every stop and target for those names
 * on a different scale than their entry while every number stayed plausible.
 *
 * ── 2. COMPOSITION ────────────────────────────────────────────────────────
 * Picks for session i must not change when the database is first cut to some
 * later session j. If anything after i leaked into the calculation, cutting the
 * future away would move the answer. This exercises the re-basing too: any
 * corporate action between i and j is present in one path and absent in the
 * other, so the two only agree if the correction is right.
 *
 * ── 3. LIVE COMPARISON, REPORTED BUT NOT ENFORCED ─────────────────────────
 * Rows recorded live are NOT reproducible from official history, and that is a
 * property of the recorder rather than a fault here. Picks are written at
 * post-close, when IDX has not published the session yet, so the screener ranks
 * on the intraday overlay: Yahoo prices, foreign flow carried over from the
 * previous session, trade counts likewise. Measured on 2026-09-02 by rebuilding
 * that exact state, ranks reproduced 1:1 while scores moved in the fifth decimal
 * — the ordering survives, the inputs differ. So this section prints agreement
 * and does not gate the run.
 */
async function verify(
  db: Awaited<ReturnType<typeof loadMarketDatabaseFromDisk>>,
  ctx: Awaited<ReturnType<typeof loadChatContextFromDisk>>,
  journal: PickFile,
) {
  let failures = 0;

  const lastOfficial = db.live?.applied ? db.dates.length - 2 : db.dates.length - 1;

  // Spread the samples across the whole range rather than clustering at one end:
  // corporate actions are not evenly distributed, and a sample taken only from
  // recent sessions would miss most of them.
  const samples: number[] = [];
  for (let k = 0; k < 6; k++) {
    const i = Math.round(MIN_HISTORY + ((lastOfficial - MIN_HISTORY) * k) / 5);
    if (i >= MIN_HISTORY && i <= lastOfficial && !samples.includes(i)) samples.push(i);
  }

  console.log('1. RE-BASE — adjusted close harus sama dengan harga traded di sesi potong');
  for (const i of samples) {
    const sliced = sliceMarketDatabase(db, i);
    let worst = 0;
    let worstCode = '';
    let checked = 0;
    for (const [code, s] of sliced.series) {
      const a = s.close[i];
      const r = s.rawClose[i];
      if (!(a > 0) || !(r > 0)) continue;
      checked++;
      const d = Math.abs(a - r) / r;
      if (d > worst) { worst = d; worstCode = code; }
    }
    const bad = worst > 1e-9;
    if (bad) failures++;
    console.log(
      `   ${db.dates[i]} · ${checked} emiten · terburuk ${(100 * worst).toExponential(2)}%` +
        (worstCode ? ` (${worstCode})` : '') + (bad ? '  GAGAL' : '  ok'),
    );
  }

  console.log('');
  console.log('2. KOMPOSISI — pick sesi i tidak boleh berubah kalau masa depan dipotong dulu');
  for (const i of samples.slice(0, 4)) {
    const session = db.dates[i];
    const j = Math.min(lastOfficial, i + 40);
    if (j <= i) continue;

    const ann = sliceAnnouncements(ctx.announcements ?? null, session);
    const own = sliceOwnership(ctx.ownership ?? null, session);
    const build = (base: typeof db) =>
      buildPicksForSession({
        db: sliceMarketDatabase(base, i),
        announcements: ann,
        ownership: own,
        session,
        final: true,
        recordedAt: 'verify',
        seen: new Set(),
      });

    const direct = build(db);
    const viaJ = build(sliceMarketDatabase(db, j));

    let diff = 0;
    const byId = new Map(viaJ.map((p) => [p.id, p]));
    for (const p of direct) {
      const q = byId.get(p.id);
      if (!q) { diff++; continue; }
      byId.delete(p.id);
      if (COMPARED.some((k) => !near(p[k], q[k]))) diff++;
    }
    diff += byId.size;
    if (diff) failures++;
    console.log(
      `   ${session} (lewat ${db.dates[j]}) · ${direct.length} pick · beda ${diff}` +
        (diff ? '  GAGAL' : '  ok'),
    );
  }

  console.log('');
  console.log('3. BANDING CATATAN LIVE — informasi saja, tidak menggagalkan');
  const live = journal.picks.filter((p) => !p.backfilled && p.entryIsFinalClose);
  if (!live.length) {
    console.log('   belum ada pick yang direkam live');
  } else {
    const sessions = [...new Set(live.map((p) => p.session))].sort();
    let same = 0;
    let rankSame = 0;
    let absent = 0;
    for (const session of sessions) {
      const i = db.dates.indexOf(session);
      if (i < 0) continue;
      const rebuilt = buildPicksForSession({
        db: sliceMarketDatabase(db, i),
        announcements: sliceAnnouncements(ctx.announcements ?? null, session),
        ownership: sliceOwnership(ctx.ownership ?? null, session),
        session,
        final: true,
        recordedAt: 'verify',
        seen: new Set(),
      });
      const byId = new Map(rebuilt.map((p) => [p.id, p]));
      for (const p of live.filter((x) => x.session === session)) {
        const r = byId.get(p.id);
        if (!r) { absent++; continue; }
        if (COMPARED.every((k) => near(p[k], r[k]))) same++;
        else if (r.rank === p.rank) rankSame++;
      }
    }
    console.log(`   ${live.length} pick live pada ${sessions.length} sesi`);
    console.log(`   identik            : ${same}`);
    console.log(`   peringkat sama saja: ${rankSame}`);
    console.log(`   tidak muncul lagi  : ${absent}`);
    console.log('   (selisih di sini wajar — lihat catatan 3 di atas fungsi ini)');
  }

  console.log('');
  if (failures) {
    console.log(`GAGAL — ${failures} pemeriksaan wajib tidak lulus. Jangan pakai backfill sampai nol.`);
    process.exitCode = 1;
  } else {
    console.log('LULUS — potongan tidak menengok ke depan dan skala harganya benar.');
  }
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
