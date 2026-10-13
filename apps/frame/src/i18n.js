// Interface language. Strings are written in English in the code and looked up here:
// App.t('Next prayer'), App.t('{n} min', { n: 5 }). Missing translations fall back to English.
// Translations live in js/lang.js; add a language there and to LANGS below.
(function () {
  'use strict';
  var LANGS = [
    { id: 'en', name: 'English', locale: 'en-US' },
    { id: 'ar', name: 'العربية', locale: 'ar-u-nu-latn', rtl: true },
    { id: 'ur', name: 'اردو', locale: 'ur-PK-u-nu-latn', rtl: true },
    { id: 'fr', name: 'Français', locale: 'fr-FR' },
    { id: 'tr', name: 'Türkçe', locale: 'tr-TR' },
    { id: 'id', name: 'Bahasa Indonesia', locale: 'id-ID' },
    { id: 'ms', name: 'Bahasa Melayu', locale: 'ms-MY' }
  ];
  App.LANGS = LANGS;

  function lang() {
    var id = (App.setting && App.setting('lang')) || 'en';
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].id === id) return LANGS[i];
    return LANGS[0];
  }
  App.lang = lang;
  App.locale = function () { return lang().locale; };

  App.t = function (s, vars) {
    var dict = (window.LANG || {})[lang().id];
    var out = (dict && dict[s]) || s;
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return out;
  };

  // Static labels in index.html carry data-i18n="English text".
  App.translateStatic = function () {
    var L = lang();
    document.documentElement.lang = L.id;
    document.documentElement.classList.toggle('is-rtl-lang', !!L.rtl);
    App.$$('[data-i18n]').forEach(function (el) { el.textContent = App.t(el.dataset.i18n); });
  };
})();
