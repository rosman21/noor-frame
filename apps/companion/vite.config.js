import { defineConfig } from 'vite';

// Served by the home server at /companion/, next to the dashboard. Built into the dashboard's
// dist folder so one static folder holds both (also for Cloudflare).
export default defineConfig({
  base: '/companion/',
  build: {
    outDir: '../frame/dist/companion',
    emptyOutDir: true,
    target: 'es2020', // phones are recent; this keeps iOS 14+ and Android 9+ browsers happy
  },
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    proxy: { '/api': 'http://localhost:' + (process.env.API_PORT || 8787) },
  },
});
