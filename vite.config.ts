import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = 8787;

/** Resolves true if something is already listening on API_PORT. */
function apiAlreadyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port: API_PORT, host: '127.0.0.1' });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(400, () => done(false));
  });
}

/**
 * "Satu localhost saja." `npm run dev` used to be Vite alone — the proxy
 * below sent /api to a backend nobody started, so every call 500'd until a
 * second terminal ran `npm run auto`. This spawns that backend automatically
 * so the single `npm run dev` origin is fully functional on its own.
 *
 * Probes the port first rather than always spawning: re-running `vite dev`
 * without this checking would either crash on EADDRINUSE or, worse, leave two
 * competing schedulers running. If something already answers on 8787 — a
 * prior dev session's backend, or `npm run auto` started by hand — this plugin
 * gets out of the way and reuses it.
 */
function autoBackend(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: 'valuationpro-auto-backend',
    async configureServer(server) {
      if (await apiAlreadyRunning()) {
        server.config.logger.info('[auto-backend] port 8787 sudah menjawab, memakai yang itu');
        return;
      }
      server.config.logger.info('[auto-backend] menjalankan "npm run auto" di background…');
      // shell:true is required for npm.cmd to spawn correctly on Windows
      // (spawning it directly throws EINVAL). Safe here — the command and
      // args are fixed constants, nothing external ever reaches this call.
      //
      // PORT is forced to API_PORT rather than inherited: some launchers set
      // process.env.PORT to whatever port THEY told Vite to use (5173 here).
      // The backend also reads process.env.PORT (see src/server/index.ts) —
      // inheriting that value silently pointed it at Vite's own port, so it
      // lost the bind to Vite and every /api/* call 500'd with nothing
      // listening on 8787 at all. Overriding it here is what makes the two
      // processes agree on which port is whose.
      child = spawn('npm', ['run', 'auto'], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, PORT: String(API_PORT) },
      });
      server.httpServer?.once('close', () => {
        child?.kill();
        child = null;
      });
    },
  };
}

/*
 * The build stamp.
 *
 * WHY IT EXISTS. "Is the deployed site actually running my last commit?" was
 * asked three times in this repo's short life and every answer was a guess:
 * from a phone there is no view-source, no build log, and a browser that has
 * cached index.html looks exactly like a deploy that never happened. Baking the
 * commit and the build time into the bundle turns that into a fact anybody can
 * read off the screen — the function menu prints it in its footer.
 *
 * Vercel exports VERCEL_GIT_COMMIT_SHA during the build; GitHub Actions exports
 * GITHUB_SHA. Locally there is a git checkout. If all three are missing the
 * stamp says so rather than inventing a value.
 */
function buildStamp(): { sha: string; ref: string; at: string } {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  let sha = fromEnv;
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      sha = '';
    }
  }
  let ref = process.env.VERCEL_GIT_COMMIT_REF || '';
  if (!ref) {
    try {
      ref = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch {
      ref = '';
    }
  }
  return { sha: sha ? sha.slice(0, 7) : 'tanpa-git', ref: ref || 'lokal', at: new Date().toISOString() };
}

const STAMP = buildStamp();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), autoBackend()],
  define: {
    __BUILD_SHA__: JSON.stringify(STAMP.sha),
    __BUILD_REF__: JSON.stringify(STAMP.ref),
    __BUILD_AT__: JSON.stringify(STAMP.at),
  },
  server: {
    // The local service (npm run auto) owns /api: the scheduler, the refresh
    // trigger, and the chatbot. Proxying it here means the dev app behaves
    // exactly like the built one. If the service is not running these calls
    // simply fail and the UI falls back to its in-browser paths.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Recharts and ExcelJS are large and rarely change; splitting them out
        // keeps the app chunk small enough to parse quickly on a cold load.
        // exceljs is deliberately absent: it is dynamically imported at export
        // time, so rollup gives it its own lazily-fetched chunk.
        //
        // WHY A FUNCTION AND NOT `{ charts: ['recharts'], vendor: ['react'] }`.
        // The object form named the entry modules, and rollup put React inside
        // the `charts` chunk anyway — recharts reaches it first — leaving
        // `vendor` empty (vite even said so: "Generated an empty chunk") and
        // React on the critical path behind 560 kB of charting library. Matching
        // on the resolved path instead puts React where it was meant to go, and
        // the order of these tests is what decides the tie.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // vite normalises module ids to forward slashes on every platform, so
          // a plain '/node_modules/' test is enough — no path-separator class.
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor';
          if (/\/node_modules\/(recharts|d3-|victory-)/.test(id)) return 'charts';
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
