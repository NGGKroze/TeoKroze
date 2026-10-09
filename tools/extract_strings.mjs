// Извлича текстовете за превод от модул: статичен DOM (вкл. скрити панели) + атрибути + низове от скриптовете.
// node tools/extract_strings.mjs <id> > out.json
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const id = process.argv[2]; const url = process.env.URL || `http://127.0.0.1:${srv.address().port}/${id}/index.html`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM }); const pg = await b.newPage();
await pg.goto(url); await pg.waitForTimeout(1000);
const dom = await pg.evaluate(() => {
  const out = new Set(); const hasLetters = s => /[A-Za-zÀ-ÿ]{2,}/.test(s) && !/[А-Яа-я]/.test(s);
  const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue; const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t && hasLetters(t)) out.add(t); }
  document.querySelectorAll('*').forEach(e => { for (const a of ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-tooltip']) { const v = e.getAttribute(a); if (v && hasLetters(v)) out.add(v.replace(/\s+/g, ' ').trim()); } if (e.tagName === 'INPUT' && /button|submit/.test(e.type) && e.value) out.add(e.value); if (e.tagName === 'OPTION' && e.textContent.trim()) out.add(e.textContent.replace(/\s+/g, ' ').trim()); });
  out.add(document.title); return [...out];
});
const html = fs.readFileSync(url.includes('127.0.0.1:53') || !process.env.URL ? path.join(root, id, 'index.html') : '/dev/null', 'utf8');
const lits = new Set();
for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
  if (m[1].length > 400000) continue;
  for (const s of m[1].matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){6,220})\1/g)) { const t = s[2].replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim(); if (/[A-Za-z]{3,}.*\s.*[A-Za-z]{2,}/.test(t) && !/[{};=<>]/.test(t.replace(/\$\{[^}]*\}/g, '')) && !/^(https?:|data:|[\w.-]+\/)/.test(t)) lits.add(t); }
}
console.log(JSON.stringify({ dom, js: [...lits] }));
await b.close(); srv.close();
