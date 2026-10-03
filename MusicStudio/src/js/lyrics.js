// Lyric timing: parsing/serialising LRC (incl. word-level "enhanced" LRC),
// SRT and plain text, converting speech-recognition output to lines, and
// drawing animated lyrics on a canvas.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

export function fmtTime(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}

function parseTime(str) {
  const m = str.trim().match(/^(\d+):(\d+(?:[.:]\d+)?)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.'));
}

// Fill in word timings and line ends.
export function finalizeLines(lines, duration) {
  lines = lines.filter((l) => l.text.trim().length).sort((a, b) => a.t - b.t);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const next = lines[i + 1];
    const words = l.text.trim().split(/\s+/);
    const naturalLen = Math.max(1.2, words.length * 0.45 + 0.6);
    if (l.end == null || !(l.end > l.t)) {
      l.end = next ? Math.min(next.t, l.t + Math.max(naturalLen, 1.5) + 2.5) : Math.min(duration || l.t + naturalLen + 2, l.t + naturalLen + 2);
      if (next && next.t - l.t < 8) l.end = next.t;
    }
    if (!l.words || l.words.length !== words.length) {
      // distribute word timings by character count over the "sung" portion of the line
      const singEnd = l.t + Math.min(l.end - l.t, naturalLen + 0.6);
      const total = words.reduce((s, w) => s + w.length + 1, 0);
      let acc = l.t;
      l.words = words.map((w) => {
        const len = ((w.length + 1) / total) * (singEnd - l.t);
        const word = { t: acc, end: acc + len, text: w };
        acc += len;
        return word;
      });
    }
  }
  return lines;
}

export function parseLRC(text, duration) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+:\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    let body = raw.replace(/\[(\d+:\d+(?:[.:]\d+)?)\]/g, '').trim();
    // enhanced LRC word tags: <mm:ss.xx>word
    let words = null;
    if (/<\d+:\d+/.test(body)) {
      words = [];
      const parts = [...body.matchAll(/<(\d+:\d+(?:[.:]\d+)?)>\s*([^<]*)/g)];
      for (const p of parts) {
        const t = parseTime(p[1]);
        const w = p[2].trim();
        if (w) words.push({ t, text: w, exact: true });
        else if (words.length) words[words.length - 1].end = t; // trailing end tag
      }
      for (let i = 0; i < words.length; i++) if (words[i].end == null) words[i].end = words[i + 1] ? words[i + 1].t : words[i].t + 0.4;
      body = words.map((w) => w.text).join(' ');
    }
    for (const tag of tags) {
      const t = parseTime(tag[1]);
      if (t == null) continue;
      lines.push({ t, text: body, words: words ? words.map((w) => ({ ...w })) : null });
    }
  }
  // line end: last word end if known
  for (const l of lines) if (l.words && l.words.length) l.end = l.words[l.words.length - 1].end + 0.6;
  return finalizeLines(lines, duration);
}

export function parseSRT(text, duration) {
  const lines = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const m = b.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const t = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    const body = b.split('\n').slice(b.split('\n').findIndex((x) => x.includes('-->')) + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (body) lines.push({ t, end, text: body });
  }
  return finalizeLines(lines, duration);
}

// Spread plain lines across [start, end] proportionally to their length.
export function distributePlain(text, start, end, duration) {
  const raw = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!raw.length) return [];
  const weights = raw.map((l) => 2 + l.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = start;
  const lines = raw.map((l, i) => {
    const len = (weights[i] / total) * (end - start);
    const line = { t: acc, end: acc + len, text: l };
    acc += len;
    return line;
  });
  return finalizeLines(lines, duration);
}

