/* Logistics Packing Solution - превод на интерфейса на български (runtime слой).
   Не променя кода на модулите: заменя само показвания текст по речник (modules/<id>/bg.json + runtime/i18n/common.bg.json).
   Етикетите, печатът и данните НЕ се превеждат (skip селектори). Маркерът по-долу се заменя от ThemeInjector. */
(function () {
  var DICT = {{DICT}};
  var exact = DICT.exact || {};
  var pats = (DICT.patterns || []).map(function (p) { return [new RegExp(p[0], p[2] || ''), p[1]]; });
  var SKIP = (DICT.skip || []).join(',');
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-tooltip'];
  var missing = new Set();
  var NOT = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|PRE)$/;

  function tr(s) {
    if (!s) return s;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    var key = m[2].replace(/\s+/g, ' ');
    if (!key || !/[A-Za-zÀ-ÿ]{2}/.test(key)) return s;
    var to = exact[key];
    if (to === undefined) {
      for (var i = 0; i < pats.length; i++) {
        if (pats[i][0].test(key)) { to = key.replace(pats[i][0], pats[i][1]); break; }
      }
    }
    if (to === undefined) {
      // за допълване на речника: непреведените английски низове (виж README: __lpsMissing())
      if (!/[\u0400-\u04FF]/.test(key) && /[A-Za-z]{3,}/.test(key) && missing.size < 800) missing.add(key);
      return s;
    }
    return m[1] + to + m[3];
  }

  function skipped(el) { return SKIP && el && el.closest && el.closest(SKIP); }

  function text(node) {
    var p = node.parentElement;
    if (!p || NOT.test(p.tagName) || skipped(p)) return;
    var t = tr(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
  }

  function attrs(el) {
    if (skipped(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v) { var t = tr(v); if (t !== v) el.setAttribute(ATTRS[i], t); }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type) && el.value) {
      var tv = tr(el.value); if (tv !== el.value) el.value = tv;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(root.tagName) || skipped(root)) return;
    attrs(root);
    var w = document.createTreeWalker(root, 5); // SHOW_ELEMENT | SHOW_TEXT
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) text(n);
      else if (!/^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.tagName)) attrs(n);
    }
  }

  function run() { walk(document.documentElement); if (document.title) { var t = tr(document.title); if (t !== document.title) document.title = t; } }

  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
  });
  mo.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });

  ['alert', 'confirm', 'prompt'].forEach(function (k) {
    var orig = window[k];
    window[k] = function (msg) { var a = Array.prototype.slice.call(arguments); a[0] = tr(String(msg == null ? '' : msg)); return orig.apply(window, a); };
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.__lpsTr = tr;
  window.__lpsMissing = function () { return Array.from(missing); };
})();
