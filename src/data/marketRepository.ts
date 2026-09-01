// Loads the bundled IDX market database (public/data/idx/*.json) and decodes
// the compact wire format into typed arrays the factor engine can chew through.
//
// Assembly is deliberately split from fetching so the same code path builds the
// database in the browser and in the Node scheduler that emails the daily picks
// — the screener must not be able to disagree with itself across the two.

import {
  DailyFile,
  DailyQuote,
  Emiten,
  HistoryFile,
  IndicesFile,
  IntradayFile,
  MarketBreadth,
  MarketMeta,
  PriceSeries,
  UniverseFile,
} from '../types/market';

// `import.meta.env` only exists under Vite; the Node bundle falls back to root.
const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
const DATA_BASE = `${BASE_URL}data/idx`.replace(/\/{2,}/g, '/');

export interface IndexSeries {
  code: string;
  members: number;
  close: Float64Array;
  value: Float64Array;
  marketCap: Float64Array;
}

export interface LiveStatus {
  /** True when an intraday snapshot was folded into the history. */
  applied: boolean;
  tradingDate: string;
  marketState: string;
  sessionPhase: string;
  generatedAt: string;
  /** Set when the live session is newer than the last IDX end-of-day session. */
  appendedNewSession: boolean;
  /** Last session for which IDX published foreign buy/sell volume. */
  foreignFlowAsOf: string;
  /** True when prices were quoted on request rather than read from a snapshot. */
  onDemand?: boolean;
}

export interface MarketDatabase {
  meta: MarketMeta;
  emiten: Emiten[];
  byCode: Map<string, Emiten>;
  daily: Map<string, DailyQuote>;
  dates: string[];
  series: Map<string, PriceSeries>;
  indexDates: string[];
  indexSeries: Map<string, IndexSeries>;
  sectors: string[];
  boards: string[];
  live: LiveStatus | null;
}

/** "9800,,9725" -> Float64Array[9800, NaN, 9725]. Blank means "did not trade". */
function decodeSeries(csv: string, expected: number): Float64Array {
  const out = new Float64Array(expected).fill(NaN);
  if (!csv) return out;
  let idx = 0;
  let start = 0;
  const len = csv.length;
  for (let i = 0; i <= len; i++) {
    if (i === len || csv.charCodeAt(i) === 44 /* , */) {
      if (idx >= expected) break;
      if (i > start) out[idx] = +csv.slice(start, i);
      idx++;
      start = i + 1;
    }
  }
  return out;
}

/**
 * Back-adjust a price series for corporate actions.
 *
 * A factor at position i applies to every session BEFORE i, so the cumulative
 * multiplier is built by walking backwards from the most recent session. A 1:25
 * split (factor 0.04) scales the whole pre-split history down by 25x, turning
 * what would look like a 96% crash into the flat line it actually was.
 *
 * Returns the number of adjustments applied so the UI can disclose it.
 */
function applyAdjustments(
  factors: Float64Array,
  targets: Float64Array[]
): number {
  let cumulative = 1;
  let applied = 0;
  for (let i = factors.length - 1; i >= 0; i--) {
    const f = factors[i];
    if (Number.isFinite(f) && f > 0 && Math.abs(f - 1) > 1e-9) {
      // Sessions strictly before i are the ones that need rescaling, so the
      // multiplier changes as we step past this session, not at it.
      cumulative *= f;
      applied++;
    }
    if (cumulative !== 1 && i > 0) {
      for (const t of targets) {
        if (Number.isFinite(t[i - 1])) t[i - 1] *= cumulative;
      }
    }
  }
  return applied;
}

/** Grow a typed array by one slot, seeding the new slot with NaN. */
function extend(arr: Float64Array): Float64Array {
  const out = new Float64Array(arr.length + 1);
  out.set(arr);
  out[arr.length] = NaN;
  return out;
}

export interface RawFiles {
  meta: MarketMeta;
  universe: UniverseFile;
  daily: DailyFile;
  history: HistoryFile;
  indices: IndicesFile;
  intraday?: IntradayFile | null;
}

/**
 * Build the in-memory database from already-parsed JSON.
 *
 * When an intraday snapshot is supplied it is folded into the price history so
 * every momentum, trend and volatility factor sees today's price. Foreign flow
 * is left as NaN for the live session: IDX publishes buy/sell volume only at
 * end of day, so pretending it is zero would quietly bias the flow factors.
 */
