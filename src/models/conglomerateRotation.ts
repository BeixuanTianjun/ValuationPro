// Conglomerate rotation.
//
// The pattern this models is specific to IDX: capital cycles between the listed
// vehicles of one controlling group. One member runs, the others lag, and the
// gap eventually narrows — sometimes because the laggard catches up, sometimes
// because the leader gives it back.
//
// WHAT THIS IS NOT: a forecast. Nothing here predicts a price. The model
// measures three things a rotation needs in order to be a real setup —
//
//   1. Is the GROUP actually moving? (group-level money flow and momentum)
//   2. Do these stocks genuinely trade together? (measured, not assumed)
//   3. Which member is stretched furthest from the group? (the dispersion gap)
//
// and reports them separately, so a wide gap inside a group that does not
// co-move is visibly not a rotation candidate. The curated group table is a
// starting point, not evidence — `cohesion` is the evidence.

import { FactorSnapshot } from '../types/market';
import { MarketDatabase } from '../data/marketRepository';
import { CONGLOMERATE_GROUPS, ConglomerateGroup, GroupConfidence } from '../data/conglomerates';
import { forwardFill, W } from './factorEngine';

export interface GroupMember {
  code: string;
  name: string;
  sector: string;
  price: number;
  marketCapIdrBn: number;
  liquidityIdrBn: number;
  return1m: number;
  return3m: number;
  return6m: number;
  /** Return minus the group's cap-weighted return, over 3 months. */
  relativeToGroup3m: number;
  rsi14: number;
  priceVsSma200: number;
  foreignNet20IdrBn: number;
  volumeSurge: number;
  /** Correlation of daily returns with the rest of the group. */
  correlationWithGroup: number;
  /** How stretched this member is versus the group leader, in percent. */
  gapToLeader: number;
  role: 'leader' | 'middle' | 'laggard';
  /** Composite catch-up score; higher means more stretched with flow turning. */
  rotationScore: number;
  evidence: string[];
}

export interface GroupRotation {
  group: ConglomerateGroup;
  confidence: GroupConfidence;
  membersFound: number;
  membersListed: number;
  combinedMarketCapIdrBn: number;
  combinedLiquidityIdrBn: number;
  /** Cap-weighted group return. */
  groupReturn1m: number;
  groupReturn3m: number;
  groupForeignNet20IdrBn: number;
  /** Spread between best and worst member over 3 months. */
  dispersion3m: number;
  /**
   * Mean pairwise correlation of daily returns inside the group, 0-1.
   * This is the measured evidence that the group trades as a group.
   */
  cohesion: number;
  members: GroupMember[];
  leader: GroupMember | null;
  candidate: GroupMember | null;
  /** Whether the setup is worth looking at, and why or why not. */
  verdict: { level: 'kuat' | 'lemah' | 'tidak-valid'; reason: string };
}

