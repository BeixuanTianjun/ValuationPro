/**
 * radar-forward.ts — apakah Radar Peristiwa benar-benar mendahului harga?
 *
 *   npm run radar:forward
 *   npm run radar:forward -- --horizon 21 --min-sessions 60
 *
 * ── KENAPA ALAT INI DIBANGUN SEBELUM DATANYA ADA ─────────────────────────
 *
 * Arsip pengumuman baru mulai menumpuk 3 September 2026. Sebelum itu
 * announcements.json adalah jendela bergulir 45 hari yang ditimpa tiap hari,
 * jadi tidak ada riwayat untuk diuji dan alat ini akan menjawab "belum cukup"
 * selama berbulan-bulan.
 *
 * Itu justru alasannya dibangun sekarang. Kalau ia baru ditulis nanti ketika
 * datanya sudah tebal, ia akan ditulis oleh orang yang sudah melihat hasilnya —
 * dan setiap pilihan di dalamnya, horizon mana, pembanding apa, ambang berapa,
 * akan diambil dengan mengetahui pilihan mana yang memberi angka lebih enak.
 * Menuliskan aturannya sekarang, saat hasilnya belum bisa dilihat siapa pun,
 * adalah satu-satunya cara membuatnya jujur.
 *
 * ── APA YANG DIUKUR ──────────────────────────────────────────────────────
 *
 * Untuk tiap sesi bursa di dalam arsip, radar dibangun ULANG seolah hari itu:
 * database dipotong ke penutupan sesi tersebut dan pengumuman dipotong ke
 * tanggal yang sama, memakai `sliceMarketDatabase` dan `sliceAnnouncements`
 * yang sudah dipakai backfill jurnal. Baris yang muncul lalu diikuti ke depan.
 *
 * PEMBANDINGNYA SESAMA HARI, bukan nol. Sebuah nama yang naik 6% dalam sebulan
 * di pasar yang naik 6% tidak membuktikan apa-apa, dan menghitung return apa
 * adanya akan memuji radar untuk kenaikan pasar. Tiap baris dibandingkan
 * terhadap median emiten likuid pada SESI YANG SAMA, jadi yang dilaporkan
 * selisihnya.
 *
 * ── KENAPA IA MENOLAK MENJAWAB ───────────────────────────────────────────
 *
 * Radar mengeluarkan sekitar tiga sampai lima nama sehari. Dengan horizon tiga
 * bulan, dua nama dari sesi yang berdekatan berbagi hampir seluruh jendelanya,
 * jadi seratus baris TIDAK berarti seratus pengamatan bebas. t-statistik atas
 * jendela yang tumpang tindih pernah menipu sesi ini sendiri dengan faktor
 * tujuh: -10,5 menjadi -1,6 setelah dihitung ulang atas jendela terpisah.
 *
 * Jadi alat ini menghitung N EFEKTIF — banyaknya jendela yang tidak saling
 * tumpang tindih — dan menolak mencetak kesimpulan di bawah `--min-effective`.
 * "Belum bisa dijawab" adalah keluaran yang benar, dan ia dicetak sekeras
 * kesimpulan apa pun.
 */
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { sliceMarketDatabase } from '../src/data/marketSlice';
import { sliceAnnouncements } from '../src/models/contextSlice';
import { buildEventRadar } from '../src/models/eventRadar';
import type { AnnouncementsFile, RawAnnouncement } from '../src/models/announcements';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'public', 'data', 'idx');
const ARCHIVE_DIR = join(DATA_DIR, 'announcements-archive');

const argv = process.argv.slice(2);
const argVal = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
};

/** Sesi ke depan yang dinilai. 21 sesi ~ satu bulan bursa. */
const HORIZON = argVal('--horizon', 21);
/** Minimum jendela yang tidak tumpang tindih sebelum apa pun disimpulkan. */
const MIN_EFFECTIVE = argVal('--min-effective', 12);
/** Lantai likuiditas pembanding, supaya median tidak ditarik saham mati. */
const MIN_VALUE = 1e9;

