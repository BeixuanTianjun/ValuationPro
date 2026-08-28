import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
