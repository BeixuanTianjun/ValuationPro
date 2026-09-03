// Radar peristiwa: klasifikasi judul dan gerbang keadaan tape.
// Jalankan dengan: npm run test
//
// KENAPA ADA. eventRadar.ts adalah satu-satunya layar di aplikasi ini yang
// memberi nilai pada KEDIAMAN. Setiap layar lain menuntut sesuatu sudah
// bergerak; radar ini justru menolak yang sudah bergerak. Pembalikan itu
// menciptakan satu kelas kegagalan yang tidak dimiliki layar mana pun:
// **saham yang disuspensi adalah benda paling tenang di bursa.** Harganya tidak
// berubah satu rupiah pun, jadi runup-nya tepat 0% — nilai yang lebih baik
// daripada yang bisa dicapai saham tenang mana pun yang benar-benar hidup.
//
// Itu bukan kekhawatiran teoretis. Pada jalan pertama terhadap data sungguhan,
// WIKA lolos ke peringkat empat: harga beku di 204 selama lebih dari seratus
// sesi, tanpa volume penutupan sama sekali. Radarnya bahkan mencetak
// "Rp41 jt/hari" untuknya — rata-rata 20 sesi yang dihitung dari SATU
// pengamatan, yaitu satu cetakan intraday yang menempel di ujung seri. Angkanya
// salah dan terlihat sepenuhnya wajar.
//
// Dua tes di berkas ini mengunci persis itu, dan sisanya mengunci urutan aturan
// klasifikasi yang membuat kasus IATA terbaca sejak awal.

import type { MarketDatabase } from '../../data/marketRepository';
import type { AnnouncementsFile, RawAnnouncement } from '../announcements';
import {
  DEFAULT_RADAR_SETTINGS,
  buildEventRadar,
  classifyTrigger,
  type RadarSettings,
} from '../eventRadar';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

// ────────────────────────────────────────────────────── klasifikasi judul ──

// 1. JUDUL IATA YANG SEBENARNYA. Ini bukan contoh yang dikarang: keempat baris
//    di bawah disalin apa adanya dari arsip pengumuman IDX untuk IATA, dan
//    merekalah alasan berkas modelnya ditulis. Kalau dua yang pertama berhenti
//    menyala, radar ini kehilangan satu-satunya kasus yang pernah membuktikan
//    ia melihat sesuatu.
{
  const kasus: [string, string | null][] = [
    ['Perubahan Alamat/Nomor Telepon/Fax/E-Mail/Website/NPWP/NPKP', 'identitas'],
    ['Pemberitahuan Rencana RUPSU PT Karya Pacific Energy Tbk', 'aksi-korporasi'],
    ['Penyampaian Laporan Keuangan Interim Yang Tidak Diaudit', null],
    ['Laporan Bulanan Registrasi Pemegang Efek', null],
  ];
  for (const [judul, harap] of kasus) {
    const got = classifyTrigger(judul);
    check(`"${judul.slice(0, 44)}…" -> ${harap}`, got === harap, `dapat ${got}`);
  }
}

// 2. URUTAN ATURAN ADALAH ALGORITMANYA. Sebuah RUPSLB yang diadakan UNTUK
//    mengambil alih perusahaan adalah pengambilalihan, bukan rapat. Kalau
//    `aksi-korporasi` menang di sini, pemicu terkuat dalam taksonomi ini akan
//    tersamar sebagai yang terlemah — dan judulnya tetap terbaca masuk akal.
{
  check(
    'RUPSLB dalam rangka pengambilalihan terbaca sebagai transaksi',
    classifyTrigger('Pemberitahuan Rencana RUPSLB dalam rangka Pengambilalihan Saham') === 'transaksi',
    `${classifyTrigger('Pemberitahuan Rencana RUPSLB dalam rangka Pengambilalihan Saham')}`
  );
  check(
    'perubahan susunan direksi terbaca sebagai kendali',
    classifyTrigger('Perubahan Susunan Direksi dan Dewan Komisaris') === 'kendali'
  );
}

