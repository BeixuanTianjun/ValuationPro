// Event radar — the screen that looks BEFORE the tape moves.
//
// ── WHY THIS IS NOT THE SCREENER ──────────────────────────────────────────
//
// stockScreener.ts asks "what is moving". Every one of its modes requires a
// trend that already exists: momentum wants close above its averages, pullback
// wants close above MA200, laggard wants an index already up 10%. That is a
// confirmation instrument, and by construction it cannot name a stock the day
// before it runs — if it could, its own conditions would not yet be met.
//
// The case that forced this file: IATA, 30 July 2026, closing at 57. Its tape
// said nothing at all. Volume over the prior 20 sessions was 0.97x its own
// 60-session base and the trade count was DOWN 39%; turnover was Rp68 million a
// day, which is below the liquidity floor of every screen in this app. The
// following session it closed at 76 (+33%) and reached 129 within seven.
//
// What was observable, and public, and dated:
//
//   28 Jul  interim financial statements
//   29 Jul  change of address / phone / website — filed twice, once as a
//           correction
//   30 Jul  notice of an EGM and a bondholders meeting, under a NEW NAME:
//           "PT Karya Pacific Energy Tbk"
//
// A company changing its address, its website and its name, then calling an
// extraordinary meeting, inside three days. Individually the announcements
// taxonomy scores each of those at or near zero — and it is right to: an
// address change on its own is paperwork. The signal is the CLUSTER, on a name
// whose tape is still asleep.
//
// ── WHAT THIS FILE DOES NOT CLAIM ─────────────────────────────────────────
//
// It is not backtested, and it cannot be yet. Until 3 September 2026 the
// announcements ingest kept a rolling 45-day window and overwrote it daily, so
// no filing history older than six weeks exists to test against. A first cut
// over that window gives n=27 for identity changes and n=62 for material
// transactions — enough to see a shape, nowhere near enough to claim an edge.
// RADAR_CAVEAT says so in the words the screen prints, and the panel is
// required to print it. The archive added alongside this file accumulates from
// today; the honest test happens when it is deep enough, not before.
//
// ── WHAT IS DELIBERATELY *NOT* IN THE SCORE ───────────────────────────────
//
// Price level. Measured over 25,000 quiet sessions, stocks under Rp100 reach
// +40% within ten sessions 3.58% of the time against 0.57% for stocks over
// Rp500 — a six-fold difference that is tempting to weight. It is not weighted
// here, because most of it is tick size rather than alpha: at Rp50 a single
// tick is 2% and the auto-reject band is far wider in percentage terms.
// Encoding that as a score would dress up a measurement artifact as a finding.
// The tier is reported as a column so the reader can see it and decide; it
// never moves the ranking.

import type { MarketDatabase } from '../data/marketRepository';
import type { AnnouncementsFile, RawAnnouncement } from './announcements';

/** What kind of change a filing announces. Never a direction. */
export type RadarTrigger = 'identitas' | 'kendali' | 'aksi-korporasi' | 'transaksi';

export interface TriggerMeta {
  label: string;
  weight: number;
  hint: string;
}

/**
 * Weights are ordering, not probability.
 *
 * They say which filing is worth reading first when two names tie, and nothing
 * more. Nobody has measured a hit rate for any of these categories on a sample
 * large enough to calibrate a probability, and pretending otherwise is how a
 * ranking turns into a forecast.
 */
export const TRIGGER_META: Record<RadarTrigger, TriggerMeta> = {
  transaksi: {
    label: 'Transaksi material',
    weight: 0.4,
    hint: 'Akuisisi, pengambilalihan, penyertaan, atau transaksi yang nilainya material. Isi perusahaan berubah.',
  },
  kendali: {
    label: 'Perubahan kendali',
    weight: 0.35,
    hint: 'Pemegang saham pengendali berganti, atau susunan direksi dan komisaris dirombak.',
  },
  identitas: {
    label: 'Perubahan identitas',
    weight: 0.3,
    hint: 'Ganti nama, alamat, situs, atau anggaran dasar. Sendirian ini administratif; berkelompok ia biasanya menandai pemilik baru.',
  },
  'aksi-korporasi': {
    label: 'Aksi korporasi',
    weight: 0.2,
    hint: 'RUPSLB, penambahan modal, HMETD, atau private placement. Wadah tempat perubahan diputuskan.',
  },
};

