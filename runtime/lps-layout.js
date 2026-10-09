/* Logistics Packing Solution - единна структура на екраните ("док").
   Построява върху страницата на модула три постоянни зони: заглавие (горе), лява колона с входни данни и настройки,
   лента с действия (долу). Оригиналното съдържание на модула остава "Преглед/Резултати" в средата.
   Преместват се САМО контролите (възлите се местят, не се копират - манипулаторите и ID-тата остават). Областите за печат
   и прегледите не се пипат, затова печатът е непроменен. Конфигурацията идва от modules/<id>/layout.json. */
(function () {
  var CFG = {{LAYOUT}};
  if (!CFG) return;

  // Селектор; ако завършва на "<" - взима се родителят на намерения елемент ("#loc-code<" = обвивката на полето с етикета му)
  function qa(sel) {
    var up = 0;
    while (/<$/.test(sel)) { up++; sel = sel.slice(0, -1); }
    var list;
    try { list = Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
    if (!up) return list;
    var out = [];
    list.forEach(function (e) { var p = e; for (var i = 0; i < up && p; i++) p = p.parentElement; if (p && p !== document.body && out.indexOf(p) < 0) out.push(p); });
    return out;
  }
  var origParents = [];
  function moveTo(target, e) {
    if (e.parentElement) origParents.push(e.parentElement);
    target.appendChild(e);
  }
  // Празна обвивка (без елементи освен скрити/скриптове) след преместването - скрива се, за да не остават празни карти
  function structurallyEmpty(e) {
    if (e === document.body || e === document.documentElement) return false;
    return Array.prototype.every.call(e.children, function (c) {
      return /^(SCRIPT|STYLE)$/.test(c.tagName) || c.classList.contains('lps-hidden') || (c.tagName === 'INPUT' && (c.type === 'file' || c.type === 'hidden')) || (c.tagName === 'INPUT' && c.classList.contains('hidden'));
    });
  }
  function hideEmptied() {
    origParents.forEach(function (p) {
      for (var i = 0; i < 6 && p && p !== document.body; i++) {
        if (!structurallyEmpty(p)) break;
        p.classList.add('lps-hidden');
        p = p.parentElement;
      }
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function build() {
    if (document.getElementById('lps-head') || !document.body) return;
    var body = document.body;

    (CFG.hide || []).forEach(function (s) { qa(s).forEach(function (e) { e.classList.add('lps-hidden'); }); });

    // --- Заглавие ---
    var head = el('header'); head.id = 'lps-head';
    var tb = el('div', 'lps-head-text');
    tb.appendChild(el('h1', '', CFG.title || document.title));
    if (CFG.subtitle) tb.appendChild(el('p', '', CFG.subtitle));
    head.appendChild(tb);
    var hr = el('div', 'lps-head-right'); hr.id = 'lps-head-right'; head.appendChild(hr);
    (CFG.headRight || []).forEach(function (s) { qa(s).forEach(function (e) { moveTo(hr, e); }); });

    // --- Лява колона ---
    var side = el('aside'); side.id = 'lps-side';
    (CFG.side || []).forEach(function (sec) {
      var card = sec.card === false ? el('div', 'lps-bare') : el('section', 'lps-card');
      if (sec.title && sec.card !== false) card.appendChild(el('h2', '', sec.title));
      var any = false;
      (sec.move || []).forEach(function (s) { qa(s).forEach(function (e) { moveTo(card, e); any = true; }); });
      if (any || sec.keepEmpty) side.appendChild(card);
    });

    // --- Лента с действия ---
    var bar = el('footer'); bar.id = 'lps-bar';
    var left = el('div', 'lps-bar-left'), right = el('div', 'lps-bar-right');
    bar.appendChild(left); bar.appendChild(el('div', 'lps-spacer')); bar.appendChild(right);
    (CFG.actions || []).forEach(function (a) {
      qa(a.sel).forEach(function (b) {
        b.classList.add('lps-btn', 'lps-' + (a.kind || 'secondary'));
        if (a.label) b.textContent = a.label;
        moveTo(a.side === 'left' ? left : right, b);
      });
    });

    // Само стилизиране на бутони (без преместване)
    (CFG.style || []).forEach(function (a) { qa(a.sel).forEach(function (b) { b.classList.add('lps-btn', 'lps-' + (a.kind || 'secondary')); }); });
    hideEmptied();
    body.insertBefore(bar, body.firstChild);
    body.insertBefore(side, body.firstChild);
    body.insertBefore(head, body.firstChild);
    document.documentElement.classList.add('lps-docked');
    if (!side.children.length) document.documentElement.classList.add('lps-no-side');

    // Лентата се скрива, когато всички бутони в нея са скрити от самия модул
    function syncBar() {
      var visible = Array.prototype.some.call(bar.querySelectorAll('button, a'), function (b) { return b.offsetParent !== null || getComputedStyle(b).position === 'fixed'; });
      bar.classList.toggle('lps-empty', !visible);
      document.documentElement.classList.toggle('lps-no-bar', !visible);
    }
    // Карта в лявата колона, чието съдържание е изцяло скрито от модула, се скрива
    function syncCards() {
      Array.prototype.forEach.call(side.querySelectorAll(':scope > .lps-card'), function (c) {
        var vis = Array.prototype.some.call(c.children, function (k) { return k.tagName !== 'H2' && (k.offsetParent !== null || getComputedStyle(k).position === 'fixed'); });
        c.classList.toggle('lps-collapsed', !vis);
      });
      // ако в лявата колона няма нищо видимо - колоната се свива и прегледът заема цялата ширина
      var anyVisible = side.querySelector(':scope > :not(.lps-collapsed)') !== null;
      document.documentElement.classList.toggle('lps-no-side', !anyVisible);
      side.style.display = anyVisible ? '' : 'none';
    }
    new MutationObserver(function () { syncBar(); syncCards(); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'], childList: true });
    new MutationObserver(syncBar).observe(bar, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'], childList: true });
    syncBar(); syncCards(); setTimeout(function () { syncBar(); syncCards(); }, 400);
  }

  function ready() { try { build(); } catch (e) { console.warn('LPS layout:', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(ready, 0); });
  else setTimeout(ready, 0);
})();
