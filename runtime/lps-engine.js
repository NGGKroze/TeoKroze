/* Клиентски помощник за общия engine (OCR / PDF текст с координати).
   Страниците го викат така:   const r = await LPS.engine.pdfText(file, { ocr: 'auto' });   // r.pages[i].text / .words
                               const t = await LPS.engine.ocrImage(file);
   Обвивката стартира engine-а при първо поискване (WebView2 съобщение) и връща адреса му. */
(function () {
  var LPS = (window.LPS = window.LPS || {});
  var wv = window.chrome && window.chrome.webview;
  var baseUrl = null, starting = null;

  function ensure() {
    if (baseUrl) return Promise.resolve(baseUrl);
    if (!wv) return Promise.reject(new Error('Общият engine е наличен само в програмата Logistics Packing Solution.'));
    if (starting) return starting;
    starting = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { starting = null; reject(new Error('Engine не стартира навреме.')); }, 90000);
      function onMsg(e) {
        var m = e.data;
        if (!m || typeof m !== 'object') return;
        if (m.cmd === 'engine.ready') { clearTimeout(timer); wv.removeEventListener('message', onMsg); baseUrl = m.url.replace(/\/$/, ''); resolve(baseUrl); }
        else if (m.cmd === 'engine.error') { clearTimeout(timer); wv.removeEventListener('message', onMsg); starting = null; reject(new Error(m.message || 'Engine не може да се стартира.')); }
      }
      wv.addEventListener('message', onMsg);
      wv.postMessage({ cmd: 'engine.start' });
    });
    return starting;
  }

  function post(path, body, type) {
    return ensure().then(function (base) {
      return fetch(base + path, { method: 'POST', body: body, headers: { 'Content-Type': type } });
    }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('Engine: HTTP ' + r.status)); return j; });
    });
  }

  LPS.engine = {
    available: function () { return !!wv; },
    ensure: ensure,
    /** PDF -> { pages: [{ n, width, height, text, words: [[x0,y0,x1,y1,дума]], ocr }], ocr_available, warnings }. opts: ocr 'auto'|'off'|'force', lang, dpi */
    pdfText: function (file, opts) {
      opts = opts || {};
      return file.arrayBuffer().then(function (buf) {
        var q = '?ocr=' + (opts.ocr || 'auto') + '&lang=' + (opts.lang || 'eng') + '&dpi=' + (opts.dpi || 300);
        return post('/api/pdf/text' + q, buf, 'application/pdf');
      });
    },
    /** Изображение (PNG/JPEG) -> { text, words } */
    ocrImage: function (file, opts) {
      opts = opts || {};
      return file.arrayBuffer().then(function (buf) {
        return post('/api/ocr/image?lang=' + (opts.lang || 'eng') + '&psm=' + (opts.psm || 6), buf, file.type || 'image/png');
      });
    }
  };

  /* ---- Диагностика на Excel/таблични файлове ----
     LPS.diag.analyze(rows, spec) -> { headerRow, cols, guessed, missing, lines }
       spec: { ключ: { label:'Колона', header:[/regex/], type:'ean'|'int'|'text', required:true } }
       1) намира реда със най-много разпознати заглавия, 2) за липсващи колони пробва по съдържание
       (само EAN = колона с 12-14 цифри; количества/номера са двусмислени и се отчитат като липсващи) - ако заглавието липсва или е разменено.
     LPS.diag.report(title, lines) - показва на български какво и защо липсва (с бутон за копиране). */
  function cellText(v) { return v == null ? '' : String(v).trim(); }
  var TYPE_TEST = {
    ean: function (s) { return /^\d{12,14}$/.test(s.replace(/\s/g, '')); },
    int: function (s) { return /^\d{1,5}$/.test(s); },
    text: function (s) { return s.length > 1 && /[A-Za-zА-Яа-я]/.test(s); }
  };
  function analyze(rows, spec) {
    var keys = Object.keys(spec), best = -1, bestScore = 0, i, k, c;
    for (i = 0; i < Math.min(rows.length, 60); i++) {
      var score = 0, row = rows[i] || [];
      keys.forEach(function (key) { if (row.some(function (v) { return spec[key].header.some(function (re) { return re.test(cellText(v)); }); })) score++; });
      if (score > bestScore) { bestScore = score; best = i; }
    }
    var cols = {}, guessed = {}, missing = [], lines = [];
    if (best < 0) {
      lines.push('Не е намерен ред със заглавия на колоните (очаквани: ' + keys.map(function (x) { return spec[x].label; }).join(', ') + ').');
      lines.push('Първите редове във файла: ' + rows.slice(0, 3).map(function (r) { return '[' + (r || []).map(cellText).filter(Boolean).slice(0, 8).join(' | ') + ']'; }).join(' '));
      return { headerRow: -1, cols: cols, guessed: guessed, missing: keys.map(function (x) { return spec[x].label; }), lines: lines };
    }
    var header = rows[best] || [];
    keys.forEach(function (key) {
      for (c = 0; c < header.length; c++) if (spec[key].header.some(function (re) { return re.test(cellText(header[c])); })) { cols[key] = c; break; }
    });
    var used = {}; Object.keys(cols).forEach(function (x) { used[cols[x]] = 1; });
    keys.forEach(function (key) {
      if (cols[key] != null) return;
      var test = spec[key].type === 'ean' ? TYPE_TEST.ean : null; if (!test) return; // налучкваме само отличимото (EAN); целите числа са двусмислени
      var width = 0; rows.slice(best + 1, best + 40).forEach(function (r) { width = Math.max(width, (r || []).length); });
      var bestCol = -1, bestRatio = 0;
      for (c = 0; c < width; c++) {
        if (used[c]) continue;
        var n = 0, ok = 0;
        rows.slice(best + 1, best + 40).forEach(function (r) { var s = cellText((r || [])[c]); if (s) { n++; if (test(s)) ok++; } });
        if (n >= 3 && ok / n > 0.8 && ok / n > bestRatio) { bestRatio = ok / n; bestCol = c; }
      }
      if (bestCol >= 0) { guessed[key] = bestCol; used[bestCol] = 1; }
    });
    keys.forEach(function (key) {
      if (cols[key] == null && guessed[key] == null && spec[key].required !== false) missing.push(spec[key].label);
    });
    lines.push('Ред със заглавия: ' + (best + 1) + '. Прочетени заглавия: ' + header.map(cellText).filter(Boolean).join(' | '));
    keys.forEach(function (key) {
      var L = spec[key].label;
      if (cols[key] != null) lines.push('✔ ' + L + ' - колона ' + (cols[key] + 1) + ' („' + cellText(header[cols[key]]) + '“)');
      else if (guessed[key] != null) lines.push('≈ ' + L + ' - няма заглавие, налучкана по съдържанието: колона ' + (guessed[key] + 1));
      else lines.push((spec[key].required === false ? '○ ' : '✘ ') + L + ' - не е намерена (нито по заглавие, нито по съдържание).');
    });
    return { headerRow: best, cols: cols, guessed: guessed, missing: missing, lines: lines };
  }
  function report(title, lines) {
    var old = document.getElementById('lps-diag'); if (old) old.remove();
    var box = document.createElement('div'); box.id = 'lps-diag';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:14px Segoe UI,Arial,sans-serif';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;color:#111;max-width:760px;width:92%;max-height:80vh;overflow:auto;border-radius:10px;padding:18px 22px;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    var h = document.createElement('h3'); h.textContent = title; h.style.cssText = 'margin:0 0 10px;font-size:17px';
    var pre = document.createElement('pre'); pre.textContent = lines.join('\n'); pre.style.cssText = 'white-space:pre-wrap;margin:0 0 14px;font:13px Consolas,monospace';
    var bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    function btn(txt, fn) { var b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'padding:7px 16px;border:1px solid #888;border-radius:6px;background:#eee;cursor:pointer'; b.onclick = fn; return b; }
    bar.appendChild(btn('Копирай', function () { try { navigator.clipboard.writeText(title + '\n' + lines.join('\n')); } catch (e) { } }));
    bar.appendChild(btn('Затвори', function () { box.remove(); }));
    card.appendChild(h); card.appendChild(pre); card.appendChild(bar); box.appendChild(card); document.body.appendChild(box);
  }
  LPS.diag = { analyze: analyze, report: report };

  /* ---- Резервен drag & drop ----
     Ако WebView2 не предаде влаченето на файлове от Explorer (известен проблем при някои конфигурации), обвивката хваща
     падането сама и праща файловете като съобщение {cmd:'lps.drop', x, y, files:[{name,type,b64}]}.
     Тук ги превръщаме във File и симулираме drop върху елемента под курсора (или попълваме най-близкия input[type=file]). */
  var lastNative = 0;
  document.addEventListener('drop', function (e) { if (e.isTrusted) lastNative = Date.now(); }, true);
  function b64ToFile(f) {
    var bin = atob(f.b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], f.name, { type: f.type || '' });
  }
  function deliver(msg) {
    var files = (msg.files || []).map(b64ToFile);
    if (!files.length) return;
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    var el = document.elementFromPoint(msg.x, msg.y) || document.body;
    var init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: msg.x, clientY: msg.y };
    var handled = false;
    ['dragenter', 'dragover', 'drop'].forEach(function (type) {
      var ev = new DragEvent(type, init);
      el.dispatchEvent(ev);
      if (type === 'drop' && ev.defaultPrevented) handled = true;
    });
    if (handled) return;
    // никой не прихвана drop -> най-близкият файлов input
    var node = el, input = null;
    while (node && !input) {
      input = node.querySelector && node.querySelector('input[type=file]');
      node = node.parentElement;
    }
    input = input || document.querySelector('input[type=file]');
    if (input) { try { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { } }
  }
  if (wv) wv.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object' || m.cmd !== 'lps.drop') return;
    setTimeout(function () { if (Date.now() - lastNative > 1200) deliver(m); }, 450);   // ако браузърът вече го е обработил - не го дублираме
  });
})();
