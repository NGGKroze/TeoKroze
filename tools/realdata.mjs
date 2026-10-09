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
  frankie:   [[F('THE FRANKIE SHOP - DONE','Raw Data','THE FRANKIE SHOP PL-TROUSERS EU.xls')], [F('THE FRANKIE SHOP - DONE','Raw Data','THE FRANKIE SHOP PL-TROUSERS US.xls')]],
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
  reformation: { pre: ['#btn-tab-excel'] },
  jacquemus: { post: ['#btn-generate, button:has-text("Generate Labels"), button:has-text("Генерирай етикети")'] },
  zadig: { pre: ['#manualModeTab'] },
};
// THEME=1 -> вкарва и темата + превода (като обвивката), за да се види, че нищо не се чупи
function lpsScripts(id) {
  const rd = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  const c = rd(path.join(repo, 'runtime/i18n/common.bg.json')), m = rd(path.join(root, id, 'bg.json'));
  const dict = { exact: { ...c.exact, ...m.exact }, patterns: [...(c.patterns || []), ...(m.patterns || [])], skip: [...new Set([...(c.skip || []), ...(m.skip || [])])] };
  const css = fs.readFileSync(path.join(repo, 'runtime/lps-theme.css'), 'utf8') + (fs.existsSync(path.join(root, id, 'lps.css')) ? '\n' + fs.readFileSync(path.join(root, id, 'lps.css'), 'utf8') : '');
  return [fs.readFileSync(path.join(repo, 'runtime/lps-theme.js'), 'utf8').replace('{{MODULE}}', JSON.stringify(id)).replace('{{CSS}}', JSON.stringify(css)),
    fs.readFileSync(path.join(repo, 'runtime/lps-i18n.js'), 'utf8').replace('{{DICT}}', JSON.stringify(dict))];
}
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
    if (process.env.THEME) for (const sc of lpsScripts(id)) await pg.addInitScript(sc);
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
    fs.writeFileSync(`${out}/${id}${i}.txt`, await pg.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('input,textarea,select')].map(e => e.value).join('\n')));
    console.log(`\n===== ${id}#${i}  files=${files.map(f => path.basename(f)).join(' + ')}\nerrors: ${errs.length ? '\n  ' + errs.join('\n  ') : 'none'}\ndownloads: ${dl.join(', ') || '-'}\n--- text:\n${text}`);
    await ctx.close();
  }
}
await b.close(); srv.close();
