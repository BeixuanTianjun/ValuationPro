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

import { computeDailyPicks } from './marketFromDisk';
import { explainMailError, readMailConfig, sendDigest } from './emailAlert';
import { administrator, configureAuth } from './auth';
import { StrategyId } from '../types/market';

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
const STRATEGY = (process.env.ALERT_STRATEGY || 'balanced-alpha') as StrategyId;

async function main() {
  const dataDir = join(ROOT, 'public', 'data', 'idx');
  const { result, breadth, briefing, db } = await computeDailyPicks(dataDir, STRATEGY);

  console.log(`Sesi ${result.session} · strategi ${result.strategy.name} · ${result.picks.length} pick`);
  console.log(briefing);

  if (!result.picks.length) {
    console.log('Tidak ada emiten yang lolos filter — email dilewati.');
    return;
  }

  if (DRY_RUN) {
    for (const p of result.picks.slice(0, 5)) {
      console.log(`  #${p.rank} ${p.emiten.code} skor ${p.compositeScore.toFixed(2)} (${p.conviction})`);
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
    const id = await sendDigest(cfg, { result, breadth, briefing, live: db.live, trigger: TRIGGER });
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
