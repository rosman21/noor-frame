// Small UI helpers: escaping, icons, the page frame, toasts.
import { ICONS } from '../../frame/src/core/icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const icon = (name, size = 22) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// A page: optional back link, label, title, then body.
export function page({ back, label, title, body }) {
  return `${back ? `<a class="back" href="${back}">${icon('left', 20)}Back</a>` : ''}
    <header class="head">${label ? `<div class="label">${label}</div>` : ''}<h1 class="serif">${title}</h1></header>
    ${body}`;
}

// A tappable row that opens another page.
export function link(href, label, value, sub = '') {
  return `<a class="row" href="${href}"><span class="row-l">${label}</span><span class="row-v"><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</span>${icon('right', 20)}</a>`;
}

let toastTimer;
export function toast(message, { error = false, ms = 2600 } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast is-in' + (error ? ' is-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// Disable a button while its promise runs; show the error as a toast.
export async function busy(button, job) {
  button.disabled = true;
  try { return await job(); }
  catch (err) { toast(err.message, { error: true, ms: 4500 }); throw err; }
  finally { button.disabled = false; }
}
