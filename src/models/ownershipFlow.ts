// Institutional ownership — the mutual fund tracker.
//
// SCOPE — READ THIS BEFORE TRUSTING ANY NUMBER HERE. The source is KSEI's
// monthly "Balance Posisi Efek": the custody balance of every listed share,
// split across nine investor types and again across local and foreign holders.
// That is a real per-stock ownership register, and it is the only public one
// Indonesia has.
//
// Three things it is NOT:
//
//   1. NOT NAMED. KSEI publishes the CATEGORY, never the manager. This tells
//      you that mutual funds hold 8.4% of an emiten and added 90bp last month.
//      It cannot tell you that it was Schroder rather than Sucorinvest. Any
//      tool claiming named fund positions for IDX is inferring them.
//
//   2. NOT DAILY. One observation per month end. The flow is the difference
//      between two month ends, so the newest reading can be up to five weeks
//      old. The terminal always prints the month it belongs to.
//
//   3. NOT THE WHOLE COMPANY. Only shares held in KSEI scripless custody
//      appear. Founder and controlling blocks are frequently registered
//      outside it — BBCA's custody register is ~43% of its issued shares —
//      so a percentage here is a percentage OF THE REGISTER, which is much
//      closer to the free float. `custodyCoverage` reports that ratio so the
//      denominator is never silently wrong.
//
// WHAT THE TWO LINES MEAN. `institusi` pools professional money managed on
// somebody else's behalf: mutual funds, insurers, pension funds, banks and
// foundations. `ritel` is individuals. `strategis` — corporates, securities
// houses and the residual "others" — is neither: a corporate line is usually
// the controlling shareholder and a securities line is largely inventory and
// nominee. Folding either into the institutional side would make every
// founder-controlled emiten read as institution-owned, so it is charted
// separately and never counted as conviction.
//
// A WIDENING GAP between the institutional and retail lines means the register
// is moving from individuals into professional hands. That is the signal. It
// is a position change, not a forecast.

const IDR_BN = 1e9;

export type OwnerSide = 'institusi' | 'ritel' | 'strategis';
export type OwnerOrigin = 'lokal' | 'asing';

export interface OwnerType {
  key: string;
  label: string;
  short: string;
  side: OwnerSide;
}

export interface RawOwnershipEmiten {
  /** Total shares in KSEI custody, per month, comma separated. */
  tot: string;
  /** Issued shares, run-length encoded: an empty cell repeats the previous. */
  sec: string;
  /** Closing price used by KSEI for that month end, in IDR. */
  px: string;
  /** Local holders, ppm of the custody total, keyed by owner type. */
  l: Record<string, string>;
  /** Foreign holders, same encoding. */
  f: Record<string, string>;
}

export interface OwnershipFile {
  generatedAt: string;
  months: string[];
  latestMonth: string;
  emitenCount: number;
  types: OwnerType[];
  unit: string;
  source: string;
  scope: string;
  emiten: Record<string, RawOwnershipEmiten>;
}

/** One month of the ownership register, as fractions of the custody total. */
export interface OwnershipPoint {
  month: string;
  institusi: number;
  ritel: number;
  strategis: number;
  /** institusi − ritel. The gap the chart is about. */
  spread: number;
  /** Mutual funds alone, local + foreign. */
  reksadana: number;
  /** Every foreign holder, all types. */
  asing: number;
  custodyShares: number;
  price: number;
  /** Market value of the shares on the custody register, IDR bn. */
  custodyValueIdrBn: number;
}

/** One investor type on one side of the register. */
export interface HolderLine {
  key: string;
  label: string;
  short: string;
  side: OwnerSide;
  origin: OwnerOrigin;
  /** Fraction of the custody register. */
  share: number;
  shares: number;
  valueIdrBn: number;
  /** Change in share of register, in percentage points of the register. */
  change1m: number;
  change3m: number;
  change12m: number;
  /** Change in the actual share count over three months. */
  sharesChange3m: number;
  valueChange3mIdrBn: number;
}

export interface OwnershipVerdict {
  level: 'akumulasi' | 'distribusi' | 'stabil' | 'tidak-cukup-data';
  headline: string;
  reason: string;
}