// 3. HASIL RAPAT BUKAN KABAR AKAN ADA RAPAT. "Pemberitahuan Hasil RUPSU" terbit
//    setelah semuanya selesai; memicu radar di situ berarti menyalakan alarm
//    untuk peristiwa yang sudah lewat, yang persis kegagalan yang layar ini ada
//    untuk dihindari.
{
  check('hasil RUPSU tidak memicu', classifyTrigger('Pemberitahuan Hasil RUPSU PT Karya Pacific Energy Tbk') === null,
    `${classifyTrigger('Pemberitahuan Hasil RUPSU PT Karya Pacific Energy Tbk')}`);
  check('risalah RUPS tidak memicu', classifyTrigger('Risalah Rapat Umum Pemegang Saham Tahunan') === null);
  check('laporan penggunaan dana IPO tidak memicu',
    classifyTrigger('Laporan Penggunaan Dana Hasil Penawaran Umum') === null);
}

// ──────────────────────────────────────────────────── perkakas basis data ──

const DATES = Array.from({ length: 120 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 2, 2) + i * 86400000);
  return d.toISOString().slice(0, 10);
});
const N = DATES.length;
const ASOF = '2026-09-03';

interface SeriesSpec {
  /** Harga penutupan tiap sesi. Panjangnya harus N. */
  close: number[];
  /** Volume tiap sesi. NaN berarti tidak ada perdagangan tercatat. */
  volume: number[];
}

const flat = (px: number, vol: number): SeriesSpec => ({
  close: Array(N).fill(px),
  volume: Array(N).fill(vol),
});

/** Harga yang bergerak pelan tanpa tren — keadaan yang radar ini cari. */
const tenang = (px: number, vol: number): SeriesSpec => ({
  close: Array.from({ length: N }, (_, i) => px + (i % 5) - 2),
  volume: Array.from({ length: N }, (_, i) => vol * (0.9 + ((i % 7) / 20))),
});

function makeDb(spec: Record<string, SeriesSpec>): MarketDatabase {
  const byCode = new Map<string, unknown>();
  const series = new Map<string, unknown>();
  for (const [code, s] of Object.entries(spec)) {
    byCode.set(code, { code, name: `${code} Tbk`, sector: 'Energy' });
    const vol = Float64Array.from(s.volume);
    series.set(code, {
      code,
      close: Float64Array.from(s.close),
      high: Float64Array.from(s.close),
      low: Float64Array.from(s.close),
      volume: vol,
      value: vol,
      foreignNet: new Float64Array(N),
      freq: vol,
      rawClose: Float64Array.from(s.close),
      adjustments: 0,
    });
  }
  return { dates: DATES, byCode, series } as unknown as MarketDatabase;
}

function makeFile(rows: RawAnnouncement[]): AnnouncementsFile {
  return {
    generatedAt: ASOF,
    from: '2026-07-20',
    to: ASOF,
    count: rows.length,
    emitenCount: new Set(rows.map((r) => r.code)).size,
    source: 'uji',
    pdfBase: 'https://contoh/',
    scope: 'uji',
    announcements: rows,
  };
}

const ann = (code: string, date: string, title: string): RawAnnouncement => ({ code, date, title });

const run = (
  spec: Record<string, SeriesSpec>,
  rows: RawAnnouncement[],
  over: Partial<RadarSettings> = {}
) => buildEventRadar(makeDb(spec), makeFile(rows), { ...DEFAULT_RADAR_SETTINGS, ...over });

// ──────────────────────────────────────────────────────────── gerbang tape ──

