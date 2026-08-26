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
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
