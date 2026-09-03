// Taksonomi keterbukaan informasi IDX dan sinyal naratifnya.
// Jalankan dengan: npm run test
//
// KENAPA ADA. announcements.ts 305 baris tanpa tes, dan ia memberi makan tahap
// naratif Watchlist — kalau klasifikasinya bergeser, kandidat yang muncul ikut
// bergeser tanpa satu pun error.
//
// Yang paling perlu dijaga di sini BUKAN kategori satu per satu melainkan
// URUTAN aturannya. Komentar di RULES menyebut tiga tabrakan yang sengaja
// dijinakkan di puncak daftar, dan ketiganya termasuk pengajuan paling banyak
// di feed. Menyusun ulang daftar itu akan mempromosikan ratusan laporan rutin
// jadi material, membanjiri skor naratif, dan tidak menghasilkan satu pun
// pesan kesalahan.

import {
  AnnouncementsFile,
  RawAnnouncement,
  buildNarrativeSignals,
  classifyAnnouncement,
  summariseAnnouncements,
} from '../announcements';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

// 1. Tabrakan yang dijinakkan. Tiap judul di sini MEMUAT kata kunci kategori
//    material, dan tiap satunya tetap rutin karena aturannya duduk lebih dulu.
{
  const jinak: [string, string][] = [
    ['Laporan Penggunaan Dana Hasil Penawaran Umum Periode Juni 2026', 'rutin'],
    ['Laporan Pengalihan Kembali Saham Hasil Buy Back Tahap II', 'rutin'],
    ['Rencana Penyampaian Laporan Keuangan Tahunan 2025', 'rutin'],
    ['Laporan Bulanan Registrasi Pemegang Efek Agustus 2026', 'rutin'],
    // Judul IDX untuk laporan pemeringkatan memuat frasa "fakta material" di
    // dalam dirinya sendiri; ia tetap laporan rating.
    ['Fakta Material: Laporan Pemeringkatan Tahunan Obligasi', 'utang'],
  ];
  for (const [judul, harus] of jinak) {
    const dapat = classifyAnnouncement(judul);
    check(`tabrakan dijinakkan: "${judul.slice(0, 42)}…" -> ${harus}`, dapat === harus, `dapat ${dapat}`);
  }
}

// 2. Pengajuan yang benar-benar material harus tetap tertangkap. Menjinakkan
//    tabrakan tanpa memeriksa ini akan menghasilkan klasifikasi yang aman dan
//    tidak berguna: semuanya rutin.
{
  const material: [string, string][] = [
    ['Keterbukaan Informasi Pengambilalihan Saham PT Anak Usaha', 'ekspansi'],
    ['Penandatanganan Perjanjian Kerjasama Strategis', 'ekspansi'],
    ['Penambahan Modal Dengan Memberikan HMETD', 'struktur-modal'],
    ['Rencana Buy Back Saham Perseroan', 'struktur-modal'],
    ['Pembagian Dividen Tunai Tahun Buku 2025', 'dividen'],
    ['Permintaan Penjelasan Bursa Atas Volatilitas Transaksi Efek', 'perhatian-bursa'],
    ['Penundaan Kewajiban Pembayaran Utang (PKPU)', 'hukum'],
    ['Pemanggilan Rapat Umum Pemegang Saham Tahunan', 'rups'],
    ['Penerbitan Obligasi Berkelanjutan Tahap III', 'utang'],
    ['Penyampaian Laporan Keuangan Interim Juni 2026', 'keuangan'],
  ];
  for (const [judul, harus] of material) {
    const dapat = classifyAnnouncement(judul);
    check(`material: "${judul.slice(0, 40)}…" -> ${harus}`, dapat === harus, `dapat ${dapat}`);
  }
}

// 3. Judul yang tidak dikenali jatuh ke rutin, bukan ke kategori material.
//    Arah kegagalannya penting: menebak "ekspansi" untuk judul asing akan
//    memasukkan emiten ke watchlist atas dasar yang tidak ada.
{
  check('judul asing jatuh ke rutin', classifyAnnouncement('Pengumuman Libur Operasional Kantor') === 'rutin');
  check('judul kosong jatuh ke rutin', classifyAnnouncement('') === 'rutin');
}

// --- pembangun berkas uji
const file = (list: RawAnnouncement[], to = '2026-09-01'): AnnouncementsFile => ({
  generatedAt: to,
  from: '2026-07-01',
  to,
  count: list.length,
  emitenCount: new Set(list.map((a) => a.code)).size,
  source: 'uji',
  pdfBase: 'https://contoh/',
  scope: 'uji',
  announcements: list,
});

// 4. Skor jenuh di 0..1. Sepuluh pengajuan rutin tidak boleh mengalahkan satu
//    akuisisi — itu seluruh alasan skornya jenuh dan bukan penjumlahan lurus.
{
  const banyakRutin = Array.from({ length: 20 }, (_, i) => ({
    code: 'RUTN', date: '2026-09-01', title: `Laporan Bulanan Registrasi Pemegang Efek ${i}`,
  }));
  const satuAkuisisi: RawAnnouncement[] = [
    { code: 'AKUI', date: '2026-09-01', title: 'Keterbukaan Informasi Pengambilalihan Saham' },
  ];
  const sig = buildNarrativeSignals(file([...banyakRutin, ...satuAkuisisi]), 14);
  const rutin = sig.get('RUTN');
  const akuisisi = sig.get('AKUI');
  check('skor tidak pernah melebihi 1',
    [...sig.values()].every((s) => s.score >= 0 && s.score <= 1),
    [...sig.values()].map((s) => s.score.toFixed(3)).join(', '));
  check('satu akuisisi mengalahkan dua puluh laporan rutin',
    (akuisisi?.score ?? 0) > (rutin?.score ?? 0),
    `akuisisi=${akuisisi?.score.toFixed(3)} rutin=${rutin?.score.toFixed(3)}`);
}