export interface OwnershipProfile {
  code: string;
  months: string[];
  points: OwnershipPoint[];
  latest: OwnershipPoint;
  /** Every non-empty type × origin line, biggest holder first. */
  holders: HolderLine[];
  /** The same lines merged across local and foreign. */
  byType: HolderLine[];
  issuedShares: number;
  /** Custody register ÷ issued shares. Below ~0.5 means a large block sits outside KSEI. */
  custodyCoverage: number;
  spreadChange3m: number;
  spreadChange12m: number;
  institusiChange1m: number;
  institusiChange3m: number;
  institusiChange12m: number;
  reksadanaChange3m: number;
  asingChange3m: number;
  verdict: OwnershipVerdict;
}

export interface OwnershipMover {
  code: string;
  institusi: number;
  ritel: number;
  spread: number;
  reksadana: number;
  asing: number;
  /** Percentage-point change of the institutional share over the window. */
  institusiDelta: number;
  reksadanaDelta: number;
  asingDelta: number;
  /** Shares the institutional bucket added over the window. */
  sharesDelta: number;
  /** That share count at the latest price, IDR bn — the size of the move. */
  valueDeltaIdrBn: number;
  custodyValueIdrBn: number;
  custodyCoverage: number;
  price: number;
  priceChange: number;
  /**
   * How much the custody register itself grew or shrank over the window.
   *
   * This is the number that decides whether `institusiDelta` means anything. A
   * rights issue doubles the register and halves every existing percentage
   * without a single share being sold; re-registering a founder block into KSEI
   * custody does the same thing even harder — MAPI's foreign-corporate line went
   * from 1.8% to 87% of the register in three months and mechanically crushed
   * every other holder's share. When this moves, read `sharesDelta` instead.
   */
  custodyChange: number;
  /** True when the register moved enough that percentage deltas are not comparable. */
  registerDistorted: boolean;
}

