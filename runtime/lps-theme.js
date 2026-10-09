/* Logistics Packing Solution - обща тема за всички клиентски екрани.
   Вкарва се от обвивката във всяка страница (преди скриптовете на модула).
   Двата шаблонни маркера по-долу (CSS и MODULE, в двойни къдрави скоби) се заместват от ThemeInjector. */
(function () {
  var CSS = {{CSS}};
  var MODULE = {{MODULE}};

  var THEME = {{THEME}};

  // Смесва два цвята (#rrggbb): t=0 -> a, t=1 -> b.
  function mix(a, b, t) {
    function p(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
    var x = p(a), y = p(b);
    return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join('');
  }
  // Акцентните цветове на Tailwind (blue/indigo/...) стават цветът на темата. Неутралните (slate/gray) НЕ се пипат,
  // за да не се променя това, което се печата върху етикетите.
  var A = THEME.accent, D = THEME.accentDark;
  var ramp = { 50: mix(A, '#ffffff', .94), 100: mix(A, '#ffffff', .88), 200: mix(A, '#ffffff', .76), 300: mix(A, '#ffffff', .58), 400: mix(A, '#ffffff', .34), 500: mix(A, '#ffffff', .1),
    600: A, 700: mix(A, D, .4), 800: mix(A, D, .75), 900: D, 950: mix(D, '#000000', .35) };
  var ACCENTS = {};
  ['blue', 'indigo', 'violet', 'purple', 'sky', 'cyan', 'fuchsia', 'brand'].forEach(function (n) { ACCENTS[n] = ramp; });

  // Променливите на темата (след тях идват правилата, които ги ползват; :root на стила по подразбиране се презаписва)
  var VARS = ':root{--lps-bg:' + THEME.bg + ';--lps-side:' + THEME.side + ';--lps-line:' + THEME.line + ';--lps-ink:' + THEME.ink + ';--lps-ink-soft:' + THEME.inkSoft +
    ';--lps-accent:' + THEME.accent + ';--lps-accent-dark:' + THEME.accentDark + ';--lps-graphite:' + THEME.accentDark + ';--lps-graphite-2:' + THEME.accent +
    ';--lps-brass:' + THEME.brass + ';--lps-brass-dark:' + THEME.brassDark + ';--lps-soft:' + THEME.soft + ';--lps-sel:' + THEME.sel + ';--lps-thumb:' + THEME.thumb + ';}';

  function apply() {
    if (document.getElementById('lps-theme')) return;
    document.documentElement.setAttribute('data-lps', MODULE);
    var s = document.createElement('style');
    s.id = 'lps-theme';
    s.textContent = CSS + VARS;   // променливите на темата след стила по подразбиране
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
