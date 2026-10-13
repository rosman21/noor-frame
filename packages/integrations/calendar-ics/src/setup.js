// Adding calendars without a keyboard on the frame:
//  1. The frame asks for a pairing code (POST /api/pair, in the server) and shows it as a QR code.
//  2. A phone scans it and opens /api/setup?token=…, a small page where the calendar link is pasted.
//  3. The page posts the link (POST /api/setup/calendar). The server checks it is a real
//     calendar, saves it, and the frame (polling /api/pair/status) shows it within seconds.
// Calendars from frame.config.json still work; the frame can hide them or change their colour.

import { json, html, randomToken, escapeHtml as esc } from '@noor-frame/core';
import { validateFeed } from './ics.js';

export const COLORS = ['#2D5BFF', '#E4007C', '#00A36C', '#FFB000', '#7B3FE4', '#FF5A1F', '#0EA5E9', '#111111'];

// ------------------------------------------------------------------ effective calendar list
// Config calendars (minus hidden ones, with colour/family overrides) followed by phone-added ones.
export async function effectiveCalendars(cfg, store) {
  if (!store) return cfg.calendars || [];
  const [added, overrides] = await Promise.all([store.get('calendars'), store.get('calendarOverrides')]);
  const fromConfig = (cfg.calendars || []).map((c) => ({ ...c, ...(overrides?.[c.id] || {}), source: 'config' }));
  return fromConfig.filter((c) => !c.hidden).concat((added || []).map((c) => ({ ...c, source: 'phone' })));
}

