// Domain types for the IDX market database and the daily alpha screener.
// Everything here describes data produced by scripts/ingest-idx.mjs.

export interface Emiten {
  code: string;            // 4-letter IDX ticker, e.g. "TLKM"
  name: string;            // short listed name
  fullName: string;        // legal entity name
  sector: string;          // IDX-IC sector, e.g. "Infrastructures"
  sectorSlug: string;
  industry: string;
  subIndustry: string;
  business: string;
  board: string;           // Main | Development | Acceleration | Economic
  listingDate: string;     // YYYY-MM-DD
  listedShares: number;
  website: string;
  yahoo: string;           // "TLKM.JK"
}

export interface UniverseFile {
  generatedAt: string;
  count: number;
  emiten: Emiten[];
}

/** Compact wire format: every series is a comma-joined string, blank = no trade. */
export interface RawSeries {
  c: string;   // close (IDR), as traded
  h: string;   // high
  l: string;   // low
  v: string;   // volume in lots
  t: string;   // turnover value in IDR million
  fn: string;  // net foreign flow in IDR million (buy - sell, at close)
  /**
   * Sparse corporate-action factors, present only for emiten that had one.
   * A value at position i means prices BEFORE i must be multiplied by it to be
   * comparable with prices from i onward (a 1:5 split gives 0.2).
   */
  adj?: string;
}

export interface HistoryFile {
  generatedAt: string;
  dates: string[];
  series: Record<string, RawSeries>;
}

/**
 * Decoded series. NaN marks a session the emiten did not trade.
 *
 * `close`, `high` and `low` are ADJUSTED for splits, reverse splits and rights
 * issues so that any two points are directly comparable. `rawClose` keeps the
 * price as actually traded, which is what an order ticket needs.
 */
export interface PriceSeries {
  code: string;
  close: Float64Array;
  high: Float64Array;
  low: Float64Array;
  volume: Float64Array;
  value: Float64Array;
  foreignNet: Float64Array;
  rawClose: Float64Array;
  /** Number of corporate actions folded into this series. */
  adjustments: number;
}

export interface RawIndexSeries {
  members: number;
  c: string;
  v: string;
  t: string;
  mc: string;
}

export interface IndicesFile {
  generatedAt: string;
  dates: string[];
  indices: Record<string, RawIndexSeries>;
}

export interface IndexQuote {
  code: string;
  name: string;
  group: 'headline' | 'sector' | 'thematic' | 'sharia' | 'factor';
  members: number;
  close: number;
  prevClose: number;
  changePercent: number;
  return1m: number;
  return3m: number;
  return6m: number;
  return12m: number;
  ytd: number;
  turnoverIdrBn: number;
  marketCapIdrTn: number;
  closes: Float64Array;
}

export interface DailyQuote {
  code: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev: number;
  change: number;      // percent
  volume: number;      // shares
  value: number;       // IDR
  freq: number;
  foreignNet: number;  // IDR
  listedShares: number;
  /** Free-float adjusted share count IDX weights its indices by. */
  indexShares: number;
  marketCap: number;   // IDR
}

export interface DailyFile {
  generatedAt: string;
  session: string;
  count: number;
  stocks: DailyQuote[];
}

/** One emiten's live quote during the session (Yahoo, ~10 minute delay). */
export interface IntradayQuote {
  price: number;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  changePercent: number | null;
  time: number | null;
}

export interface IntradayFile {
  generatedAt: string;
  tradingDate: string;
  marketState: string;
  sessionPhase: 'pre-open' | 'sesi-1' | 'break' | 'sesi-2' | 'closed' | 'weekend' | string;
  covered: number;
  attempted: number;
  source: string;
  /** Reminder that IDX publishes foreign buy/sell only end-of-day. */
  foreignFlowAsOf: string;
  /** True when quoted on request rather than read from a committed snapshot. */
  onDemand?: boolean;
  quotes: Record<string, IntradayQuote>;
  /** Only COMPOSITE and LQ45 are quoted live anywhere; sector indices are not. */
  indices?: Record<string, { close: number; prevClose: number | null; changePercent: number | null }>;
}

export interface MarketMeta {
  generatedAt: string;
  latestSession: string;
  /** Weekdays inside the covered range on which IDX did not trade. */
  holidays?: string[];
  /** Weekdays after the latest session that IDX has not published yet. */
  pendingSessions?: number;
  sessions: number;
  firstSession: string;
  emitenListed: number;
  emitenWithHistory: number;
  /** Splits / reverse splits / rights issues folded into the price history. */
  corporateActions?: number;
  indexCount: number;
  calendarDaysRequested: number;
  sources: string[];
}

// ------------------------------------------------------------------ factors

/** Raw (un-normalised) factor readings for one emiten on the snapshot date. */
export interface FactorSnapshot {
  code: string;
  close: number;
  marketCapIdrBn: number;

  // momentum
  return1w: number;
  return1m: number;
  return3m: number;
  return6m: number;
  return12m: number;
  momentum12_1: number;   // 12-month return excluding the most recent month

  // trend
  sma20: number;
  sma50: number;
  sma200: number;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  goldenCross: boolean;
  distanceFrom52wHigh: number;  // negative = below the high
  distanceFrom52wLow: number;
  trendQuality: number;         // R^2 of log-price regression over 90 sessions

  // timing / mean reversion
  rsi14: number;
  zScore20: number;

  // risk
  annualisedVol: number;
  atr14: number;
  atrPercent: number;
  maxDrawdown6m: number;

  // liquidity
  medianValue20IdrBn: number;
  tradedSessions20: number;
  turnoverRatio: number;        // 20d median turnover / market cap

  // flow
  foreignNet5IdrBn: number;
  foreignNet20IdrBn: number;
  foreignNet60IdrBn: number;
  foreignIntensity: number;     // 20d net foreign / 20d turnover
  foreignStreak: number;        // consecutive sessions of net inflow

  // confirmation
  volumeSurge: number;          // 20d avg volume / 60d avg volume

  // relative strength
  relativeStrength3m: number;   // vs COMPOSITE
  sectorRelativeStrength3m: number; // vs own IDX sector index

  sessionsAvailable: number;
}

export interface MarketBreadth {
  session: string;
  advancers: number;
  decliners: number;
  unchanged: number;
  notTraded: number;
  percentAboveSma200: number;
  percentAboveSma50: number;
  totalTurnoverIdrTn: number;
  netForeignIdrBn: number;
  newHighs52w: number;
  newLows52w: number;
}
