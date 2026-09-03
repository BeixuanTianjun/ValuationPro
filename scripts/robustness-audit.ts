/**
 * robustness-audit.ts — apakah temuan runup bisa muncul dari pengacakan saja?
 *
 * ── KENAPA INI ADA ────────────────────────────────────────────────────────
 *
 * `gate:ablate` menemukan SATU pembacaan yang punya dosis-respons monoton di
 * sepuluh desil: runup 60 sesi, dari +1,40pp (desil terendah) sampai -8,63pp
 * (desil tertinggi) pada horizon tiga bulan. Sembilan belas syarat lainnya
 * datar dalam ±0,3pp. Temuan itu sekarang menjadi satu-satunya alasan empiris
 * di balik aturan keras `runup 60 sesi < 25%` di mode momentum.
 *
 * Yang BELUM pernah dijawab: seberapa sering pola semonoton itu muncul kalau
 * pembacaannya diacak dan return dibiarkan apa adanya. Sepuluh desil yang
 * urutannya sempurna terdengar mustahil kebetulan, tapi intuisi itu tidak
 * dihitung dari apa pun. Sebelum ada distribusi null, "monoton di sepuluh
 * desil" adalah kesan, bukan bukti.
 *
 * Skrip ini membangun null-nya (Robust Systems Lab 3.22), lalu mengecek tiga
 * hal lain yang seluruh angka repo ini belum pernah lewati:
 *
 *   3.11  Stratifikasi rezim   — apakah efeknya hidup di dua arah pasar?
 *   3.31  Biaya transaksi      — semua angka sejauh ini gerak harga KOTOR.
 *   3.19/3.20  Effective N     — berapa pengamatan bebas yang benar-benar ada?
 *   3.13  Matriks penuh        — bukan satu angka untuk seluruh sampel.
 *
 * ── APA YANG DIUJI ────────────────────────────────────────────────────────
 *
 * Aturan yang BENAR-BENAR DIPAKAI produksi, bukan papan strategi:
 *
 *   - Empat pembacaan kontinu yang dipotong desil oleh `gate:ablate` — runup
 *     (yang diuji), plus regangan ATR, sesi di atas MA5 dan RSI14 sebagai
 *     PEMBANDING. Pembanding itu penting: kalau runup lolos tapi ketiganya juga
 *     lolos, yang ditemukan bukan sifat runup melainkan cacat ujinya.
 *   - Gerbang keras mode momentum apa adanya (`passAll`).
 *   - Gerbang `runup < 25%` sendirian, karena itu yang dipasang 2026-09-02.
 *   - Gabungan tiga mode — persis yang dibaca watchlist tahap 3.
 *
 * TIDAK ADA satu ambang pun yang digeser di sini. Skrip ini mengukur.
 *
 * ── STATISTIK UJINYA DITETAPKAN LEBIH DULU ────────────────────────────────
 *
 * 3.22 memperingatkan bahwa memilih statistik SESUDAH melihat data akan
 * menggelembungkan signifikansi. Karena itu keduanya diwarisi bulat-bulat dari
 * `gate:ablate`, bukan disusun di sini:
 *
 *   SPREAD    median lintas sesi dari [median return desil 1 - median desil 10]
 *   MONOTON   rho Spearman antara nomor desil (1..10) dan efek median desil itu
 *
 * Ujinya DUA SISI. Arah temuan runup (desil rendah menang) sudah diketahui dari
 * data yang SAMA, jadi uji satu sisi ke arah itu akan menghitung informasi yang
 * sudah dipakai untuk memilih arahnya. Dua sisi membuang setengah kekuatan uji
 * dan itu memang harganya.
 *
 * ── BAGAIMANA NULL-NYA DIBANGUN ───────────────────────────────────────────
 *
 * Return DIBIARKAN UTUH di tempatnya. Yang diacak adalah pasangan
 * emiten <-> nilai indikator, di dalam tiap sesi. Hipotesis nol-nya persis:
 * "sebaran runup lintas emiten hari ini tidak memberi tahu apa pun tentang
 * emiten mana yang akan naik tiga bulan lagi."
 *
 * Karena return tidak digeser sedikit pun, seluruh struktur yang membuat angka
 * t jadi bohong — jendela 63 sesi yang tumpang tindih 62 barnya, dan satu
 * faktor pasar yang menggerakkan seluruh emiten bersamaan — IKUT TERBAWA ke
 * dalam distribusi null. Itu keunggulan utama uji permutasi di sini
 * dibandingkan angka t: null-nya tidak perlu diasumsikan, ia diukur.
 *
 * ── PERMUTASI BLOK, DAN KENAPA WAJIB ──────────────────────────────────────
 *
 * Runup 60 sesi hari ini dan runup 60 sesi besok berbagi 59 dari 60 barnya.
 * Kalau tiap sesi diacak SENDIRI-SENDIRI, tiap emiten mendapat identitas runup
 * baru tiap hari, sehingga deret null-nya jauh lebih acak daripada deret yang
 * sebenarnya. Null seperti itu terlalu sempit, dan null yang terlalu sempit
 * menolak apa saja. 3.22 menyebutnya "misspecified null, biasing toward false
 * rejections".
 *
 * Perbaikannya: SATU permutasi label dipakai untuk seluruh blok L sesi
 * berturut-turut. Di dalam blok, emiten A memakai deret runup milik emiten B
 * sepanjang blok itu — jadi persistensi runup yang asli ikut terbawa, yang
 * putus hanya kaitannya dengan emiten yang benar.
 *
 * L tidak ditebak: skrip mengukur paruh-usia autokorelasi peringkat lintas
 * emiten tiap indikator, lalu memakainya. Versi L = 1 (naif) ikut dicetak
 * berdampingan supaya selisihnya terlihat — itu demonstrasi langsung dari
 * peringatan 3.22, bukan hiasan.
 *
 * ── INTI BLOK ─────────────────────────────────────────────────────────────
 *
 * Keranjang likuid berubah anggotanya tiap sesi. Supaya permutasi tetap
 * bijeksi di setiap sesi dalam blok, statistik dihitung hanya atas INTI blok:
 * emiten yang likuid di SELURUH sesi blok itu. Statistik teramati dihitung
 * ulang atas inti yang sama, jadi yang diamati dan null-nya berdiri di atas
 * populasi identik. Versi sampel penuh ikut dicetak sebagai pembanding; kalau
 * keduanya jauh berbeda, itu sendiri temuan.
 *
 * ── CARA PAKAI ────────────────────────────────────────────────────────────
 *
 *   npm run audit:robust
 *   npm run audit:robust -- --perms 200        (lebih cepat, resolusi p 1/201)
 *   npm run audit:robust -- --sessions 250
 */

