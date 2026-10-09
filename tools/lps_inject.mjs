// Сглобява същите скриптове като ThemeInjector.cs (тема + превод + структура) за тестове с Playwright.
import fs from 'node:fs'; import path from 'node:path';
export function lpsScripts(repo, id, opts = {}) {
  const root = path.join(repo, 'modules'), rt = path.join(repo, 'runtime');
  const rd = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) : null;
  const out = [];
  const css = fs.readFileSync(path.join(rt, 'lps-theme.css'), 'utf8') + (fs.existsSync(path.join(root, id, 'lps.css')) ? '\n' + fs.readFileSync(path.join(root, id, 'lps.css'), 'utf8') : '');
  const cat = rd(path.join(rt, 'themes.json')); const th = cat.themes.find(x => x.id === (opts.theme || cat.default)) || cat.themes[0];
  out.push(fs.readFileSync(path.join(rt, 'lps-theme.js'), 'utf8').replace('{{THEME}}', JSON.stringify(th.web)).replace('{{MODULE}}', JSON.stringify(id)).replace('{{CSS}}', JSON.stringify(css)));
  const lay = rd(path.join(root, id, 'layout.json'));
  if (lay && opts.layout !== false) out.push(fs.readFileSync(path.join(rt, 'lps-layout.js'), 'utf8').replace('{{LAYOUT}}', JSON.stringify(lay)));
  if (opts.i18n !== false) {
    const c = rd(path.join(rt, 'i18n/common.bg.json')) || {}, m = rd(path.join(root, id, 'bg.json')) || {};
    const dict = { exact: { ...c.exact, ...m.exact }, patterns: [...(c.patterns || []), ...(m.patterns || [])], skip: [...new Set([...(c.skip || []), ...(m.skip || [])])] };
    out.push(fs.readFileSync(path.join(rt, 'lps-i18n.js'), 'utf8').replace('{{DICT}}', JSON.stringify(dict)));
  }
  return out;
}
