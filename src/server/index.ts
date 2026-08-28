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

function record(job: string, reason: string, ok: boolean, detail: string) {
  history.unshift({ at: new Date().toISOString(), job, reason, ok, detail });
  history.length = Math.min(history.length, 40);
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

async function runJob(id: JobId, reason: string, sendAlert: boolean): Promise<string> {
  switch (id) {
    case 'intraday':
    case 'post-sesi-1':
    case 'post-close': {
      await runScript('ingest-intraday.mjs', ['--quiet']);
      if (!sendAlert) return 'harga live diperbarui';
      const mail = await emailDigest(reason);
      return `harga live diperbarui; ${mail}`;
    }
    case 'eod': {
      // A short window is enough for the daily catch-up; the per-session cache
      // means already-fetched days cost nothing.
      await runScript('ingest-idx.mjs', ['--days', '20']);
      const n = await refreshHolidays();
      return `data resmi IDX diperbarui (${n} hari libur diketahui)`;
    }
    case 'weekly': {
      await runScript('ingest-quotes.mjs');
      await runScript('ingest-fundamentals.mjs', ['--concurrency', '3']);
      await runScript('ingest-brokers.mjs', ['--days', '180']);
      return 'fundamental, rasio valuasi & aktivitas broker diperbarui';
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

server.listen(PORT, async () => {
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
