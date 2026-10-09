// Smoke тест на страницата /lab: качва текстов PDF, скениран PDF и Excel и проверява какво се показва.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH);
import fs from 'node:fs'; import path from 'node:path'; import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const port = 5498;
const eng = spawn('python3', [path.join(repo, 'runtime/engine/run.py')], { env: { ...process.env, TEOKROZE_PORT: String(port), TEOKROZE_RUNTIME: path.join(repo, 'runtime'), TEOKROZE_WATCH_STDIN: '0', TEOKROZE_DATA_DIR: '/tmp/claude-0/engine_data2', TEOKROZE_OUTPUT_DIR: '/tmp/claude-0/lab_out' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise(r => setTimeout(r, 200)); } }
execFileSync('python3', ['-c', `
import sys; sys.path.insert(0,'${repo}/tests/engine'); import test_engine as t, test_lab as l
open('/tmp/claude-0/lab_text.pdf','wb').write(t.text_pdf()); open('/tmp/claude-0/lab_scan.pdf','wb').write(t.scanned_pdf()); open('/tmp/claude-0/lab_pl.xlsx','wb').write(l.sample_xlsx())`]);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM }); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
await pg.goto(`http://127.0.0.1:${port}/lab`);
const ok = []; const chk = (n, c) => { ok.push(!!c); console.log((c ? 'OK   ' : 'FAIL ') + n); };
await pg.setInputFiles('#file', '/tmp/claude-0/lab_text.pdf'); await pg.waitForSelector('#pdfUI:not(.hidden)', { timeout: 20000 });
chk('PDF с текст: изглед „по колони“', (await pg.textContent('#pdfBody')).includes('PACKING'));
await pg.click('#pdfTabs button:nth-child(3)'); chk('таблица с думи и координати', (await pg.textContent('#pdfBody')).includes('12345'));
await pg.click('#pdfTabs button:nth-child(4)'); await pg.waitForSelector('#pw img'); chk('страница с рамки (изображение + рамки)', (await pg.$$('#pw .box')).length > 3);
// мащабиране: бутони, ctrl+колело, остро изображение (по-висок dpi при голямо увеличение)
const z0 = await pg.textContent('#zVal'); await pg.click('#zIn'); await pg.click('#zIn'); await pg.waitForTimeout(400);
const z1 = await pg.textContent('#zVal'); chk('бутонът + увеличава (' + z0 + ' → ' + z1 + ')', parseInt(z1) > parseInt(z0));
const src1 = await pg.getAttribute('#pimg', 'src'); const dpi1 = Number((src1.match(/dpi=(\d+)/) || [])[1]); chk('изображението се рендира с по-висок dpi (' + dpi1 + ')', dpi1 >= 120);
const vpb = await pg.$eval('#vp', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await pg.mouse.move(vpb.x, vpb.y); await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -400); await pg.keyboard.up('Control'); await pg.waitForTimeout(400);
const z2 = await pg.textContent('#zVal'); chk('Ctrl+колело увеличава крайно (' + z2 + ')', parseInt(z2) > parseInt(z1));
await pg.click('#zFit'); await pg.waitForTimeout(300); chk('„Побери“ работи', parseInt(await pg.textContent('#zVal')) < parseInt(z2));
await pg.click('#z100'); chk('100%', (await pg.textContent('#zVal')) === '100%');
await pg.setInputFiles('#file', '/tmp/claude-0/lab_scan.pdf'); await pg.waitForFunction(() => /OCR/.test(document.getElementById('status').textContent), null, { timeout: 60000 });
chk('сканиран PDF: OCR', /OCR/.test(await pg.textContent('#status')));
await pg.click('#pdfTabs button:nth-child(1)'); chk('OCR текстът съдържа 12345', (await pg.textContent('#pdfBody')).replace(/\s/g, '').includes('12345'));
await pg.setInputFiles('#file', '/tmp/claude-0/lab_pl.xlsx'); await pg.waitForSelector('#tblUI:not(.hidden)');
chk('Excel: лист PL', (await pg.textContent('#sheetTabs')).includes('PL'));
chk('Excel: заглавен ред 3 е открит', (await pg.textContent('#tblBody')).includes('вероятни заглавни редове: 3'));
await pg.click('#btnSave'); await pg.waitForFunction(() => /записан/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
const zips = fs.readdirSync('/tmp/claude-0/lab_out/Анализ'); chk('пакетът е записан като ZIP', zips.some(z => z.endsWith('.zip')));
chk('няма JS грешки', !errs.length);
await b.close(); eng.kill(); process.exit(ok.every(Boolean) ? 0 : 1);
