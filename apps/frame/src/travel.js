// "Time to leave" banners for today's events that have a travel time (see worker/travel.js).
(function () {
  'use strict';
  var KEY = 'hq-leave-told', AHEAD = 10; // minutes before leave-by time

  function told() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function remember(id) {
    var all = told(), day = App.ymd(new Date()), out = {};
    out[day] = (all[day] || []).concat(id); // keep only today's
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  }

  function check() {
    var now = new Date(), day = App.ymd(now), seen = told()[day] || [];
    App.timedOn(now).forEach(function (e) {
      if (!e.travel || e.start <= now || seen.indexOf(e.id) > -1) return;
      var mins = (App.leaveBy(e) - now) / 60000;
      if (mins > AHEAD || mins < -5) return;
      remember(e.id);
      var who = e.people.map(function (id) { return App.person(id).name; });
      App.banner({
        tone: 'ink', icon: 'car',
        title: mins <= 1 ? App.t('Time to leave for {title}', { title: App.esc(e.title) }) : App.t('Leave in {t} for {title}', { t: App.fmt.mins(mins), title: App.esc(e.title) }),
        sub: (App.isFamily(e) ? App.t('Everyone') : who.join(' + ')) + ' · ' + App.t(e.trip && e.trip.source === 'google' ? '{n} min in current traffic' : '{n} min drive', { n: e.travel }) + ' · ' + App.t('starts {time}', { time: App.fmt.time(e.start) }),
        action: App.t('Directions'), dismiss: App.t('OK'), ms: 10 * 60000,
        onAction: function () { App.eventSheet(e); }
      });
    });
  }
  App.on('minute', check);
  App.on('data', check);
})();
