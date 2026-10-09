// Снимки на всички клиенти С общата тема (огледало на ThemeInjector.cs).
// PLAYWRIGHT_PATH=$(npm root -g)/playwright CHROMIUM=... node tools/theme_shots.mjs <изходна_папка> [id ...]
// (Python модулите трябва да са стартирани на 5301/5302/5303, ако искате и тях.)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lpsScripts } from './lps_inject.mjs';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'modules'); const rt = path.join(repo, 'runtime');
const out = process.argv[2]; const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const html = fs.readdirSync(root).filter(d => fs.existsSync(`${root}/${d}/index.html`)).map(d => [d, `http://127.0.0.1:${srv.address().port}/${d}/index.html`]);
const targets = [...html, ['acne', 'http://127.0.0.1:5301/'], ['asphalte', 'http://127.0.0.1:5302/'], ['courreges', 'http://127.0.0.1:5303/']].filter(([id]) => !only.length || only.includes(id));
for (const [id, url] of targets) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 760 } });
  for (const sc of lpsScripts(repo, id, { layout: process.env.NOLAYOUT ? false : true })) await pg.addInitScript(sc);
  await pg.goto(url); await pg.waitForTimeout(1000);
  await pg.screenshot({ path: `${out}/${id}.png` }); await pg.close();
}
await b.close(); srv.close();
