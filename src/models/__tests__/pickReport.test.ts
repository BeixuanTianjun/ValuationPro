// Isi laporan Excel jurnal pick.
// Jalankan dengan: npm run test
//
// KENAPA BARU BISA SEKARANG. `exportPickJournalToExcel` memanggil `saveAs`,
// yang butuh DOM, jadi selama penyusunan workbook dan penyimpanannya menyatu
// satu-satunya cara memeriksa laporan ini adalah mengunduh lalu membukanya
// dengan mata — yang berarti ia tidak pernah diperiksa. `buildPickWorkbook`
// dipisahkan supaya isinya bisa dibaca di Node.
//
// KENAPA LAYAK DIPERIKSA. Komentar di berkasnya sendiri menjelaskannya lebih
// baik daripada yang bisa saya tulis di sini: sebuah workbook hidup lebih lama
// daripada layar asalnya, dan angka di sel C4 akan dikutip enam bulan lagi oleh
// orang yang tidak ingat posisi terbuka dikecualikan. Kalau lembar Metode
// hilang atau isinya basi, angkanya berubah dari pengukuran menjadi klaim.

import { PICK_SOURCES, type EvaluatedPick, type PickSummary } from '../pickJournal';
import { buildPickWorkbook, pickReportFilename } from '../pickReport';

const results: { name: string; ok: boolean; detail: string }[] = [];
// Detail hanya berguna saat gagal. Sebuah baris PASS yang diikuti keterangan
// "frasa tidak ditemukan" membaca seperti kontradiksi, dan pembaca yang berhenti
// pada keterangan itu akan menyimpulkan kebalikan dari hasilnya.
const check = (name: string, ok: boolean, detail = '') =>
  results.push({ name, ok, detail: ok ? '' : detail });

const pick = (over: Partial<EvaluatedPick>): EvaluatedPick =>
  ({
    id: 'x', recordedAt: '2026-09-01T09:00:00Z', session: '2026-09-01',
    source: 'screener:momentum', code: 'AAAA', name: 'AAAA Tbk', sector: 'Energy',
    rank: 1, score: 0.5, entry: 1000, stop: 900, target: 1250, atr14: 66.7,
    runupFromLow: 0.1, extensionAtr: 0.5, gapToIndexPp: 0, dipFromHigh: -0.05,
    entryIsFinalClose: true,
    outcome: 'target', sessionsHeld: 10, exitSession: '2026-09-15',
    exitPrice: 1250, rMultiple: 2.5, returnPercent: 0.25,
    return1w: 0.05, return1m: 0.2, return3m: 0.25, resolved: true,
    ...over,
  }) as EvaluatedPick;

const summary = (over: Partial<PickSummary>): PickSummary =>
  ({
    source: 'SEMUA', label: 'Semua sumber', picks: 2, resolved: 2, open: 0,
    wins: 1, losses: 1, winRate: 0.5, expectancyR: 0.75, avgWinR: 2.5, avgLossR: -1,
    medianReturn1m: 0.02, medianReturn3m: 0.05, oldestOpenSessions: 0,
    ...over,
  }) as PickSummary;

const META = {
  startedOn: '2026-08-01',
  latestSession: '2026-09-30',
  month: null as string | null,
  provisionalExcluded: 0,
};

