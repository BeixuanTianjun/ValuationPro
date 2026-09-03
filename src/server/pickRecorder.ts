// Records what the screens said today, so the win rate can be measured later.
//
// ── WHY THE SCHEDULER OWNS THIS AND NOT THE UI ────────────────────────────
//
// The obvious place to record a pick is the moment somebody looks at it. That
// would make the journal a record of ATTENTION rather than of the screen's
// output: days nobody opened the terminal would vanish, and the sample would be
// biased toward the days the market was interesting enough to check. A win rate
// computed on that is a measurement of the owner's browsing habits.
//
// So the scheduler records every session at the same point in the day, whether
// or not anyone is watching, and takes the top of each list exactly as the
// screen ranks it.
//
// ── WHY POST-CLOSE, AND WHY IT REFUSES TO RUN MID-SESSION ─────────────────
//
// Entry has to be a price that actually printed and that everyone can agree on
// afterwards. An intraday price is real but it is a moving target: the same
// pick recorded at 09:30 and at 14:00 gets two different entries, two different
// ATR stops and eventually two different verdicts, and nothing in the file
// would say which one the measurement used. So a session whose market state is
// still REGULAR is refused, and `--force` exists only for testing — anything it
// writes is stamped `entryIsFinalClose: false` so it can be excluded rather
// than silently mixed into the numbers.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { computeAllFactors } from '../models/factorEngine';
import { runStockScreener, convictionScore, ScreenerMode } from '../models/stockScreener';
import { buildWatchlist, Horizon } from '../models/watchlist';
import { buildEventRadar } from '../models/eventRadar';
import { Pick, PickFile, PickSource, RULES_VERSION, levelsFor } from '../models/pickJournal';
import type { AnnouncementsFile } from '../models/announcements';
import type { OwnershipFile } from '../models/ownershipFlow';
import type { MarketDatabase } from '../data/marketRepository';
import { loadChatContextFromDisk, loadMarketDatabaseFromDisk } from './marketFromDisk';

/**
 * How many names per list are recorded.
 *
 * Ten, not five, and not all of them. Five is what the screen shows by default,
 * but a win rate measured on five names a day is measuring the very top of the
 * ranking and would take a year to say anything. Recording every passing emiten
 * — 227 on a good day for momentum alone — would measure the RULE, which the
 * strategy lab already does far better with two years of history. Ten is the
 * band a person actually reads down to.
 */
const TOP_N = 10;

export interface RecordResult {
  session: string;
  marketState: string;
  final: boolean;
  added: number;
  skippedExisting: number;
  total: number;
  bySource: Record<string, number>;
  note: string;
}

/**
 * Build one session's picks.
 *
 * Extracted so the daily recorder and the historical backfill run the SAME
 * ranking code. If each had its own copy, comparing a backfilled row against
 * the row recorded live for that session would prove nothing — the comparison
 * only means something while there is one implementation to disagree with.
 */
export interface BuildPicksInput {
  db: MarketDatabase;
  /** Already cut to the session for a backfill; today's file for a live run. */
  announcements: AnnouncementsFile | null;
  ownership: OwnershipFile | null;
  session: string;
  final: boolean;
  recordedAt: string;
  /** Ids already in the journal. Anything listed here is left alone. */
  seen: Set<string>;
  /** Stamped onto every row so the two kinds never merge silently. */
  backfilled?: boolean;
}

