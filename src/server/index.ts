// ValuationPro local service: auto-refresh scheduler + small HTTP API.
//
//   npm run auto          build and start
//   http://localhost:8787/api/status
//
// It does two jobs:
//   1. Keeps public/data/idx fresh — live prices during the session, official
//      IDX end-of-day when it lands, fundamentals weekly.
//   2. Emails the stock-pick digest once Sesi I closes and again after the
//      closing auction.
//
// It also backs the emiten chatbot, so the browser never needs an API key.

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';

import {
  computeDailyDigest,
  loadChatContextFromDisk,
  loadFundamentalsFromDisk,
  loadMarketDatabaseFromDisk,
} from './marketFromDisk';
import {
  MailConfig,
  explainMailError,
  readMailConfig,
  renderDigestHtml,
  sendDigest,
  verifyMail,
} from './emailAlert';
import {
  explainTelegramError,
  readTelegramConfig,
  sendTelegramDigest,
} from './telegramAlert';
import {
  SESSION_COOKIE,
  administrator,
  clearedCookie,
  configureAuth,
  hasAnyUser,
  listUsers,
  logIn,
  parseCookies,
  revokeSession,
  sessionCookie,
  signUp,
  userForToken,
  PublicUser,
} from './auth';
import { JobId, dueJobs, nextMilestone, phaseOf, setHolidays, wibNow } from './schedule';
import { journalPathFor, readJournal, recordTodaysPicks } from './pickRecorder';
import { buildPickSummaries, evaluatePick, EvaluatedPick } from '../models/pickJournal';
import { summariseDisclosure, summaryCachePathFor } from './disclosureSummary';
import { answerQuestion, ChatTurn } from './chatApi';

// Resolved from the working directory, not from import.meta.url: this file is
// bundled to .cache/server.mjs, so a path relative to the module would land one
// directory above the project. npm scripts always run from the project root.
const ROOT = process.env.VALUATIONPRO_ROOT || process.cwd();
const DATA_DIR = join(ROOT, 'public', 'data', 'idx');
const DIST_DIR = join(ROOT, 'dist');
// Account store lives outside the served tree so it can never be fetched.
configureAuth(join(ROOT, '.data'));

loadEnv({ path: join(ROOT, '.env') });

const PORT = Number(process.env.PORT || 8787);
/**
 * Loopback only, unless HOST says otherwise.
 *
 * `listen(PORT)` with no host binds every interface, which put the account
 * store, the chatbot and now the portfolio on the local network for anyone who
 * could reach this machine. Nothing here is meant to be a network service: the
 * browser talks to it through Vite's proxy on the same box, and remote access
 * goes through the Vercel deploy or Claude Remote Control, never straight at
 * this port. Binding to 127.0.0.1 is what makes an unauthenticated portfolio
 * route defensible below.
 */
const HOST = process.env.HOST || '127.0.0.1';

const log = (...a: unknown[]) => {
  const w = wibNow();
  console.log(`[${w.date} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')} WIB]`, ...a);
};

// --------------------------------------------------------------- job runner

/**
 * Which run of each job has already completed.
 *
 * Persisted to disk, not just held in memory: a job like `post-close` is due for
 * a wide window after the market shuts, so a service restarted inside that
 * window would re-fire it and send the digest a second time. Keeping the run
 * keys on disk makes "once per window" survive restarts.
 */
const lastRunKeys: Partial<Record<JobId, string>> = {};
const RUN_STATE_FILE = join(ROOT, '.data', 'job-state.json');

async function loadRunState(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(RUN_STATE_FILE, 'utf8')) as Partial<Record<JobId, string>>;
    Object.assign(lastRunKeys, saved);
  } catch {
    /* first run */
  }
}

async function saveRunState(): Promise<void> {
  try {
    await mkdir(dirname(RUN_STATE_FILE), { recursive: true });
    await writeFile(RUN_STATE_FILE, JSON.stringify(lastRunKeys, null, 2));
  } catch {
    /* a failed write only costs a duplicate on the next restart */
  }
}

const history: { at: string; job: string; reason: string; ok: boolean; detail: string }[] = [];
let running = false;

function runScript(script: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', script), ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', (b) => process.stdout.write(b));
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

