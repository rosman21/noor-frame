// Calendars: what's on the frame, adding new ones by pasting share links, and changing or
// removing them. Each calendar is a lane on the frame in its own colour.

import { get, post } from '../api.js';
import { page, esc, icon, toast, busy, $, $$ } from '../ui.js';

const SOURCE = { phone: 'Added from a phone', config: 'From the settings file', demo: 'Demo calendar' };

export async function calendarsPage(app) {
  const { calendars } = await get('/api/calendars');
  app.innerHTML = page({
    back: '#/', label: 'Calendars', title: 'On the <i>frame</i>',
    body: `
      <section class="card">${calendars.map((c) => `<a class="row" href="#/calendars/${esc(c.id)}">
          <i class="swatch" style="background:${esc(c.color)}"></i>
          <span class="row-v"><b>${esc(c.name)}</b><small>${esc([SOURCE[c.source], c.family ? 'Whole family' : '', c.hidden ? 'Hidden' : ''].filter(Boolean).join(' · '))}</small></span>${icon('right', 20)}</a>`).join('')
        || '<p class="muted">No calendars yet.</p>'}
      </section>
      <a class="btn btn--solid btn--wide" href="#/calendars/add">${icon('plus', 20)}Add calendars</a>`,
  });
}

export async function addCalendarPage(app) {
  const { colors } = await get('/api/calendars');
  // A pairing code from the frame's "Add calendar" QR code lets that frame show what was added.
  const pair = sessionStorage.getItem('noor-pair') || '';
  app.innerHTML = page({
    back: '#/calendars', label: 'Calendars', title: 'Add <i>calendars</i>',
    body: `
      <p class="lead">Paste a calendar’s share link. Each calendar becomes a lane on the frame in its own colour.</p>
      <details class="card help" open><summary>iPhone · Apple Calendar</summary><ol>
        <li>Open the <b>Calendar</b> app and tap <b>Calendars</b> at the bottom.</li>
        <li>Tap <b>ⓘ</b> next to the calendar you want on the frame.</li>
        <li>Turn on <b>Public Calendar</b>, tap <b>Share Link…</b>, then <b>Copy</b>.</li>
        <li>Come back here and paste it below.</li></ol>
        <p class="muted">Anyone with this link can see the calendar, so only share it with the frame.</p></details>
      <details class="card help"><summary>Google Calendar</summary><ol>
        <li>On a computer, open <b>calendar.google.com</b> → <b>Settings</b>.</li>
        <li>Under <b>Settings for my calendars</b>, pick the calendar.</li>
        <li>Under <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b> and paste it below.</li></ol></details>
      <details class="card help"><summary>Outlook</summary><ol>
        <li>On outlook.com: <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li>
        <li>Under <b>Publish a calendar</b>, choose it, pick <b>Can view all details</b> and <b>Publish</b>.</li>
        <li>Copy the <b>ICS</b> link and paste it below.</li></ol></details>
      <form class="card form" id="add">
        <label class="field"><span>Calendar link <small>(several? one per line)</small></span>
          <textarea name="url" rows="4" placeholder="webcal://p123-caldav.icloud.com/published/2/…" autocomplete="off" autocapitalize="off" spellcheck="false" required></textarea></label>
        ${navigator.clipboard?.readText ? `<button type="button" class="link-btn" id="paste">${icon('plus', 16)}Paste from clipboard</button>` : ''}
        <label class="field"><span>Name on the frame <small>(optional)</small></span><input name="name" maxlength="30" placeholder="e.g. Family, Aisha, Yusuf"></label>
        <label class="field field--switch"><span>For the whole family<small class="help">Its events show for everyone.</small></span><span class="switch"><input type="checkbox" name="family"><i></i></span></label>
        <fieldset class="field"><legend>Colour</legend><div class="swatches">${colors.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i === 0 ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div></fieldset>
        <button class="btn btn--solid" type="submit">${icon('check', 20)}Add to frame</button>
      </form>
      <div id="added"></div>`,
  });
  $('#paste')?.addEventListener('click', async () => {
    try { $('#add').url.value = (await navigator.clipboard.readText()).trim(); } catch { toast('Couldn’t read the clipboard. Paste into the box instead.'); }
  });
  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    busy(f.querySelector('[type=submit]'), async () => {
      const r = await post('/api/calendars/add', { url: f.url.value, name: f.name.value, color: f.color.value, family: f.family.checked, token: pair || undefined });
      const ok = r.results.filter((x) => !x.error), bad = r.results.filter((x) => x.error);
      $('#added').innerHTML = `<section class="card done">
        ${ok.map((x) => `<p class="added"><i class="swatch" style="background:${esc(x.color)}"></i><b>${esc(x.name)}</b><small>${x.upcoming} events in the next month</small></p>`).join('')}
        ${bad.map((x) => `<p class="error">${esc(x.error)}</p>`).join('')}
        ${ok.length ? '<p class="muted">They’ll appear on every screen in a few seconds.</p>' : ''}</section>`;
      if (ok.length) { f.reset(); toast(ok.length === 1 ? `Added ${ok[0].name}` : `Added ${ok.length} calendars`); }
    }).catch(() => {});
  });
}

export async function calendarPage(app, id) {
  const { calendars, colors } = await get('/api/calendars');
  const c = calendars.find((x) => x.id === id);
  if (!c) { location.hash = '#/calendars'; return; }
  const canRemove = c.source === 'phone';
  app.innerHTML = page({
    back: '#/calendars', label: SOURCE[c.source] || 'Calendar', title: esc(c.name),
    body: `
      <section class="card form">
        <fieldset class="field"><legend>Colour</legend><div class="swatches">${colors.map((col) => `<label><input type="radio" name="color" value="${col}" ${col === c.color ? 'checked' : ''}><i style="background:${col}"></i></label>`).join('')}</div></fieldset>
        <label class="field field--switch"><span>For the whole family<small class="help">Its events show for everyone.</small></span><span class="switch"><input type="checkbox" id="family" ${c.family ? 'checked' : ''}><i></i></span></label>
        ${canRemove ? '' : `<label class="field field--switch"><span>Show on the frame<small class="help">Calendars from the settings file can be hidden, not removed.</small></span><span class="switch"><input type="checkbox" id="shown" ${c.hidden ? '' : 'checked'}><i></i></span></label>`}
      </section>
      ${canRemove ? `<button class="btn btn--danger btn--wide" id="remove">Remove ${esc(c.name)}</button>` : ''}`,
  });
  const update = (patch, el, msg) => busy(el, async () => { await post('/api/calendars/update', { id, ...patch }); toast(msg); }).catch(() => {});
  for (const r of $$('[name=color]', app)) r.addEventListener('change', () => update({ color: r.value }, r, 'Colour changed'));
  $('#family').addEventListener('change', (e) => update({ family: e.target.checked }, e.target, 'Saved'));
  $('#shown')?.addEventListener('change', (e) => update({ hidden: !e.target.checked }, e.target, e.target.checked ? 'Shown' : 'Hidden'));
  $('#remove')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    if (!confirm(`Remove ${c.name} from the frame?`)) return;
    await post('/api/calendars/remove', { id });
    toast(`${c.name} removed`);
    location.hash = '#/calendars';
  }).catch(() => {}));
}
