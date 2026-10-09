// Показва какво още е останало на английски/френски в модула СЛЕД превода (за допълване на bg.json).
// PLAYWRIGHT_PATH=... CHROMIUM=... node tools/i18n_report.mjs <id> [URL]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const id = process.argv[2]; const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const read = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
const common = read(path.join(repo, 'runtime/i18n/common.bg.json')), mod = read(path.join(root, id, 'bg.json'));
const dict = { exact: { ...common.exact, ...mod.exact }, patterns: [...(common.patterns || []), ...(mod.patterns || [])], skip: [...new Set([...(common.skip || []), ...(mod.skip || [])])] };
const script = fs.readFileSync(path.join(repo, 'runtime/lps-i18n.js'), 'utf8').replace('{{DICT}}', JSON.stringify(dict));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM }); const pg = await b.newPage();
await pg.addInitScript(script);
await pg.goto(process.argv[3] || `http://127.0.0.1:${srv.address().port}/${id}/index.html`); await pg.waitForTimeout(1200);
const left = await pg.evaluate((skip) => {
  const out = new Set(); const eng = s => /[A-Za-zÀ-ÿ]{3,}/.test(s) && !/[А-Яа-я]/.test(s);
  const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName) || (skip && p.closest(skip))) continue; const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t && eng(t)) out.add(t); }
  document.querySelectorAll('*').forEach(e => { if (skip && e.closest(skip)) return; for (const a of ['placeholder', 'title', 'aria-label']) { const v = e.getAttribute(a); if (v && eng(v)) out.add('[' + a + '] ' + v); } });
  return [...out];
}, dict.skip.join(','));
console.log(`${id}: останали ${left.length}`); left.forEach(s => console.log('  ' + s));
await b.close(); srv.close();
