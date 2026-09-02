// Rule-based stock screener.
//
// This deliberately replaced an earlier weighted-composite factor model, which
// ranked the whole universe and handed back the top of a distribution — useful,
// but it always returned something, and it could not be checked by hand. This
// one applies hard rules and reports pass or fail for each, so the answer to
// "why is this stock here" is a row of ticks rather than a score you have to
// trust.
//
// ── THREE MODES, ONE MACHINE ──────────────────────────────────────────────
//
// The original screen only ever answered one question — "what is going up right
// now" — and by construction it could never return a stock that had fallen. Two
// setups the owner actually trades were therefore invisible to it:
//
//   MOMENTUM  (the original)  Close above both the 3- and 5-session averages,
//             with volume and turnover above their floors. What is moving, and
//             is liquid enough to get filled in.
//
//   PULLBACK  Structure still up (close above MA200) but the stock is BELOW its
//             own 20-session average and 8-35% off its 60-session high. The
//             buy-back zone: a name whose long trend is intact, on sale.
//
//   LAGGARD   Its index is up 10%+ over 60 sessions while the stock itself has
//             not moved (≤ +2%) and has not collapsed either (≥ -25%). The
//             mispricing the owner described as "indeksnya sudah naik 10%,
//             sahamnya belum".
//
// WHY MODES AND NOT ONE UNION LIST. A pullback candidate FAILS the momentum
// rules by definition — it is under its short averages, that is the whole
// point — so folding them together would mean a row whose ticks contradict each
// other and a funnel that counts nothing. Each mode keeps its own rules, its own
// funnel and its own conviction ranking, and the UI says which question it is
// answering. A screen that cannot state what it screened for is a ranking
// wearing a filter's clothes.
//
// WHY VOLUME AND VALUE APPLY TO EVERY MODE, and are not the same rule twice:
// they bind at different ends of the price range. On IDX a Rp 50 stock can
// print 40,000,000 shares and still turn over only Rp 2bn, while a Rp 30,000
// stock turning over Rp 9bn trades 300,000 shares. The volume rule throws out
// the illiquid high-priced names, the value rule throws out the penny-stock
// churn. Keeping only one of them lets a whole class of untradeable stock
// through — and a dip you cannot get filled in is not an opportunity.
//
// UNITS — THE TRAP IN THIS FILE. `PriceSeries.volume` is in LOTS (the repository
// divides shares by 100 on the way in) and `PriceSeries.value` is in IDR
// MILLION. The rule thresholds are in shares and rupiah. Every conversion in
// this file is explicit for that reason; comparing a lot count against
// 1,000,000 would silently screen for 100 million shares and return almost
// nothing on a quiet session.
//
// INDEX ALIGNMENT — THE OTHER TRAP. `db.indexSeries` is indexed by
// `db.indexDates`, which is NOT the same array as `db.dates`: the intraday
// overlay extends the price grid by a session the official index feed has not
// published yet. Lining the two up BY POSITION is exactly the bug that put
// every macro value one slot out of place (see HANDOVER). The laggard mode
// therefore measures each series over its OWN last N traded observations, so
// neither grid has to agree with the other about how many sessions exist.

