// Calendars ("people"), their colours, and questions about events.
// Every coloured element gets three CSS variables from pstyle(): --c (the colour), --c-rgb
// (for tints) and --c-ink (text on top). Dark mode swaps in lighter versions (see tokens.css).

import { ICONS } from './icons.js';

const App = window.App, D = window.DATA;

// Play and pause read better solid (media controls); everything else is a line icon.
const SOLID = new Set(['play', 'pause']);
App.icon = (name, size = 24, cls = '') =>
  `<svg class="i${SOLID.has(name) ? ' i--solid' : ''} ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

App.person = (id) => (id === 'family' || id === 'any' ? D.family : D.people.find((p) => p.id === id) || D.family);

const luminance = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
// 18% of the way to white: how calendar colours are lifted on the dark theme.
const lifted = (rgb) => rgb.map((v) => Math.round(v + (255 - v) * 0.18));

App.pstyle = (p) => {
  if (typeof p === 'string') p = App.person(p);
  const rgb = String(p.rgb || '').split(' ').map(Number);
  // Near-black (usually the Family calendar) follows the theme's ink colour.
  if (rgb.length === 3 && luminance(rgb) < 40) return '--c:var(--ink);--c-rgb:var(--ink-rgb);--c-ink:var(--paper)';
  let s = `--c:${p.color};--c-rgb:${p.rgb};--c-ink:${p.ink}`;
  if (rgb.length === 3) { const d = lifted(rgb); s += `;--c-d:rgb(${d.join(',')});--c-drgb:${d.join(' ')}`; }
  return s;
};

// A colour for a small swatch, matching pstyle's dark-mode behaviour.
App.dotColor = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const rgb = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  if (luminance(rgb) < 40) return 'var(--ink)';
  return document.documentElement.dataset.theme === 'dark' ? `rgb(${lifted(rgb).join(',')})` : hex;
};

App.avatar = (p, size = 48, cls = '') => {
  if (typeof p === 'string') p = App.person(p);
  const letter = p.id === 'family' ? '★' : p.name[0];
  return `<span class="avatar ${cls}" style="${App.pstyle(p)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px">${letter}</span>`;
};

App.dots = (ids, size) =>
  `<span class="dots">${ids.map((id) => `<i style="${App.pstyle(id)}${size ? `;width:${size}px;height:${size}px` : ''}"></i>`).join('')}</span>`;

// ------------------------------------------------------------ events
App.events = () => D.events;
App.findEvent = (id) => D.events.find((e) => e.id === id);
// An event for everyone (from a family calendar, or shared by every lane).
App.isFamily = (e) => D.people.length > 1 && e.people.length >= D.people.length;
App.evColor = (e) => (App.isFamily(e) ? D.family : App.person(e.people[0]));

function onDay(day, pid, allDay) {
  const from = App.dayStart(day), to = App.addDays(from, 1);
  return D.events.filter((e) => !!e.allDay === allDay && e.start < to && e.end > from && (!pid || e.people.includes(pid)));
}
App.timedOn = (day, pid) => onDay(day, pid, false).sort((a, b) => a.start - b.start || b.end - a.end);
App.allDayOn = (day, pid) => onDay(day, pid, true);

// When to leave for an event (its start minus travel time).
App.leaveBy = (e) => (e.travel ? new Date(+e.start - e.travel * 60000) : e.start);
// The next thing someone has to act on today: the earliest upcoming "leave by".
App.nextEvent = () => {
  const now = App.now();
  return App.timedOn(now).filter((e) => e.start > now).sort((a, b) => App.leaveBy(a) - App.leaveBy(b))[0] || null;
};