/** Market-wide totals, so a single emiten can be read against the tape. */
export interface OwnershipMarketSummary {
  month: string;
  emitenCovered: number;
  /** Value-weighted share of every covered register. */
  institusi: number;
  ritel: number;
  strategis: number;
  reksadana: number;
  asing: number;
  institusiDelta3m: number;
  reksadanaDelta3m: number;
  asingDelta3m: number;
  totalCustodyValueIdrTn: number;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function decode(csv: string | undefined): number[] {
  if (!csv) return [];
  return csv.split(',').map((x) => (x === '' ? NaN : Number(x)));
}

/** Run-length decode: an empty cell repeats the previous value. */
function decodeHeld(csv: string | undefined): number[] {
  if (!csv) return [];
  const out: number[] = [];
  let last = NaN;
  for (const cell of csv.split(',')) {
    if (cell !== '') last = Number(cell);
    out.push(last);
  }
  return out;
}

const PPM = 1e-6;

function at(arr: number[], i: number): number {
  const v = arr[i];
  return Number.isFinite(v) ? v : 0;
}

/** Latest index at or before `i` that actually carries a custody reading. */
function lastValid(tot: number[], i: number): number {
  for (let k = Math.min(i, tot.length - 1); k >= 0; k--) if (Number.isFinite(tot[k]) && tot[k] > 0) return k;
  return -1;
}

// ---------------------------------------------------------------------------
// Per-emiten profile
// ---------------------------------------------------------------------------

interface DecodedEmiten {
  tot: number[];
  sec: number[];
  px: number[];
  series: Map<string, number[]>;
  points: OwnershipPoint[];
}

/**
 * Decode one emiten to the monthly point series.
 *
 * Split out from the full profile because the cross-sectional rankers run this
 * over all ~960 emiten and need none of the holder-table work.
 */
function decodeEmiten(file: OwnershipFile, code: string): DecodedEmiten | null {
  const raw = file.emiten[code];
  if (!raw) return null;

  const months = file.months;
  const tot = decode(raw.tot);
  const sec = decodeHeld(raw.sec);
  const px = decode(raw.px);

  const series = new Map<string, number[]>();
  for (const t of file.types) {
    series.set(`l:${t.key}`, decode(raw.l?.[t.key]));
    series.set(`f:${t.key}`, decode(raw.f?.[t.key]));
  }

  const points: OwnershipPoint[] = [];
  for (let i = 0; i < months.length; i++) {
    if (!Number.isFinite(tot[i]) || tot[i] <= 0) continue;

    let institusi = 0;
    let ritel = 0;
    let strategis = 0;
    let asing = 0;
    let reksadana = 0;

    for (const t of file.types) {
      const l = at(series.get(`l:${t.key}`)!, i) * PPM;
      const f = at(series.get(`f:${t.key}`)!, i) * PPM;
      asing += f;
      if (t.key === 'MF') reksadana += l + f;
      if (t.side === 'institusi') institusi += l + f;
      else if (t.side === 'ritel') ritel += l + f;
      else strategis += l + f;
    }

    const price = Number.isFinite(px[i]) ? px[i] : 0;
    points.push({
      month: months[i],
      institusi,
      ritel,
      strategis,
      spread: institusi - ritel,
      reksadana,
      asing,
      custodyShares: tot[i],
      price,
      custodyValueIdrBn: (tot[i] * price) / IDR_BN,
    });
  }

  if (!points.length) return null;
  return { tot, sec, px, series, points };
}

export function computeOwnershipProfile(file: OwnershipFile, code: string): OwnershipProfile | null {
  const decoded = decodeEmiten(file, code);
  if (!decoded) return null;

  const months = file.months;
  const { tot, sec, series, points } = decoded;
  const latest = points[points.length - 1];

  // Index arithmetic for the holder table runs on the RAW month axis, because
  // "three months ago" has to mean three calendar months, not three readings.
  const n = months.length;
  const iNow = lastValid(tot, n - 1);
  if (iNow < 0) return null;
  const iBack = (k: number) => lastValid(tot, iNow - k);

  const i1 = iBack(1);
  const i3 = iBack(3);
  const i12 = iBack(12);

  const shareAt = (bucket: 'l' | 'f', key: string, i: number): number =>
    i < 0 ? NaN : at(series.get(`${bucket}:${key}`)!, i) * PPM;

  const price = latest.price;
  const holders: HolderLine[] = [];

  for (const t of file.types) {
    for (const [bucket, origin] of [
      ['l', 'lokal'],
      ['f', 'asing'],
    ] as [('l' | 'f'), OwnerOrigin][]) {
      const arr = series.get(`${bucket}:${t.key}`)!;
      if (!arr.length || !arr.some((v) => Number.isFinite(v) && v > 0)) continue;

      const share = shareAt(bucket, t.key, iNow);
      const shares = share * tot[iNow];
      const s3 = shareAt(bucket, t.key, i3);
      const shares3 = Number.isFinite(s3) && i3 >= 0 ? s3 * tot[i3] : NaN;

      holders.push({
        key: t.key,
        label: t.label,
        short: t.short,
        side: t.side,
        origin,
        share,
        shares,
        valueIdrBn: (shares * price) / IDR_BN,
        change1m: i1 >= 0 ? share - shareAt(bucket, t.key, i1) : NaN,
        change3m: i3 >= 0 ? share - s3 : NaN,
        change12m: i12 >= 0 ? share - shareAt(bucket, t.key, i12) : NaN,
        sharesChange3m: Number.isFinite(shares3) ? shares - shares3 : NaN,
        valueChange3mIdrBn: Number.isFinite(shares3) ? ((shares - shares3) * price) / IDR_BN : NaN,
      });
    }
  }
  holders.sort((a, b) => b.share - a.share);

  // Merge the two origins so the table can also be read one row per type.
  const merged = new Map<string, HolderLine>();
  for (const h of holders) {
    const existing = merged.get(h.key);
    if (!existing) {
      merged.set(h.key, { ...h, origin: 'lokal' });
      continue;
    }
    existing.share += h.share;
    existing.shares += h.shares;
    existing.valueIdrBn += h.valueIdrBn;
    const add = (a: number, b: number) => (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
    existing.change1m = add(existing.change1m, h.change1m);
    existing.change3m = add(existing.change3m, h.change3m);
    existing.change12m = add(existing.change12m, h.change12m);
    existing.sharesChange3m = add(existing.sharesChange3m, h.sharesChange3m);
    existing.valueChange3mIdrBn = add(existing.valueChange3mIdrBn, h.valueChange3mIdrBn);
  }
  const byType = [...merged.values()].sort((a, b) => b.share - a.share);

  const pointAt = (i: number): OwnershipPoint | null => {
    if (i < 0) return null;
    const month = months[i];
    return points.find((p) => p.month === month) ?? null;
  };
  const p1 = pointAt(i1);
  const p3 = pointAt(i3);
  const p12 = pointAt(i12);

  const delta = (a: number | undefined, b: number | undefined) =>
    Number.isFinite(a as number) && Number.isFinite(b as number) ? (a as number) - (b as number) : NaN;

  const institusiChange1m = delta(latest.institusi, p1?.institusi);
  const institusiChange3m = delta(latest.institusi, p3?.institusi);
  const institusiChange12m = delta(latest.institusi, p12?.institusi);
  const spreadChange3m = delta(latest.spread, p3?.spread);
  const spreadChange12m = delta(latest.spread, p12?.spread);
  const reksadanaChange3m = delta(latest.reksadana, p3?.reksadana);
  const asingChange3m = delta(latest.asing, p3?.asing);

  const issuedShares = Number.isFinite(sec[iNow]) ? sec[iNow] : NaN;
  const custodyCoverage = issuedShares > 0 ? tot[iNow] / issuedShares : NaN;

  const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)} pp`;

  let verdict: OwnershipVerdict;
  if (points.length < 4 || !Number.isFinite(institusiChange3m)) {
    verdict = {
      level: 'tidak-cukup-data',
      headline: 'Belum cukup riwayat',
      reason: 'Emiten ini belum punya cukup bulan di register KSEI untuk mengukur arah kepemilikan.',
    };
  } else if (institusiChange3m > 0.005 && spreadChange3m > 0) {
    verdict = {
      level: 'akumulasi',
      headline: 'Institusi menambah, jarak melebar',
      reason: `Porsi institusi naik ${pp(institusiChange3m)} dalam 3 bulan sementara jarak terhadap ritel melebar ${pp(spreadChange3m)}. Register bergeser dari individu ke pengelola dana.`,
    };
  } else if (institusiChange3m < -0.005 && spreadChange3m < 0) {
    verdict = {
      level: 'distribusi',
      headline: 'Institusi melepas ke ritel',
      reason: `Porsi institusi turun ${pp(institusiChange3m)} dalam 3 bulan dan jarak terhadap ritel menyempit ${pp(spreadChange3m)}. Barang berpindah ke tangan individu.`,
    };
  } else {
    verdict = {
      level: 'stabil',
      headline: 'Register relatif diam',
      reason: `Porsi institusi bergerak ${pp(institusiChange3m)} dalam 3 bulan — belum ada perpindahan kepemilikan yang berarti.`,
    };
  }

  return {
    code,
    months,
    points,
    latest,
    holders,
    byType,
    issuedShares,
    custodyCoverage,
    spreadChange3m,
    spreadChange12m,
    institusiChange1m,
    institusiChange3m,
    institusiChange12m,
    reksadanaChange3m,
    asingChange3m,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Cross-sectional ranking
// ---------------------------------------------------------------------------

export interface MoverOptions {
  /** Months to look back. 1, 3 or 12 in the UI. */
  window: number;
  /** Drop registers worth less than this, IDR bn — sub-scale names produce noise. */
  minCustodyValueIdrBn: number;
  limit: number;
  /**
   * What "biggest move" means.
   *
   * `nilai` ranks on the rupiah value of shares that actually changed hands and
   * is the safe default: it survives a rights issue or a founder block being
   * registered into custody, both of which move every percentage without a
   * share trading. `persen` ranks on the share of the register and answers the
   * ownership-structure question, but its denominator is not stable — read it
   * with `registerDistorted`.
   */
  basis?: 'nilai' | 'persen';
}

/**
 * Rank the whole market by how far the institutional share of the register
 * moved over `window` months.
 *
 * The size filter is not cosmetic: a Rp 20bn register can swing 8pp because one
 * family office bought, and that would otherwise crowd out every real move.
 */
export function rankOwnershipMovers(
  file: OwnershipFile,
  { window, minCustodyValueIdrBn, limit, basis = 'nilai' }: MoverOptions
): { accumulating: OwnershipMover[]; distributing: OwnershipMover[] } {
  const rows: OwnershipMover[] = [];

  for (const code of Object.keys(file.emiten)) {
    const decoded = decodeEmiten(file, code);
    if (!decoded) continue;

    const { points, tot, sec } = decoded;
    if (points.length < 2) continue;
    const latest = points[points.length - 1];

    const target = points.length - 1 - window;
    const past = points[Math.max(0, target)];
    if (!past || past.month === latest.month) continue;
    if (latest.custodyValueIdrBn < minCustodyValueIdrBn) continue;

    const iNow = lastValid(tot, tot.length - 1);
    const issued = iNow >= 0 && Number.isFinite(sec[iNow]) ? sec[iNow] : NaN;
    const institusiDelta = latest.institusi - past.institusi;
    const sharesDelta = latest.institusi * latest.custodyShares - past.institusi * past.custodyShares;
    const custodyChange = past.custodyShares > 0 ? latest.custodyShares / past.custodyShares - 1 : NaN;

    rows.push({
      code,
      institusi: latest.institusi,
      ritel: latest.ritel,
      spread: latest.spread,
      reksadana: latest.reksadana,
      asing: latest.asing,
      institusiDelta,
      reksadanaDelta: latest.reksadana - past.reksadana,
      asingDelta: latest.asing - past.asing,
      sharesDelta,
      valueDeltaIdrBn: (sharesDelta * latest.price) / IDR_BN,
      custodyValueIdrBn: latest.custodyValueIdrBn,
      custodyCoverage: issued > 0 ? latest.custodyShares / issued : NaN,
      price: latest.price,
      priceChange: past.price > 0 ? latest.price / past.price - 1 : NaN,
      custodyChange,
      // 5% is where the distortion starts to outweigh ordinary trading: a
      // register that size-shifted more than that moves every percentage on its
      // own, and the share-count column becomes the honest reading.
      registerDistorted: Math.abs(custodyChange) > 0.05,
    });
  }

  const key = (r: OwnershipMover) => (basis === 'persen' ? r.institusiDelta : r.valueDeltaIdrBn);
  const byDelta = [...rows].sort((a, b) => key(b) - key(a));
  return {
    accumulating: byDelta.slice(0, limit),
    distributing: byDelta.slice(-limit).reverse(),
  };
}

/**
 * Market-level composition, weighted by the value of each custody register so
 * that a Rp 700tn name counts for more than a Rp 3bn one.
 */
export function summariseOwnershipMarket(file: OwnershipFile): OwnershipMarketSummary | null {
  const months = file.months;
  if (!months.length) return null;

  let weight = 0;
  let institusi = 0;
  let ritel = 0;
  let strategis = 0;
  let reksadana = 0;
  let asing = 0;
  let institusiPast = 0;
  let reksadanaPast = 0;
  let asingPast = 0;
  let weightPast = 0;
  let covered = 0;

  for (const code of Object.keys(file.emiten)) {
    const decoded = decodeEmiten(file, code);
    if (!decoded) continue;
    const { points } = decoded;
    const latest = points[points.length - 1];
    const w = latest.custodyValueIdrBn;
    if (!(w > 0)) continue;
    covered++;
    weight += w;
    institusi += latest.institusi * w;
    ritel += latest.ritel * w;
    strategis += latest.strategis * w;
    reksadana += latest.reksadana * w;
    asing += latest.asing * w;

    const past = points[Math.max(0, points.length - 4)];
    if (past && past.month !== latest.month) {
      const wp = past.custodyValueIdrBn;
      if (wp > 0) {
        weightPast += wp;
        institusiPast += past.institusi * wp;
        reksadanaPast += past.reksadana * wp;
        asingPast += past.asing * wp;
      }
    }
  }

  if (!weight) return null;
  const norm = (v: number) => v / weight;
  const normPast = (v: number) => (weightPast > 0 ? v / weightPast : NaN);

  return {
    month: file.latestMonth,
    emitenCovered: covered,
    institusi: norm(institusi),
    ritel: norm(ritel),
    strategis: norm(strategis),
    reksadana: norm(reksadana),
    asing: norm(asing),
    institusiDelta3m: norm(institusi) - normPast(institusiPast),
    reksadanaDelta3m: norm(reksadana) - normPast(reksadanaPast),
    asingDelta3m: norm(asing) - normPast(asingPast),
    totalCustodyValueIdrTn: weight / 1e3,
  };
}
