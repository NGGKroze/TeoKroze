// Тест с реални файлове: зарежда Raw Data в модула, записва снимка + текст + грешки.
// DATA="<папка Labels DataBase>" PLAYWRIGHT_PATH=... CHROMIUM=... node tools/realdata.mjs <out> [id ...]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const D = process.env.DATA; const out = process.argv[2]; const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const F = (...p) => path.join(D, ...p);
const CASES = {
  frankie:   [[F('THE FRANKIE SHOP - DONE','Raw Data','THE FRANKIE SHOP PL-TROUSERS EU.xls')]],
  reformation:[[F('REFORMATION - DONE','PL _REFORMATION EU.xlsx')]],
  jacquemus: [[F('JACQUEMUS - Done','PACKING LIST.xlsx'), F('JACQUEMUS - Done','BARCODE FILE.xlsx')]],
  ganni:     [[F('GANNI - DONE','Packing List Example_Printed Stretch Cotton Open Collar Jacket EU.xlsx')]],
  eres:      [[F('ERES - Done','PL 13.03.26_Ani 9.xlsx')]],
  tresse:    [[F('TRESSE - DONE','TRESSE CACHASSA.xlsx')]],
  ami:       [[F('AMI PARIS - DONE','NEW Standard PKL_E26 HSH843.LY0001.xlsx')]],
  yse:       [[F('YSE - DONE','Raw Data','YSE - Trame PL.xlsx')]],
  zadig:     [[F('ZV - DONE','TULBA SHIMMER PL 1000014029-QEU.xlsx')]],
  dior:      [[F('PL','Packing list U640W Dior Blue PO 1264457.xlsx')]],
  longchamp: [[F('FW_ Labels','Labels LCH.xlsx')]],
  chanel:    [[F('FW_ Labels','SUIT PANTS box labels - 868645.xlsx')]],
  'stella-suzie': [[F('PL','PL - CAMELEA.xlsx')]],
  margiela:  [[F('FW_ Labels','ETIQUETTE COLIS.xlsx')]],
};
const STEPS = {
  reformation: { pre: ['text=Labels from Excel PL (Legacy)'] },
  jacquemus: { post: ['text=Generate Labels'] },
  zadig: { pre: ['text=Готов PL'] },
};
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
for (const [id, sets] of Object.entries(CASES)) {
  if (only.length && !only.includes(id)) continue;
  for (const [i, files] of sets.entries()) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const pg = await ctx.newPage(); const errs = []; const dl = [];
    pg.on('pageerror', e => errs.push('PAGEERR ' + String(e).slice(0, 160)));
    pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
    pg.on('dialog', d => { errs.push('DIALOG ' + d.message().slice(0, 160)); d.dismiss().catch(() => {}); });
    pg.on('download', d => dl.push(d.suggestedFilename()));
    await pg.goto(`http://127.0.0.1:${srv.address().port}/${id}/index.html`); await pg.waitForTimeout(500);
    for (const sel of (STEPS[id]?.pre || [])) { try { await pg.click(sel, { timeout: 3000 }); await pg.waitForTimeout(400); } catch (e) { errs.push('PRECLICK ' + sel); } }
    const inputs = await pg.$$('input[type=file]');
    try {
      for (const [k, f] of files.entries()) {
        if (!fs.existsSync(f)) { errs.push('NOFILE ' + f); continue; }
        const inp = inputs[Math.min(k, inputs.length - 1)];
        await inp.setInputFiles(f);
        await pg.waitForTimeout(1500);
      }
    } catch (e) { errs.push('UPLOADERR ' + String(e).slice(0, 160)); }
    for (const sel of (STEPS[id]?.post || [])) { try { await pg.click(sel, { timeout: 3000 }); await pg.waitForTimeout(1200); } catch (e) { errs.push('POSTCLICK ' + sel); } }
    await pg.waitForTimeout(2500);
    const text = (await pg.evaluate(() => document.body.innerText)).replace(/\s+\n/g, '\n').slice(0, 700);
    await pg.screenshot({ path: `${out}/${id}${i}.png`, fullPage: false });
    console.log(`\n===== ${id}#${i}  files=${files.map(f => path.basename(f)).join(' + ')}\nerrors: ${errs.length ? '\n  ' + errs.join('\n  ') : 'none'}\ndownloads: ${dl.join(', ') || '-'}\n--- text:\n${text}`);
    await ctx.close();
  }
}
await b.close(); srv.close();
