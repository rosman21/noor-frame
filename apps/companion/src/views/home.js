// The overview: every household setting group, calendars, optional features and devices.

import { get, post } from '../api.js';
import { page, link, esc, icon, toast, busy, $$ } from '../ui.js';

// Which settings group is which card, in order. Optional integrations get their own list below.
const GROUPS = [
  ['prayer-aladhan', 'Prayer times', 'moonstar'],
  ['athan', 'Athan & reminder', 'volume'],
  ['quran-alquran-cloud', 'Ayah of the day', 'book'],
  ['weather-open-meteo', 'Weather', 'partly'],
  ['display', 'Screens', 'home'],
];

function summary(integ) {
  const v = Object.fromEntries(integ.settings.map((s) => [s.key, s]));
  const label = (key) => {
    const s = v[key];
    if (!s) return '';
    const o = s.options?.find((x) => String(x.value) === String(s.value ?? s.default));
    return o ? o.label : s.value ?? s.default ?? '';
  };
  switch (integ.id) {
    case 'prayer-aladhan': return [label('method'), label('school')];
    case 'athan': return [v.enabled?.value === false ? 'Off' : 'On', `Reminder ${v.reminderMinutes?.value ?? 10} min before`];
    case 'quran-alquran-cloud': return [label('translation'), label('reciter')];
    case 'weather-open-meteo': return [label('units'), ''];
    case 'display': return [`Theme: ${label('theme')}`, `Menu: ${label('nav')}`];
    default: return [integ.description, ''];
  }
}

export async function homePage(app) {
  const [{ integrations }, cfg, cals, { devices }] = await Promise.all([get('/api/settings'), get('/api/config'), get('/api/calendars'), get('/api/devices')]);
  const waiting = devices.filter((d) => !d.approved).length;
  const byId = Object.fromEntries(integrations.map((i) => [i.id, i]));
  const loc = cfg.location || {};
  const optional = integrations.filter((i) => i.optional);
  const visibleCals = cals.calendars.filter((c) => !c.hidden);

  app.innerHTML = page({
    label: 'Household',
    title: `${esc(loc.name || 'Your home')} <i>${esc(loc.region || loc.country || '')}</i>`,
    body: `
      ${cfg.ai?.chat ? `<a class="card ask-card" href="#/ask">${icon('sun', 26)}<span><b>Ask the frame</b><small>“Who has something on tomorrow morning?”</small></span>${icon('right', 20)}</a>` : ''}
      <section class="card">
        ${link('#/location', `${icon('pin', 18)}Location`, esc(loc.name || 'Not set'), esc(loc.timezone || ''))}
        ${GROUPS.filter(([id]) => byId[id]).map(([id, title, ic]) => {
          const [a, b] = summary(byId[id]);
          return link(`#/section/${id}`, `${icon(ic, 18)}${esc(title)}`, esc(a), esc(b));
        }).join('')}
      </section>

      <h2 class="sub">Calendars</h2>
      <section class="card">
        ${link('#/calendars', `${icon('calendar', 18)}On the frame`,
          `<span class="dots">${visibleCals.slice(0, 8).map((c) => `<i style="background:${esc(c.color)}"></i>`).join('')}</span> ${visibleCals.length}`,
          esc(visibleCals.map((c) => c.name).join(', ') || 'None yet'))}
        <a class="row row--action" href="#/calendars/add">${icon('plus', 20)}<b>Add calendars</b></a>
      </section>

      <h2 class="sub">Optional features</h2>
      <section class="card">
        ${optional.map((i) => `<div class="row row--toggle">
          <a class="row-main" href="#/section/${i.id}"><b>${esc(i.name)}</b><small>${esc(i.description)}</small></a>
          <label class="switch"><input type="checkbox" data-integration="${i.id}" ${i.enabled ? 'checked' : ''}><i></i></label>
        </div>`).join('') || '<p class="muted">None installed.</p>'}
      </section>

      <h2 class="sub">Screens and phones</h2>
      <section class="card">${link('#/devices', `${icon('person', 18)}Devices`,
        waiting ? `<span class="waiting">${waiting} waiting for approval</span>` : 'Approve, rename, remove', '')}</section>
      <p class="foot">Changes apply to every screen in the house within a few seconds.</p>`,
  });

  for (const box of $$('[data-integration]', app)) {
    box.addEventListener('change', () => busy(box, async () => {
      await post('/api/integrations', { id: box.dataset.integration, enabled: box.checked });
      toast(`${byId[box.dataset.integration].name} ${box.checked ? 'on' : 'off'}`);
    }).catch(() => { box.checked = !box.checked; }));
  }
}
