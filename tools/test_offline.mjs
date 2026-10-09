// Проверка: всеки HTML модул се зарежда без интернет (блокира всяка външна заявка).
// Употреба: PLAYWRIGHT_PATH=$(npm root -g)/playwright node tools/test_offline.mjs [id ...]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.png':'image/png', '.json':'application/json', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const wanted = process.argv.slice(2);
const ids = fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'index.html')) && fs.existsSync(path.join(root, d, 'module.json')) && (!wanted.length || wanted.includes(d)));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let bad = 0;
for (const id of ids) {
  const page = await browser.newPage();
  const external = [], missing = [], errors = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    external.push(u.href.slice(0, 100)); return route.abort();
  });
  page.on('response', r => { if (r.status() >= 400) missing.push(r.url().slice(0, 100)); });
  const known = (JSON.parse(fs.readFileSync(path.join(root, id, 'module.json'), 'utf8')).knownPageErrors) || [];
  page.on('pageerror', e => { const m = String(e).slice(0, 140); if (!known.some(k => m.includes(k))) errors.push(m); });
  await page.goto(`http://127.0.0.1:${port}/${id}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const ok = !external.length && !missing.length && !errors.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}`, ok ? '' : JSON.stringify({ external, missing, errors }));
  await page.close();
}
await browser.close(); server.close();
process.exit(bad ? 1 : 0);
