// Vonis gerbang corong screener.
// Jalankan dengan: npm run test
//
// KENAPA ADA. Sebuah aturan yang berhenti membedakan tidak melempar apa pun. Ia
// tetap dicetak di corong dengan angka yang benar, dan pembacanya menyimpulkan
// daftar di bawahnya sudah melewati sebuah saringan yang sebenarnya tidak
// menyaring.
//
// KASUS YANG MELAHIRKANNYA. Pada 2026-09-03 aturan penentu mode Tertinggal —
// "indeks acuannya naik >=10% dalam 60 sesi" — menggugurkan NOL dari 962,
// karena kebetulan seluruh 45 indeks IDX sedang naik 16% sampai 40%. Corongnya
// jujur mencetak "-0 tersaring" dan tidak ada yang salah dengan angkanya. Yang
// hilang cuma kalimat yang mengatakan hari ini aturan itu tidak melakukan apa-apa.
//
// Diukur atas 481 sesi sebelumnya, aturan yang sama menggugurkan SEMUANYA pada
// 22% sesi dan nyaris tidak ada pada 0,4%. Kedua ujung itu keadaan pasar yang
// sah, bukan cacat — pada hari tidak ada indeks yang memimpin, memang tidak ada
// setup tertinggal untuk ditemukan. Vonis ini menamai hari mana yang sedang
// dilihat, ia tidak mengubah satu pun aturan.

import { annotateFunnel, GATE_VERDICT_NOTE, type FunnelStage } from '../stockScreener';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

const tahap = (id: string, remaining: number, removed: number): FunnelStage => ({
  id,
  label: id,
  remaining,
  removed,
});

// 1. BARIS PERTAMA BUKAN ATURAN. "962 emiten tercatat" adalah semestanya, dan
//    memberinya vonis "tidak menyaring apa pun" akan menjadi omong kosong yang
//    muncul di setiap layar, setiap hari.
{
  const a = annotateFunnel([tahap('semesta', 962, 0), tahap('r1', 300, 662)]);
  check('baris semesta tidak pernah divonis', a[0].verdict === null, `${a[0].verdict}`);
  check('semesta menghitung entering dari dirinya sendiri', a[0].entering === 962, `${a[0].entering}`);
}

// 2. KASUS TERTINGGAL 2026-09-03 APA ADANYA: 962 masuk, 962 keluar.
{
  const a = annotateFunnel([tahap('semesta', 962, 0), tahap('indeks', 962, 0)]);
  check('aturan yang meloloskan semuanya divonis inert', a[1].verdict === 'inert', `${a[1].verdict}`);
  check('catatannya menyebut tidak menyaring',
    GATE_VERDICT_NOTE.inert.includes('tidak menyaring'), GATE_VERDICT_NOTE.inert);
}

// 3. UJUNG SEBALIKNYA, yang terjadi pada 22% sesi: aturan menggugurkan semuanya.
//    Ini BUKAN kesalahan dan catatannya harus mengatakan begitu — pada hari
//    tidak ada indeks yang memimpin, memang tidak ada setup tertinggal.
{
  const a = annotateFunnel([tahap('semesta', 962, 0), tahap('indeks', 0, 962)]);
  check('aturan yang menggugurkan semuanya divonis habis', a[1].verdict === 'habis', `${a[1].verdict}`);
  check('catatan habis menyebut tidak ada setup',
    GATE_VERDICT_NOTE.habis.includes('tidak ada setup'), GATE_VERDICT_NOTE.habis);
}

// 4. ATURAN YANG BENAR-BENAR MEMILIH TIDAK DIBERI TANDA. Kalau ini jatuh,
//    lencananya akan muncul di aturan yang sehat dan pembacanya belajar
//    mengabaikannya — yang menghapus seluruh gunanya.
{
  const a = annotateFunnel([tahap('semesta', 962, 0), tahap('r1', 311, 651), tahap('r2', 56, 255)]);
  check('aturan yang menyaring 68% tidak diberi tanda', a[1].verdict === null, `${a[1].verdict}`);
  check('aturan yang menyaring 82% tidak diberi tanda', a[2].verdict === null, `${a[2].verdict}`);
}

// 5. AMBANG "LEMAH" DIUJI DARI KEDUA SISINYA. Sebuah aturan yang membuang satu
//    nama dari sembilan ratus melakukan ketiadaan yang sama seperti yang
//    membuang nol; ia cuma kebetulan menangkap satu yang tersasar.
{
  // 900 masuk, 9 dibuang = 1,0% -> di bawah ambang 2%
  const lemah = annotateFunnel([tahap('semesta', 900, 0), tahap('r1', 891, 9)]);
  check('membuang 1% divonis lemah', lemah[1].verdict === 'lemah', `${lemah[1].verdict}`);

  // 900 masuk, 45 dibuang = 5,0% -> di atas ambang
  const cukup = annotateFunnel([tahap('semesta', 900, 0), tahap('r1', 855, 45)]);
  check('membuang 5% tidak diberi tanda', cukup[1].verdict === null, `${cukup[1].verdict}`);
}

// 6. VONIS DIHITUNG TERHADAP YANG MASUK, BUKAN TERHADAP SEMESTA. Aturan keempat
//    yang menerima 30 emiten dan membuang 15 sedang menyaring separuh
//    kolamnya, meski 15 itu cuma 1,5% dari 962. Membandingkan ke semesta akan
//    menandai setiap aturan di ujung corong sebagai lemah, yaitu justru aturan
//    yang paling menentukan isi daftarnya.
{
  const a = annotateFunnel([
    tahap('semesta', 962, 0),
    tahap('r1', 100, 862),
    tahap('r2', 30, 70),
    tahap('r3', 15, 15),
  ]);
  check('tahap akhir dinilai terhadap kolamnya sendiri', a[3].verdict === null, `${a[3].verdict}`);
  check('entering tahap akhir adalah sisa tahap sebelumnya', a[3].entering === 30, `${a[3].entering}`);
  check('pecahan yang dibuang dihitung dari yang masuk',
    Math.abs(a[3].removedFraction - 0.5) < 1e-12, `${a[3].removedFraction}`);
}

// 7. KOLAM KOSONG TIDAK MELAHIRKAN VONIS BARU. Kalau aturan sebelumnya sudah
//    menghabiskan semuanya, aturan sesudahnya menerima nol — dan menandainya
//    "inert" akan menyalahkan aturan yang tidak pernah kebagian apa pun.
{
  const a = annotateFunnel([tahap('semesta', 962, 0), tahap('r1', 0, 962), tahap('r2', 0, 0)]);
  check('aturan yang tidak kebagian apa pun tidak divonis', a[2].verdict === null, `${a[2].verdict}`);
  check('yang menghabiskan tetap divonis habis', a[1].verdict === 'habis', `${a[1].verdict}`);
  check('pecahan atas kolam kosong menjadi NaN, bukan nol',
    Number.isNaN(a[2].removedFraction), `${a[2].removedFraction}`);
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
