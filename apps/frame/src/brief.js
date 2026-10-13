// The AI daily brief (only when the household has switched the AI on in the companion app).
// After Fajr, the screen fetches the day's brief once, shows its headline as a banner, and keeps
// it for the rest of the day (pull-down menu → Today's brief). Written by Claude from the
// household's calendar, prayer times and weather, and labelled as AI.

const App = window.App, D = window.DATA;
const KEY = 'hq-brief', SEEN = 'hq-brief-seen';

const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full */ } };

const ICON = { prayer: 'moonstar', calendar: 'calendar', travel: 'car', weather: 'partly', family: 'person', reminder: 'bell' };

let fetching = false;
const enabled = () => !!D.config?.ai?.brief;
const today = () => App.ymd(App.now());

// The brief for today, if this screen has it.
App.brief = () => {
  const b = load(KEY);
  return enabled() && b && b.date === today() ? b : null;
};

App.briefSheet = () => {
  const b = App.brief();
  if (!b) return;
  App.sheet(`<div class="sheet-pad brief">
    <div class="label">${App.icon('sun', 18)}${App.t('Today’s brief')}</div>
    <h2 class="serif sheet-h">${App.esc(b.headline)}</h2>
    <ul class="brief-list">${b.items.map((it) => `<li>${App.icon(ICON[it.kind] || 'bell', 26)}<span>${App.esc(it.text)}</span></li>`).join('')}</ul>
    <p class="brief-note">${App.t('Written by AI (Claude) from your calendar, prayer times and weather. Check anything important.')}</p>
  </div>`, { cls: 'sheet--wide' });
};

// After Fajr and before noon: fetch today's brief once and show its headline.
function maybeShow() {
  if (!enabled() || fetching || App.mode !== 'day') return;
  const now = App.now(), fajr = App.prayerDay?.(now)?.list.find((p) => p.name === 'Fajr');
  if (!fajr || now < fajr.time || now.getHours() >= 12) return;
  if (load(SEEN) === today()) return;
  const have = App.brief();
  if (have) return announce(have);
  fetching = true;
  fetch('/api/ai/brief?date=' + today(), { cache: 'no-store' })
    .then((r) => r.json().then((body) => { if (!r.ok) throw new Error(body.error || 'HTTP ' + r.status); return body; }))
    .then((b) => { save(KEY, b); announce(b); })
    .catch(() => { /* not ready (no key, limit reached, offline): try again next minute */ })
    .finally(() => { fetching = false; });
}

function announce(b) {
  save(SEEN, today()); // once a day, whatever is tapped
  App.banner({
    tone: 'ink', icon: 'sun', title: App.esc(b.headline), sub: App.t('Today’s brief'),
    action: App.t('Read'), onAction: App.briefSheet, dismiss: App.t('Later'), ms: 5 * 60000,
  });
}

App.on('minute', maybeShow);
App.on('data', maybeShow);
maybeShow(); // loaded after data arrived, so check straight away