export function detectFormat(text) {
  if (/\[\d+:\d+/.test(text)) return 'lrc';
  if (/\d+:\d+:\d+[,.]\d+\s*-->/.test(text)) return 'srt';
  return 'plain';
}

export function serializeLRC(lines, withWords = true) {
  return lines.map((l) => {
    let s = `[${fmtTime(l.t)}]`;
    if (withWords && l.words && l.words.length && l.words.some((w) => w.exact)) {
      s += l.words.map((w) => `<${fmtTime(w.t)}>${w.text}`).join(' ');
      s += ` <${fmtTime(l.words[l.words.length - 1].end)}>`;
    } else {
      s += l.text;
    }
    return s;
  }).join('\n');
}

export function serializeSRT(lines) {
  const ts = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  return lines.map((l, i) => `${i + 1}\n${ts(l.t)} --> ${ts(l.end)}\n${l.text}\n`).join('\n');
}

// Convert transformers.js ASR output into lyric lines.
export function fromTranscript(result, duration, maxWords = 7) {
  const chunks = (result.chunks || []).filter((c) => c.text && c.text.trim());
  if (!chunks.length) {
    return result.text ? distributePlain(result.text.replace(/([.!?])\s+/g, '$1\n'), 0, duration, duration) : [];
  }
  const wordLevel = chunks.every((c) => c.text.trim().split(/\s+/).length <= 2);
  if (!wordLevel) {
    return finalizeLines(chunks.map((c) => ({ t: c.timestamp[0] || 0, end: c.timestamp[1] || null, text: c.text.trim() })), duration);
  }
  const lines = [];
  let cur = null;
  let prevEnd = -10;
  for (const c of chunks) {
    const t = c.timestamp[0] ?? prevEnd;
    const end = c.timestamp[1] ?? t + 0.3;
    const text = c.text.trim();
    const gap = t - prevEnd;
    const endsSentence = cur && /[.!?,;]$/.test(cur.words[cur.words.length - 1].text);
    if (!cur || gap > 0.7 || cur.words.length >= maxWords || (endsSentence && cur.words.length >= 3)) {
      cur = { t, words: [] };
      lines.push(cur);
    }
    cur.words.push({ t, end: Math.max(end, t + 0.08), text, exact: true });
    prevEnd = end;
  }
  for (const l of lines) {
    l.text = l.words.map((w) => w.text).join(' ');
    l.end = l.words[l.words.length - 1].end + 0.5;
  }
  for (let i = 0; i < lines.length - 1; i++) lines[i].end = Math.min(lines[i].end + 0.8, lines[i + 1].t);
  return finalizeLines(lines, duration);
}

// ---------------- drawing ----------------

function currentLineIndex(lines, time) {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time) idx = i;
    else break;
  }
  return idx;
}

function layoutLine(ctx, line, maxWidth, fontPx, lineGap) {
  const space = ctx.measureText(' ').width;
  const rows = [[]];
  let rowW = 0;
  for (const w of line.words) {
    const ww = ctx.measureText(w.text).width;
    if (rowW > 0 && rowW + space + ww > maxWidth) { rows.push([]); rowW = 0; }
    rows[rows.length - 1].push({ w, width: ww });
    rowW += (rowW > 0 ? space : 0) + ww;
  }
  const placed = [];
  const totalH = rows.length * fontPx * lineGap;
  rows.forEach((row, r) => {
    const width = row.reduce((s, x) => s + x.width, 0) + space * (row.length - 1);
    let x = -width / 2;
    for (const it of row) {
      placed.push({ ...it, x: x + it.width / 2, y: r * fontPx * lineGap - totalH / 2 + (fontPx * lineGap) / 2 });
      x += it.width + space;
    }
  });
  return { placed, totalH };
}

