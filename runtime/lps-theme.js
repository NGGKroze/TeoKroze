/* Logistics Packing Solution - обща тема за всички клиентски екрани.
   Вкарва се от обвивката във всяка страница (преди скриптовете на модула).
   Двата шаблонни маркера по-долу (CSS и MODULE, в двойни къдрави скоби) се заместват от ThemeInjector. */
(function () {
  var CSS = {{CSS}};
  var MODULE = {{MODULE}};

  // Акцентните цветове на Tailwind (blue/indigo/...) стават графит + месинг. Неутралните (slate/gray) НЕ се пипат,
  // за да не се променя това, което се печата върху етикетите.
  var graphite = { 50: '#f6f3ec', 100: '#ece8df', 200: '#ddd8cd', 300: '#bdb8ac', 400: '#8a8a90', 500: '#46474d', 600: '#2f3034', 700: '#232427', 800: '#1b1c1f', 900: '#131416', 950: '#0c0c0e' };
  var ACCENTS = {};
  ['blue', 'indigo', 'violet', 'purple', 'sky', 'cyan', 'fuchsia', 'brand'].forEach(function (n) { ACCENTS[n] = graphite; });

  function apply() {
    if (document.getElementById('lps-theme')) return;
    document.documentElement.setAttribute('data-lps', MODULE);
    var s = document.createElement('style');
    s.id = 'lps-theme';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    if (window.tailwind) {
      try {
        var cfg = window.tailwind.config || {};
        cfg.theme = cfg.theme || {};
        cfg.theme.extend = cfg.theme.extend || {};
        cfg.theme.extend.colors = Object.assign({}, cfg.theme.extend.colors || {}, ACCENTS);
        window.tailwind.config = cfg;
      } catch (e) { /* без Tailwind - само CSS */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