async function main() {
  const picks = [
    pick({ id: 'a', session: '2026-08-15', code: 'AAAA' }),
    pick({ id: 'b', session: '2026-09-10', code: 'BBBB', outcome: 'stop', rMultiple: -1, resolved: true }),
    pick({ id: 'c', session: '2026-09-20', code: 'CCCC', outcome: 'open', resolved: false, rMultiple: NaN }),
  ];
  const wb = await buildPickWorkbook(picks, [summary({})], META);

  // 1. Keempat lembar harus ada. Lembar Metode yang hilang mengubah laporan ini
  //    dari pengukuran menjadi angka telanjang.
  {
    const nama = wb.worksheets.map((w) => w.name);
    for (const wajib of ['Ringkasan', 'Detail Pick', 'Per Bulan', 'Metode']) {
      check(`lembar "${wajib}" ada`, nama.includes(wajib), nama.join(', '));
    }
  }

  // 2. Tiap pick muncul di Detail Pick. Laporan yang diam-diam kehilangan baris
  //    memberi winrate atas sampel yang bukan sampelnya.
  {
    const s = wb.getWorksheet('Detail Pick')!;
    const teks: string[] = [];
    s.eachRow((row) => row.eachCell((c) => teks.push(String(c.value ?? ''))));
    for (const kode of ['AAAA', 'BBBB', 'CCCC']) {
      check(`${kode} muncul di Detail Pick`, teks.includes(kode));
    }
  }

  // 3. Lembar Metode harus menyebut batasan yang menggeser angkanya. Ini bukan
  //    pemeriksaan gaya bahasa: tiap frasa di sini menandai satu keputusan yang
  //    mengubah winrate, dan sebuah workbook yang membawa angka tanpa
  //    keputusannya adalah cara sebuah pengukuran berubah jadi klaim.
  {
    const s = wb.getWorksheet('Metode')!;
    const isi: string[] = [];
    s.eachRow((row) => row.eachCell((c) => isi.push(String(c.value ?? ''))));
    const semua = isi.join(' \n ').toLowerCase();

    const wajibSebut: [string, string][] = [
      ['posisi terbuka dikecualikan', 'masih berjalan tidak masuk winrate'],
      ['ambang minimum sebelum winrate dicetak', 'winrate tidak dicetak sebelum'],
      ['biaya dan slippage tidak dihitung', 'slippage'],
      ['dua populasi jurnal dipisah', 'dua populasi'],
      ['bias backfill disebut arahnya', 'optimis'],
      ['versi aturan dicatat', 'aturan berubah'],
    ];
    for (const [label, frasa] of wajibSebut) {
      check(`Metode menyebut: ${label}`, semua.includes(frasa.toLowerCase()),
        `frasa "${frasa}" tidak ditemukan`);
    }

    // Klaim yang SUDAH TIDAK BENAR harus hilang. Sampai 2026-09-03 lembar ini
    // masih berbunyi "Tidak ada backfill" — persis jenis pernyataan basi yang
    // lembar ini ada untuk mencegah, dan ia hidup di berkas yang dibagikan.
    check('Metode tidak lagi mengklaim "tidak ada backfill"',
      !semua.includes('tidak ada backfill'),
      'klaim basi masih ada di lembar Metode');

    // LEMBAR INI HARUS MENYEBUT TIAP SUMBER YANG ADA, dan daftarnya diturunkan
    // dari PICK_SOURCES alih-alih diketik ulang, supaya menambah layar baru
    // MEMBUAT tes ini gagal sampai lembarnya ikut diperbarui.
    //
    // Bukan kehati-hatian teoretis. Pada 2026-09-03 sumber `radar:peristiwa`
    // ditambahkan ke jurnal, dan tiga tempat sekaligus terus berbunyi "layar
    // Screener dan Watchlist": subjudul panel jurnal, deskripsi di dalam
    // picks.json, dan baris ini. Semuanya lolos typecheck, tes, dan backtest,
    // karena kalimat yang salah tidak pernah melempar apa pun. Yang menemukannya
    // cuma membaca layarnya.
    for (const src of PICK_SOURCES) {
      // Bagian setelah "·" adalah yang membedakan satu sumber dari sumber lain;
      // "Screener" sendirian dipakai bertiga dan tidak membuktikan apa-apa.
      const penanda = (src.label.split('·').pop() || src.label).trim().toLowerCase();
      check(`Metode menyebut sumber "${src.label}"`, semua.includes(penanda),
        `penanda "${penanda}" tidak ada di lembar Metode`);
    }
  }

  // 4. Lingkup bulanan benar-benar menyaring. Laporan berlabel September yang
  //    memuat Agustus adalah laporan yang salah dengan judul yang meyakinkan.
  {
    const sep = await buildPickWorkbook(picks, [summary({})], { ...META, month: '2026-09' });
    const s = sep.getWorksheet('Detail Pick')!;
    const teks: string[] = [];
    s.eachRow((row) => row.eachCell((c) => teks.push(String(c.value ?? ''))));
    check('lingkup bulan membuang sesi di luar bulan itu', !teks.includes('AAAA'),
      'AAAA dari Agustus ikut masuk laporan September');
    check('lingkup bulan menyimpan sesi di dalamnya',
      teks.includes('BBBB') && teks.includes('CCCC'));
  }

  // 5. Nama berkas memuat lingkupnya, supaya dua unduhan tidak saling menimpa
  //    dan supaya bulan mana yang di dalamnya terbaca tanpa membuka.
  {
    check('nama berkas bulanan memuat bulannya',
      pickReportFilename({ ...META, month: '2026-09' }).includes('2026-09'),
      pickReportFilename({ ...META, month: '2026-09' }));
    check('nama berkas penuh memuat rentangnya',
      pickReportFilename(META).includes('2026-08-01') && pickReportFilename(META).includes('2026-09-30'),
      pickReportFilename(META));
  }

  // 6. Workbook kosong tetap terbentuk. Bulan tanpa pick adalah keadaan yang
  //    wajar di awal, dan laporan yang melempar di situ terbaca seperti bug.
  {
    let lempar = false;
    try {
      const kosong = await buildPickWorkbook([], [], META);
      check('workbook kosong tetap punya lembar Metode',
        kosong.worksheets.some((w) => w.name === 'Metode'));
    } catch {
      lempar = true;
    }
    check('tidak melempar saat tidak ada pick', !lempar);
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