import { Emiten, FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { SECTOR_TO_INDEX } from '../data/idxIndexCatalog';
import { atr, forwardFill } from './factorEngine';

const SHARES_PER_LOT = 100;
const IDR_MN = 1e6;
const IDR_BN = 1e9;

/** Which question the screen is answering. */
export type ScreenerMode = 'momentum' | 'pullback' | 'laggard';

export const SCREENER_MODES: { id: ScreenerMode; label: string; question: string }[] = [
  {
    id: 'momentum',
    label: 'Momentum',
    question: 'Apa yang sedang bergerak naik dan cukup likuid untuk dimasuki?',
  },
  {
    id: 'pullback',
    label: 'Antre Beli',
    question: 'Saham bagus mana yang sedang diskon tapi trennya belum rusak?',
  },
  {
    id: 'laggard',
    label: 'Tertinggal',
    question: 'Indeksnya sudah naik, saham mana yang belum ikut?',
  },
];

export interface ScreenerSettings {
  /** Which of the three rule sets to apply. */
  mode: ScreenerMode;

  // -- momentum ------------------------------------------------------------
  /** Short moving average in sessions. */
  maShort: number;
  /** Long moving average in sessions. */
  maLong: number;

  // -- pullback ------------------------------------------------------------
  /** The average that defines "the long trend is still up". */
  trendMa: number;
  /** The average the price has to be BELOW for the dip to be real. */
  dipMa: number;
  /** Sessions the high-water mark is measured over. */
  dipWindow: number;
  /** Minimum distance below that high, as a fraction — shallower is just noise. */
  minDipPercent: number;
  /** Maximum distance below it — deeper than this is a break, not a dip. */
  maxDipPercent: number;

  // -- laggard -------------------------------------------------------------
  /** Sessions the stock and its index are compared over. */
  gapWindow: number;
  /** How much the index must have gained for "the market moved" to be true. */
  minIndexGainPercent: number;
  /** How little the stock may have gained and still count as "belum naik". */
  maxStockGainPercent: number;
  /** How far it may have fallen before it is broken rather than merely behind. */
  maxDeclinePercent: number;

  /**
   * Batas runup 60 sesi untuk mode MOMENTUM, sebagai pecahan.
   *
   * Satu-satunya ambang di berkas ini yang punya bukti terukur di belakangnya,
   * dan sekaligus satu-satunya yang boleh dicurigai karena angkanya dipilih
   * sesudah datanya dilihat. Dua pengukuran yang terpisah:
   *
   *   `npm run gate:ablate` menguji dua puluh syarat sendiri-sendiri terhadap
   *   keranjang likuid. Hanya runup yang punya dosis-respons: desil terendah
   *   +1,40pp pada tiga bulan, desil tertinggi -8,63pp, monoton di sepuluh
   *   desil, bertahan di kedua paruh waktu. Regangan ATR, sesi berturut di atas
   *   MA5, dan RSI semuanya datar.
   *
   *   `npm run strategy:lab` menguji ambangnya dengan pembagian train/test:
   *   15% memberi lift 1,45 terhadap tingkat kelolosan keseluruhan, 25% memberi
   *   0,72, dan 50% memberi 0,45. Makin ketat makin baik, searah dengan ablasi.
   *
   * YANG BELUM DIBUKTIKAN: 15% dipilih dari data yang juga memuat jendela test
   * lab, jadi lolosnya bukan konfirmasi out-of-sample yang bersih. Yang bisa
   * diklaim hanya bahwa hipotesisnya bisa dibantah dan tidak terbantah. Sesi
   * yang belum ada saat angka ini dipilih adalah satu-satunya yang bisa
   * mengujinya bersih — jalankan ulang keduanya setelah beberapa bulan, dan
   * yang berlaku adalah hasil di situ, bukan catatan ini.
   *
   * HANYA DIPAKAI MOMENTUM. Diukur di 120 sesi terakhir: momentum turun dari
   * 117 emiten per sesi ke 37, masih layak dibaca. Pullback turun dari 18 ke 7
   * pada corong yang sudah kurus, dan laggard memang sudah meloloskan nol.
   * Memasangnya di sana bukan menyaring, melainkan mengosongkan layar.
   */
  maxRunupPercent: number;

  // -- liquidity, every mode -----------------------------------------------
  /** Minimum traded volume, in SHARES. */
  minVolumeShares: number;
  /** Minimum traded value, in IDR. */
  minValueIdr: number;
  /** Optional board restriction; empty means every board. */
  boards: string[];
  /** Optional sector restriction; empty means every sector. */
  sectors: string[];
}

export const DEFAULT_SCREENER_SETTINGS: ScreenerSettings = {
  mode: 'momentum',

  maShort: 3,
  maLong: 5,

  trendMa: 200,
  dipMa: 20,
  dipWindow: 60,
  minDipPercent: 0.08,
  maxDipPercent: 0.35,

  gapWindow: 60,
  minIndexGainPercent: 0.1,
  maxStockGainPercent: 0.02,
  maxDeclinePercent: 0.25,

  maxRunupPercent: 0.15,

  minVolumeShares: 1_000_000,
  minValueIdr: 1_000_000_000,
  boards: [],
  sectors: [],
};

export interface ScreenerRow {
  code: string;
  name: string;
  sector: string;
  board: string;
  close: number;
  prevClose: number;
  changePercent: number;

  // -- momentum readings ---------------------------------------------------
  maShort: number;
  maLong: number;
  aboveMaShort: boolean;
  aboveMaLong: boolean;
  /** MA(short) above MA(long): the short-term averages stacked in order. */
  maStacked: boolean;
  /** How far the close sits above the longer average, as a fraction. */
  premiumToMaLong: number;
  /** Consecutive sessions the close has held above the longer average. */
  sessionsAboveMaLong: number;

  // -- pullback readings ---------------------------------------------------
  /** The long trend average (MA200 by default); NaN when history is too short. */
  maTrend: number;
  /** Close over the trend average, minus 1. Positive = structure still up. */
  premiumToMaTrend: number;
  /** The dip reference average (MA20 by default). */
  maDip: number;
  /** Highest close in the dip window. */
  highInWindow: number;
  /** Close against that high, as a fraction — zero at the high, negative below. */
  dipFromHigh: number;

  // -- laggard readings ----------------------------------------------------
  /** The index this emiten is compared against — its IDX-IC sector index. */
  indexCode: string;
  /** That index's return over the gap window. */
  indexReturn: number;
  /** The emiten's own return over the same window. */
  stockReturn: number;
  /** Index return minus stock return, in PERCENTAGE POINTS. */
  gapToIndexPp: number;

  // -- lateness ------------------------------------------------------------
  //
  // "The stock had already flown by the time we caught it" is a measurable
  // complaint, so these measure it. Both are published on EVERY row in every
  // mode, because being late is not a property of one setup.
  /** Average true range over 14 sessions — each stock's own daily range. */
  atr14: number;
  /**
   * How far the close sits above its 20-session average, in ATR units.
   *
   * ATR-normalised on purpose: 8% above the mean is an ordinary Tuesday for a
   * stock that moves 6% a day and a screaming extension for one that moves 1%.
   * A raw percentage would rank the volatile names as permanently late and the
   * quiet ones as permanently early.
   */
  extensionAtr: number;
  /** Return from the LOWEST close in the dip window — the move already made. */
  runupFromLow: number;

  // -- liquidity -----------------------------------------------------------
  volumeShares: number;
  valueIdr: number;
  freq: number;
  foreignNetIdrBn: number;
  marketCapIdrBn: number;
  /** Today's volume over the 20-session average. */
  volumeSurge: number;

  // -- rule outcomes -------------------------------------------------------
  passMa: boolean;
  passTrend: boolean;
  passDip: boolean;
  passDepth: boolean;
  passIndexUp: boolean;
  passLag: boolean;
  passIntact: boolean;
  /** Runup 60 sesi masih di bawah `maxRunupPercent`. Aturan keras di momentum. */
  passNotFlown: boolean;
  passVolume: boolean;
  passValue: boolean;
  /** Every rule of the ACTIVE mode, including the two liquidity rules. */
  passAll: boolean;
}

export interface FunnelStage {
  id: string;
  label: string;
  /** How many emiten remain after this stage. */
  remaining: number;
  /** How many this stage removed. */
  removed: number;
}

export interface ScreenerResult {
  session: string;
  /** True when the newest row came from the intraday overlay, not an IDX close. */
  live: boolean;
  mode: ScreenerMode;
  settings: ScreenerSettings;
  universe: number;
  rows: ScreenerRow[];
  funnel: FunnelStage[];
  /** Every evaluated row, passing or not — for the "why did X fail" lookup. */
  all: Map<string, ScreenerRow>;
}

/** Mean of the last `k` finite values, or NaN if the window is not complete. */
function tailMean(arr: Float64Array, k: number): number {
  let sum = 0;
  let n = 0;
  for (let i = arr.length - 1; i >= 0 && n < k; i--) {
    const v = arr[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n === k ? sum / k : NaN;
}

/** Mean over the last `k` slots, treating a non-trading session as zero. */
function tailMeanZero(arr: Float64Array, k: number): number {
  let sum = 0;
  const from = Math.max(0, arr.length - k);
  for (let i = from; i < arr.length; i++) if (Number.isFinite(arr[i])) sum += arr[i];
  return arr.length > from ? sum / (arr.length - from) : NaN;
}

/** Lowest finite value among the last `k` slots. */
function tailMin(arr: Float64Array, k: number): number {
  let lo = Infinity;
  for (let i = Math.max(0, arr.length - k); i < arr.length; i++) {
    if (Number.isFinite(arr[i]) && arr[i] > 0 && arr[i] < lo) lo = arr[i];
  }
  return lo === Infinity ? NaN : lo;
}

/** Highest finite value among the last `k` slots. */
function tailMax(arr: Float64Array, k: number): number {
  let hi = -Infinity;
  for (let i = Math.max(0, arr.length - k); i < arr.length; i++) {
    if (Number.isFinite(arr[i]) && arr[i] > hi) hi = arr[i];
  }
  return hi === -Infinity ? NaN : hi;
}

/**
 * Return over the last `k` TRADED observations.
 *
 * Sessions the stock did not trade are skipped rather than forward-filled, so
 * a name suspended for a month is measured against the last price that
 * actually printed. It also means the stock and the index can be compared
 * without either grid having to agree with the other about how many rows it
 * holds — see the alignment note in the file header.
 */
function tailReturn(arr: Float64Array, k: number): number {
  const finite: number[] = [];
  for (let i = arr.length - 1; i >= 0 && finite.length <= k; i--) {
    if (Number.isFinite(arr[i]) && arr[i] > 0) finite.push(arr[i]);
  }
  if (finite.length <= k) return NaN;
  const now = finite[0];
  const then = finite[k];
  return then > 0 ? now / then - 1 : NaN;
}

/**
 * Moving average ending at the session BEFORE the last one is not what we want:
 * "close above MA3" on IDX conventionally includes today's close in the
 * average. Both readings are defensible; this uses the inclusive one because it
 * is what a charting package draws, and a screener that disagrees with the
 * user's chart is worse than useless.
 */
function movingAverage(close: Float64Array, k: number): number {
  return tailMean(close, k);
}

function countSessionsAbove(close: Float64Array, k: number): number {
  // Walk back while each session's close was above its own trailing average.
  let count = 0;
  const finite: number[] = [];
  for (let i = 0; i < close.length; i++) if (Number.isFinite(close[i])) finite.push(close[i]);
  for (let i = finite.length - 1; i >= k - 1; i--) {
    let sum = 0;
    for (let j = 0; j < k; j++) sum += finite[i - j];
    const ma = sum / k;
    if (finite[i] > ma) count++;
    else break;
  }
  return count;
}

/** Every index's return over `window` traded observations, computed once. */
function indexReturns(db: MarketDatabase, window: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [code, series] of db.indexSeries) out.set(code, tailReturn(series.close, window));
  return out;
}

export function runStockScreener(db: MarketDatabase, partial: Partial<ScreenerSettings> = {}): ScreenerResult {
  const settings: ScreenerSettings = { ...DEFAULT_SCREENER_SETTINGS, ...partial };
  const mode = settings.mode;

  const universe: Emiten[] = db.emiten;
  const idxRet = indexReturns(db, settings.gapWindow);
  const compositeReturn = idxRet.get('COMPOSITE') ?? NaN;

  let afterFilter = 0;
  // Stage counters. Each is "passed every rule up to and including this one".
  let afterRule1 = 0;
  let afterRule2 = 0;
  let afterRule3 = 0;
  let afterVolume = 0;
  let afterValue = 0;

  const rows: ScreenerRow[] = [];
  const all = new Map<string, ScreenerRow>();

  for (const e of universe) {
    if (settings.boards.length && !settings.boards.includes(e.board)) continue;
    if (settings.sectors.length && !settings.sectors.includes(e.sector)) continue;
    afterFilter++;

    const series = db.series.get(e.code);
    const quote = db.daily.get(e.code);
    if (!series || !quote) continue;

    const close = series.close;
    const n = close.length;
    if (!n) continue;

    const last = quote.close;
    if (!(last > 0)) continue;

    const maS = movingAverage(close, settings.maShort);
    const maL = movingAverage(close, settings.maLong);
    const maTrend = movingAverage(close, settings.trendMa);
    const maDip = movingAverage(close, settings.dipMa);
    // Compare on the adjusted scale the averages are computed on. Using the
    // raw traded close against an adjusted average would flag every emiten
    // that had a split in the window.
    const adjustedLast = Number.isFinite(close[n - 1]) ? close[n - 1] : last;

    const aboveMaShort = Number.isFinite(maS) && adjustedLast > maS;
    const aboveMaLong = Number.isFinite(maL) && adjustedLast > maL;

    const highInWindow = tailMax(close, settings.dipWindow);
    const dipFromHigh = Number.isFinite(highInWindow) && highInWindow > 0 ? adjustedLast / highInWindow - 1 : NaN;

    // How much of the move has already happened. Forward-filled before ATR for
    // the same reason factorEngine does it: a non-trading session is not a
    // zero-range day, and feeding raw NaNs to a true-range calculation poisons
    // the whole average.
    const lowInWindow = tailMin(close, settings.dipWindow);
    const runupFromLow = Number.isFinite(lowInWindow) && lowInWindow > 0 ? adjustedLast / lowInWindow - 1 : NaN;
    const atr14 = atr(forwardFill(series.high), forwardFill(series.low), forwardFill(close), 14);
    const extensionAtr =
      Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(maDip) ? (adjustedLast - maDip) / atr14 : NaN;

    // The sector index if IDX publishes one for this sector, COMPOSITE if not.
    // Which one was used is carried on the row: comparing a bank against IHSG
    // and a coal miner against IDXENERGY are different claims, and the reader
    // is entitled to know which one was made.
    const sectorIndexCode = SECTOR_TO_INDEX[e.sector];
    const sectorRet = sectorIndexCode ? (idxRet.get(sectorIndexCode) ?? NaN) : NaN;
    const usesSector = Number.isFinite(sectorRet);
    const indexCode = usesSector ? sectorIndexCode : 'COMPOSITE';
    const indexReturn = usesSector ? sectorRet : compositeReturn;
    const stockReturn = tailReturn(close, settings.gapWindow);
    const gapToIndexPp =
      Number.isFinite(indexReturn) && Number.isFinite(stockReturn) ? (indexReturn - stockReturn) * 100 : NaN;

    const volumeShares = quote.volume;
    const valueIdr = quote.value;

    // -- the rules ---------------------------------------------------------
    const passMa = aboveMaShort && aboveMaLong;
    const passTrend = Number.isFinite(maTrend) && adjustedLast > maTrend;
    const passDip = Number.isFinite(maDip) && adjustedLast < maDip;
    const passDepth =
      Number.isFinite(dipFromHigh) &&
      dipFromHigh <= -settings.minDipPercent &&
      dipFromHigh >= -settings.maxDipPercent;
    const passIndexUp = Number.isFinite(indexReturn) && indexReturn >= settings.minIndexGainPercent;
    const passLag = Number.isFinite(stockReturn) && stockReturn <= settings.maxStockGainPercent;
    const passIntact = Number.isFinite(stockReturn) && stockReturn >= -settings.maxDeclinePercent;

    const passNotFlown =
      Number.isFinite(runupFromLow) && runupFromLow < settings.maxRunupPercent;

    const passVolume = volumeShares > settings.minVolumeShares;
    const passValue = valueIdr > settings.minValueIdr;

    const modeRules =
      mode === 'momentum'
        ? [passMa, passNotFlown, true]
        : mode === 'pullback'
          ? [passTrend, passDip, passDepth]
          : [passIndexUp, passLag, passIntact];

    const r1 = modeRules[0];
    const r2 = r1 && modeRules[1];
    const r3 = r2 && modeRules[2];
    if (r1) afterRule1++;
    if (r2) afterRule2++;
    if (r3) afterRule3++;
    if (r3 && passVolume) afterVolume++;
    if (r3 && passVolume && passValue) afterValue++;

    const row: ScreenerRow = {
      code: e.code,
      name: e.name,
      sector: e.sector,
      board: e.board,
      close: last,
      prevClose: quote.prev,
      changePercent: quote.prev > 0 ? last / quote.prev - 1 : NaN,

      maShort: maS,
      maLong: maL,
      aboveMaShort,
      aboveMaLong,
      maStacked: Number.isFinite(maS) && Number.isFinite(maL) && maS > maL,
      premiumToMaLong: Number.isFinite(maL) && maL > 0 ? adjustedLast / maL - 1 : NaN,
      sessionsAboveMaLong: countSessionsAbove(close, settings.maLong),

      maTrend,
      premiumToMaTrend: Number.isFinite(maTrend) && maTrend > 0 ? adjustedLast / maTrend - 1 : NaN,
      maDip,
      highInWindow,
      dipFromHigh,

      indexCode,
      indexReturn,
      stockReturn,
      gapToIndexPp,

      atr14,
      extensionAtr,
      runupFromLow,

      volumeShares,
      valueIdr,
      freq: quote.freq,
      foreignNetIdrBn: quote.foreignNet / IDR_BN,
      marketCapIdrBn: quote.marketCap / IDR_BN,
      volumeSurge: (() => {
        // series.volume is in lots; the ratio is unitless so no conversion is
        // needed here, only consistency.
        const avg20 = tailMeanZero(series.volume, 20);
        const today = volumeShares / SHARES_PER_LOT;
        return avg20 > 0 ? today / avg20 : NaN;
      })(),

      passMa,
      passTrend,
      passDip,
      passDepth,
      passIndexUp,
      passLag,
      passIntact,
      passNotFlown,
      passVolume,
      passValue,
      passAll: r3 && passVolume && passValue,
    };

    all.set(e.code, row);
    if (row.passAll) rows.push(row);
  }

  // Strongest first by turnover: among stocks that all pass the same rules, the
  // one the market is actually transacting in is the one you can get filled in.
  rows.sort((a, b) => b.valueIdr - a.valueIdr);

  const pctLabel = (v: number) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 0 })}%`;
  const ruleLabels: [string, string, string] =
    mode === 'momentum'
      ? [
          `Di atas MA${settings.maShort} dan MA${settings.maLong}`,
          `Belum naik ${pctLabel(settings.maxRunupPercent)} dari dasar ${settings.dipWindow} sesi`,
          '',
        ]
      : mode === 'pullback'
        ? [
            `Masih di atas MA${settings.trendMa}`,
            `Turun di bawah MA${settings.dipMa}`,
            `Diskon ${pctLabel(settings.minDipPercent)}–${pctLabel(settings.maxDipPercent)} dari puncak ${settings.dipWindow} sesi`,
          ]
        : [
            `Indeks acuannya naik ≥ ${pctLabel(settings.minIndexGainPercent)} dalam ${settings.gapWindow} sesi`,
            `Sahamnya sendiri ≤ ${pctLabel(settings.maxStockGainPercent)}`,
            `Tidak turun lebih dari ${pctLabel(settings.maxDeclinePercent)}`,
          ];

  const funnel: FunnelStage[] = [
    { id: 'universe', label: 'Emiten tercatat', remaining: afterFilter, removed: universe.length - afterFilter },
    { id: 'rule1', label: ruleLabels[0], remaining: afterRule1, removed: afterFilter - afterRule1 },
  ];
  if (ruleLabels[1]) {
    funnel.push({ id: 'rule2', label: ruleLabels[1], remaining: afterRule2, removed: afterRule1 - afterRule2 });
  }
  if (ruleLabels[2]) {
    funnel.push({ id: 'rule3', label: ruleLabels[2], remaining: afterRule3, removed: afterRule2 - afterRule3 });
  }
  funnel.push(
    {
      id: 'volume',
      label: `Volume > ${(settings.minVolumeShares / 1e6).toLocaleString('id-ID')} juta saham`,
      remaining: afterVolume,
      removed: afterRule3 - afterVolume,
    },
    {
      id: 'value',
      label: `Nilai transaksi > Rp ${(settings.minValueIdr / IDR_BN).toLocaleString('id-ID')} miliar`,
      remaining: afterValue,
      removed: afterVolume - afterValue,
    }
  );

  return {
    session: db.meta.latestSession,
    live: Boolean(db.live?.applied),
    mode,
    settings,
    universe: universe.length,
    rows,
    funnel,
    all,
  };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/**
 * Conviction score, 0..1 — orders the rows that already passed the hard rules,
 * it never decides which ones pass.
 *
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A FIELD ON ScreenerRow. The rest of
 * this file is deliberately a gate, not a score — see the file header. Folding
 * a composite number into passAll's neighbourhood would make it look like an
 * extra rule. This stays a ranking the UI applies on top, so "why did X pass"
 * still has checkable answers and "why is X ranked first among the ones that
 * passed" has this one, kept visibly separate.
 *
 * WHY EACH MODE SCORES DIFFERENTLY. Ranking a pullback list on the momentum
 * score would put every candidate near zero and then order them by rounding
 * noise: the momentum score rewards distance ABOVE the long average and
 * sessions spent there, and a pullback candidate is below its short average by
 * construction. Worse, it would rank the shallowest dip first — the exact
 * opposite of what the screen is for. So each mode ranks on what its own setup
 * is asking about.
 */
export function convictionScore(row: ScreenerRow, f?: FactorSnapshot, mode: ScreenerMode = 'momentum'): number {
  if (mode === 'pullback') return pullbackConviction(row, f);
  if (mode === 'laggard') return laggardConviction(row, f);
  return momentumConviction(row, f);
}

/**
 * ── THIS SCORE USED TO RANK LATENESS FIRST, AND THAT WAS THE BUG ──────────
 *
 * The complaint was "the stocks had already flown by the time we caught them".
 * It was not a complaint about the market, it was a description of this
 * function. Three of its seven terms — 35% of the weight — paid MORE the later
 * you were:
 *
 *   trend        distance ABOVE the long MA, saturating at +8%
 *   persistence  sessions already spent above it, saturating at 10
 *   relStrength  3-month outperformance, saturating at +20pp
 *
 * Measured on the live session, the top of the list was exactly what those
 * terms ask for: TAPG +60%, SINI +91%, KKES +119%, SGER +148% over 60 sessions.
 * Every one of them had already made its move. The screen was not late by
 * accident; it was sorted by lateness, and it did it in a column labelled
 * "conviction" that reads like a quality judgement.
 *
 * THE HARD RULES DID NOT CHANGE and must not. The same 227 emiten pass; the
 * gate was never the problem. What changed is the order, which is the only
 * place a ranking is allowed to have an opinion — and the default view shows
 * the top five, so the order IS the screen for most of the people reading it.
 *
 * Now it pays for being EARLY:
 *
 *   freshness    sessions since the close first held above the long MA —
 *                one session scores full, six or more scores nothing
 *   room         how far it is from its own 20-session mean in ATR units,
 *                so "stretched" means the same thing for a 1%-a-day stock and
 *                a 6%-a-day one
 *
 * Volume surge and foreign flow are kept at full weight precisely because they
 * are the two terms that can fire BEFORE the price does. RSI stays as a shape
 * check rather than a strength score.
 */
function momentumConviction(row: ScreenerRow, f?: FactorSnapshot): number {
  // BOBOT DI SINI SEKARANG MENGIKUTI PENGUKURAN, dan pengukurannya tidak enak.
  //
  // `npm run gate:ablate` menguji tiap pembacaan sendiri-sendiri terhadap
  // keranjang likuid selama 432 sesi. Dari dua puluh syarat, hanya runup 60
  // sesi yang punya dosis-respons: monoton di sepuluh desil, +1,40pp pada desil
  // terendah sampai -8,63pp pada desil tertinggi. Sisanya datar dalam ±0,3pp
  // dengan |t| di bawah dua.
  //
  // Suku `freshness` yang dulu memegang bobot 0,2 DIHAPUS. Dosis-responsnya
  // rata, dan syarat ya/tidaknya meloloskan 94% keranjang — sebuah suku yang
  // nyaris konstan tidak mengurutkan apa pun, ia hanya menambah konstanta ke
  // semua orang sambil terlihat seperti pertimbangan.
  //
  // Sisanya DIKECILKAN, bukan dibuang. Ablasi menilainya nol, tapi strategy:lab
  // memberi lift 1,96 untuk volume 2,5x sebagai filter dengan stop ATR. Dua
  // kerangka yang berbeda memberi jawaban berbeda, dan membuang sesuatu atas
  // dasar satu hasil nol adalah klaim yang sama beraninya dengan memakainya
  // penuh. Bobot kecil adalah pengakuan bahwa ini belum diputuskan.

  // Runup rendah, sekarang suku terbesar. Aturan keras sudah memotong di 15%,
  // jadi yang tersisa mengurutkan DI DALAM pita itu — dan ablasi menunjukkan
  // gradiennya masih ada di sana (desil 1-3 sekitar +0,7pp, desil 5 +0,1pp).
  const notFlown = Number.isFinite(row.runupFromLow)
    ? clamp01((0.15 - row.runupFromLow) / 0.15)
    : 0.4;
  const surge = clamp01(((row.volumeSurge ?? 1) - 1) / 1.5); // 1x -> 0, 2.5x+ -> 1
  const flow = clamp01(row.foreignNetIdrBn / 5); // Rp 5bn+ net foreign buy saturates
  // Room left before it is stretched. 0 ATR above the 20-session mean -> 1,
  // 3 ATR above -> 0. NaN (no ATR yet) scores neutral rather than free marks.
  const room = Number.isFinite(row.extensionAtr) ? clamp01((3 - row.extensionAtr) / 3) : 0.4;
  // RSI rewards strength without punishing it as "overbought" until it is
  // actually stretched — 60 is the sweet spot, both 20 and 100 score 0.
  const rsi = Number.isFinite(f?.rsi14) ? clamp01(1 - Math.abs((f!.rsi14 - 60) / 40)) : 0.4;
  const quality = Number.isFinite(f?.trendQuality) ? clamp01(f!.trendQuality) : 0;
  return clamp01(
    notFlown * 0.35 + surge * 0.2 + flow * 0.15 + room * 0.1 + rsi * 0.1 + quality * 0.1,
  );
}

/**
 * A dip is more interesting the deeper it is, up to a point — and the point is
 * where "on sale" turns into "something is wrong". 20% off the window high
 * scores full marks; the score does NOT keep climbing past it, because the
 * rules already cap the depth at 35% and rewarding the deepest survivor would
 * rank the closest thing to a broken stock first.
 */
function pullbackConviction(row: ScreenerRow, f?: FactorSnapshot): number {
  const depth = clamp01(-row.dipFromHigh / 0.2); // 20% off the high saturates
  // Distance above the long trend average: the cushion under the dip.
  const structure = clamp01(row.premiumToMaTrend / 0.15);
  // Oversold is the point here. RSI 30 scores full, 60 scores zero.
  const rsi = Number.isFinite(f?.rsi14) ? clamp01((60 - f!.rsi14) / 30) : 0.4;
  // A tidy long trend is what makes the dip worth buying rather than a shrug.
  const quality = Number.isFinite(f?.trendQuality) ? clamp01(f!.trendQuality) : 0;
  // Foreign money not running for the exit while the price falls.
  const flow = clamp01((row.foreignNetIdrBn + 1) / 3);
  const liquidity = Number.isFinite(f?.medianValue20IdrBn) ? clamp01(f!.medianValue20IdrBn / 20) : 0;
  return clamp01(depth * 0.25 + structure * 0.2 + rsi * 0.2 + quality * 0.15 + flow * 0.1 + liquidity * 0.1);
}

/**
 * The laggard's whole claim is the size of the gap, so that carries the most
 * weight — but a gap opened by a stock in freefall is not the same trade as one
 * opened by a stock going sideways, and the flat-line half is rewarded
 * explicitly.
 */
function laggardConviction(row: ScreenerRow, f?: FactorSnapshot): number {
  const gap = clamp01((row.gapToIndexPp - 8) / 27); // 8pp -> 0, 35pp+ -> 1
  const marketPull = clamp01(row.indexReturn / 0.25); // the harder the index ran, the louder the question
  // Sideways beats falling: a flat stock behind a rising index is a gap, a
  // collapsing one is a downtrend with an index for company.
  const steadiness = clamp01((row.stockReturn + 0.25) / 0.25);
  const rsi = Number.isFinite(f?.rsi14) ? clamp01((65 - f!.rsi14) / 30) : 0.4;
  const flow = clamp01((row.foreignNetIdrBn + 1) / 3);
  const liquidity = Number.isFinite(f?.medianValue20IdrBn) ? clamp01(f!.medianValue20IdrBn / 20) : 0;
  return clamp01(gap * 0.3 + marketPull * 0.15 + steadiness * 0.2 + rsi * 0.15 + flow * 0.1 + liquidity * 0.1);
}

export { IDR_BN, IDR_MN, SHARES_PER_LOT };
