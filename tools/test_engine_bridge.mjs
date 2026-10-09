// Проверка на моста LPS.engine <-> engine сървис: страница с имитация на WebView2 + истински engine (OCR на сканиран PDF).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginePort = 5499;
const eng = spawn('python3', [path.join(repo, 'runtime/engine/run.py')], { env: { ...process.env, TEOKROZE_PORT: String(enginePort), TEOKROZE_RUNTIME: path.join(repo, 'runtime'), TEOKROZE_WATCH_STDIN: '0', TEOKROZE_DATA_DIR: '/tmp/claude-0/engine_data' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${enginePort}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
// скениран PDF от тестовия генератор
execFileSync('python3', ['-c', `
import sys; sys.path.insert(0,'${repo}/tests/engine'); import test_engine as t
open('/tmp/claude-0/scanned.pdf','wb').write(t.scanned_pdf())`]);
const pdf = fs.readFileSync('/tmp/claude-0/scanned.pdf');
const page = http.createServer((q, r) => {
  if (q.url === '/lps-engine.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); return r.end(fs.readFileSync(path.join(repo, 'runtime/lps-engine.js'))); }
  r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>x</body></html>');
}).listen(0);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM }); const pg = await b.newPage();
await pg.addInitScript(`(function(){ var ls=[]; window.chrome=window.chrome||{}; window.chrome.webview={
  postMessage:function(m){ if(m.cmd==='engine.start') setTimeout(function(){ ls.forEach(function(f){ f({data:{cmd:'engine.ready',url:'http://127.0.0.1:${enginePort}'}}); }); },50); },
  addEventListener:function(t,f){ ls.push(f); }, removeEventListener:function(t,f){ ls=ls.filter(function(x){return x!==f;}); } }; })();`);
await pg.goto(`http://127.0.0.1:${page.address().port}/`);
await pg.addScriptTag({ url: '/lps-engine.js' });
const res = await pg.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const f = new File([bytes], 'scan.pdf', { type: 'application/pdf' });
  const r = await LPS.engine.pdfText(f, { ocr: 'auto' });
  return { available: LPS.engine.available(), ocr: r.pages[0].ocr, text: r.pages[0].text };
}, pdf.toString('base64'));
console.log(JSON.stringify(res));
const ok = res.available && res.ocr && /12345/.test(res.text.replace(/\s/g, ''));
console.log(ok ? 'OK   мостът LPS.engine + OCR работи' : 'FAIL');
await b.close(); page.close(); eng.kill();
process.exit(ok ? 0 : 1);