export function buildPicksForSession(input: BuildPicksInput): Pick[] {
  const { db, announcements, ownership, session, final, recordedAt, seen, backfilled } = input;
  const factors = computeAllFactors(db);
  const fresh: Pick[] = [];

  const push = (source: PickSource, rank: number, code: string, score: number, readings: Partial<Pick>) => {
    const id = `${session}:${source}:${code}`;
    if (seen.has(id)) return;
    const e = db.byCode.get(code);
    const quote = db.daily.get(code);
    const atr14 = factors.get(code)?.atr14 ?? NaN;
    const entry = quote?.close ?? NaN;
    const levels = levelsFor(entry, atr14);
    // No ATR means no mechanical stop, and without a stop there is no R and
    // nothing to grade. Skipped rather than graded on an invented level.
    if (!e || !levels) return;
    seen.add(id);
    fresh.push({
      id,
      recordedAt,
      session,
      source,
      code,
      name: e.name,
      sector: e.sector,
      rank,
      score,
      entry,
      stop: levels.stop,
      target: levels.target,
      atr14,
      runupFromLow: NaN,
      extensionAtr: NaN,
      gapToIndexPp: NaN,
      dipFromHigh: NaN,
      entryIsFinalClose: final,
      rulesVersion: RULES_VERSION,
      ...(backfilled ? { backfilled: true } : {}),
      ...readings,
    });
  };

  for (const mode of ['momentum', 'pullback', 'laggard'] as ScreenerMode[]) {
    const screen = runStockScreener(db, { mode });
    const ranked = screen.rows
      .map((r) => ({ r, c: convictionScore(r, factors.get(r.code), mode) }))
      .sort((a, b) => b.c - a.c)
      .slice(0, TOP_N);
    ranked.forEach(({ r, c }, i) =>
      push(`screener:${mode}` as PickSource, i + 1, r.code, c, {
        runupFromLow: r.runupFromLow,
        extensionAtr: r.extensionAtr,
        gapToIndexPp: r.gapToIndexPp,
        dipFromHigh: r.dipFromHigh,
      })
    );
  }

  for (const horizon of ['mingguan', 'bulanan'] as Horizon[]) {
    const wl = buildWatchlist({
      db,
      factors,
      announcements,
      ownership,
      horizon,
      limit: TOP_N,
    });
    wl.candidates.slice(0, TOP_N).forEach((c, i) =>
      push(`watchlist:${horizon}` as PickSource, i + 1, c.code, c.score, {
        runupFromLow: c.priceAction.screener?.runupFromLow ?? NaN,
        extensionAtr: c.priceAction.screener?.extensionAtr ?? NaN,
        gapToIndexPp: c.priceAction.gapToIndexPp,
        dipFromHigh: c.priceAction.dipFromHigh,
      })
    );
  }

  // RADAR PERISTIWA.
  //
  // Dicatat dengan aturan penilaian yang PERSIS SAMA seperti sumber lain —
  // entry penutupan sesi, stop dan target 1,5x/2,5x ATR14 — meski logika
  // pemilihannya sama sekali berbeda. Itu disengaja: satu-satunya cara
  // menjawab "apakah radar ini lebih baik daripada screener" adalah kalau
  // keduanya dinilai dengan penggaris yang sama.
  //
  // Dan ia dicatat sejak baris pertamanya, sebelum ada alasan untuk percaya ia
  // bekerja. Layar yang baru mulai dinilai setelah pemiliknya menyukai
  // hasilnya tidak akan pernah punya rekam jejak yang bisa dipercaya.
  //
  // `announcements` di sini sudah dipotong ke sesi yang bersangkutan pada
  // backfill (lihat BuildPicksInput), jadi radar tidak bisa melihat pengajuan
  // yang belum terbit pada hari itu.
  {
    const radar = buildEventRadar(db, announcements);
    radar.rows.slice(0, TOP_N).forEach((r, i) =>
      push('radar:peristiwa', i + 1, r.code, r.score, {
        runupFromLow: r.runup60,
      })
    );
  }

  return fresh;
}