// 4. SAHAM BEKU DITOLAK. Ini tes terpenting di berkas ini. BEKU punya harga yang
//    tidak berubah sama sekali dan tidak ada volume — persis WIKA. Ia melewati
//    setiap gerbang "ketenangan" dengan nilai sempurna, dan tanpa gerbang
//    kehidupan ia akan berdiri di puncak daftar sebagai saham paling tenang di
//    bursa. Ia tidak tenang. Ia berhenti.
{
  const r = run(
    { BEKU: flat(204, NaN), HIDUP: tenang(500, 100_000) },
    [
      ann('BEKU', '2026-09-01', 'Perubahan Anggaran Dasar'),
      ann('BEKU', '2026-09-02', 'Pemberitahuan Rencana RUPSLB'),
      ann('HIDUP', '2026-09-01', 'Perubahan Anggaran Dasar'),
    ]
  );
  const kode = r.rows.map((x) => x.code);
  check('saham dengan harga beku tidak masuk radar', !kode.includes('BEKU'), kode.join(', '));
  check('saham hidup dengan pemicu yang sama tetap masuk', kode.includes('HIDUP'), kode.join(', '));
  check(
    'alasan penolakannya menyebut beku, bukan tipis',
    r.rejected.some((x) => x.reason.includes('beku')),
    r.rejected.map((x) => x.reason).join(' | ')
  );
}

// 4b. HARGA BEKU YANG RAMAI DIPERDAGANGKAN. Kasus BEKU di atas ternyata tidak
//     menguji apa yang saya kira: volumenya kosong, jadi ia sudah gugur di
//     gerbang likuiditas sebelum gerbang kehidupan sempat menyentuhnya —
//     mematikan gerbang kehidupan tidak membuat tes itu gagal. Ini kasus yang
//     HANYA bisa ditolak oleh gerbang kehidupan, dan ia nyata di IDX: sebuah
//     saham yang duduk di lantai harga Rp50 diperdagangkan berlimpah setiap hari
//     dan harganya tidak bisa turun lagi. Likuiditasnya bagus, runup-nya tepat
//     0%, rasio volumenya tepat 1 — sempurna di setiap gerbang ketenangan, dan
//     tidak bergerak karena tidak bisa.
{
  const r = run(
    { LANTAI: flat(50, 5_000_000), HIDUP: tenang(500, 100_000) },
    [
      ann('LANTAI', '2026-09-01', 'Perubahan Alamat Perseroan'),
      ann('LANTAI', '2026-09-02', 'Pemberitahuan Rencana RUPSLB'),
      ann('HIDUP', '2026-09-01', 'Perubahan Alamat Perseroan'),
    ]
  );
  const kode = r.rows.map((x) => x.code);
  check('saham di lantai harga yang ramai tetap ditolak', !kode.includes('LANTAI'),
    kode.join(', '));
  check('yang hidup tetap lolos di uji yang sama', kode.includes('HIDUP'), kode.join(', '));
}

// 5. BENTUK WIKA UTUH: seri tanpa volume penutupan sama sekali, dengan satu
//    cetakan intraday menempel di ujungnya. Inilah baris yang benar-benar lolos
//    ke peringkat empat pada jalan pertama, lengkap dengan "Rp41 jt/hari" yang
//    dihitung dari satu pengamatan.
//
//    CATATAN JUJUR TENTANG TES INI: yang menahannya adalah gerbang kehidupan,
//    BUKAN `minObs`. Mengembalikan `minObs` ke 1 tidak membuat tes ini gagal —
//    saya sudah mencobanya. Jadi tes ini mengunci hasilnya, dan tes berikutnya
//    yang mengunci penjaganya.
{
  const s = flat(204, NaN);
  s.volume[N - 1] = 199_768; // satu cetakan intraday di ujung
  s.close[N - 1] = 205; // sedikit bergerak, supaya bukan cuma gerbang beku yang bekerja
  const r = run({ SATU: s }, [ann('SATU', '2026-09-02', 'Perubahan Anggaran Dasar')]);
  check(
    'bentuk WIKA tidak masuk radar',
    !r.rows.some((x) => x.code === 'SATU'),
    r.rows.map((x) => `${x.code} Rp${(x.valuePerDay / 1e6).toFixed(0)}jt`).join(', ')
  );
}

