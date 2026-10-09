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
})();
