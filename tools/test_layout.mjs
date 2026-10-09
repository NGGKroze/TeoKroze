// Проверка на единната структура за всички модули: докът се строи, селекторите се намират, няма JS грешки, при печат докът е скрит.
// (Python модулите трябва да са стартирани на 5301/5302/5303.)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lpsScripts } from './lps_inject.mjs';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const PY = { acne: 5301, asphalte: 5302, courreges: 5303 };
const only = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
let bad = 0;
for (const id of fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'layout.json'))).sort()) {
  if (only.length && !only.includes(id)) continue;
  const cfg = JSON.parse(fs.readFileSync(path.join(root, id, 'layout.json'), 'utf8'));
  const url = PY[id] ? `http://127.0.0.1:${PY[id]}/` : `http://127.0.0.1:${srv.address().port}/${id}/index.html`;
  const pg = await b.newPage({ viewport: { width: 1400, height: 860 } }); const errs = [];
  pg.on('pageerror', e => { const k = (JSON.parse(fs.readFileSync(path.join(root, id, 'module.json'), 'utf8')).knownPageErrors || []); const m = String(e).slice(0, 120); if (!k.some(x => m.includes(x))) errs.push(m); });
  for (const sc of lpsScripts(repo, id)) await pg.addInitScript(sc);
  // селекторите се проверяват ПРЕДИ преместването (с layout, но без да се строи) - затова втора страница без layout
  await pg.goto(url); await pg.waitForTimeout(900);
  const built = await pg.evaluate(() => !!document.getElementById('lps-head') && !!document.getElementById('lps-side'));
  const missing = [];
  const raw = await b.newPage(); await raw.goto(url); await raw.waitForTimeout(700);
  const sels = [...(cfg.hide || []), ...(cfg.side || []).flatMap(s => s.move || []), ...(cfg.actions || []).map(a => a.sel), ...(cfg.style || []).map(a => a.sel)];
  for (const s of sels) { const n = await raw.evaluate(sel => { sel = sel.replace(/<+$/, ''); try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }, s); if (n <= 0) missing.push(s + (n < 0 ? ' (невалиден)' : '')); }
  await raw.close();
  await pg.emulateMedia({ media: 'print' });
  const printHidden = await pg.evaluate(() => ['lps-head', 'lps-side', 'lps-bar'].every(i => { const e = document.getElementById(i); return !e || getComputedStyle(e).display === 'none'; }));
  const ok = built && !errs.length && printHidden && !missing.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id.padEnd(13)} dock=${built} print-hidden=${printHidden}${missing.length ? ' ЛИПСВАТ: ' + JSON.stringify(missing) : ''}${errs.length ? ' ГРЕШКИ: ' + JSON.stringify(errs) : ''}`);
  await pg.close();
}
await b.close(); srv.close(); process.exit(bad ? 1 : 0);
