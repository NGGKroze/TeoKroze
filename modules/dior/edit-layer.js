/* DIOR - редакция на packing list (слой върху оригиналния код).
   Заменя само показването на таблицата (renderPackingPreview); изчисленията, Excel и етикетите остават непроменени
   и четат редактираните данни от activePackingRows. Файлът се зарежда след основния <script>. */
(function () {
  'use strict';
  var dirty = false;          // има ръчни промени (пази се от случайно презаписване при "Rebuild")
  var wtTimer = null;
  var host = document.getElementById('packing-preview');

  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function perPiece() { return Math.max(0, num(document.getElementById('net-kg-piece').value)); }
  function tare() { return Math.max(0, num(document.getElementById('carton-tare-kg').value)); }

  /* Преизчисляване на един ред + последователно номериране на кашоните */
  function recalcRow(row, keepWeights) {
    row.qtyCtn = activeSizeColumns.reduce(function (s, c) { return s + (Number(row.sizes[c]) || 0); }, 0);
    row.ttlCtns = Math.max(1, Math.round(row.ttlCtns) || 1);
    if (!keepWeights && !row._manualWt) {
      row.netWt = r2(row.qtyCtn * perPiece());
      row.grossWt = r2(row.netWt + tare());
    }
    row.ttlNetWt = r2(row.netWt * row.ttlCtns);
    row.ttlGrossWt = r2(row.grossWt * row.ttlCtns);
    row.totalQty = row.qtyCtn * row.ttlCtns;
  }
  function renumber() {
    var cursor = activePackingRows.length ? (activePackingRows[0].ctnStart || 1) : 1;
    activePackingRows.forEach(function (row) {
      row.ctnStart = cursor;
      row.ctnEnd = cursor + row.ttlCtns - 1;
      cursor = row.ctnEnd + 1;
    });
  }
  function refreshOutputs() {
    activeLabelsData = packingRowsToLabels(activePackingRows, activeSizeColumns);
    activeLabelMeta = getControlsMeta();
    renderLabels(activeLabelsData, activeLabelMeta);
    updateSummary();
  }

  /* ---------- Таблица ---------- */
  function cellInput(field, value, cls, type) {
    return '<input data-f="' + field + '" class="ed ' + (cls || '') + '" type="' + (type || 'text') + '" value="' + esc(value) + '"' + (type === 'number' ? ' step="any" min="0"' : '') + '>';
  }

  function render(rows, sizeColumns) {
    if (!rows.length) {
      host.innerHTML = '<div class="status warn">Няма генерирани редове. Проверете дали OA PDF съдържа редове с количества по размери.</div>';
      return;
    }
    var html = '<div class="ed-bar">' +
      '<button type="button" class="ghost" data-act="add">➕ Нов ред</button>' +
      '<span class="ed-hint">Редактирайте директно в таблицата. Етикетите, Excel и сумите се обновяват веднага. ' +
      '„Раздели“ отделя един кашон от ред с няколко еднакви, за да го промените поотделно.</span></div>';
    html += '<div class="ed-wrap"><table class="preview-table ed-table"><thead><tr>' +
      ['CTN NO.', 'REF NO.', 'DESCRIPTION', 'COLOR'].concat(sizeColumns, ['QTY CTN', 'TTL CTNS', 'NET WT', 'GR. WT', 'TTL NET WT', 'TTL GR. WT', 'TTL QTY', '']).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>';
    rows.forEach(function (row, i) {
      html += '<tr data-i="' + i + '">' +
        '<td class="ed-ctn" data-c="ctn">' + esc(row.ctnStart) + (row.ctnEnd !== row.ctnStart ? ' – ' + esc(row.ctnEnd) : '') + '</td>' +
        '<td>' + cellInput('style', row.style, 'w-ref') + '</td>' +
        '<td>' + cellInput('description', row.description, 'w-desc') + '</td>' +
        '<td>' + cellInput('color', row.color, 'w-color') + '</td>' +
        sizeColumns.map(function (s) { return '<td>' + cellInput('size:' + s, row.sizes[s] || '', 'w-num', 'number') + '</td>'; }).join('') +
        '<td data-c="qtyCtn">' + esc(row.qtyCtn) + '</td>' +
        '<td>' + cellInput('ttlCtns', row.ttlCtns, 'w-num', 'number') + '</td>' +
        '<td>' + cellInput('netWt', row.netWt.toFixed(2), 'w-wt', 'number') + '</td>' +
        '<td>' + cellInput('grossWt', row.grossWt.toFixed(2), 'w-wt', 'number') + '</td>' +
        '<td data-c="ttlNetWt">' + row.ttlNetWt.toFixed(2) + '</td>' +
        '<td data-c="ttlGrossWt">' + row.ttlGrossWt.toFixed(2) + '</td>' +
        '<td data-c="totalQty">' + esc(row.totalQty) + '</td>' +
        '<td class="ed-act"><button type="button" class="ghost" title="Дублирай реда" data-act="dup">⧉</button>' +
        (row.ttlCtns > 1 ? '<button type="button" class="ghost" title="Раздели: отделя 1 кашон от реда" data-act="split">✂</button>' : '') +
        '<button type="button" class="ghost" title="Изтрий реда" data-act="del">✕</button></td></tr>';
    });
    var t = totals();
    html += '</tbody><tfoot><tr class="ed-total"><td colspan="' + (4 + sizeColumns.length) + '">ОБЩО</td><td></td>' +
      '<td data-t="cartons">' + t.cartons + '</td><td></td><td></td><td data-t="net">' + t.net.toFixed(2) + '</td><td data-t="gross">' + t.gross.toFixed(2) + '</td><td data-t="qty">' + t.qty + '</td><td></td></tr></tfoot></table></div>';
    host.innerHTML = html;
  }

  function totals() {
    return activePackingRows.reduce(function (a, r) {
      a.cartons += r.ttlCtns; a.net += r.ttlNetWt; a.gross += r.ttlGrossWt; a.qty += r.totalQty; return a;
    }, { cartons: 0, net: 0, gross: 0, qty: 0 });
  }

  function updateComputedCells(tr, row) {
    function set(sel, v) { var el = tr.querySelector('[data-c="' + sel + '"]'); if (el) el.textContent = v; }
    set('qtyCtn', row.qtyCtn); set('ttlNetWt', row.ttlNetWt.toFixed(2)); set('ttlGrossWt', row.ttlGrossWt.toFixed(2)); set('totalQty', row.totalQty);
    var nw = tr.querySelector('[data-f="netWt"]'), gw = tr.querySelector('[data-f="grossWt"]');
    if (!row._manualWt) { nw.value = row.netWt.toFixed(2); gw.value = row.grossWt.toFixed(2); }
    // номерата на кашоните на всички редове
    host.querySelectorAll('tbody tr').forEach(function (r, i) {
      var rw = activePackingRows[i]; var c = r.querySelector('[data-c="ctn"]');
      if (rw && c) c.textContent = rw.ctnStart + (rw.ctnEnd !== rw.ctnStart ? ' – ' + rw.ctnEnd : '');
    });
    var t = totals();
    [['cartons', t.cartons], ['net', t.net.toFixed(2)], ['gross', t.gross.toFixed(2)], ['qty', t.qty]].forEach(function (p) {
      var el = host.querySelector('[data-t="' + p[0] + '"]'); if (el) el.textContent = p[1];
    });
  }

  host.addEventListener('input', function (e) {
    var inp = e.target.closest('input.ed'); if (!inp) return;
    var tr = inp.closest('tr'); var row = activePackingRows[Number(tr.dataset.i)]; if (!row) return;
    var f = inp.dataset.f;
    if (f === 'style' || f === 'description' || f === 'color') row[f] = inp.value;
    else if (f.indexOf('size:') === 0) row.sizes[f.slice(5)] = Math.max(0, Math.round(num(inp.value)));
    else if (f === 'ttlCtns') row.ttlCtns = Math.max(1, Math.round(num(inp.value)) || 1);
    else if (f === 'netWt') { row.netWt = r2(num(inp.value)); row._manualWt = true; }
    else if (f === 'grossWt') { row.grossWt = r2(num(inp.value)); row._manualWt = true; }
    var keep = (f === 'netWt' || f === 'grossWt');
    recalcRow(row, keep);
    renumber();
    dirty = true;
    updateComputedCells(tr, row);
    clearTimeout(wtTimer);
    wtTimer = setTimeout(refreshOutputs, 250);
  });

  host.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]'); if (!btn) return;
    var act = btn.dataset.act; var tr = btn.closest('tr'); var i = tr ? Number(tr.dataset.i) : -1;
    var rows = activePackingRows;
    if (act === 'add') {
      var base = rows[rows.length - 1];
      var sizes = {}; activeSizeColumns.forEach(function (s) { sizes[s] = 0; });
      var nr = { style: base ? base.style : '', description: base ? base.description : '', color: base ? base.color : '', sizes: sizes, ttlCtns: 1, netWt: 0, grossWt: 0 };
      recalcRow(nr); rows.push(nr);
    } else if (act === 'dup' && rows[i]) {
      var cp = JSON.parse(JSON.stringify(rows[i])); rows.splice(i + 1, 0, cp);
    } else if (act === 'split' && rows[i] && rows[i].ttlCtns > 1) {
      var one = JSON.parse(JSON.stringify(rows[i])); one.ttlCtns = 1; recalcRow(one, true);
      rows[i].ttlCtns -= 1; recalcRow(rows[i], true);
      rows.splice(i, 0, one);
    } else if (act === 'del' && rows[i]) {
      if (rows.length === 1 && !confirm('Това е последният ред. Да се изтрие ли?')) return;
      rows.splice(i, 1);
    }
    rows.forEach(function (r) { recalcRow(r, true); });
    renumber(); dirty = true;
    render(activePackingRows, activeSizeColumns);
    refreshOutputs();
  });

  /* Нов изглед на таблицата вместо статичния */
  window.renderPackingPreview = function (rows, sizeColumns) { dirty = false; render(rows, sizeColumns); };

  /* Защита: смяна на параметри / "Rebuild" презаписва ръчните редакции - питаме първо */
  var guards = ['rebuild-btn', 'max-per-carton', 'net-kg-piece', 'carton-tare-kg', 'job-select'];
  guards.forEach(function (id) {
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener(id === 'rebuild-btn' ? 'click' : 'change', function (ev) {
      if (dirty && !confirm('В таблицата има ръчни редакции. Преизчисляването ще ги презапише. Да продължи ли?')) {
        ev.stopImmediatePropagation(); ev.preventDefault();
      }
    }, true);
  });

  var css = document.createElement('style');
  css.textContent =
    '.ed-bar{display:flex;gap:12px;align-items:center;margin:8px 0}.ed-hint{font-size:12px;color:#5b5c62}' +
    '.ed-wrap{overflow-x:auto}.ed-table input.ed{width:100%;min-width:46px;border:1px solid transparent;background:transparent;padding:3px 4px;font:inherit;text-align:center;border-radius:4px}' +
    '.ed-table input.ed:hover{border-color:#cfc6b4}.ed-table input.ed:focus{background:#fff;border-color:#b08d57;outline:none}' +
    '.ed-table input.w-desc{min-width:190px;text-align:left}.ed-table input.w-color{min-width:130px;text-align:left}.ed-table input.w-ref{min-width:120px}' +
    '.ed-table input.w-num{min-width:44px}.ed-table input.w-wt{min-width:64px}.ed-table .ed-ctn{white-space:nowrap;font-weight:700}' +
    '.ed-act{white-space:nowrap}.ed-act button{padding:2px 7px;font-size:13px;margin:0 1px}.ed-total td{font-weight:700;background:#f6f6f6}';
  document.head.appendChild(css);
})();
