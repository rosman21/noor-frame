// Location: search by town or ZIP/postal code (the server asks Open-Meteo's free geocoder), then
// save it for the whole house. Offers the usual prayer calculation method for that country.

import { get, post } from '../api.js';
import { page, esc, icon, toast, busy, $ } from '../ui.js';
import { METHODS, METHOD_FOR_COUNTRY } from '@noor-frame/prayer-aladhan';

async function search(q) {
  return (await post('/api/location/search', { q, lang: navigator.language?.slice(0, 2) || 'en' })).places;
}

export async function locationPage(app) {
  const cfg = await get('/api/config');
  const loc = cfg.location || {};
  app.innerHTML = page({
    back: '#/', label: 'Location · whole house', title: esc(loc.name || 'Where do you live?'),
    body: `
      <p class="lead">Prayer times, the athan and the weather all use this place.${loc.timezone ? ` Time zone: <b>${esc(loc.timezone)}</b>.` : ''}</p>
      ${loc.source === 'auto' ? '<p class="muted">This was detected from your internet connection, which often shows the nearest big city. Search for your town or ZIP code to be exact.</p>' : ''}
      <form class="card form" id="find">
        <label class="field"><span>Town or ZIP code</span>
          <input name="q" type="search" placeholder="e.g. Springfield, 12345, M5H, Kuala Lumpur" autocomplete="off" enterkeyhint="search" minlength="2" maxlength="80" required></label>
        <button class="btn btn--solid" type="submit">${icon('pin', 20)}Search</button>
      </form>
      <div id="results"></div>`,
  });

  $('#find').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    busy($('#find button'), async () => {
      const hits = await search(q);
      $('#results').innerHTML = hits.length
        ? `<section class="card">${hits.map((h, i) => `<button class="row" data-i="${i}">
            <span class="row-l">${esc(h.country)}</span>
            <span class="row-v"><b>${esc(h.name)}</b><small>${esc([h.postcode, h.area, h.region].filter(Boolean).join(', '))}</small></span>${icon('right', 20)}</button>`).join('')}</section>`
        : `<p class="muted">No places called “${esc(q)}”. Try the nearest bigger town.</p>`;
      for (const b of $('#results').querySelectorAll('[data-i]')) b.addEventListener('click', () => choose(hits[+b.dataset.i], b));
    }).catch(() => {});
  });

  async function choose(h, button) {
    await busy(button, async () => {
      await post('/api/settings', { section: 'location', values: {
        city: h.name, region: h.region || null, country: h.country || null, code: h.code || null,
        latitude: h.latitude, longitude: h.longitude, timezone: h.timezone || null, source: 'search',
      } });
      toast(`Location set to ${h.name}`);
      await suggestMethod(h);
    }).catch(() => {});
  }

  // A sensible prayer calculation method for the country, unless the household picked one.
  async function suggestMethod(h) {
    const rec = METHOD_FOR_COUNTRY[h.code];
    const now = await get('/api/config');
    const chosen = now.saved?.prayer?.includes('method');
    if (rec == null || chosen || now.prayer?.method === rec) { location.hash = '#/'; return; }
    const name = METHODS.find(([v]) => v === rec)?.[1];
    app.innerHTML = page({
      back: '#/', label: 'Prayer times', title: `Use <i>${esc(name)}</i>?`,
      body: `<p class="lead">This calculation method is usual in ${esc(h.country)}. You can change it any time under Prayer times.</p>
        <div class="actions"><a class="btn" href="#/">Keep current</a><button class="btn btn--solid" id="use">${icon('check', 20)}Use it</button></div>`,
    });
    $('#use').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await post('/api/settings', { section: 'prayer', values: { method: rec } });
      toast('Prayer times updated');
      location.hash = '#/';
    }).catch(() => {}));
  }
}