/** Daily log returns over the last `period` sessions, NaN-free by construction. */
function returnVector(db: MarketDatabase, code: string, period: number): number[] {
  const s = db.series.get(code);
  if (!s) return [];
  const ff = forwardFill(s.close);
  const out: number[] = [];
  for (let i = Math.max(1, ff.length - period); i < ff.length; i++) {
    const a = ff[i - 1];
    const b = ff[i];
    out.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
  }
  return out;
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[a.length - n + i];
    mb += b[b.length - n + i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[a.length - n + i] - ma;
    const db2 = b[b.length - n + i] - mb;
    cov += da * db2;
    va += da * da;
    vb += db2 * db2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function computeGroupRotation(
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot>,
  group: ConglomerateGroup
): GroupRotation | null {
  const present = group.members.filter((c) => factors.has(c) && db.byCode.has(c));
  if (present.length < 2) return null;

  const vectors = new Map<string, number[]>();
  for (const c of present) vectors.set(c, returnVector(db, c, W.m3));

  // Cap-weighted group return, so a Rp 200tn member is not outvoted by a
  // Rp 2tn one when we ask "is the group moving".
  let capTotal = 0;
  let liquidityTotal = 0;
  let weighted1m = 0;
  let weighted3m = 0;
  let foreignTotal = 0;

  const raw = present.map((code) => {
    const f = factors.get(code)!;
    const e = db.byCode.get(code)!;
    const cap = Number.isFinite(f.marketCapIdrBn) ? f.marketCapIdrBn : 0;
    capTotal += cap;
    liquidityTotal += Number.isFinite(f.medianValue20IdrBn) ? f.medianValue20IdrBn : 0;
    foreignTotal += Number.isFinite(f.foreignNet20IdrBn) ? f.foreignNet20IdrBn : 0;
    if (Number.isFinite(f.return1m)) weighted1m += f.return1m * cap;
    if (Number.isFinite(f.return3m)) weighted3m += f.return3m * cap;
    return { code, e, f, cap };
  });

  const groupReturn1m = capTotal > 0 ? weighted1m / capTotal : NaN;
  const groupReturn3m = capTotal > 0 ? weighted3m / capTotal : NaN;

  // Mean pairwise correlation — the measured cohesion of the group.
  let corrSum = 0;
  let corrCount = 0;
  const memberCorr = new Map<string, { sum: number; n: number }>();
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const c = correlation(vectors.get(present[i])!, vectors.get(present[j])!);
      if (!Number.isFinite(c)) continue;
      corrSum += c;
      corrCount++;
      for (const code of [present[i], present[j]]) {
        const entry = memberCorr.get(code) || { sum: 0, n: 0 };
        entry.sum += c;
        entry.n++;
        memberCorr.set(code, entry);
      }
    }
  }
  const cohesion = corrCount ? corrSum / corrCount : NaN;

  const returns3m = raw.map((r) => (Number.isFinite(r.f.return3m) ? r.f.return3m : 0));
  const best = Math.max(...returns3m);
  const worst = Math.min(...returns3m);

  const members: GroupMember[] = raw.map((r) => {
    const f = r.f;
    const ret3m = Number.isFinite(f.return3m) ? f.return3m : 0;
    const corr = memberCorr.get(r.code);
    const correlationWithGroup = corr && corr.n ? corr.sum / corr.n : NaN;
    const gapToLeader = best - ret3m;

    const role: GroupMember['role'] = ret3m >= best - 1e-9 ? 'leader' : ret3m <= worst + 1e-9 ? 'laggard' : 'middle';

    // A catch-up candidate needs three things at once: a real gap to the
    // leader, evidence it belongs to the group, and something suggesting the
    // gap is starting to close rather than simply widening.
    const gapScore = clamp01(gapToLeader / 0.5); // a 50pp gap saturates
    const cohesionScore = clamp01((correlationWithGroup - 0.15) / 0.5);
    const flowScore = clamp01(f.foreignNet20IdrBn / 20) * 0.5 + clamp01((f.volumeSurge - 1) / 0.8) * 0.5;
    const notFalling = clamp01((f.return1m + 0.05) / 0.15);
    const notOverbought = clamp01((70 - f.rsi14) / 30);

    const rotationScore =
      role === 'leader' ? 0 : gapScore * 0.35 + cohesionScore * 0.25 + flowScore * 0.2 + notFalling * 0.12 + notOverbought * 0.08;

    const evidence: string[] = [];
    if (role !== 'leader' && gapToLeader > 0.05) {
      evidence.push(`Tertinggal ${(gapToLeader * 100).toFixed(0)} poin persentase dari pemimpin grup dalam 3 bulan.`);
    }
    if (Number.isFinite(correlationWithGroup)) {
      evidence.push(
        correlationWithGroup >= 0.4
          ? `Korelasi harian ${correlationWithGroup.toFixed(2)} dengan anggota lain — benar-benar bergerak sebagai satu grup.`
          : `Korelasi harian hanya ${correlationWithGroup.toFixed(2)} — belum tentu ikut rotasi grup.`
      );
    }
    if (f.foreignNet20IdrBn > 1) {
      evidence.push(`Asing net beli Rp ${f.foreignNet20IdrBn.toFixed(1)} miliar dalam 20 sesi.`);
    } else if (f.foreignNet20IdrBn < -1) {
      evidence.push(`Asing masih net jual Rp ${Math.abs(f.foreignNet20IdrBn).toFixed(1)} miliar dalam 20 sesi.`);
    }
    if (Number.isFinite(f.volumeSurge) && f.volumeSurge > 1.3) {
      evidence.push(`Volume 20 hari ${f.volumeSurge.toFixed(2)}x rata-rata 60 hari.`);
    }
    if (Number.isFinite(f.rsi14) && f.rsi14 > 70) {
      evidence.push(`RSI ${f.rsi14.toFixed(0)} — sudah jenuh beli.`);
    }

    return {
      code: r.code,
      name: r.e.name,
      sector: r.e.sector,
      price: f.close,
      marketCapIdrBn: f.marketCapIdrBn,
      liquidityIdrBn: f.medianValue20IdrBn,
      return1m: f.return1m,
      return3m: f.return3m,
      return6m: f.return6m,
      relativeToGroup3m: Number.isFinite(groupReturn3m) ? ret3m - groupReturn3m : NaN,
      rsi14: f.rsi14,
      priceVsSma200: f.priceVsSma200,
      foreignNet20IdrBn: f.foreignNet20IdrBn,
      volumeSurge: f.volumeSurge,
      correlationWithGroup,
      gapToLeader,
      role,
      rotationScore,
      evidence,
    };
  });

  members.sort((a, b) => b.return3m - a.return3m);
  const leader = members.find((m) => m.role === 'leader') || null;
  const ranked = [...members].filter((m) => m.role !== 'leader').sort((a, b) => b.rotationScore - a.rotationScore);
  const candidate = ranked[0] || null;

  const dispersion3m = best - worst;

  let verdict: GroupRotation['verdict'];
  if (!Number.isFinite(cohesion) || cohesion < 0.25) {
    verdict = {
      level: 'tidak-valid',
      reason: `Korelasi rata-rata antar anggota hanya ${Number.isFinite(cohesion) ? cohesion.toFixed(2) : '–'}. Anggota grup ini tidak bergerak bersama, jadi "rotasi" di antara mereka tidak punya dasar terukur.`,
    };
  } else if (dispersion3m < 0.15) {
    verdict = {
      level: 'lemah',
      reason: `Sebaran return 3 bulan hanya ${(dispersion3m * 100).toFixed(0)} poin persentase — belum ada ketertinggalan yang berarti untuk dikejar.`,
    };
  } else if (!Number.isFinite(groupReturn3m) || groupReturn3m < 0) {
    verdict = {
      level: 'lemah',
      reason: `Grup secara keseluruhan turun ${((groupReturn3m || 0) * 100).toFixed(0)}% dalam 3 bulan. Ketertinggalan di dalam grup yang sedang melemah biasanya berlanjut, bukan berbalik.`,
    };
  } else {
    verdict = {
      level: 'kuat',
      reason: `Grup naik ${(groupReturn3m * 100).toFixed(0)}% dengan korelasi antar anggota ${cohesion.toFixed(2)} dan sebaran ${(dispersion3m * 100).toFixed(0)} poin persentase — kondisi yang biasanya menyertai rotasi di dalam grup.`,
    };
  }

  return {
    group,
    confidence: group.confidence,
    membersFound: present.length,
    membersListed: group.members.length,
    combinedMarketCapIdrBn: capTotal,
    combinedLiquidityIdrBn: liquidityTotal,
    groupReturn1m,
    groupReturn3m,
    groupForeignNet20IdrBn: foreignTotal,
    dispersion3m,
    cohesion,
    members,
    leader,
    candidate,
    verdict,
  };
}

export function computeAllGroupRotations(
  db: MarketDatabase,
  factors: Map<string, FactorSnapshot>
): GroupRotation[] {
  return CONGLOMERATE_GROUPS.map((g) => computeGroupRotation(db, factors, g))
    .filter((r): r is GroupRotation => r !== null)
    .sort((a, b) => {
      // Valid, active setups first; then by how much money the group moves.
      const rank = (r: GroupRotation) => (r.verdict.level === 'kuat' ? 2 : r.verdict.level === 'lemah' ? 1 : 0);
      return rank(b) - rank(a) || b.combinedLiquidityIdrBn - a.combinedLiquidityIdrBn;
    });
}
