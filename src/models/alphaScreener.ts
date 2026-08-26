// Daily alpha screener for the IDX universe.
//
// Pipeline: eligibility filter -> cross-sectional z-scores per factor block ->
// strategy-weighted composite -> ranked picks with an ATR-sized trade plan.
//
// Scoring is purely cross-sectional against the eligible universe of the same
// session, so a score of +1.8 always means "1.8 sigma better than the median
// eligible emiten today" regardless of whether the whole market is up or down.

import {
  Emiten,
  FactorContribution,
  FactorSnapshot,
  ScreenFilters,
  ScreenResult,
  StockPick,
  StrategyId,
  StrategyProfile,
  TradePlan,
} from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { computeAllFactors, computeIndexReturns, W } from './factorEngine';
import { SECTOR_TO_INDEX } from '../data/idxIndexCatalog';

// ------------------------------------------------------------------ profiles

export const FACTOR_BLOCK_LABELS: Record<string, string> = {
  momentum: 'Momentum harga',
  trend: 'Kualitas tren',
  nearHigh: 'Dekat puncak 52 minggu',
  pullback: 'Timing pullback',
  foreignFlow: 'Aliran dana asing',
  liquidity: 'Likuiditas',
  volumeSurge: 'Lonjakan volume',
  relativeStrength: 'Kekuatan relatif',
  lowVolatility: 'Volatilitas rendah',
  sectorMomentum: 'Momentum sektor',
  contrarian: 'Potensi pembalikan',
};

export const STRATEGY_PROFILES: StrategyProfile[] = [
  {
    id: 'balanced-alpha',
    name: 'Balanced Alpha',
    tagline: 'Campuran momentum, tren, aliran asing, dan likuiditas',
    description:
      'Profil serba bisa untuk watchlist harian. Menyeimbangkan momentum harga dengan kualitas tren, arus dana asing, dan likuiditas agar hasilnya benar-benar bisa dieksekusi.',
    weights: {
      momentum: 0.2,
      trend: 0.2,
      foreignFlow: 0.15,
      relativeStrength: 0.15,
      liquidity: 0.1,
      volumeSurge: 0.08,
      lowVolatility: 0.07,
      nearHigh: 0.05,
    },
  },
  {
    id: 'momentum-breakout',
    name: 'Momentum Breakout',
    tagline: 'Saham yang menembus puncak dengan konfirmasi volume',
    description:
      'Mengejar emiten yang sedang mencetak harga tertinggi baru dengan tren mulus dan lonjakan volume. Agresif — cocok untuk holding period pendek dengan stop yang disiplin.',
    weights: {
      momentum: 0.25,
      trend: 0.22,
      nearHigh: 0.18,
      volumeSurge: 0.15,
      relativeStrength: 0.12,
      liquidity: 0.08,
    },
  },
  {
    id: 'foreign-flow',
    name: 'Foreign Flow Follower',
    tagline: 'Mengikuti akumulasi bersih investor asing',
    description:
      'Net foreign buy adalah salah satu sinyal paling persisten di IDX. Profil ini memberi bobot terbesar pada intensitas arus asing 20 hari relatif terhadap nilai transaksinya sendiri.',
    weights: {
      foreignFlow: 0.4,
      liquidity: 0.18,
      relativeStrength: 0.15,
      trend: 0.15,
      momentum: 0.12,
    },
    overrides: { minMedianValueIdrBn: 5 },
  },
  {
    id: 'pullback-uptrend',
    name: 'Pullback in Uptrend',
    tagline: 'Beli koreksi sehat pada saham yang trennya masih naik',
    description:
      'Mencari emiten dengan tren jangka panjang tetap positif tetapi harga sedang mundur ke bawah rata-rata jangka pendeknya. Risiko masuk lebih rendah dibanding mengejar breakout.',
    weights: {
      trend: 0.3,
      pullback: 0.3,
      lowVolatility: 0.15,
      momentum: 0.13,
      liquidity: 0.12,
    },
  },
  {
    id: 'sector-rotation',
    name: 'Sector Rotation',
    tagline: 'Pemimpin di sektor IDX-IC yang sedang memimpin',
    description:
      'Pertama memeringkat 11 indeks sektoral IDX-IC berdasarkan return 3 bulan, lalu memilih emiten terkuat di dalam sektor yang sedang unggul.',
    weights: {
      sectorMomentum: 0.3,
      relativeStrength: 0.22,
      momentum: 0.18,
      trend: 0.15,
      liquidity: 0.15,
    },
  },
  {
    id: 'liquid-turnaround',
    name: 'Liquid Turnaround',
    tagline: 'Saham likuid yang jatuh dalam tetapi mulai dikumpulkan',
    description:
      'Kontrarian: emiten yang tertekan sepanjang tahun namun mulai menunjukkan akumulasi asing dan lonjakan volume. Batas likuiditas dinaikkan karena risikonya paling tinggi.',
    weights: {
      contrarian: 0.28,
      pullback: 0.22,
      foreignFlow: 0.2,
      liquidity: 0.18,
      volumeSurge: 0.12,
    },
    overrides: { minMedianValueIdrBn: 10, minMarketCapIdrBn: 1000 },
  },
];