// 5b. BASIS YANG TERLALU PENDEK TIDAK MELAHIRKAN RASIO. Emiten yang baru
//     tercatat punya beberapa sesi saja di jendela basis 60 sesi. Membagi volume
//     20 sesi terakhir dengan rata-rata delapan hari menghasilkan angka seperti
//     "48x" yang terbaca sebagai ledakan volume, padahal ia hanya derau dengan
//     koma. Perilaku yang benar adalah mengaku tidak punya basis — dan karena
//     tidak punya basis bukan berarti volumenya meledak, barisnya tetap tampil
//     dengan rasio yang ditandai kosong, bukan dibuang diam-diam.
//
//     Ini satu-satunya tes yang bisa dijatuhkan dengan mengubah `minObs`.
{
  const baru: SeriesSpec = {
    close: Array.from({ length: N }, (_, i) => 500 + (i % 5) - 2),
    volume: Array(N).fill(NaN),
  };
  // delapan sesi tipis di jendela basis, lalu dua puluh sesi ramai
  for (let i = N - 28; i < N - 20; i++) baru.volume[i] = 2_000;
  for (let i = N - 20; i < N; i++) baru.volume[i] = 96_000;

  const r = run({ BARU: baru }, [ann('BARU', '2026-09-02', 'Perubahan Anggaran Dasar')]);
  const row = r.rows.find((x) => x.code === 'BARU');
  check('emiten dengan basis terlalu pendek tetap tampil', !!row,
    `ditolak: ${r.rejected.map((x) => x.reason).join(' | ')}`);
  check('rasio volumenya dilaporkan tidak diketahui, bukan angka yang mengarang',
    !!row && !Number.isFinite(row.volRatio),
    `volRatio=${row?.volRatio}`);
}

// 6. YANG SUDAH TERBANG DITOLAK. Seluruh alasan layar ini ada adalah menangkap
//    sebelum harga bergerak; sebuah radar yang meloloskan saham yang sudah naik
//    40% dari dasarnya cuma screener momentum dengan nama lain.
{
  const naik = { close: Array.from({ length: N }, (_, i) => 100 + i), volume: Array(N).fill(100_000) };
  const r = run({ TERBANG: naik }, [ann('TERBANG', '2026-09-02', 'Perubahan Anggaran Dasar')]);
  check('saham yang sudah naik jauh dari dasar ditolak', r.rows.length === 0,
    r.rows.map((x) => `${x.code} runup ${(x.runup60 * 100).toFixed(0)}%`).join(', '));
}

// 7. UMA ADALAH DISKUALIFIKASI, BUKAN BOBOT NEGATIF. Bursa bertanya kenapa harga
//    bergerak hanya SETELAH ia bergerak. Radar yang menyala di situ sedang
//    mengukur keterlambatannya sendiri.
{
  const r = run({ TELAT: tenang(500, 100_000) }, [
    ann('TELAT', '2026-09-01', 'Perubahan Anggaran Dasar'),
    ann('TELAT', '2026-09-02', 'Penjelasan atas Volatilitas Transaksi'),
  ]);
  check('emiten yang kena UMA dikeluarkan meski punya pemicu', r.rows.length === 0,
    r.rows.map((x) => x.code).join(', '));
}

// ────────────────────────────────────────────────────────────── penilaian ──

// 8. YANG DIJUMLAH ADALAH JENIS, BUKAN JUMLAH PENGAJUAN. Tiga pemberitahuan
//    perubahan alamat dalam seminggu adalah satu perubahan identitas yang
//    dilaporkan tiga kali. Membiarkannya menumpuk akan memeringkat pasar
//    berdasarkan seberapa rajin sekretaris perusahaannya menekan kirim.
{
  const r = run(
    { TIGA: tenang(500, 100_000), SATU: tenang(500, 100_000) },
    [
      ann('TIGA', '2026-09-01', 'Perubahan Alamat Perseroan'),
      ann('TIGA', '2026-09-02', 'Perubahan Alamat Perseroan (Koreksi)'),
      ann('TIGA', '2026-09-02', 'Perubahan Website Perseroan'),
      ann('SATU', '2026-09-01', 'Perubahan Alamat Perseroan'),
    ]
  );
  const tiga = r.rows.find((x) => x.code === 'TIGA');
  const satu = r.rows.find((x) => x.code === 'SATU');
  check('keduanya masuk radar', !!tiga && !!satu, r.rows.map((x) => x.code).join(', '));
  check('tiga pengajuan sejenis tidak menaikkan skor',
    !!tiga && !!satu && Math.abs(tiga.score - satu.score) < 1e-12,
    `${tiga?.score} vs ${satu?.score}`);
}

