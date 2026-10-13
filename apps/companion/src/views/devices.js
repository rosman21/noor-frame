// Screens and phones: who can change the household's settings. New screens from outside the
// home network wait here for approval.

import { get, post, session } from '../api.js';
import { page, esc, icon, toast, busy, $$ } from '../ui.js';

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'active now';
  if (m < 60) return `seen ${m} min ago`;
  if (m < 2880) return `seen ${Math.round(m / 60)} hr ago`;
  return `seen ${Math.round(m / 1440)} days ago`;
}

export async function devicesPage(app) {
  const { devices } = await get('/api/devices');
  const me = session.get()?.id;
  const pending = devices.filter((d) => !d.approved);
  const approved = devices.filter((d) => d.approved);
  const row = (d) => `<div class="row row--device">
      <span class="row-icon">${icon(d.kind === 'phone' ? 'person' : 'home', 20)}</span>
      <span class="row-v"><b>${esc(d.name)}${d.id === me ? ' <em>this phone</em>' : ''}</b><small>${d.kind === 'phone' ? 'Phone' : 'Screen'} · ${ago(d.seen)}</small></span>
      <span class="row-btns">
        ${d.approved ? '' : `<button class="btn btn--solid btn--small" data-approve="${d.id}">Approve</button>`}
        <button class="icon-btn" data-rename="${d.id}" aria-label="Rename">${icon('settings', 18)}</button>
        ${d.id === me ? '' : `<button class="icon-btn" data-remove="${d.id}" aria-label="Remove">${icon('x', 18)}</button>`}
      </span></div>`;

  app.innerHTML = page({
    back: '#/', label: 'Screens and phones', title: 'Devices',
    body: `
      ${pending.length ? `<h2 class="sub">Waiting for approval</h2><p class="muted">Only approve screens you recognise. Approved devices can change every setting.</p>
        <section class="card">${pending.map(row).join('')}</section>` : ''}
      <h2 class="sub">Approved</h2>
      <section class="card">${approved.map(row).join('')}</section>
      <p class="foot">Screens on your home Wi-Fi are approved automatically. To add a phone, open <b>Settings → Open on phone</b> on any screen and scan the code.</p>`,
  });

  const find = (id) => devices.find((d) => d.id === id);
  for (const b of $$('[data-approve]', app)) b.addEventListener('click', () => busy(b, async () => {
    await post('/api/devices/update', { id: b.dataset.approve, approved: true });
    toast(`${find(b.dataset.approve).name} approved`);
    devicesPage(app);
  }).catch(() => {}));
  for (const b of $$('[data-rename]', app)) b.addEventListener('click', () => {
    const d = find(b.dataset.rename);
    const name = prompt('Name', d.name);
    if (!name || name.trim() === d.name) return;
    busy(b, async () => {
      await post('/api/devices/update', { id: d.id, name: name.trim() });
      if (d.id === me) session.set({ ...session.get(), name: name.trim() });
      devicesPage(app);
    }).catch(() => {});
  });
  for (const b of $$('[data-remove]', app)) b.addEventListener('click', () => {
    const d = find(b.dataset.remove);
    if (!confirm(`Remove ${d.name}? It will need to be approved again to change settings.`)) return;
    busy(b, async () => {
      await post('/api/devices/remove', { id: d.id });
      toast(`${d.name} removed`);
      devicesPage(app);
    }).catch(() => {});
  });
}
