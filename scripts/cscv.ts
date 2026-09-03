/**
 * cscv.ts — CSCV (Combinatorially Symmetric Cross-Validation) dan PBO.
 *
 * ── KENAPA INI ADA, PADAHAL SUDAH ADA PEMBAGIAN TRAIN/TEST ────────────────
 *
 * `strategy-lab.ts` memakai SATU potongan 70/30. Satu potongan menjawab satu
 * pertanyaan: "apakah pemenangnya bertahan di 30% terakhir?" Ia tidak bisa
 * menjawab pertanyaan yang sebenarnya kita punya — "seberapa besar kemungkinan
 * pemenang itu menang karena kita mencari 148.104 kali?" — karena jawabannya
 * tergantung pada potongan mana yang kebetulan disisihkan.
 *
 * CSCV membalik itu. Sejarah dipotong menjadi 2S blok, lalu SEMUA cara memilih
 * S blok sebagai in-sample dienumerasi (C(16,8) = 12.870 cara untuk 2S = 16).
 * Tiap cara memilih pemenangnya sendiri di dalam sample, lalu pemenang itu
 * diperingkat di antara SELURUH kandidat di blok-blok sisanya. Kalau pemenang
 * in-sample cuma artefak pencarian, peringkat out-of-sample-nya akan mendarat
 * di bawah median kira-kira separuh waktu — dan fraksi itulah PBO.
 *
 * ── KENAPA LOGIT, BUKAN PERINGKAT MENTAH ──────────────────────────────────
 *
 *   λ = log( r / (K + 1 − r) )      r = peringkat OOS, 1 = terburuk, K = terbaik
 *
 * PBO = fraksi kombinasi dengan λ < 0, yang persis sama dengan "peringkat OOS
 * di bawah median". Angka PBO sendiri membuang bentuk sebarannya, dan bentuknya
 * yang memberi tahu KENAPA: menumpuk di nol berarti pemilihan in-sample nyaris
 * tidak membawa informasi; puncak positif yang jelas berarti peringkatnya nyata;
 * sebaran lebar berarti hasilnya bergantung pada potongan mana yang disisihkan.
 * Makanya fungsi ini mengembalikan seluruh larik logit, bukan cuma PBO.
 *
 * ── SERI YANG DIPAKAI ─────────────────────────────────────────────────────
 *
 * Matriks M di sini bukan return per sesi melainkan agregat per BLOK: Σ R,
 * Σ R², dan jumlah trade. Itu cukup, karena kedua metrik yang dipakai —
 * expectancy (rata-rata R per trade) dan Sharpe per trade (rata-rata ÷ simpangan
 * baku) — keduanya aditif atas blok. Penyimpanannya juga yang membuat 148.104
 * rule set muat: 16 slot per rule set, bukan 716.
 *
 * ── TENTANG SERI (TIE) ────────────────────────────────────────────────────
 *
 * Peringkat dihitung sebagai 1 + jumlah kandidat yang metrik OOS-nya LEBIH
 * BURUK, jadi kalau banyak kandidat seri dengan pemenang, pemenang mendapat
 * peringkat TERENDAH di antara yang seri. Itu memihak PBO yang lebih besar,
 * bukan lebih kecil — arah yang benar untuk asumsi yang tidak bisa dipastikan.
 */

export type CscvMetric = 'expectancy' | 'sharpe';

