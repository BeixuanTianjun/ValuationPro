// The monthly Excel report on the pick journal.
//
// ── WHY A "METODE" SHEET IS NOT OPTIONAL HERE ─────────────────────────────
//
// A workbook outlives the screen it came from. Six months from now the number
// in cell C4 will be quoted in a conversation where nobody remembers that open
// positions were excluded, that the stop is checked before the target on a bar
// that touched both, or that recording only began on 2026-09-02. Every one of
// those choices moves the win rate, and a spreadsheet that carries the figure
// without the choices is how a measurement turns into a claim.
//
// So the method sheet ships in the same file as the numbers, and it states the
// limits in the same breath as the results — including the one that matters
// most early on: whether there is enough resolved data to say anything at all.

import ExcelJS from 'exceljs';
import {
  EvaluatedPick,
  MAX_HOLD_SESSIONS,
  MIN_RESOLVED_FOR_WINRATE,
  PickSummary,
  monthOf,
} from './pickJournal';
import { STOP_ATR_MULT, TARGET_ATR_MULT } from './tradeSetup';

const HEADER_FILL = '1B365D';
const SUB_FILL = '2E5B88';

interface ReportMeta {
  startedOn: string;
  latestSession: string;
  /** `YYYY-MM` when the report is scoped to one month, null for everything. */
  month: string | null;
  provisionalExcluded: number;
}

function headerRow(sheet: ExcelJS.Worksheet, row: number, cells: string[], fill = HEADER_FILL) {
  const r = sheet.getRow(row);
  cells.forEach((label, i) => {
    const cell = r.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
  });
  r.height = 26;
}

/**
 * Susun workbook-nya, TANPA menyimpan.
 *
 * Dipisahkan dari `exportPickJournalToExcel` supaya isinya bisa diperiksa di
 * Node. `saveAs` butuh DOM, jadi selama keduanya menyatu satu-satunya cara
 * memeriksa laporan ini adalah mengunduhnya dan membukanya dengan mata —
 * yang berarti ia tidak pernah diperiksa. Perhitungan dan I/O adalah dua hal,
 * dan hanya yang pertama yang punya jawaban benar-salah.
 */
