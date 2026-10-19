// Резервният drag & drop: симулира съобщението lps.drop от обвивката и проверява, че страницата получава файла.
// PLAYWRIGHT_PATH=$(npm root -g)/playwright CHROMIUM=... node tools/test_drop_bridge.mjs <модул> <файл.xlsx>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const [mod, file] = process.argv.slice(2);
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM }); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.addInitScript(() => { window.chrome = window.chrome || {}; window.chrome.webview = { addEventListener: (t, f) => { window.__wv = f; }, removeEventListener() { }, postMessage() { } }; });
await pg.addInitScript({ path: path.join(repo, 'runtime', 'lps-engine.js') });
const errs = []; pg.on('pageerror', e => errs.push(String(e))); pg.on('dialog', d => { errs.push('DIALOG ' + d.message()); d.dismiss(); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/${mod}/index.html`); await pg.waitForTimeout(600);
const zone = await pg.evaluate(() => { const i = document.querySelector('input[type=file]'); const z = i && (i.closest('label,div,section') || i.parentElement); const r = z.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const b64 = fs.readFileSync(file).toString('base64');
await pg.evaluate(([m]) => window.__wv({ data: m }), [{ cmd: 'lps.drop', x: zone.x, y: zone.y, files: [{ name: path.basename(file), type: '', b64 }] }]);
await pg.waitForTimeout(3500);
const text = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
console.log('errors:', errs.length ? errs : 'none'); console.log(text);
await b.close(); srv.close();