export function assembleMarketDatabase(files: RawFiles): MarketDatabase {
  const { meta, universe, daily, history, indices, intraday } = files;

  const byCode = new Map<string, Emiten>();
  for (const e of universe.emiten) byCode.set(e.code, e);

  const dailyMap = new Map<string, DailyQuote>();
  for (const q of daily.stocks) dailyMap.set(q.code, q);

  const dates = [...history.dates];
  const n = dates.length;
  const series = new Map<string, PriceSeries>();
  for (const [code, raw] of Object.entries(history.series)) {
    const rawClose = decodeSeries(raw.c, n);
    const close = Float64Array.from(rawClose);
    const high = decodeSeries(raw.h, n);
    const low = decodeSeries(raw.l, n);

    let adjustments = 0;
    if (raw.adj) {
      adjustments = applyAdjustments(decodeSeries(raw.adj, n), [close, high, low]);
    }

    series.set(code, {
      code,
      close,
      high,
      low,
      volume: decodeSeries(raw.v, n),
      value: decodeSeries(raw.t, n),
      foreignNet: decodeSeries(raw.fn, n),
      freq: decodeSeries(raw.f || '', n),
      rawClose,
      adjustments,
    });
  }

  let live: LiveStatus | null = null;

  if (intraday && intraday.quotes && Object.keys(intraday.quotes).length) {
    const lastEod = dates[dates.length - 1] || '';
    const appendNew = intraday.tradingDate > lastEod;

    if (appendNew) {
      dates.push(intraday.tradingDate);
      for (const s of series.values()) {
        s.close = extend(s.close);
        s.rawClose = extend(s.rawClose);
        s.high = extend(s.high);
        s.low = extend(s.low);
        s.volume = extend(s.volume);
        s.value = extend(s.value);
        s.foreignNet = extend(s.foreignNet);
        s.freq = extend(s.freq);
      }
    }

    const i = dates.length - 1;
    for (const [code, q] of Object.entries(intraday.quotes)) {
      if (!q || !(q.price > 0)) continue;
      const s = series.get(code);
      if (s) {
        // Today's quote is post-adjustment by definition, so it lands in both
        // the adjusted and the raw view untouched.
        s.close[i] = q.price;
        s.rawClose[i] = q.price;
        s.high[i] = q.high || q.price;
        s.low[i] = q.low || q.price;
        s.volume[i] = q.volume ? Math.round(q.volume / 100) : NaN; // lots
        s.value[i] = q.volume ? Math.round((q.volume * q.price) / 1e6) : NaN; // IDR mn
        // foreignNet and freq intentionally left as-is (NaN on an appended
        // session) — the intraday feed does not carry either.
      }

      const prior = dailyMap.get(code);
      const listedShares = prior?.listedShares || byCode.get(code)?.listedShares || 0;
      dailyMap.set(code, {
        code,
        open: q.open || q.price,
        high: q.high || q.price,
        low: q.low || q.price,
        close: q.price,
        prev: q.prevClose || prior?.prev || q.price,
        change: Number.isFinite(q.changePercent as number) ? (q.changePercent as number) : 0,
        volume: q.volume || 0,
        value: (q.volume || 0) * q.price,
        freq: prior?.freq || 0,
        // Carried from the last IDX session, never invented for the live one.
        // Zeroing it would read as "no foreign activity today" when the truth is
        // "IDX has not published today's figure yet" — the UI labels which
        // session this belongs to instead.
        foreignNet: prior?.foreignNet || 0,
        listedShares,
        indexShares: prior?.indexShares || 0,
        marketCap: listedShares * q.price,
      });
    }

    live = {
      applied: true,
      tradingDate: intraday.tradingDate,
      marketState: intraday.marketState,
      sessionPhase: intraday.sessionPhase,
      generatedAt: intraday.generatedAt,
      appendedNewSession: appendNew,
      foreignFlowAsOf: meta.latestSession,
      // Quoted on request, versus read from the last committed snapshot.
      onDemand: intraday.onDemand === true,
    };
  }

  const indexDates = [...indices.dates];
  const liveIndexQuotes = intraday?.indices || {};
  // Only append a live index session when the live stock session is newer AND
  // an index quote actually exists for it — an empty appended slot would read
  // as "the index did not trade today", which is worse than a two-day lag.
  const appendIndexSession =
    live?.appendedNewSession === true &&
    Object.keys(liveIndexQuotes).length > 0 &&
    (indexDates[indexDates.length - 1] || '') < (intraday?.tradingDate || '');
  if (appendIndexSession && intraday) indexDates.push(intraday.tradingDate);

  const m = indexDates.length;
  const indexSeries = new Map<string, IndexSeries>();
  for (const [code, raw] of Object.entries(indices.indices)) {
    const close = decodeSeries(raw.c, m);
    const value = decodeSeries(raw.t, m);
    const marketCap = decodeSeries(raw.mc, m);

    const liveQuote = liveIndexQuotes[code];
    if (liveQuote && liveQuote.close > 0) {
      // Carry the last official close forward into the appended slot so a
      // sector index without a live quote does not read as a gap.
      close[m - 1] = liveQuote.close;
    } else if (appendIndexSession) {
      close[m - 1] = close[m - 2];
    }

    indexSeries.set(code, { code, members: raw.members, close, value, marketCap });
  }

  const sectors = [...new Set(universe.emiten.map((e) => e.sector))].sort();
  const boards = [...new Set(universe.emiten.map((e) => e.board).filter(Boolean))].sort();

  return {
    meta: {
      ...meta,
      latestSession: live?.tradingDate || meta.latestSession,
      // Kept separately because the line above destroys it: the overlay makes
      // the newest session look like today even when the official crawl has
      // not run for a week.
      officialSession: meta.latestSession,
    },
    emiten: universe.emiten,
    byCode,
    daily: dailyMap,
    dates,
    series,
    indexDates,
    indexSeries,
    sectors,
    boards,
    live,
  };
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(
      `Gagal memuat ${file} (HTTP ${res.status}). Jalankan "npm run data:refresh" untuk membangun database IDX.`
    );
  }
  return (await res.json()) as T;
}

