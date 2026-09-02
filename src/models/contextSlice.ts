/**
 * contextSlice.ts — the filing and ownership files as they stood at a session.
 *
 * The watchlist's narrative stage reads `announcements.json` and its ownership
 * term reads `ownership.json`. Both files on disk are CURRENT, so handing them
 * unchanged to a backfill for an earlier session lets the watchlist see filings
 * that had not been published yet and a KSEI register that did not exist yet.
 * That is look-ahead in its purest form, and it would not announce itself: the
 * backfilled picks would look ordinary and score better than they had any right
 * to, in exactly the direction that makes a win rate flattering.
 *
 * These two functions cut both files back to what was actually available.
 *
 * ── WHY A DATE CUT IS ENOUGH FOR FILINGS, AND ALMOST ENOUGH FOR KSEI ──────
 *
 * IDX filings are published the day they are dated, so keeping `date <= session`
 * is exact.
 *
 * KSEI is a monthly register, and the file names it by the month's last
 * settlement date. Measured 2026-09-02: `latestMonth` 2026-08-31 with
 * `generatedAt` 2026-09-01, so the register for a month appears about a day
 * after that month ends. Keeping months strictly BEFORE the session is
 * therefore correct with a day to spare — on 2026-08-15 the newest register a
 * person could have read was July's, and that is what this returns. It is not
 * exact for the first day or two of a month, and it errs towards showing LESS
 * than was available, which is the safe direction: a backfill that under-informs
 * scores worse than the live path, and a win rate biased downwards is one you
 * can act on.
 */

import type { AnnouncementsFile } from './announcements';
import type { OwnershipFile, RawOwnershipEmiten } from './ownershipFlow';

/**
 * Filings published on or before `session`.
 *
 * `to` moves with the cut because `buildNarrativeSignals` decays each filing's
 * weight from that anchor: leaving today's date there would age every kept
 * filing by the length of the backfill window and quietly mute the whole stage.
 */
export function sliceAnnouncements(
  file: AnnouncementsFile | null,
  session: string,
): AnnouncementsFile | null {
  if (!file) return null;
  const kept = file.announcements.filter((a) => a.date <= session);
  return {
    ...file,
    to: session,
    count: kept.length,
    emitenCount: new Set(kept.map((a) => a.code)).size,
    announcements: kept,
  };
}

/**
 * Keep the first `n` comma-separated cells of a run-length encoded series.
 *
 * The encoding's rule is "an empty cell repeats the previous one", so a prefix
 * decodes identically to the prefix of the decoded whole — which is only true
 * for a PREFIX. Taking cells from the middle would silently inherit whatever
 * the missing head implied.
 */
function cutCells(csv: string, n: number): string {
  if (!csv) return csv;
  const cells = csv.split(',');
  if (cells.length <= n) return csv;
  return cells.slice(0, n).join(',');
}

function cutEmiten(e: RawOwnershipEmiten, n: number): RawOwnershipEmiten {
  const l: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.l)) l[k] = cutCells(v, n);
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.f)) f[k] = cutCells(v, n);
  return { ...e, sec: cutCells(e.sec, n), px: cutCells(e.px, n), l, f };
}

/**
 * The KSEI register as of `session`: every month that had already closed.
 *
 * Returns null when no month qualifies, rather than an empty register. The
 * watchlist already handles a missing ownership file — it drops the term and
 * says so — whereas a register with zero months is a shape nothing downstream
 * was written to expect.
 */
export function sliceOwnership(
  file: OwnershipFile | null,
  session: string,
): OwnershipFile | null {
  if (!file) return null;
  let n = 0;
  while (n < file.months.length && file.months[n] < session) n++;
  if (n === 0) return null;
  if (n === file.months.length) return file;

  const emiten: Record<string, RawOwnershipEmiten> = {};
  for (const [code, e] of Object.entries(file.emiten)) emiten[code] = cutEmiten(e, n);

  return {
    ...file,
    months: file.months.slice(0, n),
    latestMonth: file.months[n - 1],
    emiten,
  };
}