/**
 * Runs a package.json script, for the jobs whose entry point is TypeScript.
 *
 * `runScript` above spawns node directly on a file in scripts/, which only
 * works for the .mjs ingests. strategy-lab.ts has to be bundled by esbuild
 * first, and its npm script already encodes that two-step. Shelling out to npm
 * reuses that definition instead of duplicating the esbuild invocation here,
 * where it would quietly drift the first time a flag changes.
 */
function runNpm(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows resolves npm through npm.cmd, which needs a shell. The command
      // and argument are fixed constants — nothing external reaches this call.
      shell: true,
    });
    let stderr = '';
    child.stdout.on('data', (b) => process.stdout.write(b));
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm run ${script} exited ${code}: ${stderr.slice(-400)}`))
    );
  });
}

/**
 * Speak a one-line alert, if the voice hook is installed and configured.
 *
 * WHY THE SCHEDULER TALKS AT ALL. A failed ingest is already recorded in
 * `history` and visible on /api/status, but both require someone to go and
 * look. The failure that matters — IDX answering with a Cloudflare challenge,
 * so the official series silently stops growing — is exactly the one nobody
 * looks for, because every screen keeps rendering yesterday's data perfectly.
 *
 * IT IS DELIBERATELY FIRE-AND-FORGET. Detached, stdio ignored, unref'd, and
 * wrapped so a missing script or a broken Node cannot touch the scheduler. A
 * data pipeline must never fail because a speaker did. If the hook is not
 * installed, or FISH_AUDIO_API_KEY is unset, the child exits silently on its
 * own and nothing here notices or cares.
 */
function speakAlert(text: string): void {
  try {
    const script = join(
      process.env.USERPROFILE || process.env.HOME || '',
      '.claude',
      'hooks',
      'speak-alert.mjs'
    );
    const child = spawn(process.execPath, [script, '--text', text], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.on('error', () => {
      /* no voice installed — that is a fine state to be in */
    });
    child.unref();
  } catch {
    /* never let the narrator break the pipeline */
  }
}

function record(job: string, reason: string, ok: boolean, detail: string) {
  history.unshift({ at: new Date().toISOString(), job, reason, ok, detail });
  history.length = Math.min(history.length, 40);
  // Only failures are spoken. Announcing every successful refresh would be a
  // voice going off six times a session saying nothing happened.
  // Spoken in English on purpose: the voice hook speaks English now, and this
  // is the one alert string that lives inside the repo rather than in the hook.
  // `detail` is machine text (an HTTP status, a script name) and is passed
  // through untranslated — inventing an English paraphrase of an error message
  // would put a layer between the owner and what actually failed.
  if (!ok) speakAlert(`ValuationPro job ${job} failed. ${detail.slice(0, 120)}`);
}

/** SMTP settings, addressed to the administrator account when one exists. */
async function resolveMailConfig(): Promise<MailConfig | null> {
  const admin = await administrator();
  return readMailConfig(process.env, admin?.email);
}

async function emailDigest(trigger: string): Promise<string> {
  const cfg = await resolveMailConfig();
  if (!cfg) {
    return 'email dilewati — SMTP belum dikonfigurasi di .env';
  }
  const { screener, watchlist, breadth, db } = await computeDailyDigest(DATA_DIR);
  if (!screener.rows.length && !watchlist.candidates.length) {
    return 'email dilewati — tidak ada yang lolos screener maupun watchlist';
  }
  try {
    const id = await sendDigest(cfg, {
      session: db.meta.latestSession,
      screener,
      watchlist,
      breadth,
      live: db.live,
      trigger,
    });
    return `email terkirim ke ${cfg.to.join(', ')} (${screener.rows.length} lolos screener, ${watchlist.candidates.length} watchlist, id ${id})`;
  } catch (err) {
    // Surfaced rather than swallowed: a scheduled alert that silently fails is
    // worse than no alert, because you believe you are being watched.
    return `email GAGAL ke ${cfg.to.join(', ')} — ${explainMailError(err)}`;
  }
}

/**
 * Kanal kedua, gagal sendiri-sendiri.
 *
 * Dipisahkan dari `emailDigest` dan dipanggil terpisah supaya satu kanal yang
 * mati tidak membungkam yang lain. Seluruh alasan fitur ini ada adalah tidak
 * melewatkan sesi; menggabungkan keduanya dalam satu try akan membuat token
 * Telegram yang kedaluwarsa ikut membatalkan emailnya.
 */
async function telegramDigest(trigger: string): Promise<string> {
  const cfg = readTelegramConfig();
  if (!cfg) return 'telegram dilewati — TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID belum diisi di .env';

  const { screener, watchlist, breadth, db } = await computeDailyDigest(DATA_DIR);
  if (!screener.rows.length && !watchlist.candidates.length) {
    return 'telegram dilewati — tidak ada yang lolos screener maupun watchlist';
  }
  try {
    const id = await sendTelegramDigest(cfg, {
      session: db.meta.latestSession,
      screener,
      watchlist,
      breadth,
      live: db.live,
      trigger,
    });
    return `telegram terkirim (id ${id})`;
  } catch (err) {
    return `telegram GAGAL — ${explainTelegramError(err)}`;
  }
}

async function runJob(id: JobId, reason: string, sendAlert: boolean): Promise<string> {
  switch (id) {
    case 'intraday':
    case 'post-sesi-1':
    case 'post-close': {
      await runScript('ingest-intraday.mjs', ['--quiet']);
      // The wire rides the intraday cycle: RSS is cheap, and a news panel that
      // is an hour stale during the session is the one complaint it cannot
      // survive. A failure here must not cost the price refresh, which is what
      // anybody actually opened the terminal for.
      let news = '';
      try {
        await runScript('ingest-news.mjs');
        news = '; berita diperbarui';
      } catch (err) {
        news = `; berita GAGAL (${(err as Error).message.slice(0, 80)})`;
      }
      // The pick journal is written HERE and only here, at the same point every
      // day, so the sample is the screen's output rather than a record of when
      // somebody happened to look. It runs after the price refresh because it
      // reads what that refresh just wrote, and its failure must not cost the
      // prices or the digest — a missed day of journalling is a gap in a
      // measurement, a missed refresh is a terminal showing yesterday.
      let picks = '';
      if (id === 'post-close') {
        try {
          const r = await recordTodaysPicks(DATA_DIR, journalPathFor(ROOT));
          picks = `; ${r.note}`;
        } catch (err) {
          picks = `; catatan pick GAGAL (${(err as Error).message.slice(0, 80)})`;
        }
      }
      if (!sendAlert) return `harga live diperbarui${news}${picks}`;
      const mail = await emailDigest(reason);
      const tele = await telegramDigest(reason);
      return `harga live diperbarui${news}${picks}; ${mail}; ${tele}`;
    }
    case 'eod': {
      // A short window is enough for the daily catch-up; the per-session cache
      // means already-fetched days cost nothing.
      await runScript('ingest-idx.mjs', ['--days', '20']);
      const n = await refreshHolidays();

      // Announcements moved here from CI-only, and the reason is measured, not
      // theoretical: IDX answers a GitHub runner with a Cloudflare challenge,
      // so `Laporkan crawl IDX yang diblokir` has failed on four of the last
      // five scheduled runs and announcements.json sat 114 hours stale while
      // every screen kept rendering. The same ingest finishes in 54 seconds
      // from this machine, because a home connection is not a datacenter IP.
      // The Watchlist's narrative stage reads this file; without it that stage
      // runs on curated themes alone and quietly loses most of its input.
      let ann = '';
      try {
        await runScript('ingest-announcements.mjs');
        ann = '; pengumuman IDX diperbarui';
      } catch (err) {
        ann = `; pengumuman IDX GAGAL (${(err as Error).message.slice(0, 80)})`;
      }

      // The strategy search re-runs once the session is final, so the
      // leaderboard always reflects the newest bar — and, more importantly, so
      // the out-of-sample window keeps sliding forward. A leaderboard fitted
      // once and never revisited becomes a historical curiosity within weeks.
      // It runs after the ingest because it reads what the ingest just wrote.
      let lab = '';
      try {
        await runNpm('strategy:lab');
        lab = '; strategi di-backtest ulang';
      } catch (err) {
        lab = `; backtest strategi GAGAL (${(err as Error).message.slice(0, 80)})`;
      }
      return `data resmi IDX diperbarui (${n} hari libur diketahui)${ann}${lab}`;
    }
    case 'weekly': {
      // Each step is independent so one failure cannot swallow the rest. The
      // CI weekly run on 2026-08-29 was cancelled partway through the KSEI
      // ownership pull, and because its commit came after that step, NOTHING
      // from that run was ever saved — quotes and ownership then sat 125 hours
      // stale with no sign anything had gone wrong. Sequential-and-fatal is
      // what turned one slow endpoint into four dead feeds.
      const done: string[] = [];
      const failed: string[] = [];
      const step = async (label: string, run: () => Promise<void>) => {
        try {
          await run();
          done.push(label);
        } catch (err) {
          failed.push(`${label} (${(err as Error).message.slice(0, 60)})`);
        }
      };

      await step('rasio valuasi', () => runScript('ingest-quotes.mjs'));
      await step('laporan keuangan', () => runScript('ingest-fundamentals.mjs', ['--concurrency', '3']));
      await step('aktivitas broker', () => runScript('ingest-brokers.mjs', ['--days', '180']));
      // Added here because CI never reached them: the cancelled run above meant
      // ownership had not refreshed since August, and macro/tanker were on no
      // local tier at all.
      await step('kepemilikan KSEI', () => runScript('ingest-ownership.mjs', ['--months', '24']));
      await step('makro global', () => runScript('ingest-macro.mjs', ['--range', '2y']));
      await step('proksi tanker', () => runScript('ingest-tanker.mjs', ['--range', '2y']));

      // Tiga feed di bawah ini sebelumnya tidak ada di tier MANA PUN — bukan di
      // penjadwal ini, bukan di .github/workflows/refresh-data.yml. Satu-satunya
      // cara mereka pernah segar adalah kalau ada yang mengetik npm run secara
      // manual. Diukur 2026-09-02: worldmap 122 jam, gdelt dan risk 107 jam,
      // sementara layar MAP dan RISK terus menggambar seolah tidak ada apa-apa.
      // Sebuah feed tanpa jadwal bukan feed, itu berkas.
      //
      // Ditaruh di tier mingguan, bukan harian, karena ketiganya menarik jendela
      // panjang tiap kali jalan (120 hari, 288 jam, 90 hari) — jeda seminggu
      // tidak meninggalkan lubang di dalam datanya sendiri.
      await step('peta dunia & selat', () => runScript('ingest-worldmap.mjs', ['--days', '120']));
      await step('peristiwa GDELT', () => runScript('ingest-gdelt.mjs', ['--hours', '288']));
      await step('komposit risiko', () => runScript('ingest-risk.mjs', ['--days', '90']));

      return failed.length
        ? `${done.length} diperbarui (${done.join(', ')}); GAGAL: ${failed.join('; ')}`
        : `diperbarui: ${done.join(', ')}`;
    }
  }
}

/**
 * Reload the derived trading-holiday calendar. Called at boot and after every
 * IDX ingest, so a newly-discovered holiday takes effect without a restart.
 */
async function refreshHolidays(): Promise<number> {
  try {
    const meta = JSON.parse(await readFile(join(DATA_DIR, 'meta.json'), 'utf8')) as { holidays?: string[] };
    setHolidays(meta.holidays || []);
    return (meta.holidays || []).length;
  } catch {
    return 0;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  const w = wibNow();
  const due = dueJobs(w, lastRunKeys);
  if (!due.length) return;

  running = true;
  try {
    for (const job of due) {
      log(`▶ ${job.id} — ${job.reason}`);
      try {
        const detail = await runJob(job.id, job.reason, job.sendAlert);
        lastRunKeys[job.id] = job.runKey;
        await saveRunState();
        record(job.id, job.reason, true, detail);
        log(`✔ ${job.id}: ${detail}`);
      } catch (err) {
        record(job.id, job.reason, false, (err as Error).message);
        log(`✖ ${job.id} gagal: ${(err as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

// ------------------------------------------------------------------- server

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('Body terlalu besar'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function fileAge(name: string): Promise<{ exists: boolean; ageMinutes: number; modified: string | null }> {
  try {
    const s = await stat(join(DATA_DIR, name));
    return {
      exists: true,
      ageMinutes: Math.round((Date.now() - s.mtimeMs) / 60000),
      modified: new Date(s.mtimeMs).toISOString(),
    };
  } catch {
    return { exists: false, ageMinutes: -1, modified: null };
  }
}

async function handleStatus(res: ServerResponse, viewer: PublicUser | null) {
  const w = wibNow();
  const files: Record<string, unknown> = {};
  for (const f of ['meta.json', 'intraday.json', 'daily.json', 'history.json', 'fundamentals.json', 'quotes.json', 'brokers.json']) {
    files[f] = await fileAge(f);
  }
  const admin = await administrator();
  const mail = await resolveMailConfig();
  json(res, 200, {
    viewer,
    admin: admin ? { email: admin.email, name: admin.name } : null,
    now: { ...w, phase: phaseOf(w) },
    next: nextMilestone(w),
    running,
    files,
    alerts: {
      configured: !!mail,
      to: mail?.to ?? [],
      recipientSource: admin ? 'akun administrator' : 'ALERT_EMAIL_TO di .env',
      note: mail
        ? null
        : admin
          ? 'Isi SMTP_HOST / SMTP_USER / SMTP_PASS di .env untuk mengaktifkan alert.'
          : 'Isi SMTP_HOST / SMTP_USER / SMTP_PASS / ALERT_EMAIL_TO di .env, atau daftarkan akun administrator.',
    },
    chat: { claudeEnabled: !!process.env.ANTHROPIC_API_KEY },
    history,
  });
}

/**
 * API routes that stay open once accounts exist.
 *
 * Everything else requires a session. `/api/status` is deliberately readable
 * without one so the UI can tell whether anyone has signed up yet and render
 * the right dialog — it returns a stripped shape to anonymous callers.
 */
const OPEN_ROUTES = new Set([
  '/api/auth/signup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  // Prices are the same public market data served statically under /data, so
  // gating them behind a session would protect nothing and break the terminal
  // for a signed-out visitor.
  '/api/live',
  // The portfolio is personal, and it is open for exactly one reason: the
  // service now listens on loopback only, so "open" means open to processes on
  // this machine, which is the same trust boundary as the file itself. Gating
  // it behind a session would mean re-authenticating in every fresh browser
  // profile just to see your own holdings — which is precisely the friction
  // that made localStorage look like the right answer in the first place.
  '/api/portfolio',
  // The pick journal and the disclosure summaries follow the portfolio for the
  // same reason and no other: loopback-only means "open" is open to processes
  // on this machine. Both are read by screens a signed-out visitor can already
  // reach, and a login wall in front of a win-rate table would only teach the
  // owner to stop opening it.
  //
  // The summary route stays POST-only, which is the guard that actually matters
  // here: it is the one route that spends money per call, and POST keeps a
  // prefetch, a crawler or a refresh from triggering it.
  '/api/picks',
  '/api/disclosure-summary',
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    const viewer = await userForToken(token);
    const accountsExist = await hasAnyUser();

    // ---------------------------------------------------------------- auth
    if (url.pathname === '/api/auth/me') {
      return json(res, 200, { user: viewer, accountsExist });
    }

    if (url.pathname === '/api/auth/signup' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        email?: string;
        password?: string;
        name?: string;
      };
      const result = await signUp(body.email || '', body.password || '', body.name || '');
      if (!result.ok) return json(res, result.status, { error: result.error });
      res.setHeader('Set-Cookie', sessionCookie(result.token!));
      log(`akun dibuat: ${result.user!.email} (${result.user!.role})`);
      return json(res, 201, { user: result.user });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { email?: string; password?: string };
      const result = await logIn(body.email || '', body.password || '');
      if (!result.ok) return json(res, result.status, { error: result.error });
      res.setHeader('Set-Cookie', sessionCookie(result.token!));
      return json(res, 200, { user: result.user });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      revokeSession(token);
      res.setHeader('Set-Cookie', clearedCookie());
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/api/auth/users') {
      if (viewer?.role !== 'administrator') return json(res, 403, { error: 'Hanya administrator.' });
      return json(res, 200, { users: await listUsers() });
    }

    // ------------------------------------------------- session requirement
    // Before anyone signs up the API stays open, otherwise a fresh install
    // could never be set up. From the first account onward, it is closed.
    if (
      accountsExist &&
      !viewer &&
      url.pathname.startsWith('/api/') &&
      !OPEN_ROUTES.has(url.pathname) &&
      url.pathname !== '/api/status'
    ) {
      return json(res, 401, { error: 'Silakan masuk terlebih dahulu.' });
    }

    // Parity with the Vercel serverless endpoint: the deployed app quotes on
    // request, so the local one should too rather than always reading the
    // snapshot the scheduler last wrote. Refreshed at most once a minute so a
    // page reload does not re-quote 962 emiten every time.
    if (url.pathname === '/api/live') {
      const file = join(DATA_DIR, 'intraday.json');
      let ageMs = Infinity;
      try {
        ageMs = Date.now() - (await stat(file)).mtimeMs;
      } catch {
        /* not built yet */
      }

      if (ageMs > 60_000 && !running) {
        running = true;
        try {
          await runScript('ingest-intraday.mjs', ['--quiet']);
        } catch {
          /* keep whatever is on disk */
        } finally {
          running = false;
        }
      }

      try {
        const payload = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        payload.onDemand = true;
        payload.source = 'Layanan lokal -> Yahoo Finance (live, ~10 menit delay)';
        return json(res, 200, payload);
      } catch {
        return json(res, 503, { error: 'intraday.json belum ada — jalankan npm run data:intraday' });
      }
    }

    /**
     * Portfolio storage.
     *
     * WHY THIS MOVED OFF localStorage. The first version kept positions in the
     * browser, reasoning that Vercel has no persistent disk and the data is
     * private. Both premises still hold — but the browser Michael actually
     * views this in starts with a clean profile, so every new session lost the
     * portfolio and it had to be typed again. Storage that silently forgets is
     * worse than storage that asks for a setup step.
     *
     * The file is the source of truth when this service is reachable; the
     * client keeps its localStorage copy as a fallback for the deployed static
     * site, where no service exists.
     */
    if (url.pathname === '/api/portfolio') {
      const file = join(ROOT, '.data', 'portfolio.json');
      if (req.method === 'GET') {
        try {
          return json(res, 200, { positions: JSON.parse(await readFile(file, 'utf8')) });
        } catch {
          return json(res, 200, { positions: [] });
        }
      }
      if (req.method === 'PUT') {
        const body = JSON.parse((await readBody(req)) || '{}') as { positions?: unknown };
        if (!Array.isArray(body.positions)) return json(res, 400, { error: 'positions harus array' });
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(body.positions, null, 2));
        return json(res, 200, { ok: true, count: body.positions.length });
      }
      return json(res, 405, { error: 'Pakai GET atau PUT' });
    }

    /**
     * The pick journal, graded on the fly.
     *
     * Graded on read rather than stored: an outcome depends on every session
     * that has happened since, so a cached verdict is wrong by the next close.
     * The file itself only ever holds what was known when the pick was made.
     */
    if (url.pathname === '/api/picks') {
      if (req.method === 'POST') {
        const force = url.searchParams.get('force') === '1';
        const r = await recordTodaysPicks(DATA_DIR, journalPathFor(ROOT), { force });
        return json(res, 200, r);
      }
      const [db, file] = await Promise.all([
        loadMarketDatabaseFromDisk(DATA_DIR),
        readJournal(journalPathFor(ROOT)),
      ]);
      const rows = file.picks
        .map((p) => evaluatePick(p, db))
        .filter((r): r is EvaluatedPick => r !== null);
      const { summaries, backfillSummaries, provisionalExcluded } = buildPickSummaries(rows);

      // Baris tabel HANYA yang dicatat harian, dan itu keputusan ukuran sekaligus
      // keputusan makna. Setelah `npm run picks:backfill` jurnal berisi 22.770
      // baris; mengirim semuanya berarti respons belasan megabyte untuk sebuah
      // tabel yang tidak ada gunanya digulir sejauh itu. Yang lebih penting,
      // baris backfill bukan pengukuran yang sama — lihat buildPickSummaries —
      // jadi mencampurnya dalam satu tabel mengundang pembacaan yang salah.
      // Ringkasannya tetap dikirim, terpisah dan berlabel.
      const livePicks = rows.filter((r) => !r.backfilled);
      return json(res, 200, {
        startedOn: file.startedOn,
        note: file.note,
        latestSession: db.meta.latestSession,
        total: file.picks.length,
        provisionalExcluded,
        summaries,
        backfillSummaries,
        backfillTotal: rows.length - livePicks.length,
        picks: livePicks,
      });
    }

    /**
     * Summarise one disclosure PDF. POST so a summary is never generated by a
     * crawler, a prefetch or an accidental page load — each call reads a
     * document from IDX and spends a model request, and both should happen only
     * when a person asked for this specific filing.
     */
    if (url.pathname === '/api/disclosure-summary' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        code?: string;
        date?: string;
        title?: string;
        pdfUrl?: string;
        key?: string;
      };
      if (!body.pdfUrl || !body.key) return json(res, 400, { error: 'pdfUrl dan key wajib diisi' });
      try {
        const out = await summariseDisclosure(
          {
            code: body.code || '',
            date: body.date || '',
            title: body.title || '',
            pdfUrl: body.pdfUrl,
            key: body.key,
          },
          summaryCachePathFor(ROOT),
          process.env.ANTHROPIC_API_KEY || ''
        );
        return json(res, 200, out);
      } catch (err) {
        // 200 with an `error` field, not a 4xx: the UI shows the reason inline
        // next to the filing, and the reason ("PDF tidak bisa diambil", "key
        // belum diset") is the useful part. A bare status code would put the
        // real explanation in a console nobody has open.
        return json(res, 200, { error: (err as Error).message });
      }
    }

    if (url.pathname === '/api/status') {
      if (accountsExist && !viewer) {
        return json(res, 200, { viewer: null, accountsExist, locked: true });
      }
      return await handleStatus(res, viewer);
    }

    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      if (accountsExist && viewer?.role !== 'administrator') {
        return json(res, 403, { error: 'Hanya administrator yang bisa memicu refresh.' });
      }
      const tier = (url.searchParams.get('tier') || 'intraday') as JobId;
      if (running) return json(res, 409, { error: 'Refresh lain sedang berjalan' });
      running = true;
      try {
        const detail = await runJob(tier, 'Permintaan manual', url.searchParams.get('alert') === '1');
        record(tier, 'Permintaan manual', true, detail);
        if (url.searchParams.get('alert') === '1') {
          lastRunKeys[tier] = wibNow().date;
          await saveRunState();
        }
        return json(res, 200, { ok: true, detail });
      } finally {
        running = false;
      }
    }

    // Renders exactly what would be emailed, without sending. Lets the digest
    // be reviewed before any SMTP credentials exist.
    if (url.pathname === '/api/alert/preview') {
      const { screener, watchlist, breadth, db } = await computeDailyDigest(DATA_DIR);
      const html = renderDigestHtml({
        session: db.meta.latestSession,
        screener,
        watchlist,
        breadth,
        live: db.live,
        trigger: 'Pratinjau',
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/alert/test' && req.method === 'POST') {
      if (accountsExist && viewer?.role !== 'administrator') {
        return json(res, 403, { error: 'Hanya administrator yang bisa mengirim email uji.' });
      }
      const cfg = await resolveMailConfig();
      if (!cfg) return json(res, 400, { error: 'SMTP belum dikonfigurasi di .env' });
      try {
        await verifyMail(cfg);
      } catch (err) {
        return json(res, 502, { error: explainMailError(err) });
      }
      const detail = await emailDigest('Uji coba manual');
      return json(res, detail.includes('GAGAL') ? 502 : 200, { ok: !detail.includes('GAGAL'), detail });
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as { message?: string; history?: ChatTurn[] };
      if (!body.message?.trim()) return json(res, 400, { error: 'Pertanyaan kosong' });
      const [db, fundamentals, chatContext] = await Promise.all([
        loadMarketDatabaseFromDisk(DATA_DIR),
        loadFundamentalsFromDisk(DATA_DIR),
        loadChatContextFromDisk(DATA_DIR),
      ]);
      const answer = await answerQuestion(body.message, body.history || [], db, fundamentals, chatContext);
      return json(res, 200, answer);
    }

    // Serve the built app when dist/ exists, so `npm run auto` is enough to use
    // the whole thing without a separate dev server.
    let filePath = join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      filePath = join(DIST_DIR, 'index.html'); // SPA fallback
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, HOST, async () => {
  await loadRunState();
  const holidayCount = await refreshHolidays();
  const w = wibNow();
  // Resolved exactly the way a real send resolves it, so this line can never
  // advertise a recipient different from the one that will actually be used.
  const mail = await resolveMailConfig();
  const admin = await administrator();
  log(`ValuationPro service aktif di http://localhost:${PORT}`);
  log(`Fase pasar sekarang: ${phaseOf(w)} · berikutnya: ${nextMilestone(w).label} pukul ${nextMilestone(w).atWib} WIB`);
  log(
    mail
      ? `Alert email aktif → ${mail.to.join(', ')} (${admin ? 'akun administrator' : 'ALERT_EMAIL_TO di .env'})`
      : 'Alert email nonaktif (SMTP belum diisi di .env)'
  );
  log(process.env.ANTHROPIC_API_KEY ? 'Chatbot: mesin lokal + Claude' : 'Chatbot: mesin lokal (tanpa Claude)');
  log(`Kalender libur bursa: ${holidayCount} tanggal diketahui dari data ingest`);
  void tick();
});

setInterval(() => {
  void tick();
}, 60_000);