export interface CscvMatrix {
  /** Jumlah kandidat (K). */
  k: number;
  /** Jumlah blok (2S). Harus genap, dan separuhnya ≤ 16. */
  blocks: number;
  /** Σ R per (kandidat, blok), baris per kandidat: `sum[i * blocks + b]`. */
  sum: Float64Array;
  /** Jumlah trade per (kandidat, blok). */
  n: Float64Array;
  /** Σ R² per (kandidat, blok). Wajib kalau metriknya `sharpe`. */
  sq?: Float64Array;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface CscvResult {
  metric: CscvMetric;
  k: number;
  blocks: number;
  combinations: number;
  /** Fraksi kombinasi yang pemenang in-sample-nya di bawah median OOS. */
  pbo: number;
  medianLogit: number;
  meanLogit: number;
  /** Median dari r/(K+1) — 0,5 berarti pemenang IS setara lemparan koin di OOS. */
  medianRelativeRank: number;
  histogram: HistogramBin[];
  /**
   * Berapa banyak kandidat BERBEDA yang pernah menang in-sample.
   *
   * Ini uji stabilitas parameter (3.25) yang gratis: kalau 12.870 potongan
   * berbeda memilih 12.000 pemenang berbeda, tidak ada satu pun rule set yang
   * benar-benar terbaik — yang ada hanya potongan yang berbeda-beda.
   */
  distinctWinners: number;
  /** Kandidat yang paling sering menang in-sample. Indeks lokal ke matriks. */
  topWinner: { index: number; wins: number; share: number } | null;
  /** Rata-rata metrik OOS pemenang IS, dan rata-rata metrik OOS seluruh kandidat. */
  meanWinnerOos: number;
}

function popcount(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  v = (v + (v >> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >> 24;
}

const median = (xs: Float64Array): number => {
  if (!xs.length) return NaN;
  const s = Float64Array.from(xs).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Semua subset berukuran `half` bit yang, digabung, berukuran `pick`.
 *
 * Blok dibelah dua (blok 0..half-1 dan half..2half-1) supaya jumlah per subset
 * bisa di-DP sekali per potongan kandidat lalu dipakai ulang oleh 12.870
 * kombinasi. Tanpa itu tiap kombinasi harus menjumlahkan 8 blok per kandidat,
 * dan 12.870 × K × 8 penjumlahan tidak selesai dalam waktu yang masuk akal.
 */
function enumerateCombinations(half: number, pick: number): { low: Int32Array; high: Int32Array } {
  const size = 1 << half;
  const pcLow: number[][] = Array.from({ length: half + 1 }, () => []);
  for (let m = 0; m < size; m++) pcLow[popcount(m)].push(m);

  const low: number[] = [];
  const high: number[] = [];
  for (let j = Math.max(0, pick - half); j <= Math.min(half, pick); j++) {
    for (const a of pcLow[j]) {
      for (const b of pcLow[pick - j]) {
        low.push(a);
        high.push(b);
      }
    }
  }
  return { low: Int32Array.from(low), high: Int32Array.from(high) };
}

/** Tabel jumlah per subset untuk satu potongan kandidat: `out[subset * span + k]`. */
function buildSubsetSums(
  cols: Float64Array,
  blockOffset: number,
  half: number,
  span: number,
  blocks: number,
  rows: number,
  matrix: Float64Array,
  candidates: Int32Array,
  first: number,
): Float64Array {
  const size = 1 << half;
  const out = new Float64Array(size * span);
  // Kolom per blok dikumpulkan lebih dulu supaya DP-nya membaca berurutan.
  for (let b = 0; b < half; b++) {
    const base = (1 << b) * span;
    const src = blockOffset + b;
    for (let k = 0; k < rows; k++) out[base + k] = matrix[candidates[first + k] * blocks + src];
  }
  for (let m = 1; m < size; m++) {
    const lowBit = m & -m;
    if (m === lowBit) continue; // subset satu-bit sudah diisi di atas
    const rest = m ^ lowBit;
    const dst = m * span;
    const a = rest * span;
    const c = lowBit * span;
    for (let k = 0; k < rows; k++) out[dst + k] = out[a + k] + out[c + k];
  }
  void cols;
  return out;
}

export interface CscvOptions {
  /** Kandidat per potongan. Menentukan puncak memori tabel subset. */
  chunk?: number;
  /** Jumlah bin histogram logit. */
  bins?: number;
  onProgress?: (done: number, total: number, phase: string) => void;
}

export function runCscv(m: CscvMatrix, metric: CscvMetric, opts: CscvOptions = {}): CscvResult {
  const { k: K, blocks } = m;
  if (blocks % 2 !== 0) throw new Error(`jumlah blok harus genap, dapat ${blocks}`);
  const half = blocks / 2;
  if (half > 16) throw new Error(`separuh blok harus ≤ 16, dapat ${half}`);
  if (metric === 'sharpe' && !m.sq) throw new Error('metrik sharpe butuh Σ R²');
  if (K < 2) throw new Error(`CSCV tidak berarti dengan K = ${K}`);

  const { low: cLow, high: cHigh } = enumerateCombinations(half, half);
  const nComb = cLow.length;
  const fullLow = (1 << half) - 1;

  const chunk = Math.min(K, opts.chunk ?? 4096);
  const useSq = metric === 'sharpe';
  const sq = m.sq ?? new Float64Array(0);

  // Semua kandidat ikut; penyaringan (lantai trade per blok) sudah dilakukan
  // oleh pemanggil, SEBELUM metrik apa pun dilihat.
  const cand = new Int32Array(K);
  for (let i = 0; i < K; i++) cand[i] = i;

  const bestVal = new Float64Array(nComb).fill(-Infinity);
  const bestIdx = new Int32Array(nComb).fill(-1);
  const worseCount = new Int32Array(nComb);

  const nChunks = Math.ceil(K / chunk);

  const metricOf = (s: number, c: number, q: number): number => {
    const mean = s / c;
    if (!useSq) return mean;
    const v = q / c - mean * mean;
    return v > 0 ? mean / Math.sqrt(v) : 0;
  };

  // ── sapuan 1: pemenang in-sample tiap kombinasi ─────────────────────────
  for (let ch = 0; ch < nChunks; ch++) {
    const first = ch * chunk;
    const rows = Math.min(chunk, K - first);
    const lowS = buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, m.sum, cand, first);
    const highS = buildSubsetSums(lowS0, half, half, chunk, blocks, rows, m.sum, cand, first);
    const lowN = buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, m.n, cand, first);
    const highN = buildSubsetSums(lowS0, half, half, chunk, blocks, rows, m.n, cand, first);
    const lowQ = useSq ? buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, sq, cand, first) : lowS;
    const highQ = useSq ? buildSubsetSums(lowS0, half, half, chunk, blocks, rows, sq, cand, first) : highS;

    for (let ci = 0; ci < nComb; ci++) {
      const lo = cLow[ci] * chunk;
      const hi = cHigh[ci] * chunk;
      let bv = bestVal[ci];
      let bi = bestIdx[ci];
      if (useSq) {
        for (let k = 0; k < rows; k++) {
          const c = lowN[lo + k] + highN[hi + k];
          const s = lowS[lo + k] + highS[hi + k];
          const mean = s / c;
          const v = (lowQ[lo + k] + highQ[hi + k]) / c - mean * mean;
          const val = v > 0 ? mean / Math.sqrt(v) : 0;
          if (val > bv) {
            bv = val;
            bi = first + k;
          }
        }
      } else {
        for (let k = 0; k < rows; k++) {
          const val = (lowS[lo + k] + highS[hi + k]) / (lowN[lo + k] + highN[hi + k]);
          if (val > bv) {
            bv = val;
            bi = first + k;
          }
        }
      }
      bestVal[ci] = bv;
      bestIdx[ci] = bi;
    }
    opts.onProgress?.(ch + 1, nChunks * 2, 'in-sample');
  }

  // ── metrik OOS pemenang, dari matriks mentah ────────────────────────────
  const winnerOos = new Float64Array(nComb);
  for (let ci = 0; ci < nComb; ci++) {
    const w = bestIdx[ci];
    const base = cand[w] * blocks;
    const isLow = cLow[ci];
    const isHigh = cHigh[ci];
    let s = 0;
    let c = 0;
    let q = 0;
    for (let b = 0; b < half; b++) {
      if (isLow & (1 << b)) continue;
      s += m.sum[base + b];
      c += m.n[base + b];
      if (useSq) q += sq[base + b];
    }
    for (let b = 0; b < half; b++) {
      if (isHigh & (1 << b)) continue;
      s += m.sum[base + half + b];
      c += m.n[base + half + b];
      if (useSq) q += sq[base + half + b];
    }
    winnerOos[ci] = metricOf(s, c, q);
  }

  // ── sapuan 2: peringkat OOS pemenang di antara SELURUH kandidat ─────────
  for (let ch = 0; ch < nChunks; ch++) {
    const first = ch * chunk;
    const rows = Math.min(chunk, K - first);
    const lowS = buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, m.sum, cand, first);
    const highS = buildSubsetSums(lowS0, half, half, chunk, blocks, rows, m.sum, cand, first);
    const lowN = buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, m.n, cand, first);
    const highN = buildSubsetSums(lowS0, half, half, chunk, blocks, rows, m.n, cand, first);
    const lowQ = useSq ? buildSubsetSums(lowS0, 0, half, chunk, blocks, rows, sq, cand, first) : lowS;
    const highQ = useSq ? buildSubsetSums(lowS0, half, half, chunk, blocks, rows, sq, cand, first) : highS;