interface TriggerRule {
  trigger: RadarTrigger;
  test: RegExp;
}

/**
 * ORDER IS THE ALGORITHM, as in announcements.ts. First hit wins per filing.
 *
 * `transaksi` sits first so that "Rencana RUPSLB dalam rangka Pengambilalihan"
 * is filed as the takeover it is rather than as the meeting that will approve
 * it. `identitas` sits ahead of `aksi-korporasi` for the IATA shape exactly:
 * "Pemberitahuan Rencana RUPSU PT Karya Pacific Energy Tbk" is a meeting notice
 * whose informative part is the unfamiliar name in it, and reading it as a
 * plain meeting notice loses the only thing that made it interesting.
 *
 * The negative rules run before everything else. A filing that reports the
 * RESULT of a meeting is not news that a meeting is coming, and the monthly
 * shareholder register contains the words "pemegang saham" without ever
 * announcing a change of one.
 */
const NEGATIVE: RegExp[] = [
  /laporan bulanan registrasi/i,
  /hasil (rupslb|rupsu|rups|rapat umum)/i,
  /risalah rapat umum/i,
  /penggunaan dana hasil penawaran umum/i,
  // Pelepasan saham treasuri hasil buyback. Thirteen of them in a six-week
  // window, all routine programme reporting, and every one contains words that
  // read like a share disposal. The same collision announcements.ts defuses in
  // its own top block, and it has to be defused here too because the
  // `transaksi` rule below deliberately reaches for divestment language.
  /pengalihan (kembali )?saham (treasuri |treasury )?hasil (pembelian kembali|buy ?back)/i,
  /saham treasuri|saham treasury/i,
];

const TRIGGER_RULES: TriggerRule[] = [
  {
    trigger: 'transaksi',
    // Divestment reads as an event in both directions. A group selling a
    // subsidiary is as much a change in what it owns as buying one, and the
    // first version of this rule caught only the buying half — EMTK selling a
    // subsidiary's shares, WIFI divesting one, NIRO releasing a subsidiary's
    // assets and WINR raising its stake all fell through it silently.
    test: /akuisisi|pengambilalihan|transaksi material|penggabungan usaha|peleburan usaha|penyertaan (modal|saham)|pembelian atau penjualan saham perusahaan yang nilainya material|perubahan kegiatan usaha|divestasi|pelepasan (saham|aset)|penjualan saham|peningkatan kepemilikan saham/i,
  },
  {
    trigger: 'kendali',
    test: /pemegang saham pengendali|perubahan pengendali|pengendali baru|perubahan susunan (direksi|pengurus|dewan komisaris|anggota direksi)/i,
  },
  {
    trigger: 'identitas',
    test: /perubahan nama|ganti nama|perubahan anggaran dasar|perubahan alamat|perubahan (nomor telepon|website|situs|logo)|nama dan alamat/i,
  },
  {
    trigger: 'aksi-korporasi',
    test: /rupslb|rupsu|rapat umum pemegang saham luar biasa|penambahan modal|pmthmetd|hmetd|rights? issue|private placement/i,
  },
];

/**
 * The exchange asking why a stock moved is proof that it already has.
 *
 * A radar that fires on these would be measuring its own lateness, so they are
 * a hard disqualifier rather than a negative weight.
 */
const TOO_LATE =
  /volatilitas transaksi|unusual market activity|permintaan penjelasan bursa|suspensi|penghentian sementara perdagangan/i;