// 5. `top` adalah pengajuan dengan BOBOT terbesar, bukan yang terbaru. Ini
//    ditulis eksplisit di komentarnya dan justru karena itu mudah dilanggar:
//    mengurutkan berdasarkan tanggal terasa benar sampai sebuah pemanggilan
//    RUPS kemarin menutupi akuisisi tiga minggu lalu.
{
  const sig = buildNarrativeSignals(
    file([
      { code: 'AAAA', date: '2026-08-11', title: 'Keterbukaan Informasi Pengambilalihan Saham' },
      { code: 'AAAA', date: '2026-08-31', title: 'Pemanggilan Rapat Umum Pemegang Saham' },
    ]),
    30,
  );
  const s = sig.get('AAAA')!;
  check('top memilih bobot terbesar, bukan tanggal terbaru',
    s.topCategory === 'ekspansi', `topCategory=${s.topCategory}`);
  check('top benar-benar berbobot maksimum di antara filings',
    s.top !== null && s.filings.every((f) => f.weight <= s.top!.weight + 1e-12));
}

// 6. Peluruhan separuh-umur. Pengajuan yang berumur persis satu separuh-umur
//    harus berbobot setengah dari yang sama tetapi diajukan hari ini. Ini yang
//    membuat watchlist mingguan dan bulanan berbeda di tahap ini.
{
  const hariIni = buildNarrativeSignals(
    file([{ code: 'XXXX', date: '2026-09-01', title: 'Keterbukaan Informasi Pengambilalihan Saham' }]),
    14,
  ).get('XXXX')!;
  const duaMingguLalu = buildNarrativeSignals(
    file([{ code: 'XXXX', date: '2026-08-18', title: 'Keterbukaan Informasi Pengambilalihan Saham' }]),
    14,
  ).get('XXXX')!;
  const rasio = duaMingguLalu.filings[0].weight / hariIni.filings[0].weight;
  check('bobot meluruh separuh setelah satu separuh-umur',
    Math.abs(rasio - 0.5) < 0.02, `rasio=${rasio.toFixed(4)}`);

  // Separuh-umur lebih panjang membuat pengajuan lama lebih berarti — itulah
  // satu-satunya hal yang membedakan horizon mingguan dari bulanan di sini.
  const panjang = buildNarrativeSignals(
    file([{ code: 'XXXX', date: '2026-08-18', title: 'Keterbukaan Informasi Pengambilalihan Saham' }]),
    60,
  ).get('XXXX')!;
  check('separuh-umur lebih panjang memberi bobot lebih besar pada pengajuan lama',
    panjang.filings[0].weight > duaMingguLalu.filings[0].weight,
    `60h=${panjang.filings[0].weight.toFixed(4)} 14h=${duaMingguLalu.filings[0].weight.toFixed(4)}`);
}

// 7. Perhatian bursa harus menyalakan benderanya. Ini satu-satunya sinyal di
//    sini yang berarti "hati-hati", bukan "menarik".
{
  const sig = buildNarrativeSignals(
    file([{ code: 'ZZZZ', date: '2026-09-01', title: 'Permintaan Penjelasan Bursa Atas Volatilitas Transaksi' }]),
    14,
  );
  check('bendera perhatian bursa menyala', sig.get('ZZZZ')?.underExchangeAttention === true);

  const bersih = buildNarrativeSignals(
    file([{ code: 'YYYY', date: '2026-09-01', title: 'Pembagian Dividen Tunai' }]),
    14,
  );
  check('bendera tidak menyala tanpa sebab', bersih.get('YYYY')?.underExchangeAttention === false);
}

// 8. Ringkasan menghitung apa yang ada, bukan apa yang diharapkan.
{
  const f = file([
    { code: 'AAAA', date: '2026-09-01', title: 'Pembagian Dividen Tunai' },
    { code: 'BBBB', date: '2026-08-30', title: 'Laporan Bulanan Registrasi Pemegang Efek' },
    { code: 'AAAA', date: '2026-08-29', title: 'Penerbitan Obligasi Tahap I' },
  ]);
  const s = summariseAnnouncements(f);
  const totalKategori = s.byCategory.reduce((a, b) => a + b.count, 0);
  check('jumlah per kategori menutup ke jumlah pengajuan', totalKategori === f.announcements.length,
    `${totalKategori} vs ${f.announcements.length}`);
  check('total ringkasan = jumlah pengajuan', s.total === f.announcements.length);
  check('kategori diurutkan dari yang terbanyak',
    s.byCategory.every((c, i) => i === 0 || s.byCategory[i - 1].count >= c.count));
  check('tiap kategori punya label yang terisi',
    s.byCategory.every((c) => typeof c.label === 'string' && c.label.length > 0));
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
