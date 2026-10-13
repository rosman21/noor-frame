// One integration's settings as a form, built from the settings it declares (see the integration
// contract in packages/core). New integrations get a working settings page without extra code.
//
//   string → text field · number → number field · boolean → switch · select → dropdown
//   secret → "set, ends in 1234" with replace / remove (never shown) · json with `keys` → one row per key

import { get, post } from '../api.js';
import { page, esc, icon, toast, busy, $, $$ } from '../ui.js';

function field(s) {
  const id = 'f-' + s.key;
  const help = s.help ? `<small class="help">${esc(s.help)}</small>` : '';
  const current = s.value ?? s.default;
  switch (s.type) {
    case 'boolean':
      return `<label class="field field--switch"><span>${esc(s.label)}${help}</span>
        <span class="switch"><input type="checkbox" name="${s.key}" ${current ? 'checked' : ''}><i></i></span></label>`;
    case 'select': {
      const groups = new Map();
      for (const o of s.options || []) {
        const g = o.group || '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(o);
      }
      const opts = [...groups].map(([g, list]) => {
        const items = list.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(current) ? 'selected' : ''}>${esc(o.label ?? o.value)}</option>`).join('');
        return g ? `<optgroup label="${esc(g)}">${items}</optgroup>` : items;
      }).join('');
      return `<label class="field"><span>${esc(s.label)}</span><select name="${s.key}" id="${id}">${opts}</select>${help}</label>`;
    }
    case 'number':
      return `<label class="field"><span>${esc(s.label)}</span><input type="number" inputmode="decimal" name="${s.key}" id="${id}"
        value="${esc(current ?? '')}" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''} step="any">${help}</label>`;
    case 'secret': {
      const v = s.value || {};
      return `<div class="field field--secret" data-secret="${s.key}"><label for="${id}">${esc(s.label)}</label>
        ${v.set ? `<p class="secret-set">${icon('check', 18)}Saved · ends in <b>${esc(v.last4)}</b>${v.fromConfigFile ? ' (from frame.config.json)' : ''}</p>` : '<p class="muted">Not set</p>'}
        <input type="password" name="${s.key}" id="${id}" placeholder="${v.set ? 'Paste a new key to replace it' : 'Paste the key'}" autocomplete="off" autocapitalize="off" spellcheck="false">
        ${v.set && !v.fromConfigFile ? `<button type="button" class="link-btn" data-remove="${s.key}">Remove key</button>` : ''}${help}</div>`;
    }
    case 'json':
      if (Array.isArray(s.keys)) {
        const obj = current || {};
        const rows = s.keys.map((k) => s.valueType === 'boolean'
          ? `<label class="field field--switch field--sub"><span>${esc(k)}</span><span class="switch"><input type="checkbox" data-json="${s.key}" data-k="${esc(k)}" ${obj[k] !== false ? 'checked' : ''}><i></i></span></label>`
          : `<label class="field field--inline field--sub"><span>${esc(k)}</span><input type="number" inputmode="numeric" data-json="${s.key}" data-k="${esc(k)}" value="${esc(obj[k] ?? 0)}" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''}></label>`).join('');
        return `<fieldset class="field field--group"><legend>${esc(s.label)}</legend>${rows}${help}</fieldset>`;
      }
      return `<label class="field"><span>${esc(s.label)}</span><textarea name="${s.key}" rows="3">${esc(JSON.stringify(current ?? {}, null, 1))}</textarea>${help}</label>`;
    default:
      if (s.autocomplete) {
        return `<div class="field field--suggest" data-suggest="${esc(s.autocomplete)}"><label for="${id}">${esc(s.label)}</label>
          <input name="${s.key}" id="${id}" value="${esc(current ?? '')}" ${s.maxLength ? `maxlength="${s.maxLength}"` : ''} autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
          <div class="suggest" id="${id}-list" role="listbox"></div>${help}</div>`;
      }
      return `<label class="field"><span>${esc(s.label)}</span><input name="${s.key}" id="${id}" value="${esc(current ?? '')}" ${s.maxLength ? `maxlength="${s.maxLength}"` : ''} autocomplete="off">${help}</label>`;
  }
}

// What the form says now, for each setting (secrets only when something new was pasted).
function readForm(form, settings) {
  const out = {};
  for (const s of settings) {
    if (s.type === 'secret') {
      const v = form.elements[s.key]?.value.trim();
      if (v) out[s.key] = v;
    } else if (s.type === 'boolean') {
      out[s.key] = form.elements[s.key].checked;
    } else if (s.type === 'json' && Array.isArray(s.keys)) {
      const obj = {};
      for (const el of $$(`[data-json="${s.key}"]`, form)) obj[el.dataset.k] = s.valueType === 'boolean' ? el.checked : Number(el.value) || 0;
      out[s.key] = obj;
    } else if (s.type === 'json') {
      out[s.key] = JSON.parse(form.elements[s.key].value || '{}');
    } else {
      const v = form.elements[s.key]?.value;
      out[s.key] = v === '' ? null : v;
    }
  }
  return out;
}

// An integration's own check (e.g. Travel times → "Check address and routes"): a button, then one
// line per result, with a one-tap fix where the server suggests one.
function checkCard(check) {
  return `<section class="card check" id="check">
    <button class="btn btn--wide" type="button" id="runCheck">${icon('check', 20)}${esc(check.label)}</button>
    <div id="checkResults" aria-live="polite"></div></section>`;
}
const MARK = { true: ['ok', 'check'], false: ['bad', 'x'], null: ['warn', 'bell'] };
function checkResults(items) {
  return items.map((it, i) => {
    const [cls, ic] = MARK[String(it.ok ?? null)];
    return `<div class="check-item check-item--${cls}">${icon(ic, 20)}<div><b>${esc(it.title)}</b>
      ${it.detail ? `<p>${esc(it.detail)}</p>` : ''}
      ${it.fix ? `<button type="button" class="btn btn--small btn--solid" data-fix="${i}">${esc(it.fix.label)}</button>` : ''}</div></div>`;
  }).join('');
}

// Suggestions while typing (a setting with `autocomplete`): asks the server after a pause, shows
// up to five, and fills the field when one is tapped. One session id per visit to the page.
function wireSuggest(box) {
  const input = box.querySelector('input'), list = box.querySelector('.suggest');
  const session = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/[^\w-]/g, '');
  let timer, seq = 0, off = false;
  const close = () => { list.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (off || q.length < 4) return close();
    timer = setTimeout(async () => {
      const mine = ++seq;
      let r;
      try { r = await post(box.dataset.suggest, { input: q, session }); } catch { return; }
      if (mine !== seq) return; // a newer search is on its way
      if (r.note) { off = true; list.innerHTML = `<p class="suggest-note">${esc(r.note)}</p>`; return; }
      if (!r.suggestions.length) return close();
      list.innerHTML = r.suggestions.map((t, i) => `<button type="button" role="option" data-i="${i}">${icon('pin', 18)}<span>${esc(t)}</span></button>`).join('') +
        '<p class="suggest-by">Suggestions from Google</p>';
      input.setAttribute('aria-expanded', 'true');
      for (const b of list.querySelectorAll('[data-i]')) {
        b.addEventListener('click', () => { input.value = r.suggestions[+b.dataset.i]; close(); input.focus(); });
      }
    }, 350);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

export async function sectionPage(app, id, { runCheck = false } = {}) {
  const { integrations } = await get('/api/settings');
  const integ = integrations.find((i) => i.id === id);
  if (!integ) { location.hash = '#/'; return; }
  // Location has its own page (city search); these fields are filled from it.
  const settings = integ.settings.filter((s) => integ.id !== 'location');

  app.innerHTML = page({
    back: '#/', label: integ.optional ? 'Optional feature' : 'Whole house', title: esc(integ.name),
    body: `
      <p class="lead">${esc(integ.description)}</p>
      ${integ.optional ? `<div class="card"><label class="field field--switch"><span><b>Turned ${integ.enabled ? 'on' : 'off'}</b><small class="help">Switch it off and screens stop using it.</small></span>
        <span class="switch"><input type="checkbox" id="enabled" ${integ.enabled ? 'checked' : ''}><i></i></span></label></div>` : ''}
      ${settings.length ? `<form class="card form" id="form">${settings.filter((s) => !s.advanced).map(field).join('')}
        ${settings.some((s) => s.advanced) ? `<details class="advanced"><summary>Advanced</summary>${settings.filter((s) => s.advanced).map(field).join('')}</details>` : ''}
        <button class="btn btn--solid" type="submit">${icon('check', 20)}Save</button></form>` : ''}
      ${integ.check ? checkCard(integ.check) : ''}`,
  });

  if (integ.check) {
    const run = (button) => busy(button, async () => {
      const box = $('#checkResults');
      box.innerHTML = '<p class="muted">Checking…</p>';
      try {
        const { items } = await post(integ.check.path);
        box.innerHTML = checkResults(items);
        for (const b of $$('[data-fix]', box)) {
          const fix = items[+b.dataset.fix].fix;
          b.addEventListener('click', () => busy(b, async () => {
            await post('/api/settings', { integration: id, values: { [fix.key]: fix.value } });
            toast('Saved for every screen');
            sectionPage(app, id, { runCheck: true });
          }).catch(() => {}));
        }
      } catch (err) { box.innerHTML = ''; throw err; }
    }).catch(() => {});
    $('#runCheck').addEventListener('click', (e) => run(e.currentTarget));
    if (runCheck) { run($('#runCheck')); $('#check').scrollIntoView({ block: 'nearest' }); }
  }

  $('#enabled')?.addEventListener('change', (e) => busy(e.target, async () => {
    await post('/api/integrations', { id, enabled: e.target.checked });
    toast(`${integ.name} ${e.target.checked ? 'on' : 'off'}`);
    sectionPage(app, id);
  }).catch(() => { e.target.checked = !e.target.checked; }));

  const form = $('#form');
  if (!form) return;
  for (const box of $$('[data-suggest]', form)) wireSuggest(box);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(form.querySelector('[type=submit]'), async () => {
      let values;
      try { values = readForm(form, settings); } catch { throw new Error('One of the fields isn’t valid.'); }
      await post('/api/settings', { integration: id, values });
      toast('Saved for every screen');
      // With a check (Travel times), check what was just saved straight away.
      sectionPage(app, id, { runCheck: !!integ.check && integ.enabled });
    }).catch(() => {});
  });
  for (const b of $$('[data-remove]', form)) {
    b.addEventListener('click', () => busy(b, async () => {
      if (!confirm('Remove this key? Features that need it will stop working.')) return;
      await post('/api/settings', { integration: id, values: { [b.dataset.remove]: '' } });
      toast('Key removed');
      sectionPage(app, id);
    }).catch(() => {}));
  }
}