import { join } from 'node:path';
import { loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { sliceMarketDatabase } from '../src/data/marketSlice';
import { computeAllFactors } from '../src/models/factorEngine';
import { runStockScreener, ScreenerRow } from '../src/models/stockScreener';
import type { MarketDatabase } from '../src/data/marketRepository';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');

/** Sama seperti gate:ablate dan pickJournal: 21 sesi ~ 1 bulan, 63 ~ 3 bulan. */
const M1 = 21;
const M3 = 63;

/** Sejarah minimum sebelum MA200 punya arti. Sama dengan backfill-picks. */
const MIN_HISTORY = 220;

/** Sebuah subset terlalu kecil untuk median yang berarti dibuang sesinya. */
const MIN_SUBSET = 8;

/** Sesi dengan inti blok di bawah ini tidak bisa dibagi sepuluh desil. */
const MIN_CORE = 50;

/**
 * Jendela rezim: return IHSG 60 sesi terakhir.
 *
 * 60 dipilih karena SAMA dengan jendela runup yang sedang diuji, bukan karena
 * dicari. Rezim yang diukur pada jendela berbeda dari sinyalnya akan membuat
 * "sinyal ini hidup di pasar naik" tidak bisa dibedakan dari "sinyal ini
 * hidup ketika jendelanya sendiri sedang naik".
 */
const REGIME_WINDOW = 60;

/**
 * Ambang batas artikel 3.19 untuk true Sharpe 0,5, apa adanya.
 * 100 = lemah, 250 = sedang, 500 = andal, 1000 = sangat andal.
 */
const RELIABILITY = [100, 250, 500, 1000];

/** 3.11: minimum kasar per sel rezim sebelum sel itu boleh dipercaya. */
const REGIME_MIN_DAYS = 252;

/**
 * Ladder biaya IDX, sekali putar (beli lalu jual).
 *
 * Komisi ritel IDX yang lazim: 0,15% beli / 0,25% jual — selisihnya karena
 * sisi jual menanggung PPh final 0,1% plus levy. Itu angka yang cukup pasti.
 *
 * Slippage TIDAK pasti dan skrip ini tidak berpura-pura tahu. Tick size IDX
 * berjenjang menurut harga, jadi satu tick pada saham Rp 200 adalah 0,5%
 * sementara pada saham Rp 5.000 sekitar 0,2%. Karena itu tiga skenario, bukan
 * satu angka, dan yang tengah bukan "yang benar" melainkan yang paling sering
 * dipakai orang.
 */
const COSTS: { id: string; label: string; buy: number; sell: number }[] = [
  { id: 'fee', label: 'komisi saja (0,15% / 0,25%)', buy: 0.0015, sell: 0.0025 },
  { id: 'mid', label: 'komisi + slippage 10bp/sisi', buy: 0.0025, sell: 0.0035 },
  { id: 'wide', label: 'komisi + slippage 35bp/sisi', buy: 0.005, sell: 0.006 },
];

// ── util ──────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

const median = (xs: number[]): number => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Median dari `n` slot pertama sebuah buffer yang boleh dirusak. Tanpa alokasi. */
function medianOfBuffer(buf: Float64Array, n: number): number {
  if (n <= 0) return NaN;
  const view = buf.subarray(0, n);
  view.sort();
  const m = n >> 1;
  return n % 2 ? view[m] : (view[m - 1] + view[m]) / 2;
}

const pp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}` : '  -  ');
const pc = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}%` : '   -   ');

/**
 * RNG berbenih (mulberry32).
 *
 * Math.random akan membuat p-value berubah tiap dijalankan, dan angka yang
 * ikut memutuskan apakah sebuah aturan dipertahankan tidak boleh berubah
 * sendiri antara dua orang yang membaca laporan yang sama. Benihnya bisa
 * diganti lewat --seed untuk memeriksa bahwa kesimpulannya tidak bergantung
 * pada satu benih.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates di tempat. */
function shuffleInPlace(arr: Int32Array, rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

/**
 * Spearman rho, peringkat 1 untuk nilai TERKECIL di kedua deret.
 *
 * Orientasinya diuji tiap skrip mulai — lihat assertSpearmanOrientation().
 * Ini pelajaran dari rank:diag: versi pertamanya memberi peringkat 1 kepada
 * nilai TERBESAR di satu deret dan TERKECIL di deret lain, sehingga tandanya
 * terbalik sementara keterangan di layar mengatakan sebaliknya. Kesalahan itu
 * tidak terlihat salah — ia cuma menyimpulkan kebalikannya.
 */
function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n !== ys.length || n < 3) return NaN;
  const rank = (vs: number[]): number[] => {
    const idx = vs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array<number>(n);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i] - mx) * (ry[i] - my);
    vx += (rx[i] - mx) ** 2;
    vy += (ry[i] - my) ** 2;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN;
}

/** Dua kasus yang jawabannya sudah diketahui. Skrip menolak jalan kalau salah. */
function assertSpearmanOrientation(): void {
  const naik = spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
  const turun = spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]);
  if (!(naik > 0.99) || !(turun < -0.99)) {
    console.error(`spearman terbalik: searah=${naik}, berlawanan=${turun}`);
    process.exit(1);
  }
}

// ── pengumpulan data ──────────────────────────────────────────────────────

/** Empat pembacaan kontinu. Yang pertama diuji; tiga sisanya pembanding. */
const INDICATORS = [
  { key: 'runup', label: 'Runup dari dasar 60 sesi' },
  { key: 'ext', label: 'Regangan di atas MA20 (ATR)' },
  { key: 'sessions', label: 'Sesi berturut di atas MA5' },
  { key: 'rsi', label: 'RSI14' },
] as const;
type IndKey = (typeof INDICATORS)[number]['key'];

/** Gerbang keras apa adanya. Tidak satu pun ambang di sini yang diubah. */
const GATES = [
  { key: 'mom', label: 'Mode momentum lengkap (passAll)' },
  { key: 'notFlown', label: 'Runup < 25% sendirian (aturan 2026-09-02)' },
  { key: 'union3', label: 'Gabungan tiga mode (dibaca watchlist tahap 3)' },
] as const;
type GateKey = (typeof GATES)[number]['key'];

interface Snap {
  date: string;
  /** Kode emiten likuid sesi ini, sejajar dengan seluruh array di bawah. */
  codes: string[];
  pos: Map<string, number>;
  ind: Record<IndKey, Float64Array>;
  gate: Record<GateKey, Uint8Array>;
  r1: Float64Array;
  r3: Float64Array;
  /** Return IHSG 60 sesi terakhir pada sesi ini. Penanda rezim. */
  regimeValue: number;
  /** Return IHSG 63 sesi ke DEPAN — pembanding pasif untuk bagian biaya. */
  indexForward3: number;
}

function forwardReturn(db: MarketDatabase, code: string, i: number, n: number): number {
  const s = db.series.get(code);
  if (!s) return NaN;
  const a = s.close[i];
  const b = s.close[i + n];
  return a > 0 && b > 0 ? b / a - 1 : NaN;
}

/**
 * IHSG pada tanggal `date`, dicari LEWAT TANGGAL bukan posisi.
 *
 * `indexDates` adalah grid tersendiri yang panjangnya bisa berbeda dari
 * `db.dates` — overlay intraday menambah slot ke salah satunya lebih dulu.
 * Penyelarasan berbasis posisi antara dua berkas sudah pernah patah di repo
 * ini dalam sehari dan membuat slot terbaru jadi NaN tanpa ada yang melempar.
 */
function buildIndexLookup(db: MarketDatabase): (date: string) => number {
  const series = db.indexSeries.get('COMPOSITE');
  const at = new Map<string, number>();
  if (series) {
    for (let i = 0; i < db.indexDates.length; i++) {
      const v = series.close[i];
      if (Number.isFinite(v) && v > 0) at.set(db.indexDates[i], v);
    }
  }
  return (date: string) => at.get(date) ?? NaN;
}