const pct = (v: number, d = 2) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–';

function median(a: number[]): number {
  if (!a.length) return NaN;
  const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

async function readArchive(): Promise<RawAnnouncement[]> {
  let names: string[];
  try {
    names = (await readdir(ARCHIVE_DIR)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f));
  } catch {
    return [];
  }
  const all: RawAnnouncement[] = [];
  for (const n of names) {
    try {
      const rows = JSON.parse(await readFile(join(ARCHIVE_DIR, n), 'utf8'));
      if (Array.isArray(rows)) all.push(...rows);
    } catch {
      /* satu berkas bulanan yang rusak tidak boleh membatalkan seluruh uji */
    }
  }
  return all;
}

interface Baris {
  session: string;
  index: number;
  code: string;
  score: number;
  ret: number;
  /** Return dikurangi median emiten likuid pada sesi yang sama. */
  excess: number;
}

async function main() {
  const db = await loadMarketDatabaseFromDisk(DATA_DIR);
  const arsip = await readArchive();

  console.log(`\n═══ UJI MAJU RADAR PERISTIWA ═══\n`);
  if (!arsip.length) {
    console.log('Arsip pengumuman kosong. Jalankan "npm run data:announcements" dulu.');
    return;
  }

  const tanggal = [...new Set(arsip.map((a) => a.date))].sort();
  console.log(`arsip     : ${arsip.length.toLocaleString('id-ID')} pengajuan · ${tanggal.length} hari · ${tanggal[0]} → ${tanggal[tanggal.length - 1]}`);
  console.log(`horizon   : ${HORIZON} sesi`);

  // Berkas pengumuman lengkap yang nanti dipotong per sesi. `pdfBase` dan
  // teman-temannya tidak dipakai penilaian, tapi bentuknya harus utuh supaya
  // `sliceAnnouncements` dan `buildEventRadar` melihat berkas yang sama seperti
  // yang dilihat aplikasi.
  const penuh: AnnouncementsFile = {
    generatedAt: new Date().toISOString(),
    from: tanggal[0],
    to: tanggal[tanggal.length - 1],
    count: arsip.length,
    emitenCount: new Set(arsip.map((a) => a.code)).size,
    source: 'arsip announcements-archive',
    pdfBase: '',
    scope: 'uji maju',
    announcements: arsip,
  };

  // Sesi bursa yang punya arsip DAN punya cukup sesi ke depan untuk dinilai.
  const mulai = db.dates.findIndex((d) => d >= tanggal[0]);
  const akhir = db.dates.length - 1 - HORIZON;
  const sesi: number[] = [];
  for (let i = Math.max(0, mulai); i <= akhir; i++) {
    if (db.dates[i] <= penuh.to) sesi.push(i);
  }
  console.log(`sesi diuji: ${sesi.length} (yang punya ${HORIZON} sesi ke depan)\n`);

  if (!sesi.length) {
    console.log('BELUM BISA DIJAWAB — arsipnya belum melewati satu horizon penuh.');
    console.log(`Uji pertama baru mungkin setelah ${HORIZON} sesi bursa berlalu sejak ${tanggal[0]}.`);
    return;
  }

  const baris: Baris[] = [];
  for (const i of sesi) {
    const potongDb = sliceMarketDatabase(db, i);
    const potongAnn = sliceAnnouncements(penuh, db.dates[i]);
    const radar = buildEventRadar(potongDb, potongAnn);
    if (!radar.rows.length) continue;

    // Pembanding sesi yang sama: median return emiten yang bisa diperdagangkan.
    const kontrol: number[] = [];
    for (const [code, s] of db.series) {
      const a = s.close[i];
      const b = s.close[i + HORIZON];
      if (!(a > 0) || !(b > 0)) continue;
      const q = potongDb.daily.get(code);
      if (!q || !(q.value > MIN_VALUE)) continue;
      kontrol.push(b / a - 1);
    }
    const dasar = median(kontrol);
    if (!Number.isFinite(dasar)) continue;

    for (const r of radar.rows) {
      const s = db.series.get(r.code);
      if (!s) continue;
      const a = s.close[i];
      const b = s.close[i + HORIZON];
      if (!(a > 0) || !(b > 0)) continue;
      const ret = b / a - 1;
      baris.push({ session: db.dates[i], index: i, code: r.code, score: r.score, ret, excess: ret - dasar });
    }
  }

  if (!baris.length) {
    console.log('BELUM BISA DIJAWAB — radar tidak mengeluarkan satu baris pun yang bisa diikuti ke depan.');
    return;
  }

  // N EFEKTIF: sapu maju, ambil baris hanya kalau jendelanya tidak menyentuh
  // jendela yang sudah diambil. Inilah jumlah pengamatan yang benar-benar bebas.
  const urut = baris.slice().sort((x, y) => x.index - y.index);
  const bebas: Baris[] = [];
  let batas = -1;
  for (const b of urut) {
    if (b.index > batas) {
      bebas.push(b);
      batas = b.index + HORIZON;
    }
  }

  console.log(`baris radar terikuti : ${baris.length}`);
  console.log(`emiten berbeda       : ${new Set(baris.map((b) => b.code)).size}`);
  console.log(`N EFEKTIF            : ${bebas.length} jendela tidak tumpang tindih\n`);

  console.log(`median return        : ${pct(median(baris.map((b) => b.ret)))}`);
  console.log(`median vs sesama hari: ${pct(median(baris.map((b) => b.excess)))}`);
  console.log(`  (${baris.filter((b) => b.excess > 0).length} dari ${baris.length} mengalahkan median hari itu)\n`);

  if (bebas.length < MIN_EFFECTIVE) {
    console.log('───────────────────────────────────────────────────────────');
    console.log(`BELUM BISA DIJAWAB. N efektif ${bebas.length}, di bawah minimum ${MIN_EFFECTIVE}.`);
    console.log('');
    console.log('Angka di atas BUKAN kesimpulan. Radar mengeluarkan beberapa nama');
    console.log('sehari dan horizonnya panjang, jadi baris dari sesi yang berdekatan');
    console.log('berbagi hampir seluruh jendelanya — menghitung mereka sebagai');
    console.log('pengamatan terpisah pernah menggelembungkan t-statistik repo ini');
    console.log('tujuh kali lipat.');
    console.log('');
    console.log('Arsip pengumuman menumpuk sejak 2026-09-03. Jalankan lagi setelah');
    console.log('ia lebih dalam; alat ini akan menjawab sendiri kapan ia siap.');
    console.log('───────────────────────────────────────────────────────────');
    return;
  }

  // Hanya dijalankan kalau N efektif memadai. t-statistik dihitung ATAS JENDELA
  // BEBAS saja, bukan atas seluruh baris.
  const x = bebas.map((b) => b.excess);
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, x.length - 1));
  const t = sd > 0 ? mean / (sd / Math.sqrt(x.length)) : NaN;

  console.log('───────────────────────────────────────────────────────────');
  console.log(`ATAS ${x.length} JENDELA BEBAS:`);
  console.log(`  rata-rata kelebihan : ${pct(mean)}`);
  console.log(`  simpangan baku      : ${pct(sd)}`);
  console.log(`  t-statistik         : ${Number.isFinite(t) ? t.toFixed(2) : '–'}`);
  console.log('');
  console.log(Math.abs(t) >= 2
    ? '  |t| >= 2. Layak diperiksa lebih jauh dengan uji permutasi berblok'
      + '\n  (npm run audit:robust), BUKAN dianggap terbukti.'
    : '  |t| < 2. Tidak bisa dibedakan dari nol.');
  console.log('───────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
