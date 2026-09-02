/**
 * rank-diagnostic.ts — memisahkan efek GERBANG dari efek PERINGKAT.
 *
 * ── KENAPA INI ADA ────────────────────────────────────────────────────────
 *
 * Jurnal yang diisi mundur menunjukkan kelima sumber pick kalah dari IHSG dan
 * kalah dari melempar dadu ke seluruh universe. Itu satu angka untuk dua
 * keputusan yang sangat berbeda, dan menggabungkannya membuat perbaikan mustahil
 * diarahkan:
 *
 *   GERBANG  — aturan keras yang memutuskan emiten mana yang LOLOS sama sekali.
 *   PERINGKAT — conviction, yang memutuskan sepuluh mana dari yang lolos itu
 *               yang benar-benar dicatat dan dibaca orang.
 *
 * Keduanya bisa gagal sendiri-sendiri, dan obatnya berlawanan. Kalau gerbangnya
 * yang buruk, memperbaiki conviction tidak akan menolong: ia hanya mengurutkan
 * ulang keranjang yang isinya memang jelek. Kalau peringkatnya yang buruk,
 * gerbangnya justru mungkin sudah bekerja dan yang dibuang adalah bagian
 * terbaiknya.
 *
 * ── CARA MENGUKURNYA ──────────────────────────────────────────────────────
 *
 * Untuk tiap sesi, tiga populasi pada horizon yang sama:
 *
 *   SEMESTA  median return SELURUH emiten yang diperdagangkan sesi itu.
 *   LIKUID   median return emiten yang lolos AMBANG LIKUIDITAS saja — nilai
 *            transaksi dan volume minimum — tanpa satu pun aturan strategi.
 *            Inilah "lempar dadu" yang jujur: keranjang yang benar-benar bisa
 *            dibeli. Membandingkan terhadap SEMESTA tidak adil, karena separuh
 *            semesta adalah saham yang ordernya tidak akan pernah terisi.
 *   LOLOS    median return emiten yang melewati SELURUH gerbang mode itu.
 *            Selisihnya terhadap LIKUID adalah EFEK ATURAN.
 *   TOP-10   median return sepuluh teratas menurut conviction.
 *            Selisihnya terhadap LOLOS adalah EFEK PERINGKAT.
 *
 * Selisih LIKUID terhadap SEMESTA dilaporkan terpisah sebagai EFEK LIKUIDITAS,
 * karena itu keputusan yang berbeda lagi dan bisa saja ia yang menyeret.
 *
 * Selisih diambil PER SESI lalu dimediankan, bukan memedian tiap populasi
 * lebih dulu. Sesi yang seluruh pasarnya jatuh akan menekan ketiga angka
 * bersama-sama; yang ingin diketahui adalah apakah alat ini menambah sesuatu
 * DI DALAM sesi itu, dan itu hanya terlihat kalau pasangannya tetap utuh.
 *
 * Ditambah tabel desil: kalau conviction memuat informasi, desil teratas harus
 * mengalahkan desil terbawah secara konsisten. Kalau tidak ada urutan sama
 * sekali di situ, skornya derau — dan derau yang diberi dua desimal di layar
 * lebih berbahaya daripada tidak ada skor, karena ia terbaca seperti keyakinan.
 *
 * ── CARA PAKAI ────────────────────────────────────────────────────────────
 *
 *   npm run rank:diag                  seluruh sejarah yang bisa dipakai
 *   npm run rank:diag -- --sessions 250
 */

import { join } from 'node:path';
import { loadChatContextFromDisk, loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { sliceMarketDatabase } from '../src/data/marketSlice';
import { computeAllFactors } from '../src/models/factorEngine';
import {
  DEFAULT_SCREENER_SETTINGS,
  convictionScore,
  runStockScreener,
  ScreenerMode,
} from '../src/models/stockScreener';
import type { MarketDatabase } from '../src/data/marketRepository';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');

/** Sama seperti pickJournal: 21 sesi ~ 1 bulan, 63 sesi ~ 3 bulan. */
const M1 = 21;
const M3 = 63;

/** Sejarah minimum sebelum MA200 punya arti. Sama dengan backfill-picks. */
const MIN_HISTORY = 220;

/** Sepuluh, karena sepuluh itulah yang dicatat jurnal dan dibaca orang. */
const TOP_N = 10;

/**
 * Berapa emiten yang harus lolos sebelum sebuah sesi ikut dihitung.
 *
 * EFEK ATURAN cuma butuh cukup baris untuk median yang tidak konyol, jadi
 * ambangnya rendah. EFEK PERINGKAT butuh lebih: kalau yang lolos hanya delapan,
 * sepuluh teratas ADALAH seluruhnya, selisihnya nol secara definisi, dan
 * memasukkannya akan mengencerkan pengukuran dengan sesi yang tidak melakukan
 * pemeringkatan sama sekali. Mode Tertinggal sering meloloskan di bawah sepuluh
 * — versi pertama skrip ini membuang seluruh sesinya dan melaporkan nol sesi
 * terpakai, yang terbaca seperti mode itu tidak pernah menyala.
 */
const MIN_FOR_GATE = 5;
const MIN_FOR_RANK = 20;

const MODES: ScreenerMode[] = ['momentum', 'pullback', 'laggard'];

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
const pp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}pp` : '   -   ');
const pc = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}%` : '   -   ');

