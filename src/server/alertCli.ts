// Standalone alert sender, for environments with no long-running process.
//
//   node .cache/alert.mjs [--trigger "Sesi I selesai"] [--dry-run]
//
// The scheduler in index.ts is the right tool on a machine that stays on. In CI
// — a GitHub Actions cron, say — there is no process to keep alive, so the
// digest is computed and sent in one shot and the runner exits.
//
// Recipient resolution matches the service exactly: the administrator account
// if one exists on disk, otherwise ALERT_EMAIL_TO. In CI there is no account
// store, so ALERT_EMAIL_TO is what applies.

import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

import { computeDailyDigest } from './marketFromDisk';
import { explainMailError, readMailConfig, sendDigest } from './emailAlert';
import { administrator, configureAuth } from './auth';

const ROOT = process.env.VALUATIONPRO_ROOT || process.cwd();
loadEnv({ path: join(ROOT, '.env') });
configureAuth(join(ROOT, '.data'));

const argv = process.argv.slice(2);
const argVal = (flag: string, dflt: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const DRY_RUN = argv.includes('--dry-run');
const TRIGGER = argVal('--trigger', 'Terjadwal');

async function main() {
  const dataDir = join(ROOT, 'public', 'data', 'idx');
  const { screener, watchlist, breadth, db } = await computeDailyDigest(dataDir);
  const session = db.meta.latestSession;

  console.log(
    `Sesi ${session} · ${screener.rows.length} lolos screener · ${watchlist.candidates.length} kandidat watchlist`
  );
  for (const f of screener.funnel) console.log(`  ${f.label.padEnd(44)} ${f.remaining}`);

  // An empty screener is a real answer on a weak tape, but an email with two
  // empty sections is noise — only skip when BOTH systems come back with
  // nothing.
  if (!screener.rows.length && !watchlist.candidates.length) {
    console.log('Tidak ada yang lolos screener maupun watchlist — email dilewati.');
    return;
  }

  if (DRY_RUN) {
    for (const r of screener.rows.slice(0, 5)) {
      console.log(`  screener ${r.code} Rp ${r.close} · nilai ${(r.valueIdr / 1e9).toFixed(1)} mdr`);
    }
    for (const [i, c] of watchlist.candidates.slice(0, 5).entries()) {
      console.log(`  watchlist #${i + 1} ${c.code} skor ${c.score.toFixed(2)} — ${c.narrative.headline.slice(0, 60)}`);
    }
    console.log('--dry-run aktif: email tidak dikirim.');
    return;
  }

  const admin = await administrator();
  const cfg = readMailConfig(process.env, admin?.email);
  if (!cfg) {
    // A missing mail config in CI is a configuration error, not a soft skip:
    // exiting non-zero makes the workflow go red instead of quietly doing
    // nothing every day.
    console.error(
      'SMTP belum dikonfigurasi. Set SMTP_HOST, SMTP_USER, SMTP_PASS dan ALERT_EMAIL_TO ' +
        '(di CI: sebagai repository secrets).'
    );
    process.exit(1);
  }

  try {
    const id = await sendDigest(cfg, {
      session,
      screener,
      watchlist,
      breadth,
      live: db.live,
      trigger: TRIGGER,
    });
    console.log(`Email terkirim ke ${cfg.to.join(', ')} — id ${id}`);
  } catch (err) {
    console.error(`Pengiriman gagal: ${explainMailError(err)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
