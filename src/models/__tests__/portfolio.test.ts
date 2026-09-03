// Aritmetika portofolio.
// Jalankan dengan: npm run test
//
// KENAPA ADA. portfolio.ts 294 baris dan sampai commit ini tidak disentuh tes
// maupun invarian backtest. Ia satu-satunya model di repo ini yang berhitung
// atas UANG PEMILIKNYA SENDIRI, bukan atas kandidat yang mungkin dibeli, dan
// keluarannya sama diamnya dengan yang lain: sebuah bobot yang salah tetap
// terlihat seperti persentase.
//
// Yang diuji identitas, bukan selera. Bobot yang menjumlah ke satu, biaya yang
// benar-benar lot dikali harga, dan satu perilaku yang SENGAJA tidak intuitif:
// emiten yang tidak diperdagangkan mempertahankan biayanya sebagai nilai
// alih-alih jatuh ke nol.

import type { MarketDatabase } from '../../data/marketRepository';
import type { DailyQuote, Emiten, FactorSnapshot } from '../../types/market';
import type { ScreenerRow } from '../stockScreener';
import { Position, SHARES_PER_LOT, buildPortfolio } from '../portfolio';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });
const near = (a: number, b: number, rel = 1e-9) =>
  Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * rel;

// Stub seperlunya. buildPortfolio hanya membaca byCode dan daily dari database,
// jadi membangun MarketDatabase penuh di sini akan menambah lima puluh baris
// yang tidak diuji apa pun. Cast-nya disengaja dan dibatasi pada dua field itu.
function makeDb(quotes: Record<string, { close: number; prev: number } | null>): MarketDatabase {
  const byCode = new Map<string, Emiten>();
  const daily = new Map<string, DailyQuote>();
  for (const [code, q] of Object.entries(quotes)) {
    byCode.set(code, { code, name: `${code} Tbk`, sector: 'Energy' } as Emiten);
    if (q) daily.set(code, { code, close: q.close, prev: q.prev } as DailyQuote);
  }
  return { byCode, daily } as unknown as MarketDatabase;
}

const factorsFor = (atr: Record<string, number>): Map<string, FactorSnapshot> =>
  new Map(Object.entries(atr).map(([code, atr14]) => [code, { atr14 } as FactorSnapshot]));

const pos = (code: string, lots: number, avgPrice: number): Position => ({
  id: `${code}-1`,
  code,
  lots,
  avgPrice,
});

// 1. Biaya adalah lot x lembar-per-lot x harga rata-rata. Satu lot yang
//    diperlakukan sebagai satu lembar akan mengecilkan seluruh portofolio 100x
//    dan tetap terlihat seperti angka rupiah yang wajar.
{
  const db = makeDb({ AAAA: { close: 1200, prev: 1180 } });
  const s = buildPortfolio([pos('AAAA', 10, 1000)], db, null, null);
  const r = s.positions[0];
  check('lembar = lot x 100', r.shares === 10 * SHARES_PER_LOT, `${r.shares}`);
  check('biaya = lembar x harga rata-rata', near(r.costIdr, 1000 * 10 * SHARES_PER_LOT), `${r.costIdr}`);
  check('nilai = lembar x harga sekarang', near(r.valueIdr, 1200 * 10 * SHARES_PER_LOT), `${r.valueIdr}`);
  check('untung = nilai - biaya', near(r.gainIdr, r.valueIdr - r.costIdr));
  check('untung persen = nilai/biaya - 1', near(r.gainPercent, r.valueIdr / r.costIdr - 1),
    `${(100 * r.gainPercent).toFixed(2)}%`);
}

// 2. Bobot harus menjumlah ke satu. Bobot yang tidak menutup berarti angka
//    konsentrasi di layar mengukur sesuatu yang bukan portofolio ini.
{
  const db = makeDb({
    AAAA: { close: 1000, prev: 1000 },
    BBBB: { close: 500, prev: 500 },
    CCCC: { close: 250, prev: 250 },
  });
  const s = buildPortfolio(
    [pos('AAAA', 10, 900), pos('BBBB', 20, 400), pos('CCCC', 40, 200)],
    db, null, null,
  );
  const total = s.positions.reduce((a, r) => a + r.weight, 0);
  check('bobot menjumlah ke 1', near(total, 1, 1e-12), `${total}`);
  check('total nilai = jumlah nilai posisi',
    near(s.valueIdr, s.positions.reduce((a, r) => a + r.valueIdr, 0)));
  check('total biaya = jumlah biaya posisi',
    near(s.costIdr, s.positions.reduce((a, r) => a + r.costIdr, 0)));
}

// 3. Bobot terbesar harus benar-benar yang terbesar, dan kodenya harus cocok.
//    Keduanya dilaporkan terpisah, jadi keduanya bisa menyimpang sendiri.
{
  const db = makeDb({
    KECIL: { close: 100, prev: 100 },
    BESAR: { close: 5000, prev: 5000 },
  });
  const s = buildPortfolio([pos('KECIL', 1, 100), pos('BESAR', 10, 5000)], db, null, null);
  const maks = Math.max(...s.positions.map((r) => r.weight));
  const pemilik = s.positions.find((r) => r.weight === maks)!;
  check('topWeight = bobot terbesar', near(s.topWeight, maks), `${s.topWeight}`);
  check('topWeightCode menunjuk pemegang bobot itu', s.topWeightCode === pemilik.position.code,
    `${s.topWeightCode} vs ${pemilik.position.code}`);
  check('posisi diurutkan dari nilai terbesar',
    s.positions.every((r, i) => i === 0 || s.positions[i - 1].valueIdr >= r.valueIdr));
}

