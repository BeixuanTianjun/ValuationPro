/**
 * record-picks.ts — write today's screener and watchlist output to the journal.
 *
 *   npm run picks:record            # refuses while the session is still open
 *   npm run picks:record -- --force # records anyway, stamped as non-final
 *   npm run picks:report            # grade what has been recorded so far
 *
 * The scheduler calls the same function at post-close (see src/server/index.ts),
 * so this exists for catching up a missed day by hand and for verifying the
 * recorder without waiting for 16:15 WIB.
 */
import { join } from 'node:path';
import { loadMarketDatabaseFromDisk } from '../src/server/marketFromDisk';
import { journalPathFor, readJournal, recordTodaysPicks } from '../src/server/pickRecorder';
import {
  MIN_RESOLVED_FOR_WINRATE,
  buildPickSummaries,
  evaluatePick,
  EvaluatedPick,
} from '../src/models/pickJournal';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'public', 'data', 'idx');
const JOURNAL = journalPathFor(ROOT);

const argv = process.argv.slice(2);
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '–');

async function main() {
  if (!argv.includes('--report-only')) {
    const r = await recordTodaysPicks(DATA_DIR, JOURNAL, { force: argv.includes('--force') });
    console.log(`sesi ${r.session} · pasar ${r.marketState} · penutupan final: ${r.final ? 'ya' : 'BELUM'}`);
    console.log(r.note);
    if (r.added) {
      for (const [source, n] of Object.entries(r.bySource)) console.log(`   ${source.padEnd(22)} ${n}`);
    }
    console.log(`total pick di jurnal: ${r.total}`);
  }

  // ---- grade whatever is in there -----------------------------------------
  const [db, file] = await Promise.all([loadMarketDatabaseFromDisk(DATA_DIR), readJournal(JOURNAL)]);
  if (!file.picks.length) {
    console.log('\nJurnal masih kosong — belum ada yang bisa dinilai.');
    return;
  }

  const rows = file.picks
    .map((p) => evaluatePick(p, db))
    .filter((r): r is EvaluatedPick => r !== null);

  console.log(`\n════════ HASIL SEMENTARA ════════`);
  // Versi aturan yang tercampur, kalau ada. Ditulis di sini dan bukan cuma di
  // komentar sumber, karena aturan yang tidak pernah muncul di layar adalah
  // aturan yang akan dilupakan tepat ketika ia mulai penting.
  const versions = new Map<number, number>();
  for (const p of file.picks) {
    const v = p.rulesVersion ?? 1;
    versions.set(v, (versions.get(v) ?? 0) + 1);
  }
  if (versions.size > 1) {
    const parts = [...versions.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([v, n]) => `v${v}: ${n}`)
      .join(' · ');
    console.log('');
    console.log(`PERHATIAN — jurnal memuat lebih dari satu versi aturan (${parts}).`);
    console.log('Lihat RULES_VERSION di src/models/pickJournal.ts untuk apa yang berubah di tiap');
    console.log('versi, dan sumber mana yang terbukti identik antar-versi sehingga tetap boleh');
    console.log('digabung.');
  }

  console.log(`dicatat sejak ${file.startedOn} · ${file.picks.length} pick · ${rows.length} bisa dinilai\n`);
  console.log('sumber                    pick  selesai  terbuka   winrate  expectancy  median 1b  median 3b');
  const { summaries, backfillSummaries, provisionalExcluded } = buildPickSummaries(rows);
  const line = (s: (typeof summaries)[number]) => {
    const wr =
      s.resolved >= MIN_RESOLVED_FOR_WINRATE
        ? `${(s.winRate * 100).toFixed(0)}%`.padStart(7)
        : 'belum'.padStart(7);
    console.log(
      `  ${s.label.padEnd(24)}${String(s.picks).padStart(4)}${String(s.resolved).padStart(9)}` +
        `${String(s.open).padStart(9)}${wr}` +
        `${(Number.isFinite(s.expectancyR) ? s.expectancyR.toFixed(2) + 'R' : '–').padStart(12)}` +
        `${pct(s.medianReturn1m, 1).padStart(11)}${pct(s.medianReturn3m, 1).padStart(11)}`
    );
  };

  // Dua tabel, tidak pernah satu. Menjumlahkan keduanya menghasilkan angka yang
  // tidak menjawab pertanyaan apa pun — alasannya ada di atas buildPickSummaries.
  console.log('');
  console.log('-- DICATAT HARIAN --');
  if (summaries.length) summaries.forEach(line);
  else console.log('  (belum ada)');

  if (backfillSummaries.length) {
    console.log('');
    console.log('-- DIISI DARI SEJARAH (npm run picks:backfill) --');
    backfillSummaries.forEach(line);
    console.log('');
    console.log('  Angka di blok ini OPTIMIS. Universe-nya universe HARI INI, jadi emiten');
    console.log('  yang sudah delisting tidak pernah bisa terpilih, dan delisting condong');
    console.log('  ke kegagalan. Pakai sebagai perkiraan kasar, bukan sebagai hasil yang');
    console.log('  setara dengan blok di atasnya.');
  }

  if (provisionalExcluded) {
    console.log(
      `
${provisionalExcluded} catatan sementara (dicatat saat sesi masih berjalan) DIKECUALIKAN dari angka di atas.`
    );
  }

  const resolved = rows.filter((r) => r.resolved && r.entryIsFinalClose).length;
  if (resolved < MIN_RESOLVED_FOR_WINRATE) {
    console.log(
      `\nWinrate belum dicetak: baru ${resolved} pick yang selesai, ambang ${MIN_RESOLVED_FOR_WINRATE}. ` +
        `Angka dari sampel sekecil itu bergerak belasan poin karena satu trade saja.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
