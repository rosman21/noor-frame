// Entry point. The core goes first; feature modules then attach to window.App in this order.
import './core/app.js';
import './core/time.js';
import './core/people.js';
import './core/weather.js';
import './core/router.js';
import './core/overlays.js';
import './core/shell.js';
import './device.js';

import './i18n.js';
import './lang.js';
import './settings.js';
import './cities.js';
import './live.js';
import './system.js';
import './shade.js';
import './prayer.js';
import './travel.js';

import './views/home.js';
import './views/calendar.js';
import './views/settings.js';
import './views/ambient.js';

// Optional features load only when the household has switched them on (feature flags from the
// server), so a frame without AI never downloads the AI code.
const optional = { ai: () => import('./brief.js') };
const loaded = new Set();
window.App.on('data', () => {
  for (const f of window.DATA.config?.features || []) {
    if (optional[f] && !loaded.has(f)) { loaded.add(f); optional[f](); }
  }
});

// Opening without a connection (see public/sw.js). Only in the built app: in development the
// worker would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* not allowed here */ }));
}
