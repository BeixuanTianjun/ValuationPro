// The watchlist — a narrative-first funnel, run weekly or monthly.
//
// THE WORKFLOW THIS ENCODES, in order, because the order is the method:
//
//   1. NARRATIVE.  Is anything actually happening? Either the company filed
//      something material with IDX, or it sits in a curated policy theme.
//      Nothing enters the funnel without this. A stock that is merely going up
//      is the screener's business, not the watchlist's.
//   2. ROTASI KONGLOMERASI.  Does it belong to a group whose capital is moving,
//      and is it the member that has not moved yet? Scored, not required —
//      most emiten belong to no group, and that is not a mark against them.
//   3. PRICE ACTION.  Does the tape agree? Foreign flow, volume, the average
//      ticket size trading in it, the slow KSEI ownership shift, and the hard
//      screener rules — all THREE sets of them, not just the momentum one.
//      "The tape agrees" is not the same claim as "the price is going up": a
//      stock 15% off its high with its long trend intact, or one standing still
//      while its sector index ran 20%, is a tape worth acting on too, and the
//      momentum-only version of this stage scored both of them zero. It now
//      takes the BEST of the three setups, so nothing that used to qualify can
//      stop qualifying — the stage can only find more, never less.
//   4. CHART.  Not scored here. The UI hands the finished candidate to a
//      TradingView chart, because the last step of this workflow is a human
//      looking at a chart, and pretending an algorithm did that would be a lie.
//
// WEEKLY VERSUS MONTHLY is not a different set of rules, it is a different
// clock. The narrative half-life, the price-action lookback and the rotation
// horizon all shift together, so the weekly list reacts to a filing from
// Tuesday while the monthly list still remembers one from three weeks ago.
//
// ON "BANDARMOLOGY". IDX does not publish per-stock broker breakdowns. What IS
// available per stock is value ÷ frequency —
// the average rupiah size of a trade in that specific name — and that is the
// same discriminator the market-wide broker data uses: retail prints many small
// tickets, institutions print few large ones. history.json keeps turnover but
// not trade count, so a past session's ticket cannot be reconstructed — the
// comparison is therefore made across the market on the same day, which asks
// the same question anyway: are the hands in this stock bigger than the hands
// in everything else trading right now. That is an inference from public data,
// it is labelled as one, and it is not the same thing as knowing which broker
// bought.

import { FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { AnnouncementsFile, NarrativeSignal, buildNarrativeSignals } from './announcements';
import { NARRATIVE_THEMES, NarrativeTheme, THEMES_BY_CODE, ThemeMember, themeWeight } from '../data/narratives';
import { GroupRotation, computeAllGroupRotations } from './conglomerateRotation';
import { OwnershipFile, computeOwnershipProfile } from './ownershipFlow';
import { SCREENER_MODES, ScreenerMode, ScreenerRow, ScreenerSettings, runStockScreener } from './stockScreener';

const IDR_BN = 1e9;

export type Horizon = 'mingguan' | 'bulanan';

export interface HorizonProfile {
  id: Horizon;
  label: string;
  /** Days for the announcement recency decay. */
  narrativeHalfLifeDays: number;
  /** Sessions the price-action stage looks back over. */
  lookbackSessions: number;
  /** Which rotation return the group stage reads. */
  rotationWindow: '1m' | '3m';
  description: string;
}

export const HORIZONS: Record<Horizon, HorizonProfile> = {
  mingguan: {
    id: 'mingguan',
    label: 'Mingguan',
    narrativeHalfLifeDays: 7,
    lookbackSessions: 5,
    rotationWindow: '1m',
    description:
      'Disusun ulang tiap awal pekan. Pengajuan dari minggu lalu masih penuh bobotnya, yang berumur sebulan hampir hilang. Konfirmasi tape memakai jendela 5 sesi.',
  },
  bulanan: {
    id: 'bulanan',
    label: 'Bulanan',
    narrativeHalfLifeDays: 21,
    lookbackSessions: 20,
    rotationWindow: '3m',
    description:
      'Disusun ulang tiap awal bulan. Narasi berumur tiga minggu masih dihitung setengah, jadi tema kebijakan yang butuh waktu untuk terwujud tidak keburu hilang. Konfirmasi tape memakai jendela 20 sesi.',
  },
};

export interface ThemeHit {
  theme: NarrativeTheme;
  member: ThemeMember;
  weight: number;
}

export interface NarrativeStage {
  /** 0-1 from IDX filings. */
  filingScore: number;
  /** 0-1 from curated policy themes. */
  themeScore: number;
  score: number;
  signal: NarrativeSignal | null;
  themes: ThemeHit[];
  underExchangeAttention: boolean;
  headline: string;
}

export interface RotationStage {
  score: number;
  group: GroupRotation | null;
  role: 'leader' | 'middle' | 'laggard' | null;
  gapToLeader: number;
  cohesion: number;
  verdict: GroupRotation['verdict'] | null;
}

export interface PriceActionStage {
  score: number;
  /** The hard screener rules, evaluated on the same session. */
  screener: ScreenerRow | null;
  /** True when the MOMENTUM rules pass — kept under its original name. */
  passesScreener: boolean;
  /**
   * Which screener setups this emiten satisfies today, in registry order.
   *
   * Empty is a real answer and is left empty: it means the narrative is there
   * and the tape has not confirmed it in any of the three ways we can check.
   */
  setups: ScreenerMode[];
  /** Close against its 60-session high, as a fraction — the pullback reading. */
  dipFromHigh: number;
  /** Reference index return minus the stock's own, in percentage points. */
  gapToIndexPp: number;
  /** Which index that gap was measured against. */
  indexCode: string;
  foreignNetIdrBn: number;
  volumeSurge: number;
  /** Value ÷ frequency today, in IDR — the per-stock average ticket size. */
  avgTicketIdr: number;
  /**
   * Where that ticket sits among every emiten that traded today, 0-1.
   *
   * Compared across the market rather than against the stock's own history for
   * one reason: history.json stores turnover but not trade COUNT, so a past
   * session's ticket size cannot be reconstructed at all. The cross-section
   * can, and it answers the same question — are the hands in this stock bigger
   * than the hands in the rest of the market today.
   */
  ticketPercentile: number;
  /** Today's turnover over the emiten's own 20-session median turnover. */
  valueSurge: number;
  /** Percentage-point change in institutional ownership, 3 months, KSEI. */
  institutionalDeltaPp: number;
  returnOverHorizon: number;
  rsi14: number;
  liquidityIdrBn: number;
}

export interface WatchlistCandidate {
  code: string;
  name: string;
  sector: string;
  close: number;
  changePercent: number;
  narrative: NarrativeStage;
  rotation: RotationStage;
  priceAction: PriceActionStage;
  /** Weighted composite of the three stages, 0-1. */
  score: number;
  /** How many of the three stages produced a meaningful reading. */
  stagesCleared: number;
  reasons: string[];
  cautions: string[];
  /** Symbol for the TradingView embed, e.g. "IDX:BBCA". */
  tradingViewSymbol: string;
}

export interface WatchlistResult {
  horizon: HorizonProfile;
  session: string;
  asOf: string;
  candidates: WatchlistCandidate[];
  funnel: { id: string; label: string; remaining: number; note: string }[];
  /** Set when announcements.json has not been built. */
  missing: string[];
  themesUnsourced: number;
}

export interface WatchlistInputs {
  db: MarketDatabase;
  factors: Map<string, FactorSnapshot> | null;
  announcements: AnnouncementsFile | null;
  ownership: OwnershipFile | null;
  horizon: Horizon;
  limit?: number;
  screenerSettings?: Partial<ScreenerSettings>;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Fraction of `sorted` at or below `value`, by binary search. */
function percentileOf(sorted: number[], value: number): number {
  if (!sorted.length || !Number.isFinite(value)) return NaN;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

/** Median turnover over the last `k` sessions, in IDR million. */
function medianValue(db: MarketDatabase, code: string, k: number): number {
  const s = db.series.get(code);
  if (!s) return NaN;
  const vals: number[] = [];
  for (let i = Math.max(0, s.value.length - k); i < s.value.length; i++) {
    const v = s.value[i];
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  if (!vals.length) return NaN;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export function buildWatchlist({
  db,
  factors,
  announcements,
  ownership,
  horizon,
  limit = 25,
  screenerSettings,
}: WatchlistInputs): WatchlistResult {
  const profile = HORIZONS[horizon];
  const missing: string[] = [];
  const asOf = announcements?.to ?? db.meta.latestSession;

  // ---- stage 1: narrative -------------------------------------------------
  const signals = announcements
    ? buildNarrativeSignals(announcements, profile.narrativeHalfLifeDays)
    : new Map<string, NarrativeSignal>();
  if (!announcements) missing.push('announcements.json — jalankan "npm run data:announcements"');

  const themeHits = new Map<string, ThemeHit[]>();
  for (const [code, entries] of THEMES_BY_CODE) {
    const hits = entries
      .map(({ theme, member }) => ({ theme, member, weight: themeWeight(theme, member, asOf) }))
      .filter((h) => h.weight > 0);
    if (hits.length) themeHits.set(code, hits);
  }

  // ---- stage 2: conglomerate rotation ------------------------------------
  const rotations = factors ? computeAllGroupRotations(db, factors) : [];
  const rotationByCode = new Map<string, { group: GroupRotation; member: GroupRotation['members'][number] }>();
  for (const g of rotations) for (const m of g.members) rotationByCode.set(m.code, { group: g, member: m });

  // ---- stage 3: price action ---------------------------------------------
  //
  // All three screens are run, not just the momentum one. The readings on a row
  // (dip, gap, volume, MA distances) are identical across modes — only the
  // rule verdicts differ — so `screen` stays the momentum result for every
  // number the rest of this function reads, and the other two are consulted
  // solely for their pass/fail.
  const screens: Record<ScreenerMode, ReturnType<typeof runStockScreener>> = {
    momentum: runStockScreener(db, { ...screenerSettings, mode: 'momentum' }),
    pullback: runStockScreener(db, { ...screenerSettings, mode: 'pullback' }),
    laggard: runStockScreener(db, { ...screenerSettings, mode: 'laggard' }),
  };
  const screen = screens.momentum;

  // Every traded emiten's average ticket today, sorted, so a candidate's ticket
  // can be placed in the market's own distribution rather than against an
  // arbitrary rupiah threshold that would mean something different in a bull
  // tape than in a quiet one.
  const ticketLadder: number[] = [];
  for (const q of db.daily.values()) {
    if (q.freq > 0 && q.value > 0) ticketLadder.push(q.value / q.freq);
  }
  ticketLadder.sort((a, b) => a - b);

  const candidates: WatchlistCandidate[] = [];
  let entered = 0;

  for (const e of db.emiten) {
    const signal = signals.get(e.code) ?? null;
    const themes = themeHits.get(e.code) ?? [];

    const filingScore = signal ? signal.score : 0;
    // Several themes on one emiten compound but saturate: being in both the
    // biodiesel and food-estate stories is a stronger story than being in one,
    // but not twice as strong.
    const themeRaw = themes.reduce((s, h) => s + h.weight, 0);
    const themeScore = 1 - Math.exp(-themeRaw / 1.1);

    // The narrative gate. Filings and themes are alternatives, not a sum:
    // an acquisition is a reason on its own, and so is being the only listed
    // solar-panel maker when a solar programme is announced.
    const narrativeScore = Math.max(filingScore, themeScore * 0.9);
    if (narrativeScore < 0.12) continue;

    const quote = db.daily.get(e.code);
    const f = factors?.get(e.code);
    if (!quote || !(quote.close > 0)) continue;
    entered++;

    // -- rotation
    const rot = rotationByCode.get(e.code) ?? null;
    let rotationScore = 0;
    if (rot) {
      const groupReturn = profile.rotationWindow === '1m' ? rot.group.groupReturn1m : rot.group.groupReturn3m;
      const groupMoving = clamp01((groupReturn ?? 0) / 0.25);
      const cohesionOk = clamp01(((rot.group.cohesion || 0) - 0.2) / 0.4);
      // A leader inside a moving group is a confirmation; a laggard inside one
      // is the actual rotation trade. Both are worth something, the laggard more.
      const positional = rot.member.role === 'leader' ? 0.45 : rot.member.rotationScore;
      rotationScore = clamp01(groupMoving * 0.4 + cohesionOk * 0.25 + positional * 0.35);
    }

    // -- price action
    const row = screen.all.get(e.code) ?? null;
    const avgTicketIdr = quote.freq > 0 ? quote.value / quote.freq : NaN;
    const median20 = medianValue(db, e.code, 20) * 1e6; // history value is IDR mn
    const valueSurge = Number.isFinite(median20) && median20 > 0 ? quote.value / median20 : NaN;
    const ticketPercentile = percentileOf(ticketLadder, avgTicketIdr);

    let institutionalDeltaPp = NaN;
    if (ownership) {
      const prof = computeOwnershipProfile(ownership, e.code);
      if (prof) institutionalDeltaPp = prof.institusiChange3m * 100;
    }

    const returnOverHorizon =
      profile.lookbackSessions <= 5 ? (f?.return1w ?? NaN) : (f?.return1m ?? NaN);

    // Which of the three setups the tape satisfies today.
    const setups: ScreenerMode[] = [];
    for (const m of SCREENER_MODES) if (screens[m.id].all.get(e.code)?.passAll) setups.push(m.id);

    const flowScore = clamp01((quote.foreignNet / IDR_BN) / 10) * 0.35;
    const surgeScore = clamp01(((row?.volumeSurge ?? 1) - 1) / 1.2) * 0.2;
    const ticketScore = clamp01((valueSurge - 1) / 2) * 0.1 + clamp01((ticketPercentile - 0.5) / 0.4) * 0.05;
    // The setup term takes the BEST of the three, and the momentum branch is
    // byte-for-byte what it always was. That is deliberate: adding the two new
    // setups must not be able to REMOVE a name from a list somebody has been
    // reading for months, so no existing candidate's tape score can fall. A
    // pullback or a laggard scores just under a clean momentum pass, because a
    // stock that is already moving has answered one question these two have
    // only posed.
    const momentumTape = (row?.passMa ? 0.15 : 0) + (row?.passAll ? 0.05 : 0);
    const alternativeTape = setups.some((m) => m !== 'momentum') ? 0.16 : 0;
    const trendScore = Math.max(momentumTape, alternativeTape);
    const ownershipScore = Number.isFinite(institutionalDeltaPp) ? clamp01(institutionalDeltaPp / 2) * 0.1 : 0;
    const priceActionScore = clamp01(flowScore + surgeScore + ticketScore + trendScore + ownershipScore);

    // Narrative is the entry ticket and carries the most weight; the tape is
    // the confirmation; the group is context that is often simply absent.
    //
    // The tape then gets a partial veto on top of its weight. Without it a
    // company with a spectacular filing and no buyers ranks above one where the
    // story is real AND money is moving — which inverts the whole point of a
    // watchlist you intend to trade. It halves rather than zeroes, because a
    // narrative the tape has not noticed yet is exactly what a watchlist is for.
    const tapeMultiplier = 0.55 + 0.45 * clamp01(priceActionScore / 0.35);
    const score = clamp01(
      (narrativeScore * 0.45 + priceActionScore * 0.35 + rotationScore * 0.2) * tapeMultiplier
    );

    const reasons: string[] = [];
    const cautions: string[] = [];

    if (signal?.top) {
      const top = signal.top;
      reasons.push(
        `${top.meta.label}: "${top.title}" (${top.ageDays === 0 ? 'hari ini' : `${top.ageDays} hari lalu`}).`
      );
    }
    for (const h of themes.slice(0, 2)) {
      reasons.push(
        `Tema ${h.theme.name} — ${h.member.why}${h.member.exposure === 'tidak-langsung' ? ' (eksposur tidak langsung)' : ''}`
      );
    }
    if (rot && rot.group.verdict.level === 'kuat') {
      reasons.push(
        rot.member.role === 'laggard'
          ? `Anggota paling tertinggal di ${rot.group.group.name}, kohesi grup ${rot.group.cohesion.toFixed(2)}.`
          : `Anggota ${rot.group.group.name} yang sedang bergerak, kohesi ${rot.group.cohesion.toFixed(2)}.`
      );
    }
    if (quote.foreignNet / IDR_BN > 1) {
      reasons.push(`Asing net beli Rp ${(quote.foreignNet / IDR_BN).toFixed(1)} miliar pada sesi ini.`);
    }
    if (Number.isFinite(valueSurge) && valueSurge > 2) {
      reasons.push(`Nilai transaksi ${valueSurge.toFixed(1)}x median 20 sesi terakhirnya sendiri.`);
    }
    if (Number.isFinite(ticketPercentile) && ticketPercentile > 0.8) {
      reasons.push(
        `Tiket rata-rata Rp ${(avgTicketIdr / 1e6).toFixed(1)} juta — persentil ${(ticketPercentile * 100).toFixed(0)} pasar hari ini, ciri partisipasi tangan besar.`
      );
    }
    if (Number.isFinite(institutionalDeltaPp) && institutionalDeltaPp > 0.5) {
      reasons.push(`Porsi institusi di register KSEI naik ${institutionalDeltaPp.toFixed(2)} pp dalam 3 bulan.`);
    }
    if (setups.includes('pullback') && row) {
      reasons.push(
        `Zona antre beli: ${(-row.dipFromHigh * 100).toFixed(1)}% di bawah puncak ${screen.settings.dipWindow} sesi, tapi masih di atas MA${screen.settings.trendMa} — trennya belum patah.`
      );
    }
    if (setups.includes('laggard') && row) {
      reasons.push(
        `Tertinggal ${row.gapToIndexPp.toFixed(1)} pp dari ${row.indexCode}: indeksnya ${(row.indexReturn * 100).toFixed(1)}% dalam ${screen.settings.gapWindow} sesi, sahamnya ${(row.stockReturn * 100).toFixed(1)}%.`
      );
    }

    if (signal?.underExchangeAttention) {
      cautions.push('Bursa sudah meminta penjelasan atas pergerakan harga atau pemberitaan — baca pengumumannya sebelum masuk.');
    }
    if (themes.some((h) => !h.theme.source.trim())) {
      cautions.push('Sebagian tema yang menopang emiten ini belum punya tautan sumber; bobotnya sudah dipotong setengah.');
    }
    // Only a candidate that fits NONE of the three setups gets the warning. A
    // pullback that fails the momentum rules is not a failure, it is the setup
    // working as intended, and printing "tidak lolos screener" under a reason
    // that just explained why the price is down would contradict itself.
    if (row && !setups.length) {
      const failed = [
        !row.passMa && `belum di atas MA${screen.settings.maShort}/MA${screen.settings.maLong}`,
        !row.passVolume && 'volume di bawah ambang',
        !row.passValue && 'nilai transaksi di bawah ambang',
      ].filter(Boolean);
      cautions.push(`Tidak lolos satu pun setup screener: ${failed.join(', ')}.`);
    }
    if (setups.length === 1 && setups[0] === 'laggard' && row && row.stockReturn < 0) {
      cautions.push(
        `Sahamnya sendiri ${(row.stockReturn * 100).toFixed(1)}% dalam ${screen.settings.gapWindow} sesi — jarak ke indeks bisa berarti salah harga, bisa juga berarti pasar tahu sesuatu. Layar ini tidak bisa membedakannya.`
      );
    }
    if (rot && rot.group.verdict.level === 'tidak-valid') {
      cautions.push(`Anggota ${rot.group.group.name}, tetapi grup itu tidak bergerak bersama — jangan hitung sebagai rotasi.`);
    }
    if (Number.isFinite(f?.rsi14) && (f as FactorSnapshot).rsi14 > 75) {
      cautions.push(`RSI ${(f as FactorSnapshot).rsi14.toFixed(0)} — sudah jenuh beli.`);
    }

    const stagesCleared =
      (narrativeScore >= 0.12 ? 1 : 0) + (rotationScore >= 0.25 ? 1 : 0) + (priceActionScore >= 0.25 ? 1 : 0);

    candidates.push({
      code: e.code,
      name: e.name,
      sector: e.sector,
      close: quote.close,
      changePercent: quote.prev > 0 ? quote.close / quote.prev - 1 : NaN,
      narrative: {
        filingScore,
        themeScore,
        score: narrativeScore,
        signal,
        themes,
        underExchangeAttention: Boolean(signal?.underExchangeAttention),
        headline: signal?.top
          ? signal.top.title
          : themes.length
            ? `Tema ${themes[0].theme.name}`
            : 'Tanpa pemicu tercatat',
      },
      rotation: {
        score: rotationScore,
        group: rot?.group ?? null,
        role: rot?.member.role ?? null,
        gapToLeader: rot?.member.gapToLeader ?? NaN,
        cohesion: rot?.group.cohesion ?? NaN,
        verdict: rot?.group.verdict ?? null,
      },
      priceAction: {
        score: priceActionScore,
        screener: row,
        passesScreener: Boolean(row?.passAll),
        setups,
        dipFromHigh: row?.dipFromHigh ?? NaN,
        gapToIndexPp: row?.gapToIndexPp ?? NaN,
        indexCode: row?.indexCode ?? '',
        foreignNetIdrBn: quote.foreignNet / IDR_BN,
        volumeSurge: row?.volumeSurge ?? NaN,
        avgTicketIdr,
        ticketPercentile,
        valueSurge,
        institutionalDeltaPp,
        returnOverHorizon,
        rsi14: f?.rsi14 ?? NaN,
        liquidityIdrBn: f?.medianValue20IdrBn ?? NaN,
      },
      score,
      stagesCleared,
      reasons,
      cautions,
      tradingViewSymbol: `IDX:${e.code}`,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // KEDUANYA dihitung dari `candidates` yang sama, yaitu tahap 1. Ini BUKAN
  // rantai bersarang, dan angkanya memang bisa naik lagi di tahap 3: pada
  // 2026-09-03 layarnya menunjukkan 284 -> 34 -> 113. Yang salah waktu itu
  // bukan angkanya melainkan katanya — tahap 3 berbunyi "Di antaranya", yang
  // membuat corong tak-bersarang terbaca seolah bersarang dan menyuruh pembaca
  // menghitung 113 dari 34. Tahap 2 menilai, ia tidak pernah menggugurkan.
  const withRotation = candidates.filter((c) => c.rotation.score >= 0.25).length;
  const withTape = candidates.filter((c) => c.priceAction.score >= 0.25).length;

  const funnel = [
    {
      id: 'narrative',
      label: '1. Narasi',
      remaining: entered,
      note: 'Emiten dengan pengajuan material ke IDX atau yang masuk tema kebijakan terkurasi.',
    },
    {
      id: 'rotation',
      label: '2. Rotasi konglomerasi',
      remaining: withRotation,
      note: 'Di antaranya, yang berada di grup pengendali yang benar-benar sedang bergerak dan kohesif. Tahap ini MENILAI, bukan menyaring — sebagian besar emiten tidak punya grup pengendali, dan itu bukan cacat.',
    },
    {
      id: 'price',
      label: '3. Price action',
      remaining: withTape,
      note: 'Dihitung dari tahap 1, BUKAN dari tahap 2 — karena tahap 2 tidak menggugurkan siapa pun, angka di sini bisa lebih besar daripada di atasnya. Yang tape-nya ikut mengonfirmasi: arus asing, lonjakan nilai, ukuran tiket, dan aturan screener — ketiga setup-nya sekaligus (momentum, antre beli, tertinggal), bukan hanya yang sedang naik.',
    },
    {
      id: 'chart',
      label: '4. Chart',
      remaining: Math.min(limit, candidates.length),
      note: 'Langkah terakhir tidak diskor: buka chart TradingView tiap kandidat dan putuskan sendiri. Angka di sini adalah jumlah kandidat yang ditampilkan, bukan sisa saringan — tahap 2 dan 3 adalah penilaian, bukan gerbang.',
    },
  ];

  return {
    horizon: profile,
    session: db.meta.latestSession,
    asOf,
    candidates: candidates.slice(0, limit),
    funnel,
    missing,
    themesUnsourced: NARRATIVE_THEMES.filter((t) => !t.source.trim()).length,
  };
}
