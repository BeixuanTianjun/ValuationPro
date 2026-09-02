/**
 * gate-ablation.ts — menguji SATU PER SATU tiap aturan gerbang screener.
 *
 * ── KENAPA INI ADA ────────────────────────────────────────────────────────
 *
 * `rank:diag` menunjukkan ketiga mode menghasilkan keranjang yang tidak bisa
 * dibedakan dari "saham likuid mana saja": efek aturan -0,18pp, -0,36pp dan
 * -0,09pp untuk satu bulan. Tetapi tiap mode adalah BUNDEL beberapa syarat yang
 * harus dipenuhi bersamaan, dan sebuah bundel yang hasilnya nol bisa berarti dua
 * hal yang sangat berbeda:
 *
 *   - tidak ada satu pun syaratnya yang memuat informasi, atau
 *   - beberapa memuat informasi dan saling meniadakan.
 *
 * Bundelnya tidak bisa menjawab itu. Skrip ini memecahnya: tiap syarat diuji
 * SENDIRIAN terhadap keranjang likuid yang sama.
 *
 * ── APA YANG DIUKUR ───────────────────────────────────────────────────────
 *
 * Untuk tiap sesi dan tiap syarat: median return maju dari emiten likuid yang
 * MEMENUHI syarat itu, dikurangi median seluruh keranjang likuid. Positif
 * berarti syarat itu memilih pemenang; negatif berarti ia memilih pecundang —
 * dan syarat yang negatif konsisten lebih berguna daripada yang nol, karena
 * kebalikannya bisa langsung dipakai.
 *
 * Selisih diambil PER SESI lalu dimediankan, supaya sesi yang seluruh pasarnya
 * jatuh tidak dihitung sebagai kegagalan syaratnya.
 *
 * ── SOAL ANGKA t ──────────────────────────────────────────────────────────
 *
 * Dilaporkan HANYA dari sampel yang tidak tumpang tindih: tiap sesi ke-21 untuk
 * horizon satu bulan, tiap sesi ke-63 untuk tiga bulan. Memakai semua sesi akan
 * melipatgandakan t sekitar tujuh kali lipat tanpa menambah satu pun informasi,
 * karena jendela hari ini dan jendela besok berbagi 62 dari 63 barnya. Itu
 * pelajaran dari rank:diag, di mana pullback tampak meyakinkan pada t = -10,5
 * dan menjadi t = -1,6 begitu dihitung jujur.
 *
 * n kecil adalah konsekuensi yang tidak bisa ditawar, bukan cacat skrip ini.
 * Dua tahun data memang hanya berisi tujuh jendela tiga-bulanan yang bebas.
 *
 * ── CARA PAKAI ────────────────────────────────────────────────────────────
 *
 *   npm run gate:ablate
 *   npm run gate:ablate -- --sessions 250
 */