async function tryJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${file}`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

let cache: Promise<MarketDatabase> | null = null;

export function loadMarketDatabase(): Promise<MarketDatabase> {
  if (!cache) cache = buildDatabase();
  return cache;
}

/** Drop the memoised copy so the next load re-reads the JSON from disk. */
export function invalidateMarketDatabase(): void {
  cache = null;
}

/**
 * Live prices, preferring a running quote source over the committed snapshot.
 *
 * `/api/live` is served by the local service in development and by a Vercel
 * serverless function in production. Either way it returns the same shape as
 * intraday.json, so a failure here simply means the committed snapshot is used
 * — the app never blocks on it, and never shows a blank market because a quote
 * provider was slow.
 */
async function loadIntraday(): Promise<IntradayFile | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch('/api/live', { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok) {
      const live = (await res.json()) as IntradayFile;
      if (live?.quotes && Object.keys(live.quotes).length) return live;
    }
  } catch {
    /* no live endpoint here — fall back to what was committed */
  }
  return tryJson<IntradayFile>('intraday.json');
}

async function buildDatabase(): Promise<MarketDatabase> {
  const [meta, universe, daily, history, indices, intraday] = await Promise.all([
    getJson<MarketMeta>('meta.json'),
    getJson<UniverseFile>('universe.json'),
    getJson<DailyFile>('daily.json'),
    getJson<HistoryFile>('history.json'),
    getJson<IndicesFile>('indices.json'),
    loadIntraday(),
  ]);

  return assembleMarketDatabase({ meta, universe, daily, history, indices, intraday });
}

// ------------------------------------------------------------------ queries

/** Latest non-NaN value at or before `offsetFromEnd` sessions back. */
export function lastValid(arr: Float64Array, offsetFromEnd = 0): number {
  for (let i = arr.length - 1 - offsetFromEnd; i >= 0; i--) {
    if (Number.isFinite(arr[i])) return arr[i];
  }
  return NaN;
}

export function computeBreadth(
  db: MarketDatabase,
  sma50: Map<string, number>,
  sma200: Map<string, number>
): MarketBreadth {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let notTraded = 0;
  let turnover = 0;
  let foreign = 0;
  let above50 = 0;
  let above200 = 0;
  let counted50 = 0;
  let counted200 = 0;
  let newHighs = 0;
  let newLows = 0;

  for (const e of db.emiten) {
    const d = db.daily.get(e.code);
    if (!d || !d.close) {
      notTraded++;
      continue;
    }
    if (!d.volume) notTraded++;
    else if (d.change > 0) advancers++;
    else if (d.change < 0) decliners++;
    else unchanged++;

    turnover += d.value;
    foreign += d.foreignNet;

    const s50 = sma50.get(e.code);
    if (Number.isFinite(s50 as number)) {
      counted50++;
      if (d.close > (s50 as number)) above50++;
    }
    const s200 = sma200.get(e.code);
    if (Number.isFinite(s200 as number)) {
      counted200++;
      if (d.close > (s200 as number)) above200++;
    }

    const s = db.series.get(e.code);
    if (s) {
      const window = s.close.subarray(Math.max(0, s.close.length - 252));
      let hi = -Infinity;
      let lo = Infinity;
      for (let i = 0; i < window.length; i++) {
        const v = window[i];
        if (!Number.isFinite(v)) continue;
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      if (Number.isFinite(hi) && d.close >= hi) newHighs++;
      if (Number.isFinite(lo) && d.close <= lo) newLows++;
    }
  }

  return {
    session: db.meta.latestSession,
    advancers,
    decliners,
    unchanged,
    notTraded,
    percentAboveSma50: counted50 ? above50 / counted50 : 0,
    percentAboveSma200: counted200 ? above200 / counted200 : 0,
    totalTurnoverIdrTn: turnover / 1e12,
    netForeignIdrBn: foreign / 1e9,
    newHighs52w: newHighs,
    newLows52w: newLows,
  };
}