/**
 * The filing is about a subsidiary, not about the listed company itself.
 *
 * FOUND BY READING THE LIVE SCREEN, not by reasoning. CMNT sat at rank two on
 * the first render, and opening the row showed why: "Perubahan Susunan Pengurus
 * Entitas Anak dari PT Cemindo Gemilang Tbk" — a board reshuffle at a
 * subsidiary. That is group housekeeping. It is not a change of control of
 * CMNT, and a radar built to notice new owners had put it second.
 *
 * The suppression is deliberately PARTIAL, because "mentions a subsidiary" is
 * not the same as "does not matter". Of the 33 filings in the window that name
 * one, the split is clean along a line worth stating:
 *
 *   suppressed   PGJO's subsidiary changing its articles, INTP's subsidiary
 *                changing its directors, WIRG's subsidiary changing both.
 *                Identity and control INSIDE a group say nothing about who
 *                owns the group.
 *   kept         ARKO's subsidiary completing a share acquisition, EMTK
 *                selling a subsidiary's shares, WIFI divesting one, MIRA
 *                selling land through one. A transaction executed through a
 *                subsidiary is still a transaction of the group, and it lands
 *                in the same consolidated accounts.
 *
 * So it suppresses `identitas` and `kendali` only, and it lets the search
 * continue rather than returning null — a filing that reshuffles a subsidiary
 * board AND calls an EGM is still an EGM.
 */
const SUBSIDIARY =
  /entitas anak|anak[- ]anak perusahaan|anak perusahaan|perusahaan anak|anak usaha|entitas asosiasi/i;
const SUBSIDIARY_SUPPRESSES: RadarTrigger[] = ['identitas', 'kendali'];

export function classifyTrigger(title: string): RadarTrigger | null {
  for (const re of NEGATIVE) if (re.test(title)) return null;
  const aboutSubsidiary = SUBSIDIARY.test(title);
  for (const rule of TRIGGER_RULES) {
    if (!rule.test.test(title)) continue;
    if (aboutSubsidiary && SUBSIDIARY_SUPPRESSES.includes(rule.trigger)) continue;
    return rule.trigger;
  }
  return null;
}

export interface RadarSettings {
  /** How many days back a filing still counts as a trigger. */
  lookbackDays: number;
  /** Two distinct trigger kinds inside this many days count as a cluster. */
  clusterDays: number;
  /** Maximum run-up from the 60-session low. Above this the move has started. */
  maxRunup: number;
  /** Maximum volume ratio (last 20 sessions vs the 60 before). */
  maxVolRatio: number;
  /**
   * Of the last 20 sessions, how many must have actually traded.
   *
   * Half. A name that trades on nine days out of twenty is thin; a name that
   * trades on none is suspended, and a suspended stock is the single most
   * dangerous thing this screen can return, because a frozen price satisfies
   * every quietness gate perfectly.
   */
  minTradedSessions: number;
  /**
   * Minimum average daily turnover, in rupiah.
   *
   * Set deliberately low. Every other screen in this app floors at hundreds of
   * millions, and that floor is why IATA — Rp68 million a day — was invisible
   * to all of them. This is the tier where control changes happen, so the floor
   * exists only to exclude names that cannot be sold at all, not to make the
   * list look respectable.
   */
  minValuePerDay: number;
  maxResults: number;
}

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  lookbackDays: 10,
  clusterDays: 7,
  maxRunup: 0.15,
  maxVolRatio: 2,
  minTradedSessions: 10,
  minValuePerDay: 3e7,
  maxResults: 40,
};

export interface RadarFiling extends RawAnnouncement {
  trigger: RadarTrigger;
  ageDays: number;
  pdfUrl: string;
}

export interface RadarRule {
  label: string;
  pass: boolean;
  detail: string;
}

export interface RadarRow {
  code: string;
  name: string;
  sector: string;
  price: number;
  /** Average daily turnover over the last 20 sessions, in rupiah. */
  valuePerDay: number;
  priceTier: '<100' | '100-500' | '>=500';
  runup60: number;
  volRatio: number;
  freqRatio: number;
  /** Of the last 20 sessions, how many actually traded. */
  tradedSessions: number;
  filings: RadarFiling[];
  triggers: RadarTrigger[];
  /** At least two distinct trigger kinds within `clusterDays`. */
  clustered: boolean;
  clusterSpanDays: number;
  score: number;
  rules: RadarRule[];
  why: string[];
}

export interface RadarResult {
  rows: RadarRow[];
  asOf: string;
  windowFrom: string;
  /** Counts of emiten that had a trigger but failed a gate, by gate. */
  rejected: { reason: string; count: number }[];
  triggeredEmiten: number;
  caveat: string;
}