import { join } from 'node:path';
import { loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { sliceMarketDatabase } from '../src/data/marketSlice';
import { computeAllFactors, FactorSnapshot } from '../src/models/factorEngine';
import { runStockScreener, ScreenerRow } from '../src/models/stockScreener';
import type { MarketDatabase } from '../src/data/marketRepository';

const DATA_DIR = join(process.cwd(), 'public', 'data', 'idx');

const M1 = 21;
const M3 = 63;
const MIN_HISTORY = 220;

/** Sebuah subset terlalu kecil untuk median yang berarti diabaikan sesinya. */
const MIN_SUBSET = 8;

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
const pp = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(2)}` : '  -  ');

function forwardReturn(db: MarketDatabase, code: string, i: number, n: number): number {
  const s = db.series.get(code);
  if (!s) return NaN;
  const a = s.close[i];
  const b = s.close[i + n];
  return a > 0 && b > 0 ? b / a - 1 : NaN;
}

/**
 * Tiap syarat yang diuji.
 *
 * Delapan yang pertama adalah aturan keras screener persis seperti yang
 * dipakai; sisanya adalah pembacaan yang sudah dihitung tiap baris dan dipakai
 * oleh conviction, dipotong jadi ya/tidak supaya bisa diperlakukan sama.
 * Ambang potongnya sama dengan yang dipakai conviction, bukan dicari-cari:
 * tujuannya menguji aturan yang ADA, bukan menemukan ambang baru dengan
 * mengintip jawabannya.
 */
interface Gate {
  id: string;
  label: string;
  test: (r: ScreenerRow, f: FactorSnapshot | undefined) => boolean;
}

const GATES: Gate[] = [
  { id: 'ma', label: 'MA cepat (di atas MA3 & MA5)', test: (r) => r.passMa },
  { id: 'stack', label: 'MA bertumpuk (MA3 > MA5)', test: (r) => r.maStacked },
  { id: 'trend', label: 'Di atas MA200', test: (r) => r.passTrend },
  { id: 'dip', label: 'Di bawah MA20', test: (r) => r.passDip },
  { id: 'depth', label: 'Diskon 8-35% dari puncak 60 sesi', test: (r) => r.passDepth },
  { id: 'idxup', label: 'Indeks sektornya naik >= 10%', test: (r) => r.passIndexUp },
  { id: 'lag', label: 'Sahamnya belum naik (<= +2%)', test: (r) => r.passLag },
  { id: 'intact', label: 'Belum jatuh > 25%', test: (r) => r.passIntact },

  { id: 'surge', label: 'Volume > 1,5x rata-rata 20 sesi', test: (r) => r.volumeSurge > 1.5 },
  { id: 'foreign', label: 'Asing net beli hari ini', test: (r) => r.foreignNetIdrBn > 0 },
  { id: 'foreignBig', label: 'Asing net beli > Rp 5 miliar', test: (r) => r.foreignNetIdrBn > 5 },
  { id: 'fresh', label: 'Baru menembus (<= 6 sesi di atas MA5)', test: (r) => r.sessionsAboveMaLong <= 6 },
  { id: 'room', label: 'Belum meregang (< 3 ATR di atas MA20)', test: (r) => r.extensionAtr < 3 },
  { id: 'early', label: 'Belum terbang (runup < 25%)', test: (r) => r.runupFromLow < 0.25 },
  { id: 'flown', label: 'SUDAH terbang (runup > 50%)', test: (r) => r.runupFromLow > 0.5 },

  { id: 'rsiMid', label: 'RSI14 antara 40 dan 60', test: (_r, f) => !!f && f.rsi14 >= 40 && f.rsi14 <= 60 },
  { id: 'rsiHot', label: 'RSI14 di atas 70', test: (_r, f) => !!f && f.rsi14 > 70 },
  { id: 'rsiCold', label: 'RSI14 di bawah 30', test: (_r, f) => !!f && f.rsi14 < 30 },
  { id: 'quality', label: 'Kualitas tren > 0,5', test: (_r, f) => !!f && f.trendQuality > 0.5 },
  { id: 'bigcap', label: 'Kapitalisasi > Rp 10 triliun', test: (r) => r.marketCapIdrBn > 10_000 },
];

interface Acc {
  e1: number[];
  e3: number[];
  share: number[];
}

/**
 * Pembacaan kontinu yang layak dilihat BENTUKNYA, bukan cuma lolos/tidaknya.
 *
 * Tiga yang pertama adalah pembacaan "keterlambatan" yang syarat ya/tidak-nya
 * meloloskan 93-94% keranjang — angka sebesar itu berarti ambangnya tidak
 * menyaring apa pun, dan satu-satunya cara tahu di mana ia SEHARUSNYA berada
 * adalah melihat sebarannya.
 */
const DOSE: [string, string][] = [
  ['Runup dari dasar 60 sesi', 'runup'],
  ['Regangan di atas MA20 (ATR)', 'ext'],
  ['Sesi berturut di atas MA5', 'sessions'],
  ['RSI14', 'rsi'],
];

/**
 * Kombinasi yang layak dilihat setelah tabel syarat tunggal.
 *
 * `passAll` di sini adalah aturan mode momentum lengkap, karena itulah mode
 * yang paling banyak dipakai dan satu-satunya yang meloloskan cukup emiten
 * untuk diuji bersama syarat lain.
 */
const COMBOS: { id: string; label: string; test: (r: ScreenerRow) => boolean }[] = [
  { id: 'mom', label: 'Aturan momentum (apa adanya)', test: (r) => r.passAll },
  { id: 'momEarly', label: 'Momentum + runup < 25%', test: (r) => r.passAll && r.runupFromLow < 0.25 },
  { id: 'momEarly15', label: 'Momentum + runup < 15%', test: (r) => r.passAll && r.runupFromLow < 0.15 },
  { id: 'momNotFlown', label: 'Momentum + runup <= 50%', test: (r) => r.passAll && r.runupFromLow <= 0.5 },
  { id: 'early15', label: 'Likuid + runup < 15% (tanpa MA)', test: (r) => r.runupFromLow < 0.15 },
  { id: 'early25', label: 'Likuid + runup < 25% (tanpa MA)', test: (r) => r.runupFromLow < 0.25 },
];

interface DoseBin {
  e1: number[];
  e3: number[];
  edge: number[];
  n: number[];
}

async function main() {
  const db = await loadMarketDatabaseFromDisk(DATA_DIR);
  const lastOfficial = db.live?.applied ? db.dates.length - 2 : db.dates.length - 1;
  const lastUsable = lastOfficial - M3;
  const want = Number(arg('sessions', String(lastUsable)));
  const first = Math.max(MIN_HISTORY, lastUsable - want + 1);

  console.log(`universe ${db.emiten.length} emiten · ${db.dates.length} sesi`);
  console.log(`menilai ${db.dates[first]} .. ${db.dates[lastUsable]} (${lastUsable - first + 1} sesi)`);
  console.log('');

  const acc = new Map<string, Acc>(GATES.map((g) => [g.id, { e1: [], e3: [], share: [] }]));
  const liquidCount: number[] = [];
  const dose = new Map<string, DoseBin[]>(
    DOSE.map(([, k]) => [k, Array.from({ length: 10 }, () => ({ e1: [], e3: [], edge: [], n: [] }))]),
  );
  // Spread desil-1 dikurangi desil-10 untuk runup, disimpan per sesi supaya
  // ketahanannya bisa diuji tanpa menjalankan ulang semuanya.
  const comboAcc = new Map<string, Acc>(COMBOS.map((c) => [c.id, { e1: [], e3: [], share: [] }]));
  const runupSpread1: number[] = [];
  const runupSpread3: number[] = [];
  const runupLabel: string[] = [];

  const doseValue: Record<string, (r: ScreenerRow, f: FactorSnapshot | undefined) => number> = {
    runup: (r) => r.runupFromLow,
    ext: (r) => r.extensionAtr,
    sessions: (r) => r.sessionsAboveMaLong,
    rsi: (_r, f) => f?.rsi14 ?? NaN,
  };

  const t0 = Date.now();
  let done = 0;
  for (let i = first; i <= lastUsable; i++) {
    const sliced = sliceMarketDatabase(db, i);
    const factors = computeAllFactors(sliced);
    // Mode apa pun boleh: kesembilan bendera aturan dihitung untuk SETIAP baris,
    // tanpa memandang mode aktif. Yang mode-spesifik hanya `passAll`.
    const screen = runStockScreener(sliced, { mode: 'momentum' });

    const liquid: { r: ScreenerRow; f: FactorSnapshot | undefined; r1: number; r3: number }[] = [];
    for (const r of screen.all.values()) {
      if (!r.passVolume || !r.passValue) continue;
      liquid.push({
        r,
        f: factors.get(r.code),
        r1: forwardReturn(db, r.code, i, M1),
        r3: forwardReturn(db, r.code, i, M3),
      });
    }
    if (liquid.length < 30) continue;
    liquidCount.push(liquid.length);

    const base1 = median(liquid.map((x) => x.r1));
    const base3 = median(liquid.map((x) => x.r3));

    for (const g of GATES) {
      const hit = liquid.filter((x) => {
        try {
          return g.test(x.r, x.f);
        } catch {
          return false;
        }
      });
      const a = acc.get(g.id)!;
      a.share.push(hit.length / liquid.length);
      if (hit.length < MIN_SUBSET) continue;
      const m1 = median(hit.map((x) => x.r1));
      const m3 = median(hit.map((x) => x.r3));
      if (Number.isFinite(m1) && Number.isFinite(base1)) a.e1.push(m1 - base1);
      if (Number.isFinite(m3) && Number.isFinite(base3)) a.e3.push(m3 - base3);
    }

    for (const c of COMBOS) {
      const hit = liquid.filter((x) => c.test(x.r));
      const a = comboAcc.get(c.id)!;
      a.share.push(hit.length / liquid.length);
      if (hit.length < MIN_SUBSET) continue;
      const m1 = median(hit.map((x) => x.r1));
      const m3 = median(hit.map((x) => x.r3));
      if (Number.isFinite(m1) && Number.isFinite(base1)) a.e1.push(m1 - base1);
      if (Number.isFinite(m3) && Number.isFinite(base3)) a.e3.push(m3 - base3);
    }

    for (const [, key] of DOSE) {
      const val = doseValue[key];
      const sorted = liquid
        .map((x) => ({ v: val(x.r, x.f), r1: x.r1, r3: x.r3 }))
        .filter((x) => Number.isFinite(x.v))
        .sort((a, b) => a.v - b.v);
      if (sorted.length < 50) continue;
      for (let d = 0; d < 10; d++) {
        const lo = Math.floor((d * sorted.length) / 10);
        const hi = Math.floor(((d + 1) * sorted.length) / 10);
        const bin = sorted.slice(lo, hi);
        if (bin.length < MIN_SUBSET) continue;
        const b = dose.get(key)![d];
        const m1 = median(bin.map((x) => x.r1));
        const m3 = median(bin.map((x) => x.r3));
        if (Number.isFinite(m1) && Number.isFinite(base1)) b.e1.push(m1 - base1);
        if (Number.isFinite(m3) && Number.isFinite(base3)) b.e3.push(m3 - base3);
        b.edge.push(bin[bin.length - 1].v);
        b.n.push(bin.length);
      }

      if (key === 'runup') {
        const lowHi = Math.floor(sorted.length / 10);
        const highLo = Math.floor((9 * sorted.length) / 10);
        const low = sorted.slice(0, lowHi);
        const high = sorted.slice(highLo);
        if (low.length >= MIN_SUBSET && high.length >= MIN_SUBSET) {
          const d1 = median(low.map((x) => x.r1)) - median(high.map((x) => x.r1));
          const d3 = median(low.map((x) => x.r3)) - median(high.map((x) => x.r3));
          if (Number.isFinite(d1)) runupSpread1.push(d1);
          if (Number.isFinite(d3)) runupSpread3.push(d3);
          runupLabel.push(db.dates[i]);
        }
      }
    }

    done++;
    if (done % 100 === 0 || i === lastUsable) {
      console.log(`  ${done}/${lastUsable - first + 1} sesi · ${((Date.now() - t0) / done / 1000).toFixed(2)} dtk/sesi`);
    }
  }

  // t hanya dari sampel yang tidak tumpang tindih.
  const thinStat = (xs: number[], step: number) => {
    const s = xs.filter((_, i) => i % step === 0);
    const n = s.length;
    if (n < 3) return { m: median(xs), t: NaN, n };
    const mean = s.reduce((a, b) => a + b, 0) / n;
    const v = s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
    return { m: median(xs), t: mean / Math.sqrt(v / n), n };
  };

  console.log('');
  console.log(`keranjang likuid: ${median(liquidCount).toFixed(0)} emiten per sesi`);
  console.log('');
  console.log('EFEK TIAP SYARAT, dalam poin persen terhadap keranjang likuid');
  console.log('t dari sampel TIDAK tumpang tindih saja. |t| < 2 = tidak bisa dibedakan dari nol.');
  console.log('');
  console.log('syarat                                lolos |  1 bln     t   n |  3 bln     t   n');
  console.log('-'.repeat(88));

  const rows = GATES.map((g) => {
    const a = acc.get(g.id)!;
    return { g, a, s1: thinStat(a.e1, M1), s3: thinStat(a.e3, M3), share: median(a.share) };
  });
  // Urut menurut efek satu bulan: yang paling merusak di atas, karena itu yang
  // paling bisa ditindaklanjuti — membalik syarat buruk lebih murah daripada
  // menemukan syarat baru.
  rows.sort((x, y) => (x.s1.m || 0) - (y.s1.m || 0));

  for (const { g, s1, s3, share } of rows) {
    console.log(
      `${g.label.padEnd(38)}${(100 * share).toFixed(0).padStart(4)}% |` +
        `${pp(s1.m).padStart(7)}${s1.t.toFixed(1).padStart(6)}${String(s1.n).padStart(4)} |` +
        `${pp(s3.m).padStart(7)}${s3.t.toFixed(1).padStart(6)}${String(s3.n).padStart(4)}`,
    );
  }

  // ── DOSIS-RESPONS ────────────────────────────────────────────────────────
  // Sebuah syarat ya/tidak hanya memberi tahu apakah ambangnya kebetulan berada
  // di tempat yang berguna. Tabel ini menunjukkan BENTUKNYA: keranjang likuid
  // dibagi sepuluh menurut satu pembacaan, lalu tiap desil dibandingkan
  // keranjangnya sendiri. Kalau ada kemiringan, ambang yang benar terbaca dari
  // situ; kalau datar, tidak ada ambang yang akan menolong.
  console.log('');
  console.log('DOSIS-RESPONS: desil keranjang likuid menurut satu pembacaan');
  console.log('desil 1 = nilai terendah. Angka = poin persen terhadap keranjang.');
  for (const [label, key] of DOSE) {
    console.log('');
    console.log(`${label}:`);
    console.log('  desil   batas atas    1 bln    3 bln       n/sesi');
    for (let d = 0; d < 10; d++) {
      const a = dose.get(key)![d];
      console.log(
        `  ${String(d + 1).padStart(5)}${(Number.isFinite(median(a.edge)) ? median(a.edge).toFixed(2) : '-').padStart(13)}` +
          `${pp(median(a.e1)).padStart(9)}${pp(median(a.e3)).padStart(9)}${median(a.n).toFixed(0).padStart(13)}`,
      );
    }
  }

  // ── UJI KETAHANAN UNTUK RUNUP ────────────────────────────────────────────
  // Pola yang monoton sempurna di sepuluh desil adalah pola yang wajib
  // dicurigai. Dua pemeriksaan yang murah dan sulit dibohongi:
  //
  //   1. Belah waktunya jadi dua. Kalau kemiringannya hanya ada di satu paruh,
  //      yang ditemukan adalah satu rezim pasar, bukan sifat yang bertahan.
  //   2. Hitung berapa SESI yang desil terendahnya mengalahkan desil tertinggi.
  //      Median bisa digeser segelintir sesi ekstrem; hitungan tanda tidak.
  // ── KOMBINASI ────────────────────────────────────────────────────────────
  // Ambang runup di bawah ini DIPILIH SETELAH MELIHAT DATANYA. Itu membuatnya
  // hipotesis, bukan hasil: angka mana pun yang dipilih dengan cara begitu akan
  // terlihat bagus pada data yang sama. Yang bisa disimpulkan dari sini hanya
  // apakah arah dan besarannya cukup untuk pantas diuji out-of-sample lewat
  // strategy:lab. Jangan memasang ambang ini ke screener atas dasar tabel ini.
  console.log('');
  console.log('KOMBINASI (hipotesis, bukan hasil — ambangnya dipilih sesudah melihat data)');
  console.log('');
  console.log('kombinasi                             lolos |  1 bln     t   n |  3 bln     t   n');
  console.log('-'.repeat(88));
  for (const c of COMBOS) {
    const a = comboAcc.get(c.id)!;
    const s1 = thinStat(a.e1, M1);
    const s3 = thinStat(a.e3, M3);
    console.log(
      `${c.label.padEnd(38)}${(100 * median(a.share)).toFixed(0).padStart(4)}% |` +
        `${pp(s1.m).padStart(7)}${s1.t.toFixed(1).padStart(6)}${String(s1.n).padStart(4)} |` +
        `${pp(s3.m).padStart(7)}${s3.t.toFixed(1).padStart(6)}${String(s3.n).padStart(4)}`,
    );
  }

  console.log('');
  console.log('UJI KETAHANAN — runup, dibelah dua menurut waktu');
  const half = Math.floor(runupSpread1.length / 2);
  const part = (xs: number[], from: number, to: number) => median(xs.slice(from, to));
  console.log(`  paruh awal  (${runupLabel[0]} .. ${runupLabel[half - 1] ?? '-'}) : ` +
    `1 bln ${pp(part(runupSpread1, 0, half))}pp · 3 bln ${pp(part(runupSpread3, 0, half))}pp`);
  console.log(`  paruh akhir (${runupLabel[half] ?? '-'} .. ${runupLabel[runupLabel.length - 1]}) : ` +
    `1 bln ${pp(part(runupSpread1, half, runupSpread1.length))}pp · 3 bln ${pp(part(runupSpread3, half, runupSpread3.length))}pp`);
  const won1 = runupSpread1.filter((x) => x > 0).length;
  const won3 = runupSpread3.filter((x) => x > 0).length;
  console.log(
    `  desil terendah mengalahkan desil tertinggi di ` +
      `${won1}/${runupSpread1.length} sesi (1 bln) dan ${won3}/${runupSpread3.length} sesi (3 bln)`,
  );
  console.log('  (spread = desil 1 dikurangi desil 10, per sesi, dalam poin persen)');

  console.log('');
  console.log('BACA BEGINI: "lolos" adalah porsi keranjang likuid yang memenuhi syarat itu.');
  console.log('Syarat yang meloloskan 90% tidak menyaring apa pun betapapun efeknya terlihat.');
  console.log('Efek positif besar dengan |t| kecil belum tentu nyata — kolom n memberi tahu');
  console.log('berapa pengamatan bebas yang benar-benar ada di baliknya.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
