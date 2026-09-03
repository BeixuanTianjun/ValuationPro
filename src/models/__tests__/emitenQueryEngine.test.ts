// Parser kalimat Indonesia dan gerbang angka mesin kueri emiten.
// Jalankan dengan: npm run test
//
// KENAPA ADA. emitenQueryEngine.ts 458 baris tanpa tes, dan ia berdiri di
// belakang chatbot: kalimat pengguna masuk, daftar emiten keluar. Salah tafsir
// di sini tidak pernah muncul sebagai error — ia muncul sebagai daftar saham
// yang salah, dan pengguna tidak punya cara tahu bahwa "P/E di bawah 10"
// terbaca sebagai "P/E di atas 10".
//
// Dua hal yang dijaga: apa yang parser KLAIM ia pahami harus sama dengan yang
// benar-benar ia terapkan, dan angka yang tidak ada tidak boleh lolos gerbang
// perbandingan.

import type { MarketDatabase } from '../../data/marketRepository';
import type { DailyQuote, Emiten } from '../../types/market';
import { buildRow, parseIndonesianQuery, queryEmiten } from '../emitenQueryEngine';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

// ─────────────────────────────────────────────────────── parser kalimat ──

// 1. Arah perbandingan. Ini kesalahan paling mahal di berkas ini: sebuah
//    "di bawah" yang terbaca "di atas" mengembalikan justru saham yang ingin
//    dihindari, dengan daftar yang terlihat sama masuk akalnya.
{
  const kasus: [string, 'maxPe' | 'minPe', number][] = [
    ['saham dengan P/E di bawah 10', 'maxPe', 10],
    ['cari PE kurang dari 8', 'maxPe', 8],
    ['P/E maksimal 12', 'maxPe', 12],
    ['P/E di atas 20', 'minPe', 20],
    ['pe lebih dari 15', 'minPe', 15],
    ['P/E minimal 5', 'minPe', 5],
  ];
  for (const [kalimat, kunci, nilai] of kasus) {
    const p = parseIndonesianQuery(kalimat);
    check(`"${kalimat}" -> ${kunci}=${nilai}`, p.query[kunci] === nilai,
      `maxPe=${p.query.maxPe} minPe=${p.query.minPe}`);
  }

  // Tanpa kata arah, defaultnya "di bawah". Perilaku ini ditulis di kodenya dan
  // dijaga di sini supaya tidak berubah diam-diam.
  const polos = parseIndonesianQuery('saham P/E 15');
  check('"P/E 15" tanpa arah default ke maxPe', polos.query.maxPe === 15,
    `maxPe=${polos.query.maxPe} minPe=${polos.query.minPe}`);
}

// 2. Desimal Indonesia memakai KOMA. "P/E di bawah 12,5" yang terbaca 12
//    diam-diam mengetatkan filternya.
{
  const p = parseIndonesianQuery('P/E di bawah 12,5');
  check('koma desimal terbaca sebagai pecahan', p.query.maxPe === 12.5, `${p.query.maxPe}`);
}

// 3. Persen dividen dikembalikan sebagai PECAHAN, bukan angka persen. Selisih
//    seratus kali yang tidak akan pernah memberi hasil.
{
  const p = parseIndonesianQuery('dividen di atas 5%');
  check('dividend yield 5% menjadi 0,05', p.query.minDividendYield === 0.05,
    `${p.query.minDividendYield}`);
}

// 4. Satuan rupiah. "10 triliun" harus menjadi 10.000 miliar, karena seluruh
//    mesin ini berhitung dalam miliar.
{
  const t = parseIndonesianQuery('kapitalisasi minimal 10 triliun');
  check('10 triliun = 10.000 miliar', t.query.minMarketCapIdrBn === 10_000,
    `${t.query.minMarketCapIdrBn}`);
  const m = parseIndonesianQuery('kapitalisasi minimal 500 miliar');
  check('500 miliar tetap 500', m.query.minMarketCapIdrBn === 500, `${m.query.minMarketCapIdrBn}`);
}

// 5. Sektor dikenali dari kata sehari-hari, bukan dari nama resmi IDX-IC.
//    Nyaris tidak ada yang mengetik "Consumer Non-Cyclicals".
{
  const kasus: [string, string][] = [
    ['saham batu bara yang murah', 'Energy'],
    ['emiten nikel', 'Basic Materials'],
    ['saham rokok', 'Consumer Non-Cyclicals'],
    ['emiten rumah sakit', 'Healthcare'],
  ];
  for (const [kalimat, sektor] of kasus) {
    const p = parseIndonesianQuery(kalimat);
    check(`"${kalimat}" -> ${sektor}`, (p.query.sectors || []).includes(sektor),
      `${(p.query.sectors || []).join(', ') || 'kosong'}`);
  }
}

// 6. Yang tidak dipahami menjadi pencarian teks, BUKAN filter yang ditebak.
//    Arah kegagalannya seluruh alasan parser ini konservatif: sebuah filter
//    yang salah tebak mengembalikan daftar yang salah dengan percaya diri,
//    sementara pencarian teks yang kosong terlihat kosong.
{
  const p = parseIndonesianQuery('bagaimana prospek pasar minggu depan');
  check('kalimat tanpa pola jatuh ke pencarian teks', p.fellBackToTextSearch === true,
    `understood=[${p.understood.join(', ')}]`);
}