export const RADAR_CAVEAT =
  'Radar ini BELUM diuji. Arsip pengumuman baru dimulai 3 September 2026 — sebelum itu ' +
  'jendelanya bergulir 45 hari dan ditimpa tiap hari, jadi tidak ada riwayat untuk diuji. ' +
  'Uji pertama atas jendela yang ada memberi n=27 untuk perubahan identitas dan n=62 untuk ' +
  'transaksi material: cukup untuk melihat bentuk, jauh dari cukup untuk mengklaim edge. ' +
  'Perlakukan tiap baris sebagai daftar bacaan, bukan sinyal beli.';

const dayDiff = (from: string, to: string): number => {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 9999;
};

/**
 * Mean over a window, ignoring gaps, but only when enough of the window is
 * actually there.
 *
 * `minObs` is not defensive padding, it is the fix for a real defect found on
 * the first live run. WIKA has been suspended for over a hundred sessions and
 * carries no end-of-day volume at all, but the intraday snapshot appends one
 * final session with a print in it. Averaging "the last 20 sessions" over the
 * single observation that existed returned a 20-session average built from one
 * day, and the radar duly reported "Rp41 jt/hari" for a stock that has not
 * traded since May. The number was wrong and looked entirely reasonable, which
 * is the only kind of wrong that survives review.
 */
function meanOf(a: Float64Array, from: number, to: number, minObs = 1): number {
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i <= to && i < a.length; i++) {
    if (Number.isFinite(a[i])) {
      sum += a[i];
      n++;
    }
  }
  return n >= minObs ? sum / n : NaN;
}

/**
 * Sessions in the last `window` that actually traded, and whether the price
 * ever moved.
 *
 * WHY THIS IS A GATE AND NOT A COLUMN. 122 of 960 emiten — one in eight — have
 * a price that has not changed by a single rupiah in twenty sessions. They are
 * suspended, or nobody trades them. To a run-up gate a frozen price is the
 * quietest thing on the exchange: `runup60` is exactly 0%, better than any
 * genuinely quiet stock can score. Every gate this radar has would wave them
 * through, and they would fill the list, because the whole screen is built to
 * reward stillness. Stillness because nothing is happening is the signal;
 * stillness because trading is halted is a wall.
 */
function tradingLife(
  s: { close: Float64Array; volume: Float64Array },
  last: number,
  window = 20
): { tradedSessions: number; priceMoved: boolean } {
  let traded = 0;
  let moved = false;
  const ref = s.close[last];
  for (let k = 0; k < window && last - k >= 0; k++) {
    const i = last - k;
    if (s.volume[i] > 0) traded++;
    if (Number.isFinite(s.close[i]) && s.close[i] !== ref) moved = true;
  }
  return { tradedSessions: traded, priceMoved: moved };
}

const tierOf = (price: number): RadarRow['priceTier'] =>
  price < 100 ? '<100' : price < 500 ? '100-500' : '>=500';

/**
 * Score one emiten from its triggering filings.
 *
 * Distinct KINDS are summed, not filings: three address-change filings in one
 * week are one identity change reported three times, and letting them add up
 * would rank the market by how often its corporate secretaries hit send. The
 * cluster bonus is where the IATA shape earns its place — identity plus a
 * corporate action inside a week is the thing that was worth seeing, and either
 * one alone usually is not.
 *
 * Saturating, so a name with all four kinds does not run away from the field.
 */
function scoreTriggers(kinds: Set<RadarTrigger>, clustered: boolean): number {
  let raw = 0;
  for (const k of kinds) raw += TRIGGER_META[k].weight;
  if (clustered) raw += 0.25;
  return 1 - Math.exp(-raw / 0.6);
}

/**
 * Build the radar.
 *
 * Every gate is reported per row as a pass/fail line, in the same spirit as the
 * screener: the answer to "why is this here" should be a list you can check,
 * not a number you have to trust.
 */
