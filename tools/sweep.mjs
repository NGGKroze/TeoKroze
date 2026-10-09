// Пуска модул с много входни файлове и показва резултата/грешките за всеки.
//   SPEC=spec.json node tools/sweep.mjs [модул ...]
// spec.json: [{ "module":"ganni", "label":"EU blazer", "files":["/abs/a.xlsx"], "pre":["#sel"], "post":["#sel"], "preview":"#sel" }]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process'; import net from 'node:net';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const spec = JSON.parse(fs.readFileSync(process.env.SPEC, 'utf8')); const only = process.argv.slice(2);
const OUT = process.env.OUT || '/tmp/claude-0/sweep'; fs.mkdirSync(OUT, { recursive: true });
const PY = new Set(['acne', 'asphalte', 'courreges']);
const PREVIEW = { ganni: '#preview-grid', eres: '#previewContainer', tresse: '#labels-container', jacquemus: '#labels-container', frankie: '#labelGrid', ami: '#preview-grid', yse: '#previewContainer', dior: '#packing-preview, #pages-container', kenzo: '#plPreview, #summaryPanel', zadig: '#packingListPreview, #preview', chanel: '#preview-content', longchamp: '#previewBody', margiela: '#printArea', 'stella-suzie': '#labelsPreviewContainer', reformation: '#labels-preview-container, #pl-preview-table-container', loreal: '#previewTableWrap', acne: '#orders', asphalte: '#results', courreges: '#orderCards, .tableWrap, #log' };
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
let n = 0;
for (const c of spec) {
  if (only.length && !only.includes(c.module)) continue;
  let py = null, url;
  if (PY.has(c.module)) { const port = await freePort(); py = spawn('python3', [path.join(root, c.module, 'run.py')], { env: { ...process.env, TEOKROZE_PORT: String(port), TEOKROZE_RUNTIME: path.join(repo, 'runtime'), TEOKROZE_WATCH_STDIN: '0', TEOKROZE_DATA_DIR: fs.mkdtempSync('/tmp/sw-') + '/d' }, stdio: 'ignore' }); for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } } url = `http://127.0.0.1:${port}/`; }
  else url = `http://127.0.0.1:${srv.address().port}/${c.module}/index.html`;
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const pg = await ctx.newPage();
  const errs = [], dl = [];
  pg.on('pageerror', e => errs.push('PAGEERR ' + String(e).slice(0, 140))); pg.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });
  pg.on('dialog', d => { errs.push('DIALOG ' + d.message().slice(0, 160)); d.dismiss().catch(() => {}); }); pg.on('download', d => dl.push(d.suggestedFilename()));
  await pg.goto(url); await pg.waitForTimeout(600);
  try {
    for (const s of c.pre || []) { await pg.click(s, { timeout: 4000 }); await pg.waitForTimeout(300); }
    const inputs = await pg.$$('input[type=file]');
    if (c.multi) { await inputs[c.input ?? 0].setInputFiles(c.files); await pg.waitForTimeout(c.wait ?? 4000); }
    else for (const [k, f] of c.files.entries()) { await inputs[Math.min(c.inputs?.[k] ?? k, inputs.length - 1)].setInputFiles(f); await pg.waitForTimeout(c.wait ?? 2500); }
    for (const s of c.post || []) { await pg.click(s, { timeout: 4000 }); await pg.waitForTimeout(1500); }
  } catch (e) { errs.push('STEP ' + String(e).slice(0, 140)); }
  await pg.waitForTimeout(c.settle ?? 2500);
  const sel = c.preview || PREVIEW[c.module] || 'body';
  await pg.evaluate(() => document.querySelectorAll('input:not([type=file]):not([type=checkbox]),textarea,select').forEach(i => { const v = i.tagName === 'SELECT' ? (i.selectedOptions[0] || {}).text : i.value; const s = document.createElement('span'); s.textContent = v || ' '; i.replaceWith(s); })); // значенията на полетата да се виждат в текста
  const info = await pg.evaluate(s => { const t = [...document.querySelectorAll(s)].map(e => e.innerText).join('\n'); const st = document.querySelector('#status, #statusBox, .status, #message, #log, #logMessages'); return { text: t.replace(/\n{2,}/g, '\n').slice(0, 1500), status: st ? st.innerText.slice(0, 300) : '', len: t.length }; }, sel);
  const f = `${OUT}/${c.module}_${++n}.txt`; fs.writeFileSync(f, await pg.evaluate(s => [...document.querySelectorAll(s)].map(e => e.innerText).join('\n'), sel));
  console.log(`\n##### [${c.module}] ${c.label || ''}  files=${(c.files || []).map(x => path.basename(x)).join(' + ')}\nerrors: ${errs.length ? '\n  ' + [...new Set(errs)].join('\n  ') : 'none'}${dl.length ? '\ndownloads: ' + dl.join(', ') : ''}\nstatus: ${info.status.replace(/\s+/g, ' ').slice(0, 220)}\npreview chars: ${info.len}  -> ${f}\n${c.show === false ? '' : info.text.split('\n').slice(0, c.lines ?? 8).join('\n')}`);
  await ctx.close(); if (py) py.kill();
}
await b.close(); srv.close();