// 9. KELOMPOK DUA JENIS MENGALAHKAN SATU JENIS. Bentuk IATA: identitas ditambah
//    aksi korporasi dalam beberapa hari. Salah satunya sendirian biasanya bukan
//    apa-apa; berbarengan itulah yang pantas dilihat.
{
  const r = run(
    { KLASTER: tenang(500, 100_000), TUNGGAL: tenang(500, 100_000) },
    [
      ann('KLASTER', '2026-09-01', 'Perubahan Alamat Perseroan'),
      ann('KLASTER', '2026-09-02', 'Pemberitahuan Rencana RUPSLB'),
      ann('TUNGGAL', '2026-09-01', 'Perubahan Alamat Perseroan'),
    ]
  );
  const k = r.rows.find((x) => x.code === 'KLASTER');
  const t = r.rows.find((x) => x.code === 'TUNGGAL');
  check('dua jenis dalam jendela klaster ditandai clustered', !!k && k.clustered === true, `${k?.clustered}`);
  check('satu jenis tidak ditandai clustered', !!t && t.clustered === false, `${t?.clustered}`);
  check('klaster berperingkat di atas pemicu tunggal', !!k && !!t && k.score > t.score,
    `${k?.score} vs ${t?.score}`);
  check('klaster berada di baris pertama', r.rows[0]?.code === 'KLASTER', r.rows.map((x) => x.code).join(', '));
}

// 10. PENGAJUAN DI LUAR JENDELA TIDAK MEMICU. `lookbackDays` harus benar-benar
//     menyaring; kalau tidak, radar ini akan menyalakan peristiwa berumur
//     berminggu-minggu sebagai kabar hari ini.
{
  const r = run({ LAMA: tenang(500, 100_000) }, [ann('LAMA', '2026-07-25', 'Perubahan Anggaran Dasar')]);
  check('pengajuan 40 hari lalu tidak memicu', r.rows.length === 0 && r.triggeredEmiten === 0,
    `${r.rows.length} baris, ${r.triggeredEmiten} emiten terpicu`);
}

// 11. TIAP BARIS MEMBAWA ATURANNYA. Semangat yang sama dengan screener: jawaban
//     atas "kenapa saham ini di sini" harus daftar yang bisa dicek. Sebuah baris
//     yang lolos tetapi menyimpan aturan yang gagal berarti gerbangnya tidak
//     benar-benar mengikat.
{
  const r = run({ ADA: tenang(500, 100_000) }, [ann('ADA', '2026-09-02', 'Perubahan Anggaran Dasar')]);
  const row = r.rows[0];
  check('baris yang lolos membawa daftar aturan', !!row && row.rules.length >= 5, `${row?.rules.length}`);
  check('semua aturan pada baris yang lolos berstatus lulus',
    !!row && row.rules.every((x) => x.pass),
    row?.rules.filter((x) => !x.pass).map((x) => x.label).join(', '));
  check('alasan dalam bahasa manusia ikut terbawa', !!row && row.why.length > 0, `${row?.why.join(', ')}`);
}

// 12. TANPA BERKAS PENGUMUMAN, RADAR KOSONG DAN TETAP MEMBAWA PERINGATANNYA.
//     Layar yang gagal diam-diam terbaca sebagai "tidak ada peristiwa hari ini",
//     dan itu pernyataan yang jauh lebih kuat daripada "datanya tidak ada".
{
  const r = buildEventRadar(makeDb({ X: tenang(500, 100_000) }), null);
  check('tanpa berkas pengumuman hasilnya kosong', r.rows.length === 0);
  check('peringatan tetap terbawa saat kosong', r.caveat.length > 0 && r.caveat.includes('BELUM diuji'),
    r.caveat.slice(0, 60));
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