/**
 * Return maju dalam SATU skala harga.
 *
 * `close` disesuaikan terhadap sesi terbaru sementara `rawClose` adalah harga
 * traded, jadi rasio keduanya di sesi masuk mengembalikan bar-bar berikutnya ke
 * skala yang sama. Ini perbaikan yang sama seperti di `evaluatePick`; tanpa itu
 * satu reverse split terbaca sebagai keruntuhan 80%.
 */
function forwardReturn(db: MarketDatabase, code: string, i: number, n: number): number {
  const s = db.series.get(code);
  if (!s) return NaN;
  const a = s.close[i];
  const b = s.close[i + n];
  return a > 0 && b > 0 ? b / a - 1 : NaN;
}

/**
 * Spearman antara SKOR CONVICTION dan return maju.
 *
 * Positif berarti conviction lebih tinggi cenderung return lebih tinggi — yaitu
 * skornya bekerja. Ditulis terhadap skornya langsung, bukan terhadap posisi
 * peringkat, karena versi pertama fungsi ini memberi peringkat 1 kepada
 * conviction TERTINGGI dan peringkat 1 kepada return TERENDAH, sehingga rho
 * positif justru berarti skornya terbalik. Angkanya benar; keterangannya di
 * layar yang menyatakan kebalikannya. Satu tanda yang salah arah adalah cara
 * paling rapi untuk menyimpulkan kebalikan dari apa yang diukur.
 */
function spearman(pairs: { conv: number; ret: number }[]): number {
  const rows = pairs.filter((p) => Number.isFinite(p.ret) && Number.isFinite(p.conv));
  const n = rows.length;
  if (n < 3) return NaN;

  const rankOf = (key: (r: (typeof rows)[number]) => number) => {
    const sorted = [...rows].sort((a, b) => key(a) - key(b));
    const m = new Map<(typeof rows)[number], number>();
    sorted.forEach((r, idx) => m.set(r, idx + 1));
    return m;
  };
  const cr = rankOf((r) => r.conv);
  const rr = rankOf((r) => r.ret);

  let sum = 0;
  for (const r of rows) {
    const d = (cr.get(r) ?? 0) - (rr.get(r) ?? 0);
    sum += d * d;
  }
  return 1 - (6 * sum) / (n * (n * n - 1));
}

/**
 * Uji tanda, dijalankan tiap kali skrip ini mulai.
 *
 * Sebuah korelasi yang tandanya terbalik tidak terlihat salah — ia hanya
 * menghasilkan kesimpulan yang berkebalikan, dengan angka yang sama masuk
 * akalnya. Dua kasus yang jawabannya sudah diketahui lebih murah daripada satu
 * laporan yang menyarankan memperkuat skor yang seharusnya dibalik.
 */
function assertSpearmanOrientation(): void {
  const naik = [1, 2, 3, 4, 5].map((x) => ({ conv: x, ret: x }));
  const turun = [1, 2, 3, 4, 5].map((x) => ({ conv: x, ret: -x }));
  const a = spearman(naik);
  const b = spearman(turun);
  if (!(a > 0.99) || !(b < -0.99)) {
    throw new Error(
      `spearman terbalik: conviction sejalan return memberi ${a.toFixed(3)} (harus +1), ` +
        `berlawanan memberi ${b.toFixed(3)} (harus -1)`,
    );
  }
}

interface Bucket {
  /** LOLOS dikurangi LIKUID: apakah aturan strateginya menambah sesuatu. */
  gate1: number[];
  gate3: number[];
  rank1: number[];
  rank3: number[];
  rho1: number[];
  rho3: number[];
  passCount: number[];
  decile1: number[][];
  decile3: number[][];
}

const emptyBucket = (): Bucket => ({
  gate1: [], gate3: [], rank1: [], rank3: [], rho1: [], rho3: [],
  passCount: [], decile1: Array.from({ length: 10 }, () => []), decile3: Array.from({ length: 10 }, () => []),
});