export async function recordTodaysPicks(
  dataDir: string,
  journalPath: string,
  opts: { force?: boolean } = {}
): Promise<RecordResult> {
  const [db, ctx] = await Promise.all([loadMarketDatabaseFromDisk(dataDir), loadChatContextFromDisk(dataDir)]);

  const session = db.meta.latestSession;
  const marketState = db.live?.marketState ?? 'UNKNOWN';
  // REGULAR means the session is still trading, so its close does not exist yet.
  const final = !db.live?.applied || marketState !== 'REGULAR';

  const existing = await readJournal(journalPath);

  // A PROVISIONAL row must not block the real one.
  //
  // The id is `session:source:code`, so a `--force` run during the session
  // claims every id that the post-close run would later want to write, and the
  // day's actual closing picks would be silently skipped as duplicates — the
  // journal would end up holding intraday guesses for that whole session and
  // nothing would say so. Anything stamped non-final for THIS session is
  // therefore dropped the moment a final record is made. That is not rewriting
  // history: a non-final row was explicitly marked provisional when it was
  // written, and this is the promise being kept.
  const superseded = final ? existing.picks.filter((p) => p.session === session && !p.entryIsFinalClose).length : 0;
  const kept = final
    ? existing.picks.filter((p) => !(p.session === session && !p.entryIsFinalClose))
    : existing.picks;
  const seen = new Set(kept.map((p) => p.id));

  if (!final && !opts.force) {
    return {
      session,
      marketState,
      final,
      added: 0,
      skippedExisting: 0,
      total: existing.picks.length,
      bySource: {},
      note: `sesi ${session} masih berjalan (${marketState}) — pencatatan menunggu penutupan`,
    };
  }

  const fresh = buildPicksForSession({
    db,
    announcements: ctx.announcements ?? null,
    ownership: ctx.ownership ?? null,
    session,
    final,
    recordedAt: new Date().toISOString(),
    seen,
  });

  const bySource: Record<string, number> = {};
  for (const p of fresh) bySource[p.source] = (bySource[p.source] ?? 0) + 1;

  const merged: PickFile = {
    version: 1,
    startedOn: existing.startedOn || session,
    note: existing.note,
    // Append-only. A pick is never rewritten once recorded, because the whole
    // value of the file is that it was written BEFORE the outcome was known.
    picks: [...kept, ...fresh],
  };
  await mkdir(dirname(journalPath), { recursive: true });
  await writeFile(journalPath, JSON.stringify(merged, null, 2));

  return {
    session,
    marketState,
    final,
    added: fresh.length,
    skippedExisting: TOP_N * 5 - fresh.length,
    total: merged.picks.length,
    bySource,
    note:
      (fresh.length
        ? `${fresh.length} pick dicatat untuk sesi ${session}`
        : `tidak ada pick baru untuk sesi ${session} (sudah tercatat sebelumnya)`) +
      (superseded ? `; ${superseded} catatan sementara sesi ini digantikan oleh harga penutupan` : ''),
  };
}

const EMPTY: PickFile = {
  version: 1,
  startedOn: '',
  note:
    'Catatan pick harian dari layar Screener, Watchlist dan Radar Peristiwa. Ditulis SEBELUM hasilnya diketahui; tidak pernah disunting ulang. Entry = penutupan sesi yang tercatat, stop/target = 1,5x/2,5x ATR14 seperti yang dicetak layar — penggaris yang sama untuk ketiganya, supaya ketiganya bisa dibandingkan.',
  picks: [],
};

export async function readJournal(path: string): Promise<PickFile> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as PickFile;
    if (!Array.isArray(parsed?.picks)) throw new Error('bentuk berkas tidak dikenali');
    return { ...EMPTY, ...parsed };
  } catch (err) {
    // An UNREADABLE file is not an empty one. gdelt.json lost 45 days of
    // history to exactly this confusion (see HANDOVER): a parse failure was
    // swallowed as `null`, the next run treated it as "nothing recorded yet"
    // and overwrote everything. Here a corrupt file surfaces as an empty
    // journal only when it genuinely does not exist.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { ...EMPTY };
    throw new Error(`Jurnal pick ada tapi tidak terbaca (${(err as Error).message}) — dihentikan supaya tidak menimpa riwayat`);
  }
}

export const journalPathFor = (root: string) => join(root, '.data', 'picks.json');