    for (let ci = 0; ci < nComb; ci++) {
      // Blok OOS adalah komplemen blok IS — subsetnya ada di tabel yang sama.
      const lo = (fullLow ^ cLow[ci]) * chunk;
      const hi = (fullLow ^ cHigh[ci]) * chunk;
      const w = winnerOos[ci];
      let cnt = worseCount[ci];
      if (useSq) {
        for (let k = 0; k < rows; k++) {
          const c = lowN[lo + k] + highN[hi + k];
          const s = lowS[lo + k] + highS[hi + k];
          const mean = s / c;
          const v = (lowQ[lo + k] + highQ[hi + k]) / c - mean * mean;
          const val = v > 0 ? mean / Math.sqrt(v) : 0;
          if (val < w) cnt++;
        }
      } else {
        for (let k = 0; k < rows; k++) {
          const val = (lowS[lo + k] + highS[hi + k]) / (lowN[lo + k] + highN[hi + k]);
          if (val < w) cnt++;
        }
      }
      worseCount[ci] = cnt;
    }
    opts.onProgress?.(nChunks + ch + 1, nChunks * 2, 'out-of-sample');
  }

  // ── logit dan PBO ───────────────────────────────────────────────────────
  const logits = new Float64Array(nComb);
  const relRank = new Float64Array(nComb);
  let below = 0;
  for (let ci = 0; ci < nComb; ci++) {
    const r = worseCount[ci] + 1; // 1 = terburuk, K = terbaik
    const w = r / (K + 1);
    relRank[ci] = w;
    logits[ci] = Math.log(r / (K + 1 - r));
    if (logits[ci] < 0) below++;
  }

  const winCount = new Map<number, number>();
  for (let ci = 0; ci < nComb; ci++) winCount.set(bestIdx[ci], (winCount.get(bestIdx[ci]) ?? 0) + 1);
  let topWinner: CscvResult['topWinner'] = null;
  for (const [idx, wins] of winCount) {
    if (!topWinner || wins > topWinner.wins) topWinner = { index: idx, wins, share: wins / nComb };
  }

  let lmin = Infinity;
  let lmax = -Infinity;
  let lsum = 0;
  for (const v of logits) {
    if (v < lmin) lmin = v;
    if (v > lmax) lmax = v;
    lsum += v;
  }
  const nBins = opts.bins ?? 21;
  const width = lmax > lmin ? (lmax - lmin) / nBins : 1;
  const histogram: HistogramBin[] = Array.from({ length: nBins }, (_, i) => ({
    from: lmin + i * width,
    to: lmin + (i + 1) * width,
    count: 0,
  }));
  for (const v of logits) {
    let b = Math.floor((v - lmin) / width);
    if (b < 0) b = 0;
    if (b >= nBins) b = nBins - 1;
    histogram[b].count++;
  }

  let oosSum = 0;
  for (const v of winnerOos) oosSum += v;

  return {
    metric,
    k: K,
    blocks,
    combinations: nComb,
    pbo: below / nComb,
    medianLogit: median(logits),
    meanLogit: lsum / nComb,
    medianRelativeRank: median(relRank),
    histogram,
    distinctWinners: winCount.size,
    topWinner,
    meanWinnerOos: oosSum / nComb,
  };
}

/** Placeholder yang tidak dipakai — `buildSubsetSums` tidak butuh buffer luar. */
const lowS0 = new Float64Array(0);

/** Histogram logit sebagai batang ASCII, karena bentuknya yang dibaca. */
export function renderLogitHistogram(res: CscvResult, width = 46): string[] {
  const max = res.histogram.reduce((a, b) => Math.max(a, b.count), 0) || 1;
  const lines: string[] = [];
  for (const b of res.histogram) {
    const bar = '█'.repeat(Math.round((b.count / max) * width));
    const mark = b.from < 0 && b.to > 0 ? ' ←0' : '';
    lines.push(
      `${b.from.toFixed(2).padStart(7)} … ${b.to.toFixed(2).padStart(7)} │${bar.padEnd(width)} ${String(
        b.count,
      ).padStart(6)}${mark}`,
    );
  }
  return lines;
}