export async function buildPickWorkbook(
  picks: EvaluatedPick[],
  summaries: PickSummary[],
  meta: ReportMeta
): Promise<ExcelJS.Workbook> {
  const scoped = meta.month ? picks.filter((p) => monthOf(p.session) === meta.month) : picks;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ValuationPro';
  workbook.created = new Date();

  // ---------------------------------------------------------------- ringkasan
  const s1 = workbook.addWorksheet('Ringkasan');
  s1.getColumn(1).width = 26;
  for (let c = 2; c <= 10; c++) s1.getColumn(c).width = 13;

  s1.mergeCells('A1:J1');
  const title = s1.getCell('A1');
  title.value = `LAPORAN JURNAL PICK — ${meta.month ?? 'seluruh periode'}`;
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  s1.getRow(1).height = 30;

  s1.getCell('A2').value = `Dicatat sejak ${meta.startedOn || '—'} · sesi terakhir dinilai ${meta.latestSession}`;
  s1.getCell('A2').font = { size: 9, italic: true };

  const totalRow = summaries.find((s) => s.source === 'SEMUA');
  const resolved = totalRow?.resolved ?? 0;
  const verdict =
    resolved >= MIN_RESOLVED_FOR_WINRATE
      ? `Winrate keseluruhan ${((totalRow?.winRate ?? 0) * 100).toFixed(0)}% dari ${resolved} pick yang sudah selesai.`
      : `WINRATE BELUM DAPAT DISIMPULKAN. Baru ${resolved} pick selesai dari ambang ${MIN_RESOLVED_FOR_WINRATE}; angka dari sampel sekecil ini bergeser belasan poin karena satu trade.`;
  s1.mergeCells('A3:J3');
  s1.getCell('A3').value = verdict;
  s1.getCell('A3').font = { bold: true, size: 10, color: { argb: resolved >= MIN_RESOLVED_FOR_WINRATE ? 'FF000000' : 'FF9C4221' } };
  s1.getCell('A3').alignment = { wrapText: true, vertical: 'middle' };
  s1.getRow(3).height = 30;

  headerRow(s1, 5, [
    'Sumber',
    'Pick',
    'Selesai',
    'Berjalan',
    'Menang',
    'Kalah',
    'Winrate',
    'Expectancy (R)',
    'Median 1 bln',
    'Median 3 bln',
  ]);

  let row = 6;
  for (const s of summaries) {
    const r = s1.getRow(row++);
    r.getCell(1).value = s.label;
    r.getCell(2).value = s.picks;
    r.getCell(3).value = s.resolved;
    r.getCell(4).value = s.open;
    r.getCell(5).value = s.wins;
    r.getCell(6).value = s.losses;
    // A win rate below the floor is written as text, not as a number: a number
    // in a spreadsheet gets charted, averaged and quoted, and this one is not
    // ready to be any of those things.
    r.getCell(7).value = s.resolved >= MIN_RESOLVED_FOR_WINRATE ? s.winRate : 'belum cukup data';
    if (s.resolved >= MIN_RESOLVED_FOR_WINRATE) r.getCell(7).numFmt = '0%';
    r.getCell(8).value = Number.isFinite(s.expectancyR) ? s.expectancyR : '–';
    if (Number.isFinite(s.expectancyR)) r.getCell(8).numFmt = '+0.00;-0.00';
    r.getCell(9).value = Number.isFinite(s.medianReturn1m) ? s.medianReturn1m : '–';
    r.getCell(10).value = Number.isFinite(s.medianReturn3m) ? s.medianReturn3m : '–';
    if (Number.isFinite(s.medianReturn1m)) r.getCell(9).numFmt = '+0.0%;-0.0%';
    if (Number.isFinite(s.medianReturn3m)) r.getCell(10).numFmt = '+0.0%;-0.0%';
    if (s.source === 'SEMUA') r.font = { bold: true };
  }

  // ------------------------------------------------------------------- detail
  const s2 = workbook.addWorksheet('Detail Pick');
  const widths = [11, 12, 22, 20, 9, 6, 11, 11, 11, 12, 12, 9, 11, 9, 11, 11, 11];
  widths.forEach((w, i) => (s2.getColumn(i + 1).width = w));
  headerRow(s2, 1, [
    'Sesi',
    'Kode',
    'Nama',
    'Sumber',
    'Skor',
    '#',
    'Entry',
    'Stop',
    'Target',
    'Status',
    'Sesi keluar',
    'Ditahan',
    'Harga keluar',
    'R',
    'Hasil %',
    'Return 1 bln',
    'Return 3 bln',
  ]);

  let d = 2;
  for (const p of [...scoped].sort((a, b) => b.session.localeCompare(a.session) || a.rank - b.rank)) {
    const r = s2.getRow(d++);
    r.getCell(1).value = p.session;
    r.getCell(2).value = p.code;
    r.getCell(3).value = p.name;
    r.getCell(4).value = p.source + (p.entryIsFinalClose ? '' : ' (sementara)');
    r.getCell(5).value = p.score;
    r.getCell(5).numFmt = '0.00';
    r.getCell(6).value = p.rank;
    r.getCell(7).value = p.entry;
    r.getCell(8).value = p.stop;
    r.getCell(9).value = p.target;
    r.getCell(10).value = p.outcome;
    r.getCell(11).value = p.exitSession;
    r.getCell(12).value = p.sessionsHeld;
    r.getCell(13).value = Number.isFinite(p.exitPrice) ? p.exitPrice : '–';
    r.getCell(14).value = Number.isFinite(p.rMultiple) ? p.rMultiple : '–';
    if (Number.isFinite(p.rMultiple)) r.getCell(14).numFmt = '+0.00;-0.00';
    r.getCell(15).value = Number.isFinite(p.returnPercent) ? p.returnPercent : '–';
    r.getCell(16).value = Number.isFinite(p.return1m) ? p.return1m : '–';
    r.getCell(17).value = Number.isFinite(p.return3m) ? p.return3m : '–';
    for (const c of [15, 16, 17]) if (typeof r.getCell(c).value === 'number') r.getCell(c).numFmt = '+0.0%;-0.0%';
    for (const c of [7, 8, 9, 13]) if (typeof r.getCell(c).value === 'number') r.getCell(c).numFmt = '#,##0';
  }
  s2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 17 } };
  s2.views = [{ state: 'frozen', ySplit: 1 }];

  // ---------------------------------------------------------------- per bulan
  const s3 = workbook.addWorksheet('Per Bulan');
  s3.getColumn(1).width = 14;
  for (let c = 2; c <= 6; c++) s3.getColumn(c).width = 13;
  headerRow(s3, 1, ['Bulan', 'Pick', 'Selesai', 'Menang', 'Kalah', 'Winrate'], SUB_FILL);
  const byMonth = new Map<string, EvaluatedPick[]>();
  for (const p of picks) {
    if (!p.entryIsFinalClose) continue;
    const m = monthOf(p.session);
    byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
  }
  let mrow = 2;
  for (const m of [...byMonth.keys()].sort()) {
    const list = byMonth.get(m)!;
    const done = list.filter((p) => p.resolved);
    const wins = done.filter((p) => p.rMultiple > 0).length;
    const r = s3.getRow(mrow++);
    r.getCell(1).value = m;
    r.getCell(2).value = list.length;
    r.getCell(3).value = done.length;
    r.getCell(4).value = wins;
    r.getCell(5).value = done.length - wins;
    r.getCell(6).value = done.length >= MIN_RESOLVED_FOR_WINRATE ? wins / done.length : 'belum cukup data';
    if (done.length >= MIN_RESOLVED_FOR_WINRATE) r.getCell(6).numFmt = '0%';
  }

  // ------------------------------------------------------------------ metode
  const s4 = workbook.addWorksheet('Metode');
  s4.getColumn(1).width = 110;
  const lines: [string, boolean][] = [
    ['BAGAIMANA ANGKA DI BERKAS INI DIHITUNG', true],
    ['', false],
    [`Apa yang dicatat: sepuluh nama teratas dari tiap layar (Screener momentum / antre beli / tertinggal, Watchlist mingguan / bulanan, Radar Peristiwa) pada setiap sesi bursa, diurutkan persis seperti yang ditampilkan layar.`, false],
    [`Kapan dicatat: setelah penutupan, oleh penjadwal, tanpa bergantung pada ada tidaknya orang yang membuka aplikasi. Sesi yang masih berjalan ditolak; kalau ada yang dipaksa masuk, barisnya ditandai "sementara" dan DIKECUALIKAN dari seluruh statistik (${meta.provisionalExcluded} baris pada laporan ini).`, false],
    [`Entry: harga penutupan sesi saat pick dicatat — harga yang benar-benar tercetak.`, false],
    [`Stop dan target: ${STOP_ATR_MULT}x dan ${TARGET_ATR_MULT}x ATR14, sama persis dengan yang dicetak layar. Multiplier ini konvensi, bukan hasil optimasi.`, false],
    [`Cara menilai: berjalan maju sesi demi sesi mulai sesi BERIKUTNYA. Kalau satu sesi menyentuh stop dan target sekaligus, yang dihitung STOP-nya — bar harian tidak bisa mengatakan mana yang lebih dulu, jadi pembacaan paling pesimis yang dipakai.`, false],
    [`Horizon: ${MAX_HOLD_SESSIONS} sesi (±3 bulan). Yang belum kena stop maupun target ditutup di harga pasar dan ditandai "habis waktu".`, false],
    ['', false],
    ['YANG TIDAK DIHITUNG, DAN KENAPA', true],
    [`Posisi yang masih berjalan tidak masuk winrate. Posisi terbuka bukan setengah kemenangan, dan di awal periode hampir semuanya terbuka sementara yang selesai duluan justru yang paling volatil — memasukkannya akan membuat angka awal terlihat jauh lebih baik daripada kenyataannya.`, false],
    [`Winrate tidak dicetak sebelum ${MIN_RESOLVED_FOR_WINRATE} pick selesai. Di bawah itu sel winrate berisi teks, bukan angka, supaya tidak ikut ter-chart atau ter-rata-rata.`, false],
    [`Ada DUA populasi di jurnal ini, dan keduanya tidak boleh dijumlahkan. Baris yang dicatat harian ditulis pada sesinya, sebelum hasilnya diketahui. Baris backfill direkonstruksi dari sejarah oleh "npm run picks:backfill" memakai screener yang sama atas database yang dipotong ke sesi itu. Kalau laporan ini memuat keduanya, angkanya dipisah dan diberi label.`, false],
    [`Angka backfill OPTIMIS, dan arah biasnya diketahui. Universe-nya universe hari ini, jadi emiten yang sudah delisting tidak pernah bisa terpilih — dan delisting condong ke kegagalan, bukan keberhasilan. Rankingnya juga dihitung dari angka resmi IDX, sementara pencatatan harian berjalan di harga intraday karena IDX belum menerbitkan sesinya saat pencatatan.`, false],
    [`Aturan berubah, dan tiap baris membawa versinya. Versi 2 (2 September 2026) menambahkan gerbang runup pada momentum dan menghapus suku freshness dari conviction; versi 3 malam yang sama menambahkan syarat MA200 dan melonggarkan ambang runup ke 25%. Baris berversi berbeda mengukur aturan yang berbeda.`, false],
    [`Biaya transaksi, slippage, dan pajak TIDAK dihitung. Semua angka di sini adalah gerak harga kotor.`, false],
    ['', false],
    ['HUBUNGANNYA DENGAN PAPAN STRATEGI', true],
    [`Papan Strategi menguji aturan mekanis atas 715 sesi riwayat dengan pemisahan train/test, dan untuk pertanyaan "apakah aturan ini bekerja" ia bukti yang lebih kuat. Jurnal ini menjawab pertanyaan yang berbeda: daftar yang benar-benar dicetak terminal ini, dalam urutan yang dipakainya, menghasilkan apa. Keduanya bisa berbeda, dan kalau berbeda, jurnal inilah yang menggambarkan pengalaman pemakainya.`, false],
    ['', false],
    ['Ini catatan hasil, bukan rekomendasi investasi.', true],
  ];
  lines.forEach(([text, bold], i) => {
    const c = s4.getCell(i + 1, 1);
    c.value = text;
    c.font = { bold, size: bold ? 11 : 10 };
    c.alignment = { wrapText: true, vertical: 'top' };
    s4.getRow(i + 1).height = text.length > 110 ? 42 : text.length > 60 ? 28 : 16;
  });

  return workbook;
}

/** Nama berkas unduhan. Diekspor supaya bisa diuji tanpa menyentuh DOM. */
export function pickReportFilename(meta: ReportMeta): string {
  const stamp = meta.month ?? `${meta.startedOn || 'awal'}_${meta.latestSession}`;
  return `ValuationPro_JurnalPick_${stamp}.xlsx`;
}

export async function exportPickJournalToExcel(
  picks: EvaluatedPick[],
  summaries: PickSummary[],
  meta: ReportMeta
) {
  const workbook = await buildPickWorkbook(picks, summaries, meta);
  const buf = await workbook.xlsx.writeBuffer();
  // Diimpor DI SINI, bukan di puncak berkas.
  //
  // `file-saver` butuh DOM, jadi impor tingkat-modul membuat seluruh berkas ini
  // tidak bisa dimuat di Node — termasuk `buildPickWorkbook`, yang tidak
  // menyentuh DOM sama sekali. Selama begitu, laporan ini tidak punya cara
  // diperiksa selain diunduh dan dibaca dengan mata.
  const { saveAs } = await import('file-saver');
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    pickReportFilename(meta),
  );
}