async function main() {
  assertSpearmanOrientation();

  const [db, ctx] = await Promise.all([
    loadMarketDatabaseFromDisk(DATA_DIR),
    loadChatContextFromDisk(DATA_DIR),
  ]);
  void ctx;

  const lastOfficial = db.live?.applied ? db.dates.length - 2 : db.dates.length - 1;
  // Sesi terakhir yang punya 63 bar ke depan untuk dinilai.
  const lastUsable = lastOfficial - M3;
  const want = Number(arg('sessions', String(lastUsable)));
  const first = Math.max(MIN_HISTORY, lastUsable - want + 1);

  console.log(`universe ${db.emiten.length} emiten · ${db.dates.length} sesi`);
  console.log(
    `menilai sesi ${db.dates[first]} .. ${db.dates[lastUsable]} ` +
      `(${lastUsable - first + 1} sesi; berhenti ${M3} sesi sebelum ujung supaya tiap pick punya 3 bulan penuh)`,
  );
  console.log('');

  const buckets = new Map<ScreenerMode, Bucket>(MODES.map((m) => [m, emptyBucket()]));
  const codes = [...db.series.keys()];

  // Efek likuiditas tidak bergantung pada mode, jadi dihitung sekali per sesi.
  const liqEffect1: number[] = [];
  const liqEffect3: number[] = [];
  const liqCount: number[] = [];
  const zeroShare: number[] = [];

  const t0 = Date.now();
  let done = 0;
  for (let i = first; i <= lastUsable; i++) {
    const sliced = sliceMarketDatabase(db, i);
    const factors = computeAllFactors(sliced);

    // SEMESTA: dihitung dari db penuh, bukan potongan — return maju memang
    // berada di masa depan potongan itu, dan itulah yang sedang diukur.
    const uni1: number[] = [];
    const uni3: number[] = [];
    for (const c of codes) {
      const s = db.series.get(c)!;
      if (!(s.close[i] > 0)) continue;
      const r1 = forwardReturn(db, c, i, M1);
      const r3 = forwardReturn(db, c, i, M3);
      if (Number.isFinite(r1)) uni1.push(r1);
      if (Number.isFinite(r3)) uni3.push(r3);
    }
    const universe1 = median(uni1);
    const universe3 = median(uni3);

    // BERAPA BANYAK "return" SEMESTA yang sebenarnya harga yang tidak bergerak?
    //
    // Sebuah emiten yang nyaris tidak diperdagangkan menutup di harga yang sama
    // berminggu-minggu, dan itu tercatat sebagai return 0,00%. Di pasar yang
    // turun, nol mengalahkan median — jadi semesta bisa terlihat "menang" bukan
    // karena ada yang naik, melainkan karena banyak harga yang mati. Kalau
    // angka ini besar, pembanding SEMESTA tidak boleh dipakai untuk menilai apa
    // pun, dan hanya keranjang LIKUID yang berarti.
    zeroShare.push(uni1.length ? uni1.filter((r) => r === 0).length / uni1.length : NaN);

    // LIKUID: hanya ambang nilai dan volume, tanpa aturan strategi apa pun.
    // Dibaca dari kuotasi potongan supaya ambangnya diterapkan pada angka sesi
    // itu, bukan angka hari ini.
    const liq1: number[] = [];
    const liq3: number[] = [];
    for (const [code, q] of sliced.daily) {
      if (!(q.value >= DEFAULT_SCREENER_SETTINGS.minValueIdr)) continue;
      if (!(q.volume >= DEFAULT_SCREENER_SETTINGS.minVolumeShares)) continue;
      const r1 = forwardReturn(db, code, i, M1);
      const r3 = forwardReturn(db, code, i, M3);
      if (Number.isFinite(r1)) liq1.push(r1);
      if (Number.isFinite(r3)) liq3.push(r3);
    }
    const liquid1 = median(liq1);
    const liquid3 = median(liq3);
    if (Number.isFinite(liquid1) && Number.isFinite(universe1)) liqEffect1.push(liquid1 - universe1);
    if (Number.isFinite(liquid3) && Number.isFinite(universe3)) liqEffect3.push(liquid3 - universe3);
    liqCount.push(liq1.length);

    for (const mode of MODES) {
      const b = buckets.get(mode)!;
      const screen = runStockScreener(sliced, { mode });
      const rows = screen.rows.map((r) => ({
        code: r.code,
        conv: convictionScore(r, factors.get(r.code), mode),
        r1: forwardReturn(db, r.code, i, M1),
        r3: forwardReturn(db, r.code, i, M3),
      }));
      if (rows.length < MIN_FOR_GATE) continue;
      b.passCount.push(rows.length);

      const pass1 = median(rows.map((r) => r.r1));
      const pass3 = median(rows.map((r) => r.r3));

      rows.sort((a, z) => z.conv - a.conv);
      const top = rows.slice(0, TOP_N);
      const top1 = median(top.map((r) => r.r1));
      const top3 = median(top.map((r) => r.r3));

      // EFEK ATURAN: yang lolos gerbang mode ini, dibandingkan keranjang likuid.
      if (Number.isFinite(pass1) && Number.isFinite(liquid1)) b.gate1.push(pass1 - liquid1);
      if (Number.isFinite(pass3) && Number.isFinite(liquid3)) b.gate3.push(pass3 - liquid3);

      // EFEK PERINGKAT hanya bermakna kalau memang ada yang disaring. Dengan
      // dua belas baris, sepuluh teratas nyaris seluruh himpunannya dan
      // selisihnya mendekati nol karena aritmetika, bukan karena temuan.
      if (rows.length >= MIN_FOR_RANK) {
        if (Number.isFinite(top1) && Number.isFinite(pass1)) b.rank1.push(top1 - pass1);
        if (Number.isFinite(top3) && Number.isFinite(pass3)) b.rank3.push(top3 - pass3);
      }

      if (rows.length < MIN_FOR_RANK) continue;

      const rho1 = spearman(rows.map((r) => ({ conv: r.conv, ret: r.r1 })));
      const rho3 = spearman(rows.map((r) => ({ conv: r.conv, ret: r.r3 })));
      if (Number.isFinite(rho1)) b.rho1.push(rho1);
      if (Number.isFinite(rho3)) b.rho3.push(rho3);

      // Desil menurut conviction: 0 = paling yakin.
      for (let d = 0; d < 10; d++) {
        const lo = Math.floor((d * rows.length) / 10);
        const hi = Math.floor(((d + 1) * rows.length) / 10);
        const slice = rows.slice(lo, hi);
        if (!slice.length) continue;
        const m1 = median(slice.map((r) => r.r1));
        const m3 = median(slice.map((r) => r.r3));
        if (Number.isFinite(m1) && Number.isFinite(liquid1)) b.decile1[d].push(m1 - liquid1);
        if (Number.isFinite(m3) && Number.isFinite(liquid3)) b.decile3[d].push(m3 - liquid3);
      }
    }

    done++;
    if (done % 50 === 0 || i === lastUsable) {
      console.log(`  ${done}/${lastUsable - first + 1} sesi · ${((Date.now() - t0) / done / 1000).toFixed(2)} dtk/sesi`);
    }
  }

  console.log('');
  console.log('════ EFEK LIKUIDITAS ════');
  console.log('keranjang likuid dibandingkan seluruh semesta. Ini bukan keputusan strategi,');
  console.log('tapi kalau besar, ia menjelaskan sebagian hasil sebelum aturan apa pun jalan.');
  console.log('');
  console.log(
    `  likuid/sesi ${median(liqCount).toFixed(0)} emiten · ` +
      `1 bulan ${pp(median(liqEffect1))} · 3 bulan ${pp(median(liqEffect3))}`,
  );
  console.log(
    `  harga mati di semesta: ${(100 * median(zeroShare)).toFixed(1)}% emiten mencatat return 1 bulan PERSIS 0,00%`,
  );
  console.log('  (kalau angka itu besar, pembanding SEMESTA tidak berarti — pakai LIKUID.)');

  console.log('');
  console.log('════ EFEK ATURAN vs EFEK PERINGKAT ════');
  console.log('median selisih per sesi. aturan = lolos vs likuid. peringkat = top10 vs lolos.');
  console.log(`peringkat hanya dihitung pada sesi dengan >= ${MIN_FOR_RANK} emiten lolos.`);
  console.log('');
  console.log('mode        sesi  lolos/sesi |   aturan 1b  peringkat 1b |   aturan 3b  peringkat 3b');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    console.log(
      `${mode.padEnd(10)}${String(b.gate1.length).padStart(6)}${median(b.passCount).toFixed(0).padStart(12)} | ` +
        `${pp(median(b.gate1)).padStart(11)}${pp(median(b.rank1)).padStart(14)} | ` +
        `${pp(median(b.gate3)).padStart(11)}${pp(median(b.rank3)).padStart(14)}`,
    );
  }
  console.log('');
  console.log('sesi yang cukup besar untuk mengukur peringkat:');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    console.log(`  ${mode.padEnd(10)} ${b.rank1.length}`);
  }

  console.log('');
  console.log('════ KORELASI PERINGKAT (Spearman, rata-rata per sesi) ════');
  console.log('positif = conviction tinggi cenderung return tinggi (skornya bekerja).');
  console.log('negatif = skornya TERBALIK. nol = derau. Orientasinya diuji tiap skrip ini jalan.');
  console.log('');
  console.log('mode          rho 1b   t     %neg |   rho 3b   t     %neg   sesi');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    const stat = (xs: number[]) => {
      const n = xs.length;
      if (n < 2) return { m: NaN, t: NaN, neg: NaN };
      const m = xs.reduce((s, x) => s + x, 0) / n;
      const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
      return { m, t: m / Math.sqrt(v / n), neg: xs.filter((x) => x < 0).length / n };
    };
    const a = stat(b.rho1);
    const c = stat(b.rho3);
    console.log(
      `${mode.padEnd(12)}${a.m.toFixed(4).padStart(8)}${a.t.toFixed(1).padStart(6)}${(100 * a.neg).toFixed(0).padStart(6)}% | ` +
        `${c.m.toFixed(4).padStart(8)}${c.t.toFixed(1).padStart(6)}${(100 * c.neg).toFixed(0).padStart(6)}%${String(b.rho3.length).padStart(7)}`,
    );
  }
  console.log('');
  console.log('t di atas dihitung seolah tiap sesi adalah pengamatan bebas. IA TIDAK.');
  console.log('Jendela 63 sesi yang diambil tiap hari nyaris sama isinya dengan tetangganya,');
  console.log('jadi galat bakunya terlalu kecil dan t-nya terlalu besar. Di bawah ini');
  console.log('perhitungan ulang memakai sampel yang TIDAK tumpang tindih saja.');
  console.log('');
  console.log('mode         rho 1b   t   n |   rho 3b    t    n');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    // Ambil tiap sesi ke-N, dengan N = panjang horizonnya, supaya dua sampel
    // berturut-turut tidak pernah berbagi satu bar pun.
    const thin = (xs: number[], step: number) => xs.filter((_, i) => i % step === 0);
    const stat = (xs: number[]) => {
      const n = xs.length;
      if (n < 3) return { m: NaN, t: NaN, n };
      const m = xs.reduce((s, x) => s + x, 0) / n;
      const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
      return { m, t: m / Math.sqrt(v / n), n };
    };
    const a = stat(thin(b.rho1, M1));
    const c = stat(thin(b.rho3, M3));
    console.log(
      `${mode.padEnd(11)}${a.m.toFixed(4).padStart(8)}${a.t.toFixed(1).padStart(6)}${String(a.n).padStart(4)} | ` +
        `${c.m.toFixed(4).padStart(8)}${c.t.toFixed(1).padStart(6)}${String(c.n).padStart(5)}`,
    );
  }
  console.log('');
  console.log('Inilah angka yang boleh dipakai. |t| di bawah 2 artinya rata-ratanya tidak bisa');
  console.log('dibedakan dari nol. Perhatikan n-nya: jujur berarti sampelnya jadi kecil, dan');
  console.log('sampel kecil memang belum bisa menjawab banyak hal. Tabel desil di bawah lebih');
  console.log('informatif di sini karena ia menunjukkan POLA sepanjang rentang conviction,');
  console.log('bukan satu angka ringkasan.');

  console.log('');
  console.log('════ DESIL CONVICTION, selisih terhadap keranjang likuid ════');
  console.log('desil 1 = paling yakin. Kalau conviction bekerja, kolomnya menurun ke bawah.');
  console.log('');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    console.log(`${mode}:`);
    console.log('  desil    1 bulan     3 bulan');
    for (let d = 0; d < 10; d++) {
      console.log(`  ${String(d + 1).padStart(5)}${pp(median(b.decile1[d])).padStart(11)}${pp(median(b.decile3[d])).padStart(12)}`);
    }
    const top = median(b.decile1[0]);
    const bot = median(b.decile1[9]);
    console.log(`  desil 1 dikurangi desil 10 (1 bulan): ${pp(top - bot)}`);
    console.log('');
  }

  console.log('════ ANGKA MENTAH SEBAGAI KONTEKS ════');
  for (const mode of MODES) {
    const b = buckets.get(mode)!;
    console.log(
      `${mode.padEnd(10)} median lolos-per-sesi ${median(b.passCount).toFixed(0).padStart(4)} · ` +
        `sesi terpakai ${b.gate1.length}`,
    );
  }
  void pc;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