// ── inti blok dan permutasi ───────────────────────────────────────────────

interface Block {
  from: number;
  to: number;
  /** Emiten yang likuid di SELURUH sesi blok — satu-satunya yang boleh diacak. */
  core: string[];
}

function buildBlocks(snaps: Snap[], len: number): Block[] {
  const out: Block[] = [];
  for (let from = 0; from < snaps.length; from += len) {
    const to = Math.min(from + len, snaps.length);
    let core: string[] | null = null;
    for (let t = from; t < to; t++) {
      if (core === null) core = [...snaps[t].codes];
      else core = core.filter((c) => snaps[t].pos.has(c));
    }
    out.push({ from, to, core: core ?? [] });
  }
  return out;
}

/**
 * Paruh-usia autokorelasi peringkat lintas emiten sebuah indikator.
 *
 * Diukur, bukan diasumsikan: rho Spearman antara peringkat hari t dan
 * peringkat hari t+k atas emiten yang sama, dirata-rata lintas t, lalu dicari
 * k terkecil yang rho-nya turun di bawah 0,5. Itulah panjang blok yang dipakai
 * 3.22 ("block length should match the indicator's autocorrelation half-life").
 */
function rankHalfLife(snaps: Snap[], key: IndKey, maxLag: number): number {
  const step = Math.max(1, Math.floor(snaps.length / 60));
  for (let k = 1; k <= maxLag; k++) {
    const rhos: number[] = [];
    for (let t = 0; t + k < snaps.length; t += step) {
      const a = snaps[t];
      const b = snaps[t + k];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let j = 0; j < a.codes.length; j++) {
        const p = b.pos.get(a.codes[j]);
        if (p === undefined) continue;
        const va = a.ind[key][j];
        const vb = b.ind[key][p];
        if (Number.isFinite(va) && Number.isFinite(vb)) {
          xs.push(va);
          ys.push(vb);
        }
      }
      if (xs.length >= 30) rhos.push(spearman(xs, ys));
    }
    const m = median(rhos);
    if (Number.isFinite(m) && m < 0.5) return k;
  }
  return maxLag;
}

/**
 * Peta donor untuk satu blok: tiap emiten inti memakai nilai indikator milik
 * emiten inti lain, SAMA sepanjang blok.
 *
 * Dikembalikan sebagai indeks ke dalam `block.core`, bukan kode, supaya loop
 * permutasi tidak menyentuh string sama sekali.
 */
// Int32Array<ArrayBuffer>, bukan Int32Array polos: sejak TypeScript 5.7 tipe
// array bertipe punya parameter buffer, dan `new Int32Array(n)` menghasilkan
// yang berbasis ArrayBuffer sementara `Int32Array` telanjang berarti
// ArrayBufferLike — yang lebih longgar dan tidak bisa ditugaskan ke sana.
function donorPermutation(coreCount: number, rnd: () => number): Int32Array<ArrayBuffer> {
  const perm = new Int32Array(coreCount);
  for (let i = 0; i < coreCount; i++) perm[i] = i;
  shuffleInPlace(perm, rnd);
  return perm;
}

// ── statistik ─────────────────────────────────────────────────────────────

interface SpreadOut {
  /** Spread desil 1 dikurangi desil 10, per sesi. Sejajar dengan snaps yang dipakai. */
  perSession: number[];
  sessionIdx: number[];
  /** Efek tiap desil terhadap keranjang inti, dimediankan lintas sesi. */
  decileEffect: number[];
}

/**
 * Buffer kerja yang dipakai ulang di seluruh permutasi.
 *
 * Dialokasikan sekali karena loop permutasi memanggil ini ratusan ribu kali;
 * mengalokasikan array baru tiap panggilan membuat GC yang jadi penentu waktu
 * jalan, bukan hitungannya.
 */
interface Scratch {
  vals: Float64Array;
  rets: Float64Array;
  sorted: Float64Array;
  bin: Float64Array;
  decile: number[][];
}

function makeScratch(cap: number): Scratch {
  return {
    vals: new Float64Array(cap),
    rets: new Float64Array(cap),
    sorted: new Float64Array(cap),
    bin: new Float64Array(cap),
    decile: Array.from({ length: 10 }, () => [] as number[]),
  };
}

/**
 * SPREAD dan efek per desil untuk satu indikator.
 *
 * `valueOf(t, j)` mengembalikan nilai indikator untuk emiten inti ke-j pada
 * sesi ke-t; itulah satu-satunya tempat permutasi masuk. Selebihnya identik
 * antara yang teramati dan yang diacak, yang memang syaratnya.
 */
function spreadStatistic(
  snaps: Snap[],
  blocks: Block[],
  horizonKey: 'r1' | 'r3',
  valueOf: (t: number, coreIdx: number, block: Block) => number,
  sc: Scratch,
  keepDeciles: boolean,
): SpreadOut {
  const perSession: number[] = [];
  const sessionIdx: number[] = [];
  if (keepDeciles) for (const d of sc.decile) d.length = 0;

  for (const block of blocks) {
    const core = block.core;
    if (core.length < MIN_CORE) continue;
    for (let t = block.from; t < block.to; t++) {
      const snap = snaps[t];
      const ret = snap[horizonKey];

      let n = 0;
      for (let j = 0; j < core.length; j++) {
        const p = snap.pos.get(core[j]);
        if (p === undefined) continue;
        const v = valueOf(t, j, block);
        const r = ret[p];
        if (!Number.isFinite(v) || !Number.isFinite(r)) continue;
        sc.vals[n] = v;
        sc.rets[n] = r;
        n++;
      }
      if (n < MIN_CORE) continue;

      sc.sorted.set(sc.vals.subarray(0, n));
      sc.sorted.subarray(0, n).sort();

      // Basis keranjang inti sesi ini — sama untuk kesepuluh desil.
      sc.bin.set(sc.rets.subarray(0, n));
      const base = medianOfBuffer(sc.bin, n);
      if (!Number.isFinite(base)) continue;

      // Ambang desil dibaca dari deret terurut. Nilai kembar boleh membuat
      // desilnya tidak persis sama besar; itu berlaku sama untuk yang teramati
      // dan yang diacak, jadi tidak menggeser perbandingannya.
      const lo = sc.sorted[Math.max(0, Math.floor(n / 10) - 1)];
      const hi = sc.sorted[Math.min(n - 1, Math.floor((9 * n) / 10))];

      let n1 = 0;
      for (let j = 0; j < n; j++) if (sc.vals[j] <= lo) sc.bin[n1++] = sc.rets[j];
      const m1 = n1 >= MIN_SUBSET ? medianOfBuffer(sc.bin, n1) : NaN;

      let n10 = 0;
      for (let j = 0; j < n; j++) if (sc.vals[j] >= hi) sc.bin[n10++] = sc.rets[j];
      const m10 = n10 >= MIN_SUBSET ? medianOfBuffer(sc.bin, n10) : NaN;

      if (Number.isFinite(m1) && Number.isFinite(m10)) {
        perSession.push(m1 - m10);
        sessionIdx.push(t);
      }

      if (keepDeciles) {
        // Sepuluh desil penuh hanya dihitung untuk statistik teramati dan
        // untuk MONOTON; di dalam loop permutasi ini dilewati, karena
        // sepuluh median per sesi delapan kali lebih mahal daripada dua.
        const order = new Int32Array(n);
        for (let j = 0; j < n; j++) order[j] = j;
        const arr = Array.from(order);
        arr.sort((a, b) => sc.vals[a] - sc.vals[b]);
        for (let d = 0; d < 10; d++) {
          const from = Math.floor((d * n) / 10);
          const to = Math.floor(((d + 1) * n) / 10);
          if (to - from < MIN_SUBSET) continue;
          let k = 0;
          for (let j = from; j < to; j++) sc.bin[k++] = sc.rets[arr[j]];
          const md = medianOfBuffer(sc.bin, k);
          if (Number.isFinite(md)) sc.decile[d].push(md - base);
        }
      }
    }
  }

  return {
    perSession,
    sessionIdx,
    decileEffect: keepDeciles ? sc.decile.map((d) => median(d)) : [],
  };
}

