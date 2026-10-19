#!/usr/bin/env node
// Корпус от реални файлове за подобряване на парсването ("златен снимък").
//   node tools/corpus.mjs add <модул> <файл...> [--name случай]   - създава случай (копира файловете, прави case.json)
//   node tools/corpus.mjs update [модул[/случай]]                 - записва снимка на резултата (след като сте го проверили!)
//   node tools/corpus.mjs run [модул[/случай]]                    - сравнява текущия резултат със снимката (код 1 при разлика)
// Корпусът е в LPS_CORPUS (по подразбиране tests/corpus - извън git: съдържа клиентски данни).
// Резултатът е текстът на прегледа/етикетите на модула след зареждане на файловете (case.json: "preview" селектор).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { spawn } from 'node:child_process'; import net from 'node:net';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const modules = path.join(repo, 'modules');
const corpus = process.env.LPS_CORPUS || path.join(repo, 'tests', 'corpus');
const PY = new Set(['acne', 'asphalte', 'courreges']);
const PREVIEW = { ganni: '#preview-grid', eres: '#previewContainer', tresse: '#labels-container', jacquemus: '#labels-container', frankie: '#labelGrid, #printArea', ami: '#preview-grid', yse: '#previewContainer',
  dior: '#packing-preview, #pages-container', kenzo: '#plPreview, #boxPreview, #shippingPreview', zadig: '#packingListPreview, #preview', chanel: '#preview-content', longchamp: '#previewBody', margiela: '#printArea',
  'stella-suzie': '#labelsPreviewContainer', reformation: '#labels-preview-container, #excel-previewContainer, #pl-preview-table-container', loreal: '#previewTableWrap', acne: '#orders', asphalte: '#results', courreges: '#orderCards, .tableWrap' };
const [cmd, ...rest] = process.argv.slice(2);

function freePort() { return new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function cases(filter) {
  const out = [];
  if (!fs.existsSync(corpus)) return out;
  for (const m of fs.readdirSync(corpus)) for (const c of fs.existsSync(path.join(corpus, m)) ? fs.readdirSync(path.join(corpus, m)) : []) {
    const dir = path.join(corpus, m, c); if (!fs.existsSync(path.join(dir, 'case.json'))) continue;
    if (filter && filter !== m && filter !== `${m}/${c}`) continue;
    out.push({ module: m, name: c, dir, cfg: JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) });
  }
  return out;
}

async function snapshot(browser, srvPort, c, startPy) {
  const id = c.module; let url, py = null;
  if (PY.has(id)) { const port = await freePort(); py = await startPy(id, port); url = `http://127.0.0.1:${port}/`; }
  else url = `http://127.0.0.1:${srvPort}/${id}/index.html`;
  const pg = await browser.newPage({ viewport: { width: 1400, height: 900 } }); pg.on('dialog', d => d.dismiss().catch(() => {}));
  await pg.goto(url); await pg.waitForTimeout(700);
  for (const s of c.cfg.pre || []) { await pg.click(s, { timeout: 4000 }); await pg.waitForTimeout(300); }
  const inputs = await pg.$$('input[type=file]');
  for (const [k, f] of (c.cfg.files || []).entries()) { await inputs[Math.min(c.cfg.inputIndex?.[k] ?? k, inputs.length - 1)].setInputFiles(path.join(c.dir, f)); await pg.waitForTimeout(c.cfg.wait ?? 1500); }
  for (const s of c.cfg.post || []) { await pg.click(s, { timeout: 4000 }); await pg.waitForTimeout(1200); }
  await pg.waitForTimeout(c.cfg.settle ?? 2000);
  const sel = c.cfg.preview || PREVIEW[id] || 'body';
  const lines = await pg.evaluate(s => [...document.querySelectorAll(s)].map(e => e.innerText).join('\n').split('\n').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean), sel);
  await pg.close(); if (py) py.kill();
  return lines;
}

async function main() {
  if (cmd === 'add') {
    const ni = rest.indexOf('--name'); const pos = rest.filter((a, i) => !a.startsWith('--') && !(ni >= 0 && i === ni + 1)); const [mod, ...files] = pos;
    if (!mod || !files.length) { console.log('употреба: corpus.mjs add <модул> <файл...> [--name случай]'); process.exit(2); }
    const name = ni >= 0 ? rest[ni + 1] : path.basename(files[0], path.extname(files[0])).replace(/[^\w.-]+/g, '_');
    const dir = path.join(corpus, mod, name); fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.copyFileSync(f, path.join(dir, path.basename(f)));
    fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify({ files: files.map(f => path.basename(f)), preview: PREVIEW[mod] || 'body', pre: [], post: [] }, null, 2) + '\n');
    console.log(`добавен случай ${mod}/${name} в ${dir}\nсега: node tools/corpus.mjs update ${mod}/${name}  (след като проверите резултата)`); return;
  }
  if (!['run', 'update'].includes(cmd)) { console.log('команди: add | update | run'); process.exit(2); }
  const list = cases(rest[0]);
  if (!list.length) { console.log(`няма случаи в ${corpus}. Добавете: node tools/corpus.mjs add <модул> <файл...>`); return; }
  const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
  const srv = http.createServer((q, r) => { const p = path.join(modules, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
  const startPy = async (id, port) => { const p = spawn(process.env.PYTHON || 'python3', [path.join(modules, id, 'run.py')], { env: { ...process.env, TEOKROZE_PORT: String(port), TEOKROZE_RUNTIME: path.join(repo, 'runtime'), TEOKROZE_WATCH_STDIN: '0', TEOKROZE_DATA_DIR: path.join(fs.mkdtempSync('/tmp/lpsc-'), 'd') }, stdio: 'ignore' }); for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } } return p; };
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  let bad = 0;
  for (const c of list) {
    const lines = await snapshot(browser, srv.address().port, c, startPy); const snapFile = path.join(c.dir, 'snapshot.json');
    if (cmd === 'update') { fs.writeFileSync(snapFile, JSON.stringify(lines, null, 1) + '\n'); console.log(`записан  ${c.module}/${c.name}  (${lines.length} реда)`); continue; }
    if (!fs.existsSync(snapFile)) { console.log(`БЕЗ СНИМКА ${c.module}/${c.name} - пуснете update`); bad++; continue; }
    const exp = JSON.parse(fs.readFileSync(snapFile, 'utf8')); const same = exp.length === lines.length && exp.every((l, i) => l === lines[i]);
    if (same) console.log(`OK    ${c.module}/${c.name}  (${lines.length} реда)`);
    else { bad++; console.log(`РАЗЛИКА ${c.module}/${c.name}`); const es = new Set(exp), ls = new Set(lines); exp.filter(l => !ls.has(l)).slice(0, 15).forEach(l => console.log('  - ' + l.slice(0, 140))); lines.filter(l => !es.has(l)).slice(0, 15).forEach(l => console.log('  + ' + l.slice(0, 140))); }
  }
  await browser.close(); srv.close(); process.exit(bad ? 1 : 0);
}
main();
