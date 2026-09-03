// Pemuat berkas sampingan public/data/idx.
// Jalankan dengan: npm run test
//
// KENAPA ADA. Berkas ini kecil, dan justru itu masalahnya: sebuah cache yang
// salah tidak pernah melempar apa pun. Ia mengembalikan data lama dengan
// percaya diri, dan satu-satunya gejalanya adalah angka di layar yang tidak
// berubah setelah seseorang menekan refresh — yang terbaca seperti data yang
// memang belum diperbarui, bukan seperti bug.
//
// Dua perilaku di sini yang tidak akan terlihat kalau rusak:
//
//   1. DEDUPE PERMINTAAN YANG SEDANG BERJALAN. Yang di-cache adalah PROMISE-nya,
//      bukan hasilnya. Empat panel yang mount pada tick yang sama harus berbagi
//      satu unduhan; menyimpan hasilnya saja akan tetap menembakkan empat
//      permintaan karena tidak satu pun sudah selesai ketika yang berikutnya
//      bertanya.
//   2. KEGAGALAN TIDAK DI-CACHE. Satu respons buruk — layanan yang baru
//      menyala, berkas yang sedang ditimpa ingest — tidak boleh berubah menjadi
//      "data belum dibangun" permanen sampai halamannya dimuat ulang.

import { invalidateIdxFiles, loadIdxFile } from '../idxFiles';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

type Skenario = { ok: boolean; body?: unknown; tunda?: number };

let panggilan: string[] = [];
let skenario: Skenario = { ok: true, body: { nilai: 1 } };

/**
 * Pengganti `fetch` yang mencatat tiap URL yang diminta.
 *
 * `tunda` ada supaya dedupe bisa diuji sama sekali: tanpa jeda, permintaan
 * pertama sudah selesai sebelum yang kedua bertanya, dan tesnya akan lulus
 * bahkan pada cache yang hanya menyimpan hasil.
 */
function pasangFetch() {
  (globalThis as { fetch: unknown }).fetch = (url: string): Promise<unknown> => {
    panggilan.push(String(url));
    const s = skenario;
    const buat = () =>
      s.ok
        ? { ok: true, json: () => Promise.resolve(s.body) }
        : { ok: false, status: 404, json: () => Promise.reject(new Error('404')) };
    return s.tunda ? new Promise((r) => setTimeout(() => r(buat()), s.tunda)) : Promise.resolve(buat());
  };
}

async function main() {
  pasangFetch();

  // 1. Bacaan kedua tidak menyentuh jaringan sama sekali.
  {
    invalidateIdxFiles();
    panggilan = [];
    skenario = { ok: true, body: { nilai: 1 } };
    const a = await loadIdxFile<{ nilai: number }>('announcements.json');
    const b = await loadIdxFile<{ nilai: number }>('announcements.json');
    check('bacaan kedua tidak menembak jaringan', panggilan.length === 1, `${panggilan.length} permintaan`);
    check('keduanya menerima isi yang sama', a?.nilai === 1 && b?.nilai === 1, `${a?.nilai} / ${b?.nilai}`);
    check('URL dibangun tanpa garis miring ganda', !/[^:]\/\//.test(panggilan[0] || ''), panggilan[0]);
    check('URL menunjuk ke folder data yang benar',
      (panggilan[0] || '').endsWith('/data/idx/announcements.json'), panggilan[0]);
  }

  // 2. DUA PEMANGGIL SERENTAK BERBAGI SATU UNDUHAN. Inilah kasus yang
  //    sebenarnya terjadi di aplikasi: Watchlist dan Radar mount bersamaan.
  {
    invalidateIdxFiles();
    panggilan = [];
    skenario = { ok: true, body: { nilai: 2 }, tunda: 40 };
    const [a, b] = await Promise.all([
      loadIdxFile<{ nilai: number }>('ownership.json'),
      loadIdxFile<{ nilai: number }>('ownership.json'),
    ]);
    check('dua pemanggil serentak berbagi satu permintaan', panggilan.length === 1, `${panggilan.length} permintaan`);
    check('keduanya mendapat hasilnya', a?.nilai === 2 && b?.nilai === 2, `${a?.nilai} / ${b?.nilai}`);
  }

  // 3. Berkas yang berbeda tidak saling menimpa. Cache yang keliru kuncinya
  //    akan menyajikan pengumuman sebagai kepemilikan, dan tidak ada yang
  //    melempar — panelnya hanya akan kosong.
  {
    invalidateIdxFiles();
    panggilan = [];
    skenario = { ok: true, body: { nilai: 3 } };
    await loadIdxFile('macro.json');
    await loadIdxFile('news.json');
    check('berkas berbeda diambil terpisah', panggilan.length === 2, `${panggilan.length} permintaan`);
  }

  // 4. KEGAGALAN TIDAK DI-CACHE. Percobaan kedua harus benar-benar mencoba
  //    lagi, dan harus berhasil kalau berkasnya sudah ada.
  {
    invalidateIdxFiles();
    panggilan = [];
    skenario = { ok: false };
    const gagal = await loadIdxFile('strategies.json');
    check('respons buruk menjadi null, bukan lemparan', gagal === null, `${gagal}`);

    skenario = { ok: true, body: { nilai: 4 } };
    const lagi = await loadIdxFile<{ nilai: number }>('strategies.json');
    check('percobaan berikutnya menembak jaringan lagi', panggilan.length === 2, `${panggilan.length} permintaan`);
    check('percobaan berikutnya berhasil', lagi?.nilai === 4, `${lagi?.nilai}`);
  }

  // 5. Jaringan yang mati juga tidak di-cache. Bentuk kegagalan yang berbeda
  //    dari HTTP 404 — fetch yang menolak, bukan respons yang tidak ok — dan
  //    keduanya harus diperlakukan sama.
  {
    invalidateIdxFiles();
    panggilan = [];
    (globalThis as { fetch: unknown }).fetch = (url: string) => {
      panggilan.push(String(url));
      return Promise.reject(new Error('jaringan mati'));
    };
    const mati = await loadIdxFile('tanker.json');
    check('fetch yang menolak menjadi null', mati === null, `${mati}`);
    pasangFetch();
    skenario = { ok: true, body: { nilai: 5 } };
    const pulih = await loadIdxFile<{ nilai: number }>('tanker.json');
    check('setelah jaringan pulih, berkasnya terbaca', pulih?.nilai === 5, `${pulih?.nilai}`);
  }

  // 6. INVALIDASI BENAR-BENAR MEMBUANG. Ini yang menopang tombol refresh:
  //    kalau ia tidak membuang, refresh akan membaca ulang harga tetapi
  //    menyajikan pengumuman lama, dan layarnya akan terlihat sudah diperbarui.
  {
    invalidateIdxFiles();
    panggilan = [];
    skenario = { ok: true, body: { nilai: 6 } };
    await loadIdxFile('announcements.json');
    invalidateIdxFiles();
    skenario = { ok: true, body: { nilai: 7 } };
    const sesudah = await loadIdxFile<{ nilai: number }>('announcements.json');
    check('invalidasi memaksa pengambilan ulang', panggilan.length === 2, `${panggilan.length} permintaan`);
    check('isi yang baru yang dipakai, bukan yang lama', sesudah?.nilai === 7, `${sesudah?.nilai}`);
  }

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
