// Weather in words. DATA.weather (from live.js) has hourly arrays t (temp), c (icon), p (rain %)
// starting at midnight today.

const App = window.App, D = window.DATA;

const PRECIP = new Set(['rain', 'snow', 'storm']);

// Now, plus a one-line summary ("Rain from 3 PM") and what to wear.
App.weatherNow = () => {
  const W = D.weather;
  if (!W) return null;
  const h = App.now().getHours();
  const wetAt = (i) => W.p[i] >= 50 || (PRECIP.has(W.c[i]) && W.p[i] >= 30);
  const at = (hour) => App.fmt.hour(new Date(2000, 0, 1, hour));

  let firstWet = PRECIP.has(W.cond) ? h : -1;
  for (let i = h; firstWet < 0 && i < 24; i++) if (wetAt(i)) firstWet = i;

  let summary, advice;
  if (firstWet === h) {
    let end = h + 1;
    while (end < 24 && wetAt(end)) end++;
    const until = end >= 24 ? App.t('late tonight') : at(end);
    const snow = W.c[h] === 'snow';
    summary = App.t(snow ? 'Snow until {t}' : 'Rain until {t}', { t: until });
    advice = App.t(snow ? 'Boots and a warm coat' : 'Umbrella weather');
  } else if (firstWet > -1) {
    summary = App.t(W.c[firstWet] === 'snow' ? 'Snow from {t}' : 'Rain from {t}', { t: at(firstWet) });
    advice = App.t('Grab a jacket');
  } else {
    const cool = W.temp < (W.unit === 'F' ? 54 : 12);
    summary = App.t(cool ? 'Dry and cool' : 'Dry all day');
    advice = App.t(cool ? 'Jacket weather' : 'Light layers');
  }
  return { temp: W.temp, cond: W.cond, label: App.wxLabel(W.cond), hi: W.hi, lo: W.lo, summary, advice, hour: h };
};

// The next `count` hours from now: { h, t, c, p, label }.
App.hourly = (count) => {
  const W = D.weather;
  if (!W) return [];
  const h = App.now().getHours(), out = [];
  for (let i = 0; i < count && h + i < W.t.length; i++) {
    const idx = h + i;
    out.push({ h: idx % 24, t: W.t[idx], c: W.c[idx], p: W.p[idx], label: App.hourLabel(idx % 24, i === 0) });
  }
  return out;
};
