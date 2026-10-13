// Things that appear over the dashboard: toasts (one at a time, optional Undo) and sheets
// (modal cards), plus press-and-hold detection.

const App = window.App;

// ------------------------------------------------------------ toast
let toastTimer = null;
// App.toast(html, { icon, ms = 5000, tone: 'error', undo: fn })
App.toast = (html, opts = {}) => {
  const box = App.$('#toasts');
  clearTimeout(toastTimer);
  box.replaceChildren();
  const el = document.createElement('div');
  el.className = 'toast' + (opts.tone ? ' toast--' + opts.tone : '') + (opts.undo ? ' has-undo' : '');
  el.innerHTML = (opts.icon ? App.icon(opts.icon, 26) : '') + `<span class="toast-msg">${html}</span>` +
    (opts.undo ? `<button class="toast-undo">${App.icon('undo', 22)}${App.t('Undo')}</button>` : '');
  box.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  const remove = () => el.remove();
  toastTimer = setTimeout(remove, opts.ms || 5000);
  el.querySelector('.toast-undo')?.addEventListener('click', () => { clearTimeout(toastTimer); opts.undo(); remove(); });
};

// ------------------------------------------------------------ sheet
// App.sheet(html, { cls, onMount(sheetEl, close), onClose }) → close()
App.closeSheet = () => {};
App.sheet = (html, opts = {}) => {
  const layer = App.$('#sheetLayer');
  layer.innerHTML = `<div class="sheet-scrim"></div><div class="sheet ${opts.cls || ''}">` +
    `<button class="sheet-x" data-close aria-label="${App.esc(App.t('Close'))}">${App.icon('x', 28)}</button>${html}</div>`;
  layer.classList.add('is-open');
  const close = () => {
    if (!layer.classList.contains('is-open')) return;
    layer.classList.remove('is-open');
    layer.replaceChildren();
    App.closeSheet = () => {};
    opts.onClose?.();
  };
  App.closeSheet = close;
  layer.querySelector('.sheet-scrim').addEventListener('click', close);
  for (const b of App.$$('[data-close]', layer)) b.addEventListener('click', close);
  opts.onMount?.(layer.querySelector('.sheet'), close);
  return close;
};

// ------------------------------------------------------------ press and hold
// App.hold(el, ms, { done(), cancel?(), enabled?() }). The element gets .is-holding meanwhile,
// and --hold (the duration) for a CSS progress effect.
App.hold = (el, ms, cb) => {
  let timer = null;
  el.style.setProperty('--hold', ms + 'ms');
  el.addEventListener('pointerdown', () => {
    if (cb.enabled && !cb.enabled()) return;
    el.classList.add('is-holding');
    timer = setTimeout(() => { timer = null; el.classList.remove('is-holding'); cb.done(); }, ms);
  });
  const stop = (e) => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    el.classList.remove('is-holding');
    if (e.type === 'pointerup') cb.cancel?.();
  };
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, stop);
};

// Where an element's centre is in stage pixels (the stage is scaled on bigger screens).
App.centerOf = (el) => {
  const stage = App.$('#stage').getBoundingClientRect(), r = el.getBoundingClientRect(), k = stage.width / App.stageWidth;
  return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k };
};
