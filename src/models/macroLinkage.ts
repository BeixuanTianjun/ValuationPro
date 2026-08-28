// Which outside-world price actually moves an Indonesian sector, measured.
//
// WHY THIS FILE IS THE POINT OF THE MACRO LAYER. Pulling coal, the rupiah and
// the US ten-year into the database is easy and, on its own, useless: it adds a
// second dashboard to glance at. Everyone already "knows" coal drives coal
// miners. What nobody has is the number — and the number is frequently not what
// the story says. A driver that everybody repeats and measures at 0.05 is worth
// more than a driver nobody questioned, because it tells you the story is doing
// no work.
//
// So every instrument in macro.json is regressed against every IDX-IC sector
// index and, on request, against a single emiten. The output carries the
// correlation, the beta, the R², and the sample size, and the UI prints all four
// — the same standard the rest of this app holds itself to.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO.
//
// It does not claim causation. A correlation between the Hang Seng and IDX
// Energy is compatible with China buying coal, with both being risk assets, and
// with coincidence. The screen says "bergerak bersama", never "menggerakkan".
//
// It does not rank on correlation alone. |r| = 0.9 over eleven overlapping
// observations is noise; the minimum sample gate is what stops the thin coal
// series from topping every table.
//
// It does not fill gaps with zeros. A session where either side has no
// observation is dropped from the pair, not counted as "no change" — treating a
// public holiday as a flat day drags every correlation toward zero and makes
// the whole table look weaker than it is.

import { MarketDatabase } from '../data/marketRepository';
import { SECTOR_TO_INDEX } from '../data/idxIndexCatalog';

export type MacroClass = 'kurs' | 'energi' | 'logam' | 'indeks-global' | 'suku-bunga' | 'kripto';

export interface MacroInstrumentRaw {
  id: string;
  symbol: string;
  name: string;
  klass: MacroClass;
  unit: string;
  why: string;
  /** Sectors the curator expects this to drive. A hypothesis, never a finding. */
  linksTo: string[];
  /**
   * True when this market closes AFTER Jakarta does (09:00 UTC).
   *
   * Decides the alignment, and it is not cosmetic. Pairing Jakarta's Tuesday
   * with New York's Tuesday regresses the IDX session against a print that
   * lands hours after it closed — information Jakarta could not have had.
   * Those instruments are shifted one session, so the pairing is Jakarta today
   * against their close yesterday.
   */
  after: boolean;
  currency: string;
  covered: number;
  coverage: number;
  firstSession: string | null;
  /** Comma-joined closes on the IDX session grid; empty string = no value yet. */
  c: string;
}

export interface MacroFile {
  generatedAt: string;
  range: string;
  sessions: number;
  /** Session dates this file was aligned to. Present since the re-align fix. */
  dates?: string[];
  from: string;
  to: string;
  source: string;
  scope: string;
  absent: { name: string; why: string }[];
  failed: { id: string; symbol: string; why: string }[];
  instruments: MacroInstrumentRaw[];
}

export interface MacroInstrument extends Omit<MacroInstrumentRaw, 'c'> {
  closes: Float64Array;
  /** Latest value, and the moves the header prints. */
  last: number;
  change1d: number;
  change1m: number;
  change3m: number;
}

/** One measured relationship. */
export interface Linkage {
  instrumentId: string;
  /** Sector name, or an emiten code. */
  target: string;
  /** Pearson correlation of daily log returns, -1..1. */
  correlation: number;
  /** Slope: how far the target moves for a 1% move in the instrument. */
  beta: number;
  /** Share of the target's daily variance this instrument tracks, 0..1. */
  r2: number;
  /** Overlapping sessions both sides actually traded. */
  n: number;
  /**
   * The same correlation over the last RECENT_WINDOW sessions only.
   *
   * A relationship is not a constant. Coal can be irrelevant to a miner for a
   * year and then be the only thing that matters for a quarter, and a full-window
   * number averages that away into "no link". NaN when the recent window has too
   * few overlapping observations to measure — never 0, which would read as
   * "measured, and unrelated".
   */
  correlationRecent: number;
  /** True when the curator expected this pair to be linked. */
  expected: boolean;
}

export interface MacroLinkageResult {
  file: MacroFile;
  instruments: MacroInstrument[];
  /** Sector name -> its drivers, strongest absolute correlation first. */
  bySector: Map<string, Linkage[]>;
  /** Sessions the whole grid spans. */
  sessions: string[];
  /** Pairs that failed the sample gate, so the UI can say how many were dropped. */
  droppedThin: number;
}

/**
 * Below this many overlapping sessions a correlation is not reported at all.
 *
 * Sixty daily observations is about three trading months. It is not a
 * significance test; it is the point below which the coal series — 127 sessions
 * of coverage against 282 — stops producing spurious 0.9s that outrank
 * instruments with four times the data.
 */