export function makeSetup({ validate = validateFeed } = {}) {
  async function listAll(cfg, store) {
    const [added, overrides] = await Promise.all([store.get('calendars'), store.get('calendarOverrides')]);
    const fromConfig = (cfg.calendars || []).filter((c) => c.url).map((c) => {
      const o = overrides?.[c.id] || {};
      return { id: c.id, name: c.name, color: o.color || c.color, family: o.family ?? !!c.family, hidden: !!o.hidden, source: /^demo:/.test(c.url) ? 'demo' : 'config' };
    });
    return fromConfig.concat((added || []).map((c) => ({ id: c.id, name: c.name, color: c.color, family: !!c.family, hidden: false, source: 'phone', added: c.added })));
  }

  // One or more links (one per line). Each becomes its own calendar lane; with several links the
  // names come from the calendars themselves and each gets the next unused colour.
  async function addCalendar(store, cfg, body, signedIn = false) {
    // Allowed with a valid pairing code (the QR on the frame), or from a signed-in phone. When
    // both are there, the frame showing that QR code hears about the new calendars too.
    const pair = body.token ? await store.get('pair:' + body.token) : null;
    if (!pair && !signedIn) return json({ error: 'This QR code has expired. Tap “Add calendar” on the frame again.' }, 403);
    const urls = [...new Set((String(body.url || '').match(/(webcals?:\/\/|https?:\/\/)[^\s<>"]+/gi) || []))];
    if (!urls.length) return json({ error: 'That doesn’t look like a calendar link. It should start with webcal:// or https://' }, 400);
    if (urls.length > 10) return json({ error: 'Add up to 10 calendars at a time.' }, 400);
    const single = urls.length === 1;

    const added = (await store.get('calendars')) || [];
    const taken = new Set(added.map((c) => c.url).concat((cfg.calendars || []).map((c) => c.url)));
    const results = [];
    for (const url of urls) {
      if (taken.has(url)) { results.push({ url, error: 'Already on the frame' }); continue; }
      try {
        const check = await validate(url);
        const overrides = (await store.get('calendarOverrides')) || {};
        const used = added.map((c) => c.color).concat((cfg.calendars || []).filter((c) => !overrides[c.id]?.hidden).map((c) => overrides[c.id]?.color || c.color));
        const cal = {
          id: 'cal-' + randomToken().slice(0, 8),
          name: (single && String(body.name || '').trim().slice(0, 30)) || check.name || 'Calendar ' + (added.length + 1),
          color: single && COLORS.includes(body.color) ? body.color : COLORS.find((c) => !used.includes(c)) || COLORS[added.length % COLORS.length],
          family: !!body.family,
          url,
          added: Date.now(),
        };
        added.push(cal);
        taken.add(url);
        results.push({ url, name: cal.name, color: cal.color, upcoming: check.upcoming });
      } catch (err) {
        results.push({ url, error: 'Couldn’t read a calendar at this link (' + err.message + ')' });
      }
    }
    const ok = results.filter((r) => !r.error);
    if (ok.length) {
      await store.put('calendars', added);
    }
    if (ok.length && pair) {
      pair.added = (pair.added || []).concat(ok.map((r) => r.name));
      await store.put('pair:' + body.token, pair, Math.max(60, Math.round((pair.expires - Date.now()) / 1000)));
    }
    if (!ok.length && single) {
      return json({ error: results[0].error + '. Check it’s the full link and that sharing is turned on.' }, 400);
    }
    return json({ ok: ok.length > 0, results });
  }

  async function update(store, cfg, body) {
    const added = (await store.get('calendars')) || [];
    const own = added.find((c) => c.id === body.id);
    const patch = {};
    if (COLORS.includes(body.color)) patch.color = body.color;
    if (typeof body.family === 'boolean') patch.family = body.family;
    if (own) {
      Object.assign(own, patch);
      await store.put('calendars', added);
      return json({ ok: true });
    }
    if (!(cfg.calendars || []).some((c) => c.id === body.id)) return json({ error: 'Unknown calendar' }, 404);
    if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
    const overrides = (await store.get('calendarOverrides')) || {};
    overrides[body.id] = { ...(overrides[body.id] || {}), ...patch };
    await store.put('calendarOverrides', overrides);
    return json({ ok: true });
  }

  async function remove(store, body) {
    const added = (await store.get('calendars')) || [];
    const left = added.filter((c) => c.id !== body.id);
    if (left.length === added.length) return json({ error: 'Only calendars added from a phone can be removed. Hide the others instead.' }, 400);
    await store.put('calendars', left);
    return json({ ok: true });
  }

  return async function handleSetup(request, ctx) {
    const url = new URL(request.url), p = url.pathname, cfg = ctx.config, store = ctx.store;
    if (!store) {
      const msg = 'Adding calendars from a phone needs storage. On Cloudflare, add a KV namespace named FRAME_KV (see apps/server/wrangler.jsonc).';
      return p === '/api/setup' ? html(page({ error: msg })) : json({ error: msg }, 501);
    }
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

    if (p === '/api/setup') {
      // Only a real pairing code (32 hex characters) is ever put into the page.
      const token = /^[0-9a-f]{32}$/.test(url.searchParams.get('token') || '') ? url.searchParams.get('token') : null;
      const ok = !!token && !!(await store.get('pair:' + token));
      return html(page({ token: ok ? token : null, expired: !ok }));
    }
    if (p === '/api/setup/calendar' && request.method === 'POST') return addCalendar(store, cfg, body);
    if (p === '/api/calendars/add' && request.method === 'POST') return addCalendar(store, cfg, body, !!ctx.device?.approved);
    if (p === '/api/calendars') return json({ calendars: await listAll(cfg, store), colors: COLORS });
    if (p === '/api/calendars/update' && request.method === 'POST') return update(store, cfg, body);
    if (p === '/api/calendars/remove' && request.method === 'POST') return remove(store, body);
    return json({ error: 'Not found' }, 404);
  };
}

// ------------------------------------------------------------------ the phone page
function page({ token, expired, error }) {
  const swatches = COLORS.map((c, i) => `<label class="sw"><input type="radio" name="color" value="${c}"${i === 0 ? ' checked' : ''}><i style="background:${c}"></i></label>`).join('');
  const body = error || expired
    ? `<div class="card"><h2>${expired ? 'This code has expired' : 'Not available'}</h2><p>${esc(error || 'Tap “Add calendar” on the frame again and scan the new code.')}</p></div>`
    : `
  <details class="card help" open>
    <summary>iPhone · Apple Calendar</summary>
    <ol>
      <li>Open the <b>Calendar</b> app and tap <b>Calendars</b> at the bottom.</li>
      <li>Tap <b>ⓘ</b> next to the calendar you want on the frame.</li>
      <li>Turn on <b>Public Calendar</b>, tap <b>Share Link…</b>, then <b>Copy</b>.</li>
      <li>Come back here and paste it below.</li>
    </ol>
    <p class="note">Anyone with this link can see the calendar, so only share it with the frame. Repeat for each calendar you want to add.</p>
  </details>
  <details class="card help">
    <summary>Google Calendar</summary>
    <ol>
      <li>On a computer, open <b>calendar.google.com</b> → <b>Settings</b> (gear).</li>
      <li>Under <b>Settings for my calendars</b>, pick the calendar.</li>
      <li>Under <b>Integrate calendar</b>, copy the <b>Secret address in iCal format</b>.</li>
      <li>Send it to your phone (or open this page on the computer) and paste it below.</li>
    </ol>
  </details>
  <details class="card help">
    <summary>Outlook</summary>
    <ol>
      <li>On outlook.com: <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li>
      <li>Under <b>Publish a calendar</b>, choose the calendar and <b>Can view all details</b>, then <b>Publish</b>.</li>
      <li>Copy the <b>ICS</b> link and paste it below.</li>
    </ol>
  </details>

  <form class="card" id="f">
    <label class="lbl" for="url">Calendar link <span>(several? one per line)</span></label>
    <textarea id="url" name="url" rows="4" placeholder="webcal://p123-caldav.icloud.com/published/2/…" autocomplete="off" autocapitalize="off" spellcheck="false" required></textarea>
    <button type="button" class="ghost" id="paste" hidden>Paste from clipboard</button>

    <label class="lbl" for="name">Name on the frame <span>(optional; with several links each uses its own name)</span></label>
    <input id="name" name="name" maxlength="30" placeholder="e.g. Family, Aisha, Yusuf">

    <span class="lbl">Whose calendar?</span>
    <div class="seg">
      <label><input type="radio" name="family" value="0" checked><span>One person</span></label>
      <label><input type="radio" name="family" value="1"><span>Whole family</span></label>
    </div>

    <span class="lbl">Colour <span>(with several links each gets its own)</span></span>
    <div class="sws">${swatches}</div>

    <button class="solid" id="go">Add to frame</button>
    <p class="msg" id="msg" role="status"></p>
  </form>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Add a calendar</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=Instrument+Serif:ital@0;1&display=swap">
<style>
  :root { --paper:#F2EEE6; --card:#FBF9F4; --ink:#111; --mute:#7A756B; --line:#D6CFC0; --green:#0B7A5B; --alert:#E5261E; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.45 Archivo, system-ui, sans-serif; padding:24px 16px 48px; }
  main { max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }
  h1 { font:400 44px/1 'Instrument Serif', Georgia, serif; margin:0; }
  h1 i { color:var(--green); }
  .sub { color:var(--mute); margin:4px 0 6px; }
  .card { background:var(--card); border-radius:18px; padding:18px; }
  h2 { font:400 30px/1.1 'Instrument Serif', serif; margin:0 0 8px; }
  summary { font-weight:800; font-stretch:80%; letter-spacing:.06em; text-transform:uppercase; font-size:14px; cursor:pointer; }
  ol { padding-left:20px; margin:12px 0 0; } li { margin:6px 0; }
  .note { font-size:14px; color:var(--mute); margin:10px 0 0; }
  form { display:flex; flex-direction:column; gap:8px; }
  .lbl { font-weight:800; font-stretch:80%; letter-spacing:.06em; text-transform:uppercase; font-size:13px; color:var(--mute); margin-top:10px; }
  .lbl span { text-transform:none; letter-spacing:0; font-weight:400; }
  textarea, input[type=text], input:not([type]) { width:100%; font:16px/1.4 Archivo, system-ui, sans-serif; padding:12px; border:2px solid var(--line); border-radius:12px; background:#fff; color:var(--ink); }
  textarea:focus, input:focus { outline:none; border-color:var(--ink); }
  button { font:800 16px Archivo, sans-serif; font-stretch:80%; letter-spacing:.06em; text-transform:uppercase; border-radius:999px; min-height:52px; padding:0 22px; border:2px solid var(--ink); cursor:pointer; }
  .solid { background:var(--ink); color:#fff; margin-top:16px; } .solid:disabled { opacity:.5; }
  .ghost { background:transparent; color:var(--ink); align-self:flex-start; min-height:42px; }
  .seg { display:flex; background:#E8E2D5; border-radius:999px; padding:4px; }
  .seg label { flex:1; } .seg input { position:absolute; opacity:0; }
  .seg span { display:block; text-align:center; padding:10px; border-radius:999px; font-weight:700; }
  .seg input:checked + span { background:var(--ink); color:#fff; }
  .sws { display:flex; gap:10px; flex-wrap:wrap; }
  .sw input { position:absolute; opacity:0; }
  .sw i { display:block; width:40px; height:40px; border-radius:50%; box-shadow:inset 0 0 0 2px rgba(0,0,0,.08); }
  .sw input:checked + i { box-shadow:0 0 0 3px var(--paper), 0 0 0 6px var(--ink); }
  .msg { min-height:1.4em; margin:6px 0 0; font-weight:600; }
  .msg.err { color:var(--alert); } .msg.ok { color:var(--green); }
  .done { text-align:center; padding:28px 18px; }
  .done b { display:flex; align-items:center; justify-content:center; gap:10px; font:400 38px/1.05 'Instrument Serif', serif; color:var(--ink); margin:14px 0 2px; }
  .done small { display:block; color:var(--mute); }
  .done .dot { width:16px; height:16px; border-radius:50%; display:inline-block; }
</style></head>
<body><main>
  <div><h1>Add a calendar <i>to your frame</i></h1><p class="sub">Paste a calendar link here and it shows up on the frame in a few seconds.</p></div>
  ${body}
</main>
<script>
(function () {
  var f = document.getElementById('f'); if (!f) return;
  var msg = document.getElementById('msg'), go = document.getElementById('go'), paste = document.getElementById('paste');
  if (navigator.clipboard && navigator.clipboard.readText) {
    paste.hidden = false;
    paste.onclick = function () { navigator.clipboard.readText().then(function (t) { f.url.value = t.trim(); }).catch(function () {}); };
  }
  f.onsubmit = function (e) {
    e.preventDefault();
    go.disabled = true; msg.className = 'msg'; msg.textContent = 'Checking the calendar…';
    fetch('/api/setup/calendar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ${JSON.stringify(token || '')}, url: f.url.value, name: f.name.value, color: f.color.value, family: f.family.value === '1' })
    }).then(function (r) { return r.json(); }).then(function (r) {
      go.disabled = false;
      if (r.error) { msg.className = 'msg err'; msg.textContent = r.error; return; }
      var clean = function (s) { return String(s).replace(/[<>&"]/g, ''); };
      var ok = r.results.filter(function (x) { return !x.error; }), bad = r.results.filter(function (x) { return x.error; });
      if (!ok.length) { msg.className = 'msg err'; msg.textContent = bad.map(function (x) { return x.error; }).join(' · '); return; }
      f.outerHTML = '<div class="card done">Added' +
        ok.map(function (x) { return '<b><i class="dot" style="background:' + clean(x.color) + '"></i>' + clean(x.name) + '</b><small>' + x.upcoming + ' events in the next month</small>'; }).join('') +
        (bad.length ? '<p class="msg err">' + bad.map(function (x) { return clean(x.error); }).join('<br>') + '</p>' : '') +
        '<p>They’ll appear on the frame in a few seconds.</p><button class="ghost" onclick="location.reload()">Add another calendar</button></div>';
    }).catch(function () { go.disabled = false; msg.className = 'msg err'; msg.textContent = 'Couldn’t reach the frame’s server. Is your phone on the same Wi-Fi?'; });
  };
})();
</script>
</body></html>`;
}