export function drawLyrics(ctx, W, H, lines, time, s, energy = 0) {
  if (!s.enabled || !lines || !lines.length) return;
  const idx = currentLineIndex(lines, time);
  const fontPx = Math.round(H * s.size / 100);
  const fontFor = (px) => `${s.bold ? '800' : '500'} ${px}px ${s.font}`;
  const anchorY = s.position === 'top' ? H * 0.2 : s.position === 'center' ? H * 0.5 : H * 0.8;
  const cx = W / 2 + (s.offsetX || 0) * W / 100;
  const cy = anchorY + (s.offsetY || 0) * H / 100;
  const maxWidth = W * 0.86;

  const prepText = (t) => (s.uppercase ? t.toUpperCase() : t);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const drawWordBase = (text, x, y, color, alpha, scale = 1, glow = 0) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (scale !== 1) ctx.scale(scale, scale);
    if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = fontPx * 0.25; ctx.shadowOffsetY = fontPx * 0.05; }
    if (glow) { ctx.shadowColor = s.highlight; ctx.shadowBlur = glow; ctx.shadowOffsetY = 0; }
    if (s.stroke > 0) { ctx.strokeStyle = s.strokeColor; ctx.lineWidth = s.stroke * fontPx / 20; ctx.strokeText(text, 0, 0); }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };

  // context lines (previous / next)
  if (s.context) {
    ctx.font = fontFor(Math.round(fontPx * 0.6));
    const gap = fontPx * 1.6;
    const prev = lines[idx - 1] && idx >= 0 && time < lines[idx].end ? lines[idx - 1] : null;
    const next = lines[idx + 1];
    if (prev) drawWordBase(prepText(prev.text), cx, cy - gap, s.color, 0.3);
    if (next && next.t - time < 6) drawWordBase(prepText(next.text), cx, cy + gap, s.color, 0.35);
  }

  if (idx < 0) { ctx.restore(); return; }
  const line = lines[idx];
  if (time > line.end) { ctx.restore(); return; }

  ctx.font = fontFor(fontPx);
  const disp = { ...line, words: line.words.map((w) => ({ ...w, text: prepText(w.text) })) };
  const { placed } = layoutLine(ctx, disp, maxWidth, fontPx, 1.2);

  const inT = clamp((time - line.t) / 0.35);
  const outT = clamp((line.end - time) / 0.35);
  const lineAlpha = Math.min(easeOutCubic(inT), outT);
  const anim = s.animation;

  let ox = 0, oy = 0;
  if (anim === 'slide') ox = (1 - easeOutCubic(inT)) * -W * 0.15 + (1 - outT) * W * 0.15;
  if (anim === 'fade') oy = (1 - easeOutCubic(inT)) * fontPx * 0.6;
  if (s.beatPulse) oy -= energy * fontPx * 0.15;

  for (const it of placed) {
    const w = it.w;
    const p = clamp((time - w.t) / Math.max(0.05, w.end - w.t));
    const active = time >= w.t && time < w.end;
    const sung = time >= w.t;
    const x = cx + it.x + ox;
    const y = cy + it.y + oy;

    switch (anim) {
      case 'karaoke': {
        drawWordBase(w.text, x, y, s.color, lineAlpha);
        if (p > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - it.width / 2 - fontPx, y - fontPx, fontPx + it.width * p, fontPx * 2);
          ctx.clip();
          drawWordBase(w.text, x, y, s.highlight, lineAlpha, 1, active ? fontPx * 0.3 : 0);
          ctx.restore();
        }
        break;
      }
      case 'pop': {
        if (!sung) break;
        const a = clamp((time - w.t) / 0.25);
        const sc = 0.4 + 0.6 * easeOutBack(a);
        drawWordBase(w.text, x, y, active ? s.highlight : s.color, Math.min(a * 1.5, 1) * outT, sc);
        break;
      }
      case 'typewriter': {
        const chars = Math.floor(w.text.length * p + (p > 0 ? 1 : 0));
        if (chars <= 0) break;
        const shown = w.text.slice(0, chars);
        ctx.save();
        ctx.textAlign = 'left';
        drawWordBase(shown, x - it.width / 2, y, active ? s.highlight : s.color, outT);
        ctx.restore();
        break;
      }
      case 'bounce': {
        const jump = active ? Math.sin(p * Math.PI) * fontPx * 0.35 : 0;
        drawWordBase(w.text, x, y - jump, active ? s.highlight : s.color, lineAlpha, active ? 1.12 : 1);
        break;
      }
      case 'glow': {
        drawWordBase(w.text, x, y, active ? s.highlight : s.color, lineAlpha * (sung ? 1 : 0.45), active ? 1.06 : 1, active ? fontPx * 0.6 : 0);
        break;
      }
      case 'slide':
        drawWordBase(w.text, x, y, active ? s.highlight : s.color, lineAlpha);
        break;
      case 'fade':
      default:
        drawWordBase(w.text, x, y, s.color, lineAlpha);
    }
  }
  ctx.restore();
}