export const MIN_SAMPLE = 60;

/**
 * How far back `correlationRecent` looks, in sessions.
 *
 * NINETY, NOT SIXTY, AND THE GAP IS THE WHOLE POINT. This is a LOOKBACK, while
 * MIN_SAMPLE is a requirement on observations that survive inside it. Setting
 * the two equal looks tidy and breaks the column: a 60-session window holds at
 * most 60 pairs, so a single public holiday on either side drops it to 59 and
 * the measurement returns null. The recent column then read "n/a" for rows with
 * 281 observations, which looks like missing data rather than a boundary the
 * code drew on itself. Ninety sessions leaves room for the holidays on both
 * calendars and still describes roughly the last four months.
 */
export const RECENT_WINDOW = 90;

/** Correlations under this are shown but never described as a relationship. */
export const WEAK_BELOW = 0.25;

/**
 * Project a stored series onto the CURRENT session grid, matched by date.
 *
 * WHY NOT JUST INDEX INTO IT. The obvious version — decode the CSV and read
 * position i — is what shipped first, and it broke within a day. macro.json is
 * aligned to the session grid at ingest time; history.json gains a row on every
 * refresh. The moment the two disagree on length, every value is off by the
 * difference and the newest slot is NaN, so `last` reads NaN while every earlier
 * number quietly describes the wrong day. Nothing throws.
 *
 * Matching on the date string cannot drift. Sessions the macro file has never
 * seen carry the last known value forward, which is what a screen showing
 * yesterday's coal print should do; sessions before its first observation stay
 * NaN, which is what "we have no data yet" should look like.
 */
const project = (csv: string, storedDates: string[] | undefined, grid: string[]): Float64Array => {
  const out = new Float64Array(grid.length).fill(NaN);
  if (!csv) return out;
  const parts = csv.split(',');

  // Files written before `dates` existed can only be read positionally. Doing so
  // for the overlapping prefix is still better than dropping the file entirely,
  // and re-running the ingest fixes it permanently.
  if (!storedDates || !storedDates.length) {
    for (let i = 0; i < grid.length && i < parts.length; i++) {
      const n = Number(parts[i]);
      if (parts[i] !== '' && Number.isFinite(n)) out[i] = n;
    }
    return out;
  }

  const byDate = new Map<string, number>();
  for (let i = 0; i < storedDates.length && i < parts.length; i++) {
    if (parts[i] === '') continue;
    const n = Number(parts[i]);
    if (Number.isFinite(n)) byDate.set(storedDates[i], n);
  }

  let last = NaN;
  for (let i = 0; i < grid.length; i++) {
    const v = byDate.get(grid[i]);
    if (v !== undefined) last = v;
    out[i] = last;
  }
  return out;
};

/** Daily log returns; NaN wherever either endpoint is missing. */
function logReturns(src: Float64Array): Float64Array {
  const out = new Float64Array(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1];
    const b = src[i];
    if (a > 0 && b > 0) out[i] = Math.log(b / a);
  }
  return out;
}

/**
 * Shift a return series forward one session.
 *
 * After this, index i holds the return that was PRINTED on session i-1 — which
 * is the last value a Jakarta trader could actually have seen when session i
 * opened. Applied to every instrument whose market closes after Jakarta.
 */
function lagOne(src: Float64Array): Float64Array {
  const out = new Float64Array(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) out[i] = src[i - 1];
  return out;
}

/** Returns aligned to what Jakarta could see during its own session. */
function alignedReturns(inst: { closes: Float64Array; after: boolean }): Float64Array {
  const r = logReturns(inst.closes);
  return inst.after ? lagOne(r) : r;
}

const pctBetween = (s: Float64Array, back: number): number => {
  const n = s.length;
  const now = s[n - 1];
  const then = s[Math.max(0, n - 1 - back)];
  return Number.isFinite(now) && Number.isFinite(then) && then !== 0 ? now / then - 1 : NaN;
};

/**
 * Correlation, beta and R² over the sessions where BOTH sides traded.
 *
 * Returns null rather than a number when the overlap is too thin — a caller
 * that gets null must show nothing, not a zero.
 */
function measure(
  a: Float64Array,
  b: Float64Array,
  fromIndex = 0
): { correlation: number; beta: number; r2: number; n: number } | null {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = fromIndex; i < a.length && i < b.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  if (n < MIN_SAMPLE) return null;
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = fromIndex; i < a.length && i < b.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return null;
  const correlation = cov / Math.sqrt(va * vb);
  // beta = how far the TARGET (b) moves per unit move of the INSTRUMENT (a).
  const beta = cov / va;
  return { correlation, beta, r2: correlation * correlation, n };
}