export const DEFAULT_FILTERS: ScreenFilters = {
  minClose: 50,              // below Rp50 is the gocap / auto-reject floor
  maxClose: 1_000_000,
  minMedianValueIdrBn: 2,    // Rp 2 bn median daily turnover
  minMarketCapIdrBn: 500,
  minTradedSessions20: 15,
  minSessionsAvailable: 120,
  excludeBoards: ['Acceleration'],
  sectors: [],
  indexFilter: '',
  maxPicks: 15,
};

export function getStrategy(id: StrategyId): StrategyProfile {
  return STRATEGY_PROFILES.find((s) => s.id === id) || STRATEGY_PROFILES[0];
}

// -------------------------------------------------------------- z-scoring

/** Winsorised cross-sectional z-score. NaN inputs land on 0 (neutral). */
function zScore(values: number[]): number[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return values.map(() => 0);
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return values.map(() => 0);
  return values.map((v) => (Number.isFinite(v) ? Math.max(-3, Math.min(3, (v - mean) / sd)) : 0));
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * RSI is not monotonically good — the sweet spot for a pullback entry is the
 * 35-55 band. Map it to a bell centred there instead of z-scoring it raw.
 */
function rsiSweetSpot(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.exp(-((value - 45) ** 2) / (2 * 12 ** 2)) * 2 - 1;
}

// --------------------------------------------------------------- eligibility

interface Candidate {
  emiten: Emiten;
  factors: FactorSnapshot;
}

function passesFilters(
  e: Emiten,
  f: FactorSnapshot,
  filters: ScreenFilters,
  reject: Record<string, number>
): boolean {
  const fail = (reason: string) => {
    reject[reason] = (reject[reason] || 0) + 1;
    return false;
  };
  if (f.close < filters.minClose) return fail(`Harga < Rp ${filters.minClose}`);
  if (f.close > filters.maxClose) return fail(`Harga > Rp ${filters.maxClose}`);
  if (f.sessionsAvailable < filters.minSessionsAvailable) return fail('Riwayat terlalu pendek');
  if (f.tradedSessions20 < filters.minTradedSessions20) return fail('Jarang ditransaksikan');
  if (f.medianValue20IdrBn < filters.minMedianValueIdrBn) return fail('Likuiditas di bawah ambang');
  if (f.marketCapIdrBn < filters.minMarketCapIdrBn) return fail('Kapitalisasi pasar terlalu kecil');
  if (filters.excludeBoards.includes(e.board)) return fail(`Papan ${e.board}`);
  if (filters.sectors.length && !filters.sectors.includes(e.sector)) return fail('Di luar sektor terpilih');
  return true;
}

// -------------------------------------------------------------- trade plan

/** IDX price ticks (fraksi harga) — orders must sit on these increments. */
export function idxTick(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

export function roundToTick(price: number, mode: 'down' | 'up' | 'nearest' = 'nearest'): number {
  if (!(price > 0)) return 0;
  const tick = idxTick(price);
  const q = price / tick;
  const n = mode === 'down' ? Math.floor(q) : mode === 'up' ? Math.ceil(q) : Math.round(q);
  return Math.max(tick, n * tick);
}

export interface PlanSettings {
  riskBudgetIdr: number;   // rupiah the trader is willing to lose on this idea
  atrStopMultiple: number;
  atrTarget1Multiple: number;
  atrTarget2Multiple: number;
  maxPercentOfAdv: number; // position value cap as a share of median daily turnover
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  riskBudgetIdr: 10_000_000,
  atrStopMultiple: 2,
  atrTarget1Multiple: 3,
  atrTarget2Multiple: 5,
  maxPercentOfAdv: 0.1,
};

function buildPlan(f: FactorSnapshot, settings: PlanSettings): TradePlan {
  const entry = roundToTick(f.close);
  const atr = Number.isFinite(f.atr14) && f.atr14 > 0 ? f.atr14 : f.close * 0.03;

  // Keep the stop inside a sane band: never tighter than 3% (IDX noise) and
  // never wider than 15% (position sizing becomes meaningless past that).
  const rawStop = entry - settings.atrStopMultiple * atr;
  const stopLoss = roundToTick(
    Math.min(Math.max(rawStop, entry * 0.85), entry * 0.97),
    'down'
  );

  const riskPerShare = Math.max(entry - stopLoss, idxTick(entry));
  const target1 = roundToTick(entry + settings.atrTarget1Multiple * atr, 'up');
  const target2 = roundToTick(entry + settings.atrTarget2Multiple * atr, 'up');

  const riskShares = Math.floor(settings.riskBudgetIdr / riskPerShare);
  const advIdr = f.medianValue20IdrBn * 1e9;
  const liquidityShares = advIdr > 0 ? Math.floor((advIdr * settings.maxPercentOfAdv) / entry) : riskShares;
  const shares = Math.max(0, Math.min(riskShares, liquidityShares));
  const lots = Math.floor(shares / 100);

  return {
    entry,
    stopLoss,
    target1,
    target2,
    riskPerShare,
    rewardRiskRatio: riskPerShare > 0 ? (target1 - entry) / riskPerShare : 0,
    suggestedShares: lots * 100,
    suggestedLots: lots,
    positionValueIdr: lots * 100 * entry,
    liquidityCappedLots: Math.floor(liquidityShares / 100),
  };
}

// ------------------------------------------------------------------- runner

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const bn = (v: number, digits = 1) => `Rp ${v.toFixed(digits)} miliar`;

function buildRationale(e: Emiten, f: FactorSnapshot, top: FactorContribution[]): string[] {
  const out: string[] = [];

  if (Number.isFinite(f.return3m)) {
    out.push(
      `Return 3 bulan ${pct(f.return3m)} — ${
        f.relativeStrength3m >= 0 ? 'unggul' : 'tertinggal'
      } ${pct(Math.abs(f.relativeStrength3m))} terhadap IHSG.`
    );
  }
  if (f.goldenCross && Number.isFinite(f.priceVsSma200)) {
    out.push(`MA50 di atas MA200 dan harga ${pct(f.priceVsSma200)} di atas MA200 — struktur tren naik utuh.`);
  } else if (Number.isFinite(f.priceVsSma200) && f.priceVsSma200 < 0) {
    out.push(`Harga masih ${pct(f.priceVsSma200)} di bawah MA200 — tren jangka panjang belum pulih.`);
  }
  if (Number.isFinite(f.distanceFrom52wHigh)) {
    out.push(
      f.distanceFrom52wHigh > -0.05
        ? `Hanya ${pct(Math.abs(f.distanceFrom52wHigh))} dari puncak 52 minggu.`
        : `Berada ${pct(Math.abs(f.distanceFrom52wHigh))} di bawah puncak 52 minggu.`
    );
  }
  if (Math.abs(f.foreignNet20IdrBn) >= 1) {
    out.push(
      `Asing ${f.foreignNet20IdrBn > 0 ? 'net beli' : 'net jual'} ${bn(
        Math.abs(f.foreignNet20IdrBn)
      )} dalam 20 sesi (${pct(Math.abs(f.foreignIntensity))} dari nilai transaksinya).`
    );
  }
  if (Number.isFinite(f.volumeSurge) && f.volumeSurge > 1.3) {
    out.push(`Volume 20 hari ${f.volumeSurge.toFixed(2)}x rata-rata 60 hari — partisipasi meningkat.`);
  }
  out.push(
    `Likuiditas median ${bn(f.medianValue20IdrBn)}/hari, kapitalisasi ${bn(f.marketCapIdrBn, 0)}, sektor ${e.sector}.`
  );
  if (top.length) {
    out.push(
      `Kontributor skor terbesar: ${top
        .map((c) => `${c.label} (${c.contribution >= 0 ? '+' : ''}${c.contribution.toFixed(2)})`)
        .join(', ')}.`
    );
  }
  return out;
}

function buildFlags(e: Emiten, f: FactorSnapshot): string[] {
  const flags: string[] = [];
  if (e.board === 'Acceleration') flags.push('Papan Akselerasi — risiko tinggi');
  if (e.board === 'Development') flags.push('Papan Pengembangan');
  if (Number.isFinite(f.annualisedVol) && f.annualisedVol > 0.6)
    flags.push(`Volatilitas tahunan ${pct(f.annualisedVol, 0)}`);
  if (f.medianValue20IdrBn < 5) flags.push('Likuiditas tipis — perhatikan slippage');
  if (Number.isFinite(f.rsi14) && f.rsi14 > 75) flags.push(`RSI ${f.rsi14.toFixed(0)} — overbought`);
  if (Number.isFinite(f.rsi14) && f.rsi14 < 25) flags.push(`RSI ${f.rsi14.toFixed(0)} — oversold`);
  if (f.close < 100) flags.push('Harga di bawah Rp 100');
  if (f.tradedSessions20 < 20) flags.push(`Hanya ${f.tradedSessions20}/20 sesi ditransaksikan`);
  if (Number.isFinite(f.maxDrawdown6m) && f.maxDrawdown6m < -0.4)
    flags.push(`Drawdown 6 bulan ${pct(f.maxDrawdown6m, 0)}`);
  return flags;
}

/**
 * Conviction is the score tier knocked down by how hard the idea is to actually
 * hold. A high score on a 130%-volatility Development-board name that trades on
 * 16 of the last 20 sessions is a screening artefact, not a high-conviction
 * idea, and labelling it as one would be misleading.
 */
function gradeConviction(score: number, e: Emiten, f: FactorSnapshot): StockPick['conviction'] {
  let penalty = 0;
  if (e.board === 'Acceleration') penalty += 2;
  else if (e.board === 'Development') penalty += 1;
  if (Number.isFinite(f.annualisedVol)) {
    if (f.annualisedVol > 0.8) penalty += 2;
    else if (f.annualisedVol > 0.6) penalty += 1;
  }
  if (f.medianValue20IdrBn < 5) penalty += 1;
  if (f.tradedSessions20 < 18) penalty += 1;
  if (f.close < 100) penalty += 1;

  const tiers: StockPick['conviction'][] = ['speculative', 'medium', 'high'];
  const base = score >= 0.9 ? 2 : score >= 0.45 ? 1 : 0;
  const demotion = penalty >= 3 ? 2 : penalty >= 2 ? 1 : 0;
  return tiers[Math.max(0, base - demotion)];
}

export interface RunScreenOptions {
  strategyId: StrategyId;
  filters?: Partial<ScreenFilters>;
  plan?: Partial<PlanSettings>;
  /** Reuse a precomputed factor map to avoid recomputing on every re-render. */
  factors?: Map<string, FactorSnapshot>;
}

export function runScreen(db: MarketDatabase, options: RunScreenOptions): ScreenResult {
  const strategy = getStrategy(options.strategyId);
  const filters: ScreenFilters = {
    ...DEFAULT_FILTERS,
    ...strategy.overrides,
    ...options.filters,
  };
  const planSettings: PlanSettings = { ...DEFAULT_PLAN_SETTINGS, ...options.plan };

  const factorMap = options.factors || computeAllFactors(db);
  const indexReturns = computeIndexReturns(db);

  // Sector momentum is the same number for every emiten in a sector; z-score it
  // across sectors first so it lands on the same scale as the stock factors.
  const sectorZ = new Map<string, number>();
  {
    const entries = [...indexReturns.sectorReturn3m.entries()];
    const zs = zScore(entries.map(([, v]) => v));
    entries.forEach(([sector], i) => sectorZ.set(sector, zs[i]));
  }

  const rejectedReasons: Record<string, number> = {};
  const candidates: Candidate[] = [];

  const indexMembers = filters.indexFilter ? resolveIndexMembers(db, filters.indexFilter) : null;

  for (const e of db.emiten) {
    const f = factorMap.get(e.code);
    if (!f) {
      rejectedReasons['Tidak ada data harga'] = (rejectedReasons['Tidak ada data harga'] || 0) + 1;
      continue;
    }
    if (indexMembers && !indexMembers.has(e.code)) {
      rejectedReasons['Bukan konstituen indeks terpilih'] =
        (rejectedReasons['Bukan konstituen indeks terpilih'] || 0) + 1;
      continue;
    }
    if (!passesFilters(e, f, filters, rejectedReasons)) continue;
    candidates.push({ emiten: e, factors: f });
  }

  if (!candidates.length) {
    return {
      session: db.meta.latestSession,
      strategy,
      filters,
      universeSize: db.emiten.length,
      eligibleSize: 0,
      picks: [],
      rejectedReasons,
    };
  }

  const col = (fn: (c: Candidate) => number) => candidates.map(fn);

  const zMom3 = zScore(col((c) => c.factors.return3m));
  const zMom6 = zScore(col((c) => c.factors.return6m));
  const zMom121 = zScore(col((c) => c.factors.momentum12_1));
  const zSma50 = zScore(col((c) => c.factors.priceVsSma50));
  const zSma200 = zScore(col((c) => c.factors.priceVsSma200));
  const zTrendQ = zScore(col((c) => c.factors.trendQuality));
  const zNearHigh = zScore(col((c) => c.factors.distanceFrom52wHigh));
  const zFgnIntensity = zScore(col((c) => c.factors.foreignIntensity));
  const zFgn20 = zScore(col((c) => Math.sign(c.factors.foreignNet20IdrBn) * Math.log1p(Math.abs(c.factors.foreignNet20IdrBn))));
  const zLiquidity = zScore(col((c) => Math.log1p(c.factors.medianValue20IdrBn)));
  const zVolSurge = zScore(col((c) => c.factors.volumeSurge));
  const zRsMarket = zScore(col((c) => c.factors.relativeStrength3m));
  const zRsSector = zScore(col((c) => c.factors.sectorRelativeStrength3m));
  const zVol = zScore(col((c) => c.factors.annualisedVol));
  const zPullbackDepth = zScore(col((c) => c.factors.zScore20));
  const zAnnual = zScore(col((c) => c.factors.return12m));

  const blocks: Record<string, number[]> = {
    momentum: candidates.map((_, i) => mean([zMom3[i], zMom6[i], zMom121[i]])),
    trend: candidates.map((c, i) =>
      mean([zSma50[i], zSma200[i], zTrendQ[i]]) + (c.factors.goldenCross ? 0.25 : -0.15)
    ),
    nearHigh: zNearHigh,
    pullback: candidates.map((c, i) => mean([-zPullbackDepth[i], rsiSweetSpot(c.factors.rsi14)])),
    foreignFlow: candidates.map((_, i) => mean([zFgnIntensity[i], zFgn20[i]])),
    liquidity: zLiquidity,
    volumeSurge: zVolSurge,
    relativeStrength: candidates.map((_, i) => mean([zRsMarket[i], zRsSector[i]])),
    lowVolatility: zVol.map((v) => -v),
    sectorMomentum: candidates.map((c) => sectorZ.get(c.emiten.sector) ?? 0),
    contrarian: zAnnual.map((v) => -v),
  };

  const scored = candidates.map((c, i) => {
    const contributions: FactorContribution[] = Object.entries(strategy.weights)
      .map(([block, weight]) => {
        const z = blocks[block]?.[i] ?? 0;
        return {
          block,
          label: FACTOR_BLOCK_LABELS[block] || block,
          zScore: z,
          weight,
          contribution: z * weight,
        };
      })
      .sort((a, b) => b.contribution - a.contribution);

    const compositeScore = contributions.reduce((s, x) => s + x.contribution, 0);
    return { candidate: c, compositeScore, contributions };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const picks: StockPick[] = scored.slice(0, filters.maxPicks).map((s, idx) => {
    const { candidate, compositeScore, contributions } = s;
    const percentile = 1 - idx / scored.length;

    return {
      rank: idx + 1,
      emiten: candidate.emiten,
      factors: candidate.factors,
      compositeScore,
      percentile,
      conviction: gradeConviction(compositeScore, candidate.emiten, candidate.factors),
      contributions,
      plan: buildPlan(candidate.factors, planSettings),
      rationale: buildRationale(candidate.emiten, candidate.factors, contributions.slice(0, 3)),
      flags: buildFlags(candidate.emiten, candidate.factors),
    };
  });

  return {
    session: db.meta.latestSession,
    strategy,
    filters,
    universeSize: db.emiten.length,
    eligibleSize: candidates.length,
    picks,
    rejectedReasons,
  };
}

/**
 * IDX does not publish machine-readable index constituents, so membership is
 * approximated. Sector indices are exact — they are simply the IDX-IC sector.
 * The broad indices (LQ45, IDX30, KOMPAS100, ...) are selected by IDX on
 * roughly a year of transaction value plus market capitalisation, so the proxy
 * here ranks on the geometric mean of 12-month average daily turnover and
 * market cap and takes as many names as the index reports members.
 *
 * This gets the blue chips right but will not match IDX's published list
 * exactly, and the UI says so where the filter is offered.
 */
export function resolveIndexMembers(db: MarketDatabase, indexCode: string): Set<string> {
  const series = db.indexSeries.get(indexCode);
  const target = series?.members || 0;
  const sectorOf = Object.entries(SECTOR_TO_INDEX).find(([, code]) => code === indexCode)?.[0];

  const pool = db.emiten.filter((e) => (sectorOf ? e.sector === sectorOf : true));
  if (sectorOf || !target || target >= pool.length) return new Set(pool.map((e) => e.code));

  const ranked = pool
    .map((e) => {
      const s = db.series.get(e.code);
      const quote = db.daily.get(e.code);
      if (!s || !quote) return { code: e.code, rank: 0 };

      const window = Math.min(W.m12, s.value.length);
      let sum = 0;
      let traded = 0;
      for (let i = s.value.length - window; i < s.value.length; i++) {
        if (Number.isFinite(s.value[i]) && s.value[i] > 0) {
          sum += s.value[i];
          traded++;
        }
      }
      // A name that barely trades cannot be in a liquidity index.
      if (traded < window * 0.8) return { code: e.code, rank: 0 };

      const avgTurnover = sum / window;
      const marketCap = quote.marketCap / 1e6; // same order of magnitude as turnover
      return { code: e.code, rank: Math.sqrt(Math.max(avgTurnover, 0) * Math.max(marketCap, 0)) };
    })
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, target);

  return new Set(ranked.map((r) => r.code));
}

/** One-paragraph read of the session, shown above the picks. */
export function buildDailyBriefing(result: ScreenResult, breadthAdvancers: number, breadthDecliners: number): string {
  const tone =
    breadthAdvancers > breadthDecliners * 1.3
      ? 'Breadth pasar positif'
      : breadthDecliners > breadthAdvancers * 1.3
        ? 'Breadth pasar negatif'
        : 'Breadth pasar seimbang';
  const top = result.picks[0];
  const lead = top
    ? `${top.emiten.code} memimpin dengan skor ${top.compositeScore.toFixed(2)}.`
    : 'Tidak ada emiten yang lolos seluruh filter hari ini.';
  return `${tone} pada sesi ${result.session} (${breadthAdvancers} naik / ${breadthDecliners} turun). Strategi "${result.strategy.name}" menyaring ${result.universeSize} emiten tercatat menjadi ${result.eligibleSize} kandidat yang layak dieksekusi. ${lead}`;
}