export function buildEventRadar(
  db: MarketDatabase,
  announcements: AnnouncementsFile | null,
  settings: RadarSettings = DEFAULT_RADAR_SETTINGS
): RadarResult {
  const asOf = announcements?.to ?? '';
  const windowFrom = asOf
    ? new Date(Date.parse(asOf + 'T00:00:00Z') - settings.lookbackDays * 86400000)
        .toISOString()
        .slice(0, 10)
    : '';

  const empty: RadarResult = {
    rows: [],
    asOf,
    windowFrom,
    rejected: [],
    triggeredEmiten: 0,
    caveat: RADAR_CAVEAT,
  };
  if (!announcements || !announcements.announcements.length) return empty;

  // Group the window's filings by emiten, keeping only the ones that trigger.
  const byCode = new Map<string, RadarFiling[]>();
  const tooLate = new Set<string>();
  for (const raw of announcements.announcements) {
    const age = dayDiff(raw.date, asOf);
    if (age < 0 || age > settings.lookbackDays) continue;
    if (TOO_LATE.test(raw.title)) {
      tooLate.add(raw.code);
      continue;
    }
    const trigger = classifyTrigger(raw.title);
    if (!trigger) continue;
    const list = byCode.get(raw.code) ?? [];
    list.push({
      ...raw,
      trigger,
      ageDays: age,
      pdfUrl: raw.url ? announcements.pdfBase + raw.url : '',
    });
    byCode.set(raw.code, list);
  }

  const rejected = new Map<string, number>();
  const reject = (reason: string) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1);

  const rows: RadarRow[] = [];
  const lastIndex = db.dates.length - 1;

  for (const [code, filings] of byCode) {
    filings.sort((a, b) => b.date.localeCompare(a.date));

    const emiten = db.byCode.get(code);
    const series = db.series.get(code);
    if (!emiten || !series) {
      reject('tidak ada di universe atau tidak punya riwayat harga');
      continue;
    }

    const price = series.close[lastIndex];
    if (!(price > 0)) {
      reject('harga terakhir kosong');
      continue;
    }

    let low = Infinity;
    for (let k = 0; k < 60 && lastIndex - k >= 0; k++) {
      const v = series.close[lastIndex - k];
      if (v > 0 && v < low) low = v;
    }
    const runup60 = Number.isFinite(low) && low > 0 ? price / low - 1 : NaN;

    const { tradedSessions, priceMoved } = tradingLife(series, lastIndex);

    // Ten observations minimum on the recent leg, thirty on the base. An
    // "average" of one print is not an average, and the ratio of two of them is
    // noise with a decimal point.
    //
    // The recent leg's minimum is redundant today: `minTradedSessions` is also
    // ten, so anything reaching here already has ten prints. Mutating it proves
    // nothing, and the tests say so rather than implying a coverage that does
    // not exist. It stays because the two numbers answer different questions —
    // one is a tradability rule the owner may want to loosen, the other is an
    // arithmetic precondition that must hold whatever that rule is set to.
    //
    // The base leg's minimum is not redundant and is the one that matters. A
    // freshly listed emiten has a handful of sessions inside the 60-session base
    // window, and dividing twenty busy sessions by an eight-day average returns
    // something like "48x" that reads as a volume explosion. It is noise with a
    // decimal point, and it would have rejected the row for the opposite of the
    // true reason.
    const recentVol = meanOf(series.volume, lastIndex - 19, lastIndex, 10);
    const baseVol = meanOf(series.volume, lastIndex - 79, lastIndex - 20, 30);
    const volRatio = baseVol > 0 ? recentVol / baseVol : NaN;
    const recentFreq = meanOf(series.freq, lastIndex - 19, lastIndex, 10);
    const baseFreq = meanOf(series.freq, lastIndex - 79, lastIndex - 20, 30);
    const freqRatio = baseFreq > 0 ? recentFreq / baseFreq : NaN;
    const valuePerDay = recentVol > 0 ? recentVol * price : NaN;

    // A NaN must never pass a comparison gate. Written as an explicit "is it
    // finite AND within bounds" rather than a negated comparison, because
    // `!(NaN > x)` is true and would let every unknown through — the exact bug
    // emitenQueryEngine's tests exist to prevent.
    //
    // The volume gate is the one deliberate exception, and it is an exception
    // about MEANING rather than about NaN. `volRatio` is NaN when an emiten has
    // no 60-session base at all, which is true of every recent listing, and a
    // stock that has never traded long enough to have a base has certainly not
    // seen its volume explode relative to one. Failing it here would silently
    // make the radar blind to new listings, which are exactly where control
    // changes cluster.
    const passNotAsked = !tooLate.has(code);
    const passAlive = tradedSessions >= settings.minTradedSessions && priceMoved;
    const passQuiet = Number.isFinite(runup60) && runup60 <= settings.maxRunup;
    const passVolume = Number.isFinite(volRatio) ? volRatio < settings.maxVolRatio : true;
    const passLiquid = Number.isFinite(valuePerDay) && valuePerDay >= settings.minValuePerDay;

    const rules: RadarRule[] = [
      {
        label: 'Belum ditanya bursa',
        pass: passNotAsked,
        detail: passNotAsked
          ? 'tidak ada UMA atau permintaan penjelasan di jendela ini'
          : 'bursa sudah meminta penjelasan volatilitas — harganya sudah bergerak',
      },
      {
        label: `Benar-benar diperdagangkan (≥${settings.minTradedSessions} dari 20 sesi)`,
        pass: passAlive,
        detail: !priceMoved
          ? `harga tidak bergerak sama sekali 20 sesi — kemungkinan disuspensi`
          : `${tradedSessions} dari 20 sesi ada transaksi`,
      },
      {
        label: `Tape masih tenang (≤${(settings.maxRunup * 100).toFixed(0)}% dari dasar 60 sesi)`,
        pass: passQuiet,
        detail: Number.isFinite(runup60) ? `${(runup60 * 100).toFixed(1)}%` : 'tidak diketahui',
      },
      {
        label: `Volume belum meledak (<${settings.maxVolRatio}x basis)`,
        pass: passVolume,
        detail: Number.isFinite(volRatio) ? `${volRatio.toFixed(2)}x` : 'belum punya basis 60 sesi',
      },
      {
        label: `Masih bisa dijual (≥Rp${(settings.minValuePerDay / 1e6).toFixed(0)} jt/hari)`,
        pass: passLiquid,
        detail: Number.isFinite(valuePerDay)
          ? `Rp${(valuePerDay / 1e6).toFixed(0)} jt/hari`
          : 'tidak diketahui',
      },
    ];

    if (!passNotAsked) reject('bursa sudah meminta penjelasan — sudah telat');
    // Dua sebab yang berbeda, dan menyatukannya akan menyembunyikan yang
    // berbahaya di balik yang biasa. Harga yang tidak bergerak sama sekali
    // hampir selalu suspensi; harga yang bergerak tapi jarang ada transaksi
    // hanyalah saham tipis.
    else if (!passAlive)
      reject(
        priceMoved
          ? 'terlalu jarang diperdagangkan'
          : 'harga beku 20 sesi — bukan tenang, tapi berhenti'
      );
    else if (!passQuiet) reject('harganya sudah bergerak lebih dari batas');
    else if (!passVolume) reject('volumenya sudah meledak');
    else if (!passLiquid) reject('terlalu tipis untuk dijual kembali');

    if (rules.some((r) => !r.pass)) continue;

    const kinds = new Set(filings.map((f) => f.trigger));
    // Cluster span is measured across DISTINCT kinds only. Three identity
    // filings a day apart span two days but say one thing.
    const firstByKind = new Map<RadarTrigger, string>();
    for (const f of filings) if (!firstByKind.has(f.trigger)) firstByKind.set(f.trigger, f.date);
    const dates = [...firstByKind.values()].sort();
    const clusterSpanDays = dates.length >= 2 ? dayDiff(dates[0], dates[dates.length - 1]) : 0;
    const clustered = kinds.size >= 2 && clusterSpanDays <= settings.clusterDays;

    const why: string[] = [];
    for (const k of kinds) why.push(TRIGGER_META[k].label);
    if (clustered) why.push(`${kinds.size} jenis dalam ${clusterSpanDays} hari`);

    rows.push({
      code,
      name: emiten.name,
      sector: emiten.sector,
      price,
      valuePerDay,
      priceTier: tierOf(price),
      runup60,
      volRatio,
      freqRatio,
      tradedSessions,
      filings,
      triggers: [...kinds],
      clustered,
      clusterSpanDays,
      score: scoreTriggers(kinds, clustered),
      rules,
      why,
    });
  }

  rows.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

  return {
    rows: rows.slice(0, settings.maxResults),
    asOf,
    windowFrom,
    rejected: [...rejected.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    triggeredEmiten: byCode.size,
    caveat: RADAR_CAVEAT,
  };
}
