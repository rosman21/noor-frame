import { defineConfig } from 'vite';

// Cheap Android frames ship WebView 106, so the build stays within what Chromium 106 runs.
// CSS goes further back (chrome61) on purpose: that WebView rejects 4- and 8-digit hex colours,
// and newer CSS targets let the minifier rewrite rgba() into exactly that form.
export default defineConfig({
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  // `npm run dev` from the repo root starts the API server on :8787; the dev UI proxies to it.
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:' + (process.env.API_PORT || 8787),
      // The phone companion's dev server, so QR codes from this screen work during development.
      '/companion': { target: 'http://localhost:5175', ws: true },
    },
  },
});
