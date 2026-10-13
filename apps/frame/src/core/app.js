// The frame's shared namespace. Feature modules attach to window.App and read and write
// window.DATA, so modules stay small and can be loaded in any order after the core.
//
// DATA holds what the screen shows. live.js fills it from the server and keeps a copy in
// localStorage, so a frame that restarts without Wi-Fi still shows the last known day.

function restore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}

const saved = restore('hq-state', {});
const DATA = {
  // One "person" per calendar lane; a family calendar's events belong to everyone.
  people: saved.people || [],
  family: saved.family || { id: 'family', name: 'Family', color: '#111111', rgb: '17 17 17', ink: '#FFFFFF' },
  events: [],
  weather: null,
  prayer: null,
  config: saved.config || null,
};
DATA.ALL = DATA.people.map((p) => p.id);

const listeners = new Map();

const App = {
  state: DATA,
  views: {},
  current: null,
  mode: 'day',

  $: (sel, root) => (root || document).querySelector(sel),
  $$: (sel, root) => [...(root || document).querySelectorAll(sel)],

  // A tiny event bus: 'boot', 'ready', 'second', 'minute', 'data', 'settings', 'mode', 'time', 'net', …
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  },
  emit(name, arg) {
    for (const fn of listeners.get(name) || []) fn(arg);
  },

  esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
};

window.DATA = DATA;
window.App = App;
