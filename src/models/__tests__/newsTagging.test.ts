// Penandaan kode emiten pada judul berita.
// Jalankan dengan: npm run test
//
// KENAPA ADA. `tagEmiten` di scripts/news-tagging.mjs memutuskan berita mana
// yang "tentang" emiten mana, dan hasilnya tampil di layar sebagai fakta. Ia
// tidak pernah melempar apa pun: salah tanda menghasilkan berita yang terlihat
// relevan dan sama sekali bukan.
//
// KASUS YANG MELAHIRKAN BERKAS INI. Pada 3 September 2026 NewsFeed menampilkan
// "Putin floats 'chance' at peace with Ukraine as NATO chief warns Russia is
// becoming increasingly reckless" sebagai berita tentang NATO — dan NATO
// memang kode IDX yang sah, Olympus Strategic Indonesia Tbk.
//
// Aturan lama menyandarkan segalanya pada huruf besar: ticker ditulis "FAST",
// kata Inggrisnya ditulis "fast", jadi case adalah sinyalnya. Itu benar untuk
// kata biasa dan RUNTUH untuk AKRONIM, yang juga ditulis kapital. Tidak ada
// aturan huruf yang bisa memisahkan NATO dari NATO.
//
// Yang memisahkannya adalah korannya. Diukur atas seluruh feed: dari delapan
// belas ticker yang muncul sebagai token kapital, tujuh belas benar dan
// SEMUANYA dari CNBC Indonesia; satu-satunya yang salah adalah satu-satunya
// yang datang dari kawat asing.
//
// KENAPA LOGIKANYA BERKAS TERPISAH. Versi pertama tes ini mengimpor skrip
// ingest-nya langsung, dan mengimpor skrip ingest berarti MENJALANKANNYA: satu
// `npm run test` menarik lima feed RSS dan menimpa news.json. Penjaga
// entry-point tidak menolong karena esbuild membundel modulnya ke dalam berkas
// tes, sehingga `import.meta.url` dan `argv[1]` memang sama.

import { buildMatchers, tagEmiten } from '../../../scripts/news-tagging.mjs';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

const UNIVERSE = [
  { code: 'NATO', name: 'Olympus Strategic Indonesia Tbk.' },
  { code: 'GOTO', name: 'GoTo Gojek Tokopedia Tbk.' },
  { code: 'BBRI', name: 'Bank Rakyat Indonesia (Persero) Tbk.' },
  { code: 'TLKM', name: 'Telkom Indonesia (Persero) Tbk.' },
  { code: 'FAST', name: 'Fast Food Indonesia Tbk.' },
  { code: 'BBCA', name: 'Bank Central Asia Tbk.' },
];
const M = buildMatchers(UNIVERSE);
const tag = (teks: string, scope = 'indonesia') => tagEmiten(teks, M, scope);

// 1. KASUS NATO. Judul aslinya, apa adanya, dari kawat asing.
{
  const judul =
    "Putin floats 'chance' at peace with Ukraine as NATO chief warns Russia is becoming 'increasingly reckless'";
  check('NATO di kawat asing tidak ditandai sebagai emiten',
    tag(judul, 'global').length === 0, JSON.stringify(tag(judul, 'global')));
}

// 2. Tapi berita asing yang MEMANG tentang pasar Indonesia tetap ditandai.
//    Aturan ini korroborasi, bukan penyaringan buta — membuang seluruh kawat
//    asing akan diam-diam kehilangan tiap liputan Reuters soal emiten IDX,
//    dan kehilangan yang diam adalah yang paling mahal di repo ini.
{
  const r = tag("Indonesia's GOTO plunges as investors flee tech", 'global');
  check('berita asing dengan petunjuk Indonesia tetap ditandai', r.includes('GOTO'), JSON.stringify(r));

  const j = tag('Jakarta stocks slide, BBRI leads losses', 'global');
  check('petunjuk "Jakarta" cukup', j.includes('BBRI'), JSON.stringify(j));
}

// 3. Nama perusahaan sebagai FRASA dikecualikan dari syarat korroborasi.
//    "TELKOM INDONESIA" adalah bukti bagi dirinya sendiri, siapa pun yang
//    menerbitkannya.
{
  const r = tag('Telkom Indonesia weighs data centre spin-off, sources say', 'global');
  check('frasa nama perusahaan menandai tanpa perlu petunjuk lain',
    r.includes('TLKM'), JSON.stringify(r));
}

// 4. Feed Indonesia tidak berubah perilakunya. Ini yang menjaga tujuh belas
//    tanda yang benar tetap ada.
{
  const r = tag('Kredit BBRI Ngebut Naik 16,2%, Analis Sebut Target Bisa Dikerek Naik');
  check('ticker di feed Indonesia tetap ditandai', r.includes('BBRI'), JSON.stringify(r));

  const g = tag('Asing Balik Jualan, Diam-Diam Jauhi Saham GOTO');
  check('feed Indonesia tidak butuh petunjuk tambahan', g.includes('GOTO'), JSON.stringify(g));
}

// 5. Pelajaran lama tidak boleh hilang: huruf kecil bukan ticker. Kalau ini
//    jatuh, 65% feed akan kembali "tentang" emiten Indonesia.
{
  check('kata Inggris huruf kecil tidak jadi ticker',
    tag('Fast-fashion giant Shein files for London listing', 'global').length === 0,
    JSON.stringify(tag('Fast-fashion giant Shein files for London listing', 'global')));
  check('huruf kecil di feed Indonesia pun tidak jadi ticker',
    !tag('Bisnis fast food tumbuh pesat tahun ini').includes('FAST'),
    JSON.stringify(tag('Bisnis fast food tumbuh pesat tahun ini')));
}

// 6. Frasa nama harus BERURUTAN, bukan token berserak. "Bank" dan "Asia" di
//    kalimat yang sama bukan Bank Central Asia.
{
  const r = tag('Bank lending across Asia slows sharply', 'global');
  check('token nama yang berserak tidak menandai', !r.includes('BBCA'), JSON.stringify(r));
}

// 7. Petunjuk Indonesia dicari di TEKS ASLI, bukan hanya judul kapital.
//    "Tbk" di ringkasan sama sahnya dengan "Indonesia" di judul.
{
  const r = tag('NATO chief speaks. PT Olympus Strategic Indonesia Tbk unrelated.', 'global');
  check('petunjuk boleh datang dari ringkasan, bukan cuma judul',
    r.includes('NATO'), JSON.stringify(r));
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