/** Efek sebuah gerbang: median [median yang lolos - median keranjang inti]. */
function gateStatistic(
  snaps: Snap[],
  blocks: Block[],
  horizonKey: 'r1' | 'r3',
  passOf: (t: number, coreIdx: number, block: Block) => boolean,
  sc: Scratch,
): { perSession: number[]; sessionIdx: number[]; share: number[] } {
  const perSession: number[] = [];
  const sessionIdx: number[] = [];
  const share: number[] = [];

  for (const block of blocks) {
    const core = block.core;
    if (core.length < MIN_CORE) continue;
    for (let t = block.from; t < block.to; t++) {
      const snap = snaps[t];
      const ret = snap[horizonKey];

      let n = 0;
      let nHit = 0;
      for (let j = 0; j < core.length; j++) {
        const p = snap.pos.get(core[j]);
        if (p === undefined) continue;
        const r = ret[p];
        if (!Number.isFinite(r)) continue;
        sc.rets[n] = r;
        sc.vals[n] = passOf(t, j, block) ? 1 : 0;
        if (sc.vals[n] === 1) nHit++;
        n++;
      }
      if (n < MIN_CORE) continue;
      share.push(nHit / n);
      if (nHit < MIN_SUBSET) continue;

      sc.bin.set(sc.rets.subarray(0, n));
      const base = medianOfBuffer(sc.bin, n);
      let k = 0;
      for (let j = 0; j < n; j++) if (sc.vals[j] === 1) sc.bin[k++] = sc.rets[j];
      const hit = medianOfBuffer(sc.bin, k);
      if (Number.isFinite(base) && Number.isFinite(hit)) {
        perSession.push(hit - base);
        sessionIdx.push(t);
      }
    }
  }
  return { perSession, sessionIdx, share };
}

/**
 * Effective N dari autokorelasi deret statistik per sesi.
 *
 * N_eff = N / (1 + 2 * sum_k (1 - k/N) * rho_k), dipotong pada rho pertama yang
 * negatif (initial-positive-sequence). Ini versi terukur dari koreksi hold-time
 * di 3.19: "a strategy that holds positions for 30 days and observes returns
 * daily has approximately N/30 effective independent trades" — bedanya angka
 * ini tidak mengasumsikan 63, ia menghitungnya dari datanya sendiri.
 */
