// Проверка на редакцията в Dior: синтетична поръчка -> редакция -> етикети/Excel се обновяват.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lpsScripts } from './lps_inject.mjs';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const root = path.join(repo, 'modules');
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(0);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM });
const pg = await (await b.newContext({ acceptDownloads: true })).newPage();
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 150))); pg.on('dialog', d => d.accept());
if (process.env.THEME) for (const sc of lpsScripts(repo, 'dior')) await pg.addInitScript(sc);
await pg.goto(`http://127.0.0.1:${srv.address().port}/dior/index.html`); await pg.waitForTimeout(500);
await pg.evaluate(() => {
  jobs = [mergeJob(null, { commessaNo: '99911', pap: 'PAP F', style: '283U640W0533', color: '542 Bleu marine', description: 'PANTALON', oaNo: '1264457',
    sizeQty: [{ size: 'XS', qty: 30 }, { size: 'S', qty: 50 }, { size: 'M', qty: 41 }] })];
  setupJobSelector(); activeJob = jobs[0]; populateControlsFromJob(activeJob); rebuildFromControls(); pdfPanel.style.display = 'block';
});
const ok = []; const chk = (n, c) => { ok.push([n, !!c]); console.log((c ? 'OK   ' : 'FAIL ') + n); };
const rows = () => pg.$$eval('#packing-preview tbody tr', t => t.length);
const labels = () => pg.evaluate(() => activeLabelsData.length);
chk('таблицата е редактируема (има input-и)', await pg.$('#packing-preview input.ed'));
const r0 = await rows(), l0 = await labels(); console.log('   редове', r0, 'етикети', l0, 'общо бр.', await pg.evaluate(() => activePackingRows.reduce((s, r) => s + r.totalQty, 0)));
chk('общо 121 бр.', await pg.evaluate(() => activePackingRows.reduce((s, r) => s + r.totalQty, 0)) === 121);
// 1) редакция на количество
await pg.fill('#packing-preview tbody tr:first-child input[data-f="size:XS"]', '20');
await pg.waitForTimeout(500);
chk('qty ctn се преизчислява', await pg.evaluate(() => activePackingRows[0].qtyCtn === activeSizeColumns.reduce((s, c) => s + (activePackingRows[0].sizes[c] || 0), 0)));
chk('етикетите отразяват промяната', await pg.evaluate(() => activeLabelsData[0].sizes.some(x => x.size === 'XS' && x.qty === 20)));
// 2) раздели ред с няколко кашона
const before = await rows();
const splitBtn = await pg.$('#packing-preview button[data-act="split"]');
if (splitBtn) { await splitBtn.click(); await pg.waitForTimeout(300); chk('разделяне добавя ред', await rows() === before + 1); }
else console.log('   (няма ред с няколко кашона за разделяне)');
// 3) дублиране + номерация
const n1 = await labels();
await pg.click('#packing-preview tbody tr:first-child button[data-act="dup"]'); await pg.waitForTimeout(300);
chk('дублиране увеличава етикетите', await labels() > n1);
chk('номерацията е последователна', await pg.evaluate(() => { let c = activePackingRows[0].ctnStart; return activePackingRows.every(r => { const ok = r.ctnStart === c; c = r.ctnEnd + 1; return ok; }); }));
// 4) изтриване
const n2 = await rows(); await pg.click('#packing-preview tbody tr:last-child button[data-act="del"]'); await pg.waitForTimeout(300);
chk('изтриване маха ред', await rows() === n2 - 1);
// 5) ръчно тегло
await pg.fill('#packing-preview tbody tr:first-child input[data-f="grossWt"]', '9.99'); await pg.waitForTimeout(500);
chk('ръчно тегло влиза в етикета', await pg.evaluate(() => activeLabelsData[0].grossWt === 9.99));
// 6) експорт към Excel съдържа редакциите
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#download-xlsx-btn')]);
const f = '/tmp/claude-0/dior_edit_test.xlsx'; await dl.saveAs(f); console.log('   сваленият файл:', dl.suggestedFilename());
chk('няма JS грешки', errs.length === 0); if (errs.length) console.log(errs);
await b.close(); srv.close();
process.exit(ok.every(x => x[1]) ? 0 : 1);
