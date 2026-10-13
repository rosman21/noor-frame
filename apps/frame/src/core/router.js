// Views and navigation. A view registers { show(el, opts), resume?(el), hide?(), minutely? }.
// Views are built once and stay laid out while hidden (content-visibility), so switching is
// instant. After new data or settings, the open view redraws now and hidden ones are rebuilt in
// the background, one at a time, so opening them later costs nothing.

const App = window.App;
const viewEl = (name) => App.$('#view-' + name);
const minuteNow = () => Math.floor(App.now().getTime() / 60000);

App.register = (name, view) => { App.views[name] = view; };

function build(name, opts = {}) {
  const view = App.views[name];
  view.show(viewEl(name), opts);
  Object.assign(view, { _built: true, _stale: false, _minute: minuteNow() });
}

App.go = (name, opts = {}) => {
  if (!App.views[name]) name = 'home';
  const prev = App.current && App.views[App.current];
  if (prev && App.current !== name) prev.hide?.();
  for (const v of App.$$('.view')) v.classList.toggle('is-active', v.dataset.view === name);
  for (const b of App.$$('.shade-tile, .dock-item')) b.classList.toggle('is-active', b.dataset.go === name);
  App.current = name;

  const view = App.views[name];
  const outdated = !view._built || view._stale || opts.rerender || (view.minutely && view._minute !== minuteNow());
  if (outdated) build(name, opts);
  else view.resume?.(viewEl(name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
};

App.rerender = () => {
  if (App.current) App.views[App.current].show(viewEl(App.current), { rerender: true });
};

// ------------------------------------------------------------ background rebuilds
let timer = null;
function rebuildHiddenSoon(delay) {
  clearTimeout(timer);
  timer = setTimeout(function next() {
    const name = Object.keys(App.views).find((k) => k !== App.current && (!App.views[k]._built || App.views[k]._stale));
    if (!name) return;
    build(name);
    App.views[name].hide?.();
    // Lay it out now while hidden, so the first paint after navigating is cheap.
    const el = viewEl(name);
    el.classList.add('is-warming');
    void el.offsetHeight;
    el.classList.remove('is-warming');
    timer = setTimeout(next, 400);
  }, delay);
}
App.rebuildHiddenSoon = rebuildHiddenSoon;

function staleAll() {
  for (const k of Object.keys(App.views)) if (k !== App.current) App.views[k]._stale = true;
  rebuildHiddenSoon(1500);
}

App.on('data', () => { staleAll(); if (App.current && App.views[App.current]._built) App.rerender(); });
// Language, fonts or clock changed: sizes change too, so everything redraws.
App.on('settings', () => { staleAll(); App.rerender(); });
App.on('time', staleAll);