function effectiveN(xs: number[], maxLag: number): { neff: number; lags: number } {
  const n = xs.length;
  if (n < 10) return { neff: n, lags: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let c0 = 0;
  for (const x of xs) c0 += (x - mean) ** 2;
  c0 /= n;
  if (!(c0 > 0)) return { neff: n, lags: 0 };

  let sum = 0;
  let used = 0;
  for (let k = 1; k <= Math.min(maxLag, n - 2); k++) {
    let ck = 0;
    for (let i = 0; i + k < n; i++) ck += (xs[i] - mean) * (xs[i + k] - mean);
    ck /= n;
    const rho = ck / c0;
    if (rho <= 0) break;
    sum += (1 - k / n) * rho;
    used = k;
  }
  const neff = n / (1 + 2 * sum);
  return { neff: Math.max(1, Math.min(n, neff)), lags: used };
}

/** SE(Sharpe) menurut 3.19, apa adanya. */
const seSharpe = (sr: number, n: number) => Math.sqrt((1 + 0.5 * sr * sr) / n);

/** Return setelah biaya, diterapkan PER BARIS seperti diminta 3.31. */
const netOf = (r: number, buy: number, sell: number) =>
  Number.isFinite(r) ? ((1 + r) * (1 - sell)) / (1 + buy) - 1 : NaN;

/** p dua sisi dengan koreksi +1 dari 3.22. */
function permutationP(observed: number, nullDist: number[]): number {
  const b = nullDist.length;
  if (!b || !Number.isFinite(observed)) return NaN;
  let atLeast = 0;
  for (const v of nullDist) if (Math.abs(v) >= Math.abs(observed)) atLeast++;
  return (1 + atLeast) / (b + 1);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  assertSpearmanOrientation();

  const perms = Math.max(20, Number(arg('perms', '1000')));
  const seed = Number(arg('seed', '20260903'));

  const db = await loadMarketDatabaseFromDisk(DATA_DIR);
  const lastOfficial = db.live?.applied ? db.dates.length - 2 : db.dates.length - 1;
  const lastUsable = lastOfficial - M3;
  const want = Number(arg('sessions', String(lastUsable)));
  const first = Math.max(MIN_HISTORY, lastUsable - want + 1);
  const indexAt = buildIndexLookup(db);

  console.log('ROBUSTNESS AUDIT — aturan screener & watchlist yang dipakai produksi');
  console.log('');
  console.log(`universe ${db.emiten.length} emiten · ${db.dates.length} sesi`);
  console.log(`menilai ${db.dates[first]} .. ${db.dates[lastUsable]} (${lastUsable - first + 1} sesi)`);
  console.log(`permutasi ${perms} · benih ${seed}`);
  console.log('');

  // ── pengumpulan ─────────────────────────────────────────────────────────
  const snaps: Snap[] = [];
  const t0 = Date.now();
  let done = 0;

  for (let i = first; i <= lastUsable; i++) {
    const sliced = sliceMarketDatabase(db, i);
    const factors = computeAllFactors(sliced);
    // Ketiga mode dijalankan karena watchlist tahap 3 membaca ketiganya.
    // Bendera aturan selain `passAll` identik antar mode, jadi pembacaan
    // lainnya diambil dari hasil momentum saja.
    const mom = runStockScreener(sliced, { mode: 'momentum' });
    const pul = runStockScreener(sliced, { mode: 'pullback' });
    const lag = runStockScreener(sliced, { mode: 'laggard' });

    const rows: ScreenerRow[] = [];
    for (const r of mom.all.values()) if (r.passVolume && r.passValue) rows.push(r);
    if (rows.length < MIN_CORE) continue;

    const n = rows.length;
    const snap: Snap = {
      date: db.dates[i],
      codes: rows.map((r) => r.code),
      pos: new Map(rows.map((r, j) => [r.code, j])),
      ind: {
        runup: new Float64Array(n),
        ext: new Float64Array(n),
        sessions: new Float64Array(n),
        rsi: new Float64Array(n),
      },
      gate: {
        mom: new Uint8Array(n),
        notFlown: new Uint8Array(n),
        union3: new Uint8Array(n),
      },
      r1: new Float64Array(n),
      r3: new Float64Array(n),
      regimeValue: NaN,
      indexForward3: NaN,
    };

    for (let j = 0; j < n; j++) {
      const r = rows[j];
      const f = factors.get(r.code);
      snap.ind.runup[j] = r.runupFromLow;
      snap.ind.ext[j] = r.extensionAtr;
      snap.ind.sessions[j] = r.sessionsAboveMaLong;
      snap.ind.rsi[j] = f ? f.rsi14 : NaN;
      snap.gate.mom[j] = r.passAll ? 1 : 0;
      snap.gate.notFlown[j] = r.passNotFlown ? 1 : 0;
      const p = pul.all.get(r.code);
      const l = lag.all.get(r.code);
      snap.gate.union3[j] = r.passAll || p?.passAll || l?.passAll ? 1 : 0;
      snap.r1[j] = forwardReturn(db, r.code, i, M1);
      snap.r3[j] = forwardReturn(db, r.code, i, M3);
    }

    const idxNow = indexAt(db.dates[i]);
    const idxPast = indexAt(db.dates[Math.max(0, i - REGIME_WINDOW)]);
    const idxFwd = indexAt(db.dates[Math.min(db.dates.length - 1, i + M3)]);
    snap.regimeValue = idxNow > 0 && idxPast > 0 ? idxNow / idxPast - 1 : NaN;
    snap.indexForward3 = idxNow > 0 && idxFwd > 0 ? idxFwd / idxNow - 1 : NaN;

    snaps.push(snap);
    done++;
    if (done % 100 === 0 || i === lastUsable) {
      console.log(`  ${done}/${lastUsable - first + 1} sesi · ${((Date.now() - t0) / done / 1000).toFixed(2)} dtk/sesi`);
    }
  }

  if (snaps.length < 60) {
    console.error(`hanya ${snaps.length} sesi terkumpul — terlalu sedikit untuk uji apa pun.`);
    process.exit(1);
  }

  const maxN = Math.max(...snaps.map((s) => s.codes.length));
  const sc = makeScratch(maxN + 16);

  // ══ BAGIAN 1 — CAKUPAN REZIM (3.11) ═════════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('1. CAKUPAN REZIM (3.11) — backtest hanya berlaku untuk rezim yang dicakupnya');
  console.log('═'.repeat(78));

  const regimeOf = (s: Snap): 'naik' | 'turun' | 'nihil' =>
    !Number.isFinite(s.regimeValue) ? 'nihil' : s.regimeValue >= 0 ? 'naik' : 'turun';

  const regimeCount = { naik: 0, turun: 0, nihil: 0 };
  for (const s of snaps) regimeCount[regimeOf(s)]++;

  // Puncak ke dasar IHSG di dalam jendela, untuk membuktikan crash 2026 ada
  // di dalam data dan bukan asumsi.
  let peak = -Infinity;
  let trough = Infinity;
  let worstDd = 0;
  let peakDate = '';
  let ddDate = '';
  for (const s of snaps) {
    const v = indexAt(s.date);
    if (!(v > 0)) continue;
    if (v > peak) {
      peak = v;
      peakDate = s.date;
    }
    const dd = v / peak - 1;
    if (dd < worstDd) {
      worstDd = dd;
      ddDate = s.date;
      trough = v;
    }
  }

  console.log('');
  console.log(`  IHSG puncak ${peak.toFixed(0)} (${peakDate}) -> dasar ${trough.toFixed(0)} (${ddDate})`);
  console.log(`  penurunan terdalam di dalam jendela: ${pc(worstDd)}`);
  console.log('');
  console.log(`  sel rezim (return IHSG ${REGIME_WINDOW} sesi):`);
  console.log(`    naik  (>= 0) : ${String(regimeCount.naik).padStart(4)} sesi  ${regimeCount.naik >= REGIME_MIN_DAYS ? 'cukup' : `DI BAWAH minimum ${REGIME_MIN_DAYS}`}`);
  console.log(`    turun (<  0) : ${String(regimeCount.turun).padStart(4)} sesi  ${regimeCount.turun >= REGIME_MIN_DAYS ? 'cukup' : `DI BAWAH minimum ${REGIME_MIN_DAYS}`}`);
  if (regimeCount.nihil) console.log(`    tanpa nilai  : ${regimeCount.nihil} sesi (IHSG tidak terbaca)`);
  console.log('');
  console.log(`  3.11 meminta minimal ${REGIME_MIN_DAYS} sesi per sel untuk taksiran KASAR dan 1000 untuk`);
  console.log('  taksiran yang layak dipercaya. Sel yang di bawah itu dilaporkan tetap, tapi');
  console.log('  angkanya tidak boleh dipakai sebagai dasar keputusan sendirian.');

  // ── panjang blok ────────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(78));
  console.log('2. AUTOKORELASI INDIKATOR DAN PANJANG BLOK (3.22)');
  console.log('═'.repeat(78));
  console.log('');
  console.log('  Paruh-usia = lag terkecil yang rho peringkat lintas emitennya turun < 0,50.');
  console.log('  Panjang blok permutasi disetel ke angka itu, bukan ditebak.');
  console.log('');
  console.log('  indikator                        paruh-usia (sesi)   blok dipakai');

  const halfLife: Record<string, number> = {};
  for (const ind of INDICATORS) {
    const hl = rankHalfLife(snaps, ind.key, 90);
    halfLife[ind.key] = hl;
    console.log(`  ${ind.label.padEnd(34)}${String(hl).padStart(10)}${String(hl).padStart(15)}`);
  }
  // Gerbang adalah fungsi dari beberapa pembacaan sekaligus; blok untuk gerbang
  // memakai paruh-usia TERPANJANG di antara pembacaan penyusunnya, karena blok
  // yang terlalu pendek adalah kesalahan yang menolak terlalu sering.
  const gateBlock = Math.max(...Object.values(halfLife));
  console.log(`  ${'Gerbang (pakai yang terpanjang)'.padEnd(34)}${''.padStart(10)}${String(gateBlock).padStart(15)}`);

  // ══ BAGIAN 3 — EFFECTIVE N (3.19 / 3.20) ════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('3. EFFECTIVE N (3.19 / 3.20) — berapa pengamatan bebas yang benar-benar ada');
  console.log('═'.repeat(78));

  const totalRows = snaps.reduce((a, s) => a + s.codes.length, 0);
  const runupBlocks = buildBlocks(snaps, halfLife.runup);
  const obsRunup3 = spreadStatistic(
    snaps,
    runupBlocks,
    'r3',
    (t, j, b) => snaps[t].ind.runup[snaps[t].pos.get(b.core[j])!],
    sc,
    true,
  );
  const obsRunup1 = spreadStatistic(
    snaps,
    runupBlocks,
    'r1',
    (t, j, b) => snaps[t].ind.runup[snaps[t].pos.get(b.core[j])!],
    sc,
    false,
  );

  const eff3 = effectiveN(obsRunup3.perSession, 2 * M3);
  const eff1 = effectiveN(obsRunup1.perSession, 2 * M1);
  const nonOverlap3 = Math.floor(snaps.length / M3);
  const nonOverlap1 = Math.floor(snaps.length / M1);

  console.log('');
  console.log(`  baris mentah (sesi x emiten likuid)          : ${totalRows.toLocaleString('id-ID')}`);
  console.log(`  sesi terpakai                                : ${snaps.length}`);
  console.log('');
  console.log('  klaim                     jendela bebas   N_eff autokorelasi   lag terpakai');
  console.log(
    `  spread runup, 3 bulan  ${String(nonOverlap3).padStart(14)}${eff3.neff.toFixed(1).padStart(21)}${String(eff3.lags).padStart(15)}`,
  );
  console.log(
    `  spread runup, 1 bulan  ${String(nonOverlap1).padStart(14)}${eff1.neff.toFixed(1).padStart(21)}${String(eff1.lags).padStart(15)}`,
  );
  console.log('');
  console.log('  Ambang 3.19 untuk true Sharpe 0,5, dan di mana klaim tiga-bulanan berdiri:');
  for (const thr of RELIABILITY) {
    const label = { 100: 'lemah', 250: 'sedang', 500: 'andal', 1000: 'sangat andal' }[thr];
    const ok = eff3.neff >= thr;
    console.log(`    ${String(thr).padStart(5)} (${String(label).padEnd(13)}) : ${ok ? 'TERCAPAI' : 'tidak tercapai'}`);
  }
  console.log('');
  console.log(`  SE(Sharpe) = sqrt((1 + 0,5*SR^2)/N) pada N_eff = ${eff3.neff.toFixed(1)} dan SR = 0,5`);
  console.log(`    -> ${seSharpe(0.5, eff3.neff).toFixed(2)} — selang 95% sekitar ±${(2 * seSharpe(0.5, eff3.neff)).toFixed(2)} Sharpe.`);
  console.log('  Artinya sampel ini tidak bisa membedakan Sharpe 0,5 dari nol, apa pun');
  console.log('  yang tertulis di baris mana pun di bawah.');

  // ══ BAGIAN 4 — UJI PERMUTASI (3.22) ═════════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('4. UJI PERMUTASI (3.22) — bisakah pola ini muncul dari pengacakan saja?');
  console.log('═'.repeat(78));

  interface TestOut {
    label: string;
    obsSpread: number;
    obsMono: number;
    pBlock: number;
    pNaive: number;
    nullSd: number;
    nullSdNaive: number;
    null95: number;
    sessions: number;
    deciles: number[];
  }

  const runTest = (
    label: string,
    key: IndKey,
    blockLen: number,
  ): TestOut => {
    const blocks = buildBlocks(snaps, blockLen);
    const naiveBlocks = buildBlocks(snaps, 1);

    const obs = spreadStatistic(
      snaps,
      blocks,
      'r3',
      (t, j, b) => snaps[t].ind[key][snaps[t].pos.get(b.core[j])!],
      sc,
      true,
    );
    const obsStat = median(obs.perSession);
    const obsMono = spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], obs.decileEffect);

    const nullOf = (bs: Block[], tag: number): number[] => {
      const rnd = mulberry32(seed + tag);
      const out: number[] = [];
      // Peta donor dibuat ulang tiap permutasi untuk SETIAP blok; di dalam satu
      // blok ia tetap, dan itulah yang menjaga persistensi indikatornya.
      const donors = bs.map((b) => new Int32Array(b.core.length));
      for (let p = 0; p < perms; p++) {
        for (let bi = 0; bi < bs.length; bi++) {
          const d = donorPermutation(bs[bi].core.length, rnd);
          donors[bi] = d;
        }
        const blockIndex = new Map<Block, number>();
        bs.forEach((b, bi) => blockIndex.set(b, bi));
        const st = spreadStatistic(
          snaps,
          bs,
          'r3',
          (t, j, b) => {
            const d = donors[blockIndex.get(b)!];
            const donorCode = b.core[d[j]];
            const p2 = snaps[t].pos.get(donorCode);
            return p2 === undefined ? NaN : snaps[t].ind[key][p2];
          },
          sc,
          false,
        );
        out.push(median(st.perSession));
      }
      return out;
    };

    const nullBlock = nullOf(blocks, 1).filter(Number.isFinite);
    const nullNaive = nullOf(naiveBlocks, 2).filter(Number.isFinite);
    const sortedBlock = [...nullBlock].sort((a, b) => a - b);
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
    };

    return {
      label,
      obsSpread: obsStat,
      obsMono,
      pBlock: permutationP(obsStat, nullBlock),
      pNaive: permutationP(obsStat, nullNaive),
      nullSd: sd(nullBlock),
      nullSdNaive: sd(nullNaive),
      null95: quantile(sortedBlock, 0.975),
      sessions: obs.perSession.length,
      deciles: obs.decileEffect,
    };
  };

  console.log('');
  console.log('  Statistik: median lintas sesi dari [median return 3 bulan desil 1 - desil 10],');
  console.log('  atas INTI blok saja. Return tidak digeser sedikit pun; yang diacak hanya');
  console.log('  pasangan emiten <-> nilai indikator, satu permutasi per blok.');
  console.log('');
  console.log('  indikator                     spread   p(blok)  p(naif)   sd null   sesi');
  console.log('  ' + '-'.repeat(74));

  const tests: TestOut[] = [];
  for (const ind of INDICATORS) {
    const r = runTest(ind.label, ind.key, halfLife[ind.key]);
    tests.push(r);
    console.log(
      `  ${ind.label.padEnd(30)}${pp(r.obsSpread).padStart(7)}` +
        `${r.pBlock.toFixed(4).padStart(10)}${r.pNaive.toFixed(4).padStart(9)}` +
        `${pp(r.nullSd).padStart(10)}${String(r.sessions).padStart(7)}`,
    );
  }

  console.log('');
  console.log('  MONOTONISITAS — rho Spearman antara nomor desil dan efeknya');
  console.log('  (-1 = desil terendah paling untung, monoton sempurna)');
  for (const r of tests) {
    console.log(`  ${r.label.padEnd(34)}rho = ${r.obsMono.toFixed(3).padStart(6)}`);
  }

  console.log('');
  console.log('  SEBARAN NULL vs TERAMATI');
  for (const r of tests) {
    console.log(
      `  ${r.label.padEnd(30)} teramati ${pp(r.obsSpread)}pp · ` +
        `null 97,5% ${pp(r.null95)}pp · sd blok ${pp(r.nullSd)}pp vs sd naif ${pp(r.nullSdNaive)}pp`,
    );
  }
  console.log('');
  console.log('  Kolom sd blok vs sd naif adalah demonstrasi peringatan 3.22 itu sendiri:');
  console.log('  null naif lebih sempit, jadi ia menghasilkan p yang lebih kecil untuk');
  console.log('  statistik teramati yang sama persis. p(naif) di tabel atas ADALAH angka');
  console.log('  yang akan dilaporkan skrip yang tidak memakai blok.');

  console.log('');
  console.log(`  Koreksi banyak-uji: ${INDICATORS.length} indikator diuji, jadi ambang Bonferroni`);
  console.log(`  untuk alfa 0,05 adalah p < ${(0.05 / INDICATORS.length).toFixed(4)}, bukan p < 0,05.`);

  // ── gerbang produksi ────────────────────────────────────────────────────
  console.log('');
  console.log('  GERBANG PRODUKSI — label lolos/tidak diacak, jumlah yang lolos dipertahankan');
  console.log('');
  console.log('  gerbang                                lolos    efek   p(blok)   sesi');
  console.log('  ' + '-'.repeat(74));

  const gateBlocks = buildBlocks(snaps, gateBlock);
  for (const g of GATES) {
    const obs = gateStatistic(
      snaps,
      gateBlocks,
      'r3',
      (t, j, b) => snaps[t].gate[g.key][snaps[t].pos.get(b.core[j])!] === 1,
      sc,
    );
    const obsStat = median(obs.perSession);
    const rnd = mulberry32(seed + 7);
    const nullDist: number[] = [];
    const blockIndex = new Map<Block, number>();
    gateBlocks.forEach((b, bi) => blockIndex.set(b, bi));
    const donors = gateBlocks.map((b) => new Int32Array(b.core.length));
    for (let p = 0; p < perms; p++) {
      for (let bi = 0; bi < gateBlocks.length; bi++) donors[bi] = donorPermutation(gateBlocks[bi].core.length, rnd);
      const st = gateStatistic(
        snaps,
        gateBlocks,
        'r3',
        (t, j, b) => {
          const d = donors[blockIndex.get(b)!];
          const p2 = snaps[t].pos.get(b.core[d[j]]);
          return p2 !== undefined && snaps[t].gate[g.key][p2] === 1;
        },
        sc,
      );
      const v = median(st.perSession);
      if (Number.isFinite(v)) nullDist.push(v);
    }
    console.log(
      `  ${g.label.padEnd(38)}${(100 * median(obs.share)).toFixed(0).padStart(4)}%` +
        `${pp(obsStat).padStart(8)}${permutationP(obsStat, nullDist).toFixed(4).padStart(10)}${String(obs.perSession.length).padStart(7)}`,
    );
  }

  // ══ BAGIAN 5 — STRATIFIKASI REZIM (3.11) ════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('5. EFEK RUNUP DIPISAH MENURUT REZIM (3.11)');
  console.log('═'.repeat(78));

  const inRegime = (t: number, which: 'naik' | 'turun') => regimeOf(snaps[t]) === which;

  const regimeStat = (which: 'naik' | 'turun', out: SpreadOut) => {
    const vals: number[] = [];
    for (let k = 0; k < out.perSession.length; k++) {
      if (inRegime(out.sessionIdx[k], which)) vals.push(out.perSession[k]);
    }
    return vals;
  };

  const upVals3 = regimeStat('naik', obsRunup3);
  const downVals3 = regimeStat('turun', obsRunup3);
  const upVals1 = regimeStat('naik', obsRunup1);
  const downVals1 = regimeStat('turun', obsRunup1);

  // Null per rezim dari permutasi yang SAMA strukturnya, disaring ke sesi rezim
  // itu saja. Menjalankan permutasi terpisah per rezim akan memutus blok di
  // batas rezim dan memberi null yang lebih longgar tanpa alasan.
  const regimeNull = (which: 'naik' | 'turun'): number[] => {
    const blocks = buildBlocks(snaps, halfLife.runup);
    const blockIndex = new Map<Block, number>();
    blocks.forEach((b, bi) => blockIndex.set(b, bi));
    const donors = blocks.map((b) => new Int32Array(b.core.length));
    const rnd = mulberry32(seed + (which === 'naik' ? 11 : 13));
    const out: number[] = [];
    for (let p = 0; p < perms; p++) {
      for (let bi = 0; bi < blocks.length; bi++) donors[bi] = donorPermutation(blocks[bi].core.length, rnd);
      const st = spreadStatistic(
        snaps,
        blocks,
        'r3',
        (t, j, b) => {
          const d = donors[blockIndex.get(b)!];
          const p2 = snaps[t].pos.get(b.core[d[j]]);
          return p2 === undefined ? NaN : snaps[t].ind.runup[p2];
        },
        sc,
        false,
      );
      const vals: number[] = [];
      for (let k = 0; k < st.perSession.length; k++) {
        if (inRegime(st.sessionIdx[k], which)) vals.push(st.perSession[k]);
      }
      const v = median(vals);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  };

  const pUp = permutationP(median(upVals3), regimeNull('naik'));
  const pDown = permutationP(median(downVals3), regimeNull('turun'));

  console.log('');
  console.log('  spread runup (desil 1 - desil 10), dipisah rezim IHSG 60 sesi');
  console.log('');
  console.log('  rezim        sesi   1 bulan   3 bulan   p(blok, 3 bln)   cukup untuk 3.11?');
  console.log('  ' + '-'.repeat(74));
  console.log(
    `  naik  ${String(upVals3.length).padStart(10)}${pp(median(upVals1)).padStart(10)}${pp(median(upVals3)).padStart(10)}` +
      `${pUp.toFixed(4).padStart(17)}   ${regimeCount.naik >= REGIME_MIN_DAYS ? 'ya' : 'TIDAK'}`,
  );
  console.log(
    `  turun ${String(downVals3.length).padStart(10)}${pp(median(downVals1)).padStart(10)}${pp(median(downVals3)).padStart(10)}` +
      `${pDown.toFixed(4).padStart(17)}   ${regimeCount.turun >= REGIME_MIN_DAYS ? 'ya' : 'TIDAK'}`,
  );
  console.log('');
  console.log('  Kalau tanda kedua baris berbeda, yang ditemukan gate:ablate adalah RATA-RATA');
  console.log('  dua rezim yang berlawanan, bukan satu sifat yang bertahan — dan aturan yang');
  console.log('  dipasang atas dasar rata-rata itu akan salah arah di separuh waktu.');

  // ══ BAGIAN 6 — BIAYA (3.31) ═════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('6. REALISME BIAYA (3.31) — semua angka di atas adalah gerak harga KOTOR');
  console.log('═'.repeat(78));

  // Return absolut desil terendah runup, per sesi, sebelum dan sesudah biaya.
  // Yang bisa diperdagangkan adalah kaki panjangnya, bukan spread-nya: tidak
  // ada fasilitas short ritel di IDX untuk kaki desil 10.
  const absLow: number[] = [];
  const absBasket: number[] = [];
  const absIndex: number[] = [];
  const lowRows: number[] = [];
  const basketRows: number[] = [];

  for (const block of runupBlocks) {
    if (block.core.length < MIN_CORE) continue;
    for (let t = block.from; t < block.to; t++) {
      const snap = snaps[t];
      const pairs: { v: number; r: number }[] = [];
      for (const code of block.core) {
        const p = snap.pos.get(code);
        if (p === undefined) continue;
        const v = snap.ind.runup[p];
        const r = snap.r3[p];
        if (Number.isFinite(v) && Number.isFinite(r)) pairs.push({ v, r });
      }
      if (pairs.length < MIN_CORE) continue;
      pairs.sort((a, b) => a.v - b.v);
      const cut = Math.floor(pairs.length / 10);
      const low = pairs.slice(0, cut).map((x) => x.r);
      if (low.length < MIN_SUBSET) continue;
      absLow.push(median(low));
      absBasket.push(median(pairs.map((x) => x.r)));
      if (Number.isFinite(snap.indexForward3)) absIndex.push(snap.indexForward3);
      lowRows.push(low.length);
      basketRows.push(pairs.length);
    }
  }

  console.log('');
  console.log('  Return 3 bulan APA ADANYA (median lintas sesi), sekali putar per posisi.');
  console.log('  Biaya diterapkan per baris sebelum dimediankan, seperti diminta 3.31.');
  console.log('');
  console.log('  skenario biaya                    desil-1   keranjang    IHSG   edge vs keranjang');
  console.log('  ' + '-'.repeat(74));
  console.log(
    `  ${'KOTOR (tanpa biaya)'.padEnd(30)}${pp(median(absLow)).padStart(9)}${pp(median(absBasket)).padStart(12)}` +
      `${pp(median(absIndex)).padStart(8)}${pp(median(absLow) - median(absBasket)).padStart(20)}`,
  );

  for (const c of COSTS) {
    // Keranjang pembanding IKUT dikenai biaya: keranjang likuid yang
    // disetarakan adalah portofolio yang juga harus dibeli dan dijual. IHSG
    // TIDAK, karena memegang indeks selama 63 sesi tidak menimbulkan putaran.
    const netLow = median(absLow.map((r) => netOf(r, c.buy, c.sell)));
    const netBasket = median(absBasket.map((r) => netOf(r, c.buy, c.sell)));
    console.log(
      `  ${c.label.padEnd(30)}${pp(netLow).padStart(9)}${pp(netBasket).padStart(12)}` +
        `${pp(median(absIndex)).padStart(8)}${pp(netLow - netBasket).padStart(20)}`,
    );
  }

  const cWide = COSTS[COSTS.length - 1];
  const spreadNetWide = median(obsRunup3.perSession) * ((1 - cWide.sell) / (1 + cWide.buy));
  console.log('');
  console.log(`  spread desil1-desil10 setelah biaya terlebar: ${pp(spreadNetWide)}pp ` +
    `(kotor ${pp(median(obsRunup3.perSession))}pp)`);
  console.log('  Spread nyaris tidak terpengaruh biaya karena biaya proporsional menggeser');
  console.log('  KEDUA kakinya dengan faktor yang sama. Itu bukan kabar baik: spread ini juga');
  console.log('  TIDAK BISA diperdagangkan — kaki desil 10 butuh short yang tidak tersedia');
  console.log('  untuk ritel di IDX. Yang bisa dibeli hanya kolom desil-1 di tabel atas.');
  console.log('');
  console.log(`  Ukuran posisi tersirat: ${median(lowRows).toFixed(0)} emiten per sesi di desil-1,`);
  console.log(`  dari keranjang ${median(basketRows).toFixed(0)} emiten. Biaya dampak pasar TIDAK dimodelkan;`);
  console.log('  untuk order kecil itu wajar, untuk order di atas 1% ADV tidak.');

  // ══ BAGIAN 7 — MATRIKS PENUH (3.13) ═════════════════════════════════════
  console.log('');
  console.log('═'.repeat(78));
  console.log('7. MATRIKS PENUH (3.13) — bukan satu angka untuk seluruh sampel');
  console.log('═'.repeat(78));
  console.log('');
  console.log('  Efek tiap desil runup terhadap keranjang inti, 3 bulan, dipisah rezim.');
  console.log('  Kalau kemiringan hanya ada di satu kolom, satu angka gabungan menyembunyikannya.');
  console.log('');

  const decileByRegime = (which: 'naik' | 'turun' | 'semua'): number[] => {
    const acc: number[][] = Array.from({ length: 10 }, () => []);
    for (const block of runupBlocks) {
      if (block.core.length < MIN_CORE) continue;
      for (let t = block.from; t < block.to; t++) {
        if (which !== 'semua' && !inRegime(t, which)) continue;
        const snap = snaps[t];
        const pairs: { v: number; r: number }[] = [];
        for (const code of block.core) {
          const p = snap.pos.get(code);
          if (p === undefined) continue;
          const v = snap.ind.runup[p];
          const r = snap.r3[p];
          if (Number.isFinite(v) && Number.isFinite(r)) pairs.push({ v, r });
        }
        if (pairs.length < MIN_CORE) continue;
        pairs.sort((a, b) => a.v - b.v);
        const base = median(pairs.map((x) => x.r));
        for (let d = 0; d < 10; d++) {
          const from = Math.floor((d * pairs.length) / 10);
          const to = Math.floor(((d + 1) * pairs.length) / 10);
          if (to - from < MIN_SUBSET) continue;
          const m = median(pairs.slice(from, to).map((x) => x.r));
          if (Number.isFinite(m)) acc[d].push(m - base);
        }
      }
    }
    return acc.map((a) => median(a));
  };

  const dAll = decileByRegime('semua');
  const dUp = decileByRegime('naik');
  const dDown = decileByRegime('turun');

  console.log('  desil    semua    rezim naik   rezim turun');
  for (let d = 0; d < 10; d++) {
    console.log(
      `  ${String(d + 1).padStart(5)}${pp(dAll[d]).padStart(9)}${pp(dUp[d]).padStart(14)}${pp(dDown[d]).padStart(14)}`,
    );
  }
  console.log('');
  console.log(
    `  rho monoton  ${spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dAll).toFixed(3).padStart(6)}` +
      `${spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dUp).toFixed(3).padStart(14)}` +
      `${spearman([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dDown).toFixed(3).padStart(14)}`,
  );

  // ── penutup ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(78));
  console.log('BACA BEGINI');
  console.log('═'.repeat(78));
  console.log('');
  console.log('  p(blok) adalah angka yang berlaku. p(naif) hanya dicetak untuk menunjukkan');
  console.log('  berapa besar kesalahannya kalau autokorelasi diabaikan.');
  console.log('');
  console.log(`  Ambang keputusan: p < ${(0.05 / INDICATORS.length).toFixed(4)} (Bonferroni atas ${INDICATORS.length} indikator).`);
  console.log('');
  console.log('  Yang TIDAK bisa disimpulkan dari skrip ini:');
  console.log('    - Tahap 1 dan 2 watchlist (narasi pengumuman, rotasi konglomerat) TIDAK');
  console.log('      diuji. announcements.json hanya mencakup 45 hari, jadi tidak ada');
  console.log('      sejarah untuk membangun null. Itu lubang, bukan hasil nol.');
  console.log('    - Conviction / peringkat tidak diuji di sini; itu ranah rank:diag.');
  console.log('    - Emiten yang sudah delisting tidak ada di universe hari ini, jadi');
  console.log('      seluruh angka di atas OPTIMIS dengan besaran yang tidak terukur.');
  console.log('    - Biaya dampak pasar tidak dimodelkan sama sekali.');
  console.log('    - p yang kecil hanya berarti pola itu sulit muncul dari pengacakan. Ia');
  console.log('      BUKAN bukti pola itu akan bertahan di luar sampel (3.22 sendiri');
  console.log('      menegaskan ini), dan bukan bukti ia bertahan setelah biaya.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
