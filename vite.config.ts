import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
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