// 7. Apa yang diklaim dipahami harus benar-benar diterapkan. Daftar
//    `understood` dikembalikan ke pengguna untuk dikoreksi, jadi ia berbohong
//    kalau menyebut filter yang tidak ada di query-nya.
{
  const p = parseIndonesianQuery('saham batu bara dengan P/E di bawah 10 dan dividen di atas 4%');
  check('tiga hal dipahami sekaligus',
    p.understood.length >= 3 && !p.fellBackToTextSearch,
    `${p.understood.join(' · ')}`);
  check('ketiganya benar-benar ada di query',
    (p.query.sectors || []).includes('Energy') &&
      p.query.maxPe === 10 &&
      p.query.minDividendYield === 0.04);
}

// ──────────────────────────────────────────────────────── gerbang angka ──

function makeDb(list: { code: string; sector: string; board: string; close: number }[]): MarketDatabase {
  const emiten = list.map(
    (e) =>
      ({
        code: e.code, name: `${e.code} Tbk`, fullName: `PT ${e.code}`, sector: e.sector,
        board: e.board, industry: '', subIndustry: '', business: '', listedShares: 1e9,
      }) as Emiten,
  );
  const daily = new Map<string, DailyQuote>(
    list.map((e) => [e.code, { code: e.code, close: e.close, prev: e.close } as DailyQuote]),
  );
  return { emiten, daily, byCode: new Map(emiten.map((e) => [e.code, e])) } as unknown as MarketDatabase;
}

const DB = makeDb([
  { code: 'AAAA', sector: 'Energy', board: 'Main', close: 1000 },
  { code: 'BBBB', sector: 'Energy', board: 'Development', close: 200 },
  { code: 'CCCC', sector: 'Healthcare', board: 'Main', close: 5000 },
]);

// 8. Filter sektor dan papan menyaring, dan menyaring yang benar.
{
  const energi = queryEmiten(DB, null, null, { sectors: ['Energy'] });
  check('filter sektor menyaring', energi.rows.length === 2, `${energi.rows.length}`);
  check('filter sektor menyaring yang benar',
    energi.rows.every((r) => r.emiten.sector === 'Energy'));

  const utama = queryEmiten(DB, null, null, { boards: ['Main'] });
  check('filter papan menyaring', utama.rows.length === 2, `${utama.rows.length}`);
}

// 9. Batas harga menghormati kedua ujungnya.
{
  const r = queryEmiten(DB, null, null, { minPrice: 500, maxPrice: 2000 });
  check('batas harga menyaring kedua ujung',
    r.rows.length === 1 && r.rows[0].emiten.code === 'AAAA',
    r.rows.map((x) => x.emiten.code).join(', '));
}

// 10. ANGKA YANG TIDAK ADA TIDAK BOLEH LOLOS GERBANG PERBANDINGAN.
//
//     Tanpa fundamental, P/E tiap baris adalah NaN. Sebuah gerbang yang ditulis
//     `!(v > bound)` alih-alih `v <= bound` akan meloloskan SEMUANYA, dan
//     daftar yang keluar terlihat seperti hasil pencarian yang berhasil.
{
  const r = queryEmiten(DB, null, null, { maxPe: 10 });
  check('P/E yang NaN tidak lolos gerbang maxPe', r.rows.length === 0,
    `${r.rows.length} lolos padahal tidak ada fundamental`);

  const s = queryEmiten(DB, null, null, { minDividendYield: 0.03 });
  check('yield yang NaN tidak lolos gerbang minDividendYield', s.rows.length === 0,
    `${s.rows.length}`);
}

// 11. Batas jumlah dihormati, dan totalMatched tetap melaporkan yang
//     sebenarnya cocok — bukan yang ditampilkan. Kalau keduanya sama, pengguna
//     tidak pernah tahu ada yang dipotong.
{
  const r = queryEmiten(DB, null, null, { limit: 1 });
  check('limit memotong baris', r.rows.length === 1, `${r.rows.length}`);
  check('totalMatched melaporkan sebelum dipotong', r.totalMatched === 3, `${r.totalMatched}`);
}

// 12. buildRow tidak boleh melempar saat semua sumber tambahan kosong. Chatbot
//     memanggilnya untuk emiten mana pun yang disebut pengguna, termasuk yang
//     tidak punya fundamental.
{
  let lempar = false;
  let row = null as ReturnType<typeof buildRow> | null;
  try {
    row = buildRow(DB.emiten[0], DB, null, null);
  } catch {
    lempar = true;
  }
  check('buildRow bertahan tanpa faktor dan fundamental', !lempar);
  check('harga tetap terisi dari kuotasi harian', row !== null && row.price === 1000, `${row?.price}`);
  check('rasio yang tidak diketahui menjadi NaN, bukan nol',
    row !== null && Number.isNaN(row.pe) && Number.isNaN(row.pbv),
    `pe=${row?.pe} pbv=${row?.pbv}`);
}

// --- laporan
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) process.exit(1);