// 4. Emiten yang tidak diperdagangkan MEMPERTAHANKAN biayanya sebagai nilai.
//    Ini perilaku yang disengaja dan berlawanan dengan naluri: saham yang
//    disuspensi bukan kerugian total, dan menampilkannya sebagai nol akan
//    mengagetkan sekaligus salah.
{
  const db = makeDb({ SUSPEND: null });
  const s = buildPortfolio([pos('SUSPEND', 5, 800)], db, null, null);
  const r = s.positions[0];
  check('emiten tanpa kuotasi: harga NaN', Number.isNaN(r.price));
  check('emiten tanpa kuotasi: nilai = biaya', near(r.valueIdr, r.costIdr), `${r.valueIdr}`);
  check('emiten tanpa kuotasi: untung nol', near(r.gainIdr, 0), `${r.gainIdr}`);
}

// 5. Stop diukur dari HARGA BELI ANDA, bukan dari penutupan hari ini. Kedua
//    angka itu menjawab pertanyaan berbeda, dan yang dipakai pemegang posisi
//    adalah yang pertama. Diuji dengan harga sekarang yang jauh DI ATAS entry:
//    kalau stop diambil dari harga sekarang, ia akan ikut naik dan posisi ini
//    tidak akan pernah tampak aman padahal seharusnya.
{
  const db = makeDb({ NAIK: { close: 2000, prev: 1990 } });
  const s = buildPortfolio([pos('NAIK', 1, 1000)], db, factorsFor({ NAIK: 50 }), null);
  const r = s.positions[0];
  check('setup ada saat ATR tersedia', r.setupFromEntry !== null);
  check('stop dihitung dari harga beli, bukan harga sekarang',
    r.setupFromEntry !== null && r.setupFromEntry.stop < 1000 && r.setupFromEntry.stop > 800,
    `stop=${r.setupFromEntry?.stop}`);
  check('harga jauh di atas stop tidak ditandai kena stop', r.belowEntryStop === false);

  const turun = buildPortfolio([pos('NAIK', 1, 1000)], makeDb({ NAIK: { close: 800, prev: 810 } }),
    factorsFor({ NAIK: 50 }), null);
  check('harga di bawah stop dari entry ditandai', turun.positions[0].belowEntryStop === true,
    `stop=${turun.positions[0].setupFromEntry?.stop} harga=${turun.positions[0].price}`);
  check('belowStopCount menghitungnya', turun.belowStopCount === 1);
}

// 6. Tanpa ATR tidak ada stop, dan tanpa stop tidak boleh ada klaim "kena
//    stop". Menandai posisi sebagai jebol berdasarkan level yang tidak ada
//    adalah kesalahan yang paling mahal di layar ini.
{
  const db = makeDb({ TANPA: { close: 10, prev: 10 } });
  const s = buildPortfolio([pos('TANPA', 1, 1000)], db, factorsFor({ TANPA: NaN }), null);
  check('tanpa ATR: tidak ada setup', s.positions[0].setupFromEntry === null);
  check('tanpa ATR: tidak diklaim kena stop meski harga jatuh 99%',
    s.positions[0].belowEntryStop === false);
  check('tanpa ATR: belowStopCount nol', s.belowStopCount === 0);
}

// 7. failingScreenerCount hanya menghitung baris yang PUNYA hasil screener.
//    Emiten yang tidak dievaluasi bukan emiten yang gagal.
{
  const db = makeDb({ LULUS: { close: 100, prev: 100 }, GAGAL: { close: 100, prev: 100 }, SEPI: { close: 100, prev: 100 } });
  const rows = new Map<string, ScreenerRow>([
    ['LULUS', { passAll: true } as ScreenerRow],
    ['GAGAL', { passAll: false } as ScreenerRow],
  ]);
  const s = buildPortfolio([pos('LULUS', 1, 100), pos('GAGAL', 1, 100), pos('SEPI', 1, 100)], db, null, rows);
  check('yang gagal screener dihitung', s.failingScreenerCount === 1, `${s.failingScreenerCount}`);
  check('yang tidak dievaluasi tidak dihitung gagal',
    s.positions.find((r) => r.position.code === 'SEPI')!.screener === null);
}

// 8. Portofolio kosong tidak boleh menghasilkan NaN. Layar kosong yang menulis
//    "NaN%" terbaca seperti kerusakan, bukan seperti belum ada posisi.
{
  const s = buildPortfolio([], makeDb({}), null, null);
  check('kosong: nilai dan biaya nol', s.valueIdr === 0 && s.costIdr === 0);
  check('kosong: topWeight nol dan kode kosong', s.topWeight === 0 && s.topWeightCode === '');
  check('kosong: tidak ada hitungan negatif',
    s.belowStopCount === 0 && s.failingScreenerCount === 0);
}

// 9. Dua lot emiten yang sama harus tetap terpisah. Id-nya ada persis untuk
//    itu, dan menggabungkannya akan menghapus harga beli yang berbeda.
{
  const db = makeDb({ SAMA: { close: 1000, prev: 1000 } });
  const s = buildPortfolio(
    [{ id: 'a', code: 'SAMA', lots: 1, avgPrice: 500 }, { id: 'b', code: 'SAMA', lots: 1, avgPrice: 1500 }],
    db, null, null,
  );
  check('dua lot emiten sama tetap dua baris', s.positions.length === 2, `${s.positions.length}`);
  const untung = s.positions.map((r) => r.gainIdr).sort((a, b) => a - b);
  check('keduanya menghitung untung dari harga belinya sendiri',
    untung[0] < 0 && untung[1] > 0, `${untung.join(' / ')}`);
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