/** Returns of one IDX index code on the session grid, or null when absent. */
function indexReturns(db: MarketDatabase, code: string): Float64Array | null {
  const s = db.indexSeries.get(code);
  return s ? logReturns(s.close) : null;
}

/** Returns of one emiten on the session grid. */
function emitenReturns(db: MarketDatabase, code: string): Float64Array | null {
  const s = db.series.get(code);
  return s ? logReturns(s.close) : null;
}

export function buildMacroLinkage(file: MacroFile, db: MarketDatabase): MacroLinkageResult {
  const n = db.dates.length;

  const instruments: MacroInstrument[] = file.instruments.map((raw) => {
    const closes = project(raw.c, file.dates, db.dates);
    return {
      ...raw,
      closes,
      last: closes[n - 1],
      change1d: pctBetween(closes, 1),
      change1m: pctBetween(closes, 21),
      change3m: pctBetween(closes, 63),
    };
  });

  const returnsById = new Map<string, Float64Array>();
  for (const inst of instruments) returnsById.set(inst.id, alignedReturns(inst));

  const bySector = new Map<string, Linkage[]>();
  let droppedThin = 0;

  // COMPOSITE is treated as a sector row so the table has a market-wide line to
  // read every other row against. A driver that correlates 0.6 with a sector and
  // 0.6 with the whole index is not a sector story.
  const targets: { key: string; returns: Float64Array | null }[] = [
    { key: 'IHSG', returns: indexReturns(db, 'COMPOSITE') },
    ...Object.entries(SECTOR_TO_INDEX).map(([sector, indexCode]) => ({
      key: sector,
      returns: indexReturns(db, indexCode),
    })),
  ];

  for (const t of targets) {
    if (!t.returns) continue;
    const links: Linkage[] = [];
    for (const inst of instruments) {
      const m = measure(returnsById.get(inst.id)!, t.returns);
      if (!m) {
        droppedThin++;
        continue;
      }
      const recent = measure(returnsById.get(inst.id)!, t.returns, Math.max(0, n - RECENT_WINDOW));
      links.push({
        instrumentId: inst.id,
        target: t.key,
        correlation: m.correlation,
        beta: m.beta,
        r2: m.r2,
        n: m.n,
        correlationRecent: recent ? recent.correlation : NaN,
        expected: inst.linksTo.includes(t.key),
      });
    }
    links.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));
    bySector.set(t.key, links);
  }

  return { file, instruments, bySector, sessions: db.dates, droppedThin };
}

/**
 * The same measurement for one emiten.
 *
 * Separate from the sector pass because it is per-request: running 962 emiten
 * against 29 instruments on every render is 28,000 regressions nobody asked for.
 */
export function linkagesForEmiten(
  result: MacroLinkageResult,
  db: MarketDatabase,
  code: string,
  limit = 6
): Linkage[] {
  const target = emitenReturns(db, code.toUpperCase());
  if (!target) return [];
  const emiten = db.byCode.get(code.toUpperCase());
  const out: Linkage[] = [];
  for (const inst of result.instruments) {
    const aligned = alignedReturns(inst);
    const m = measure(aligned, target);
    if (!m) continue;
    const recent = measure(aligned, target, Math.max(0, target.length - RECENT_WINDOW));
    out.push({
      instrumentId: inst.id,
      target: code.toUpperCase(),
      correlation: m.correlation,
      beta: m.beta,
      r2: m.r2,
      n: m.n,
      correlationRecent: recent ? recent.correlation : NaN,
      expected: !!emiten && inst.linksTo.includes(emiten.sector),
    });
  }
  out.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return out.slice(0, limit);
}

/**
 * Where the curated expectation and the measurement disagree.
 *
 * This is the most useful thing the table produces and the reason `linksTo`
 * exists at all. Two kinds of surprise:
 *   - `mati`  — expected to be linked, measures below WEAK_BELOW. The story is
 *               doing no work in this window.
 *   - `hidup` — nobody expected it, measures strongly. Worth explaining.
 */
export interface Surprise {
  kind: 'mati' | 'hidup';
  link: Linkage;
}

export function findSurprises(result: MacroLinkageResult, strongAbove = 0.45): Surprise[] {
  const out: Surprise[] = [];
  for (const links of result.bySector.values()) {
    for (const l of links) {
      const abs = Math.abs(l.correlation);
      if (l.expected && abs < WEAK_BELOW) out.push({ kind: 'mati', link: l });
      else if (!l.expected && abs >= strongAbove && l.target !== 'IHSG') out.push({ kind: 'hidup', link: l });
    }
  }
  out.sort((a, b) => Math.abs(b.link.correlation) - Math.abs(a.link.correlation));
  return out;
}
