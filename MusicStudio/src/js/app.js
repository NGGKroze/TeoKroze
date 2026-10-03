import { Analyzer, Player, decodeAudio, encodeWav, toMono16k } from './audio-engine.js';
import { PRESETS, KEYS, generateMusic } from './generator.js';
import { Renderer } from './visualizer.js';
import {
  parseLRC, parseSRT, distributePlain, detectFormat, serializeLRC, serializeSRT, fromTranscript, fmtTime,
} from './lyrics.js';
import { exportVideo, dimensions } from './exporter.js';

const $ = (id) => document.getElementById(id);

const FONTS = [
  ['Segoe UI, Inter, Helvetica, Arial, sans-serif', 'Sans (Segoe / Inter)'],
  ['Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', 'Impact'],
  ['Georgia, "Times New Roman", serif', 'Serif (Georgia)'],
  ['"Trebuchet MS", Verdana, sans-serif', 'Trebuchet'],
  ['"Courier New", Consolas, monospace', 'Monospace'],
  ['"Comic Sans MS", "Comic Neue", cursive', 'Handwritten (Comic)'],
  ['"Arial Black", "Helvetica Neue", Arial, sans-serif', 'Arial Black'],
  ['"Brush Script MT", "Segoe Script", cursive', 'Script'],
];

const DEFAULTS = {
  format: { aspect: '16:9', res: '1080', fps: '30', container: 'mp4', quality: 'high', range: 'full' },
  background: { type: 'gradient', color1: '#1a1033', color2: '#0b3d5c', blur: 12, dim: 30, zoomPulse: 50, drift: true },
  visualizer: {
    style: 'circle', bars: 64, color1: '#ff3d81', color2: '#5ad1ff', sensitivity: 100, smoothing: 70, glow: 45,
    opacity: 100, scale: 100, width: 80, posY: 45, offsetX: 0, rotate: 10, rounded: true, peaks: true, rainbow: false, spinCenter: true,
  },
  text: { title: '', artist: '', font: FONTS[0][0], size: 4.5, color: '#ffffff', position: 'bottom-left' },
  lyrics: {
    enabled: true, animation: 'karaoke', font: FONTS[0][0], size: 6, color: '#ffffff', highlight: '#ffd166',
    strokeColor: '#000000', stroke: 0, shadow: true, bold: true, uppercase: false, position: 'bottom',
    offsetX: 0, offsetY: 0, context: true, beatPulse: true, offset: 0,
  },
  effects: { vignette: 45, grain: 12, dust: 40, shake: 0, flash: 0 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k]) merge(base[k], over[k]);
    else if (k in base) base[k] = over[k];
  }
  return base;
}

const settings = clone(DEFAULTS);
const state = {
  buffer: null,
  analyzer: null,
  audioName: '',
  lines: [],
  media: { bgImage: null, bgVideo: null, centerImage: null },
  exporting: false,
  cancel: false,
  tap: null,
};

const player = new Player();
const renderer = new Renderer();
const canvas = $('preview');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- status

function status(text, progress) {
  $('statusText').textContent = text;
  $('statusText').title = text;
  if (progress != null) $('progressBar').style.width = `${Math.round(progress * 100)}%`;
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

// ---------------------------------------------------------------- binding

function getPath(path) {
  return path.split('.').reduce((o, k) => o[k], settings);
}
function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], settings)[last] = value;
}

function syncControls() {
  for (const el of document.querySelectorAll('[data-bind]')) {
    const v = getPath(el.dataset.bind);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
    updateRangeLabel(el);
  }
  resizeCanvas();
}

function updateRangeLabel(el) {
  if (el.type !== 'range') return;
  let lab = el.parentElement.querySelector('.val');
  if (!lab) {
    lab = document.createElement('span');
    lab.className = 'val';
    el.parentElement.appendChild(lab);
  }
  lab.textContent = el.value;
}

function initBindings() {
  for (const sel of document.querySelectorAll('.font-select')) {
    for (const [v, label] of FONTS) sel.add(new Option(label, v));
  }
  for (const el of document.querySelectorAll('[data-bind]')) {
    el.addEventListener('input', () => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || el.type === 'number') v = parseFloat(el.value);
      else v = el.value;
      setPath(el.dataset.bind, v);
      updateRangeLabel(el);
      if (el.dataset.bind === 'visualizer.style') onStyleChange(v);
      if (el.dataset.bind.startsWith('format.')) resizeCanvas();
    });
  }
  for (const el of document.querySelectorAll('input[type=range]:not([data-bind])')) {
    if (el.id === 'seek' || el.id === 'volume') continue;
    updateRangeLabel(el);
    el.addEventListener('input', () => updateRangeLabel(el));
  }
  syncControls();
}

function onStyleChange(style) {
  const V = settings.visualizer;
  if (style === 'bars' || style === 'mountains') { V.posY = 92; V.width = 90; }
  else if (style === 'mirror' || style === 'wave') { V.posY = 50; V.width = 85; }
  else { V.posY = 45; }
  syncControls();
}

// ---------------------------------------------------------------- tabs

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
  });
}

// ---------------------------------------------------------------- canvas / preview loop

function resizeCanvas() {
  const { width, height } = dimensions(settings.format);
  const k = Math.min(1, 1280 / Math.max(width, height));
  const w = Math.round(width * k), h = Math.round(height * k);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

let lastFrame = performance.now();
let lastT = 0;
function loop(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  const t = player.currentTime;
  if (Math.abs(t - lastT) > 1) renderer.reset();
  lastT = t;
  syncVideo(t);
  renderer.render(ctx, canvas.width, canvas.height, settings, t, player.playing ? dt : 0.016, state.analyzer, state.lines, state.media);
  if (!state.analyzer) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 ${canvas.height * 0.035}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Upload a song or generate music to start', canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
  updateTransport(t);
  requestAnimationFrame(loop);
}

function syncVideo(t) {
  const v = state.media.bgVideo;
  if (!v || settings.background.type !== 'video' || !v.duration || state.exporting) return;
  const target = t % v.duration;
  if (player.playing) {
    if (v.paused) v.play().catch(() => {});
    if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > 0.05 && !v.seeking) v.currentTime = target;
  }
}

// ---------------------------------------------------------------- transport

let seeking = false;
function updateTransport(t) {
  $('timeCur').textContent = fmtTime(t).slice(0, 5);
  $('timeDur').textContent = fmtTime(player.duration).slice(0, 5);
  if (!seeking && player.duration) $('seek').value = String(Math.round((t / player.duration) * 1000));
  $('btnPlay').textContent = player.playing ? '❚❚' : '▶';
}

function togglePlay() {
  if (!state.buffer) return;
  if (player.playing) player.pause();
  else player.play();
}

$('btnPlay').addEventListener('click', togglePlay);
$('seek').addEventListener('input', () => {
  seeking = true;
  player.seek((parseFloat($('seek').value) / 1000) * player.duration);
});
$('seek').addEventListener('change', () => { seeking = false; });
$('volume').addEventListener('input', () => player.setVolume(parseFloat($('volume').value) / 100));

document.addEventListener('keydown', (e) => {
  if (state.tap) {
    if (e.code === 'Space') { e.preventDefault(); tapMark(); }
    else if (e.code === 'Escape') finishTap();
    return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (e.code === 'Space' && !['input', 'textarea', 'select', 'button'].includes(tag)) {
    e.preventDefault();
    togglePlay();
  }
});

// ---------------------------------------------------------------- audio

function setAudio(buffer, name) {
  state.buffer = buffer;
  state.analyzer = new Analyzer(buffer);
  state.audioName = name;
  player.setBuffer(buffer);
  renderer.reset();
  $('audioInfo').textContent = `${name} · ${fmtTime(buffer.duration).slice(0, 5)} · ${buffer.sampleRate} Hz`;
  reparseLyrics();
}

$('audioFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status(`Decoding ${f.name}…`, 0.2);
  try {
    const buf = await decodeAudio(await f.arrayBuffer());
    setAudio(buf, f.name);
    if (!settings.text.title) {
      settings.text.title = f.name.replace(/\.[^.]+$/, '');
      syncControls();
    }
    status(`Loaded ${f.name}`, 1);
  } catch (err) {
    status(`Could not decode audio: ${err.message}`, 0);
  }
  e.target.value = '';
});

function initGenerator() {
  for (const [k, p] of Object.entries(PRESETS)) $('genPreset').add(new Option(p.label, k));
  for (const k of KEYS) $('genKey').add(new Option(k, k));
  $('genKey').value = 'A';
  $('genRandom').addEventListener('click', () => { $('genSeed').value = String(Math.floor(Math.random() * 99999)); });
  $('btnGenerate').addEventListener('click', () => generate());
  $('btnSaveWav').addEventListener('click', saveWav);
}

async function generate(quiet) {
  const btn = $('btnGenerate');
  setBusy(btn, true, 'Generating…');
  const opts = {
    preset: $('genPreset').value,
    key: $('genKey').value,
    scale: $('genScale').value,
    bpm: parseFloat($('genBpm').value) || 0,
    duration: parseFloat($('genDuration').value) || 60,
    seed: parseInt($('genSeed').value, 10) || 1,
    mix: {
      drums: $('mixDrums').value / 100, bass: $('mixBass').value / 100, chords: $('mixChords').value / 100,
      pad: $('mixPad').value / 100, lead: $('mixLead').value / 100,
    },
  };
  try {
    status('Composing & rendering music…', 0.05);
    const { buffer, info } = await generateMusic(opts, (p) => status('Composing & rendering music…', p));
    setAudio(buffer, `${info.preset} in ${info.key} ${info.scale} · ${Math.round(info.bpm)} BPM · seed ${opts.seed}`);
    status(quiet ? 'Demo track generated — upload your song or tweak and re-generate.' : `Generated ${info.bars} bars of ${info.preset}.`, 1);
  } catch (err) {
    console.error(err);
    status('Generation failed: ' + err.message, 0);
  }
  setBusy(btn, false);
}

async function saveWav() {
  if (!state.buffer) return status('Nothing to save yet.');
  const p = await window.studio.saveDialog({ defaultPath: 'track.wav', filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
  if (!p) return;
  await window.studio.writeFile(p, encodeWav(state.buffer));
  status(`Saved ${p}`, 1);
}

// ---------------------------------------------------------------- AI worker

let worker = null;
let jobId = 0;
const jobs = new Map();
function ai(type, payload, transfer) {
  if (!worker) {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        const pct = Math.min(100, m.progress || 0);
        status(m.file === 'generating' ? `Generating… ${pct.toFixed(0)}%` : `Downloading ${m.file || 'model'}… ${pct.toFixed(0)}%`, pct / 100);
      } else if (m.type === 'status') {
        status(m.message);
      } else if (m.type === 'done' || m.type === 'error') {
        const j = jobs.get(m.id);
        jobs.delete(m.id);
        if (!j) return;
        if (m.type === 'done') j.resolve(m.result);
        else j.reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      status('AI worker error: ' + (e.message || 'unknown'));
      for (const j of jobs.values()) j.reject(new Error(e.message || 'worker error'));
      jobs.clear();
      worker = null;
    };
  }
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transfer || []);
  });
}

$('btnAiGenerate').addEventListener('click', async () => {
  const btn = $('btnAiGenerate');
  setBusy(btn, true, 'Generating…');
  try {
    const res = await ai('musicgen', {
      prompt: $('aiPrompt').value.trim() || 'chill lofi beat',
      seconds: parseFloat($('aiSeconds').value) || 10,
      guidance: parseFloat($('aiGuidance').value) || 3,
      model: 'Xenova/musicgen-small',
    });
    const samples = new Float32Array(res.samples);
    const buf = new AudioBuffer({ length: samples.length, numberOfChannels: 2, sampleRate: res.sampleRate });
    buf.copyToChannel(samples, 0);
    buf.copyToChannel(samples, 1);
    setAudio(buf, `AI: ${$('aiPrompt').value.trim().slice(0, 40)}`);
    status('AI track ready.', 1);
  } catch (err) {
    console.error(err);
    status('AI generation failed: ' + err.message, 0);
  }
  setBusy(btn, false);
});

// ---------------------------------------------------------------- media uploads

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = URL.createObjectURL(file);
  });
}

$('bgImageFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.media.bgImage = await loadImage(f);
  settings.background.type = 'image';
  syncControls();
  $('bgInfo').textContent = `Image: ${f.name}`;
  e.target.value = '';
});

$('bgVideoFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const v = document.createElement('video');
  v.src = URL.createObjectURL(f);
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.addEventListener('loadeddata', () => {
    state.media.bgVideo = v;
    settings.background.type = 'video';
    syncControls();
    $('bgInfo').textContent = `Video: ${f.name} (${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} s, loops)`;
  }, { once: true });
  v.addEventListener('error', () => status('Could not load that video format.'), { once: true });
  e.target.value = '';
});

$('centerImageFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.media.centerImage = await loadImage(f);
  if (settings.visualizer.style !== 'circle') { settings.visualizer.style = 'circle'; onStyleChange('circle'); }
  e.target.value = '';
});

// ---------------------------------------------------------------- lyrics

const lyricsEl = $('lyricsText');
let reparseTimer = null;

function reparseLyrics() {
  const text = lyricsEl.value;
  const dur = state.buffer ? state.buffer.duration : 180;
  const fmt = detectFormat(text);
  if (!text.trim()) state.lines = [];
  else if (fmt === 'lrc') state.lines = parseLRC(text, dur);
  else if (fmt === 'srt') state.lines = parseSRT(text, dur);
  else state.lines = distributePlain(text, dur * 0.05, dur * 0.95, dur);
  const timed = fmt !== 'plain';
  $('lyricsInfo').textContent = !text.trim()
    ? 'No lyrics.'
    : `${state.lines.length} lines · ${timed ? (fmt.toUpperCase() + ' timing') : 'untimed — spread evenly in preview. Use Detect, Spread or Tap-sync for real timing.'}`;
}

lyricsEl.addEventListener('input', () => {
  clearTimeout(reparseTimer);
  reparseTimer = setTimeout(reparseLyrics, 250);
});

$('lyricsFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  lyricsEl.value = await f.text();
  reparseLyrics();
  e.target.value = '';
});

$('btnLrcSave').addEventListener('click', async () => {
  if (!state.lines.length) return status('No lyrics to save.');
  const p = await window.studio.saveDialog({ defaultPath: 'lyrics.lrc', filters: [{ name: 'LRC lyrics', extensions: ['lrc'] }] });
  if (p) { await window.studio.writeFile(p, serializeLRC(state.lines)); status(`Saved ${p}`, 1); }
});
$('btnSrtSave').addEventListener('click', async () => {
  if (!state.lines.length) return status('No lyrics to save.');
  const p = await window.studio.saveDialog({ defaultPath: 'lyrics.srt', filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }] });
  if (p) { await window.studio.writeFile(p, serializeSRT(state.lines)); status(`Saved ${p}`, 1); }
});

function plainLines() {
  return lyricsEl.value.split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim())
    .filter(Boolean);
}

$('btnSpread').addEventListener('click', () => {
  const dur = state.buffer ? state.buffer.duration : 180;
  const lines = distributePlain(plainLines().join('\n'), dur * 0.05, dur * 0.95, dur);
  lyricsEl.value = serializeLRC(lines);
  reparseLyrics();
  status('Lines spread evenly. Fine-tune by editing the [mm:ss.xx] times or use Tap-sync.');
});

$('btnDetect').addEventListener('click', async () => {
  if (!state.buffer) return status('Load a song first.');
  const btn = $('btnDetect');
  setBusy(btn, true, 'Detecting…');
  try {
    status('Preparing audio…', 0.02);
    const audio = await toMono16k(state.buffer);
    const result = await ai('transcribe', { audio, model: $('asrModel').value, language: $('asrLang').value }, [audio.buffer]);
    const lines = fromTranscript(result, state.buffer.duration);
    if (!lines.length) throw new Error('No vocals/lyrics detected.');
    lyricsEl.value = serializeLRC(lines);
    reparseLyrics();
    status(`Detected ${lines.length} lyric lines. Review and correct the text if needed.`, 1);
  } catch (err) {
    console.error(err);
    status('Lyrics detection failed: ' + err.message, 0);
  }
  setBusy(btn, false);
});

// Tap-sync
$('btnTapSync').addEventListener('click', () => {
  if (!state.buffer) return status('Load a song first.');
  const texts = plainLines();
  if (!texts.length) return status('Paste the lyrics (one line per row) first.');
  state.tap = { texts, times: [] };
  lyricsEl.blur();
  $('tapOverlay').hidden = false;
  $('tapNext').textContent = texts[0];
  player.seek(0);
  player.play();
});
$('tapOverlay').addEventListener('click', () => tapMark());

function tapMark() {
  const tp = state.tap;
  if (!tp) return;
  tp.times.push(player.currentTime);
  if (tp.times.length >= tp.texts.length) return finishTap();
  $('tapNext').textContent = tp.texts[tp.times.length];
}

function finishTap() {
  const tp = state.tap;
  state.tap = null;
  $('tapOverlay').hidden = true;
  player.pause();
  if (!tp || !tp.times.length) return;
  const dur = state.buffer.duration;
  const lines = tp.texts.map((text, i) => ({ t: tp.times[i], text }));
  // lines that were not tapped get spread over the remaining time
  const lastT = tp.times[tp.times.length - 1];
  const rest = lines.length - tp.times.length;
  for (let i = tp.times.length; i < lines.length; i++) {
    lines[i].t = lastT + ((i - tp.times.length + 1) / (rest + 1)) * (dur - lastT);
  }
  lyricsEl.value = serializeLRC(lines.map((l) => ({ ...l, words: null })));
  reparseLyrics();
  status(`Tap-sync done: ${tp.times.length} lines timed.`, 1);
}

// ---------------------------------------------------------------- export

async function doExport() {
  if (!state.buffer) return status('Load or generate audio first.');
  if (state.exporting) return;
  const ext = settings.format.container;
  const base = (settings.text.title || state.audioName || 'visualizer').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'visualizer';
  const outPath = await window.studio.saveDialog({
    defaultPath: `${base}.${ext}`,
    filters: [{ name: ext.toUpperCase() + ' video', extensions: [ext] }],
  });
  if (!outPath) return;
  player.pause();
  state.exporting = true;
  state.cancel = false;
  $('exportModal').hidden = false;
  $('btnExportCancel').hidden = false;
  $('btnExportOpen').hidden = true;
  $('btnExportClose').hidden = true;
  $('exportBar').style.width = '0%';
  $('exportText').textContent = 'Preparing…';
  try {
    const out = await exportVideo({
      settings: clone(settings),
      buffer: state.buffer,
      analyzer: state.analyzer,
      lines: state.lines,
      media: state.media,
      outPath,
      isCancelled: () => state.cancel,
      onProgress: (p, msg) => { $('exportBar').style.width = `${(p * 100).toFixed(1)}%`; $('exportText').textContent = msg; },
    });
    if (out) {
      $('exportText').textContent = `Done! Saved to:\n${out}`;
      $('btnExportOpen').hidden = false;
      $('btnExportOpen').onclick = () => window.studio.showItem(out);
      status('Export finished.', 1);
    } else {
      $('exportText').textContent = 'Export cancelled.';
    }
  } catch (err) {
    console.error(err);
    $('exportText').textContent = 'Export failed:\n' + err.message;
  }
  state.exporting = false;
  $('btnExportCancel').hidden = true;
  $('btnExportClose').hidden = false;
}

$('btnExport').addEventListener('click', doExport);
$('btnExport2').addEventListener('click', doExport);
$('btnExportCancel').addEventListener('click', () => { state.cancel = true; $('exportText').textContent = 'Cancelling…'; });
$('btnExportClose').addEventListener('click', () => { $('exportModal').hidden = true; });

// ---------------------------------------------------------------- project save / load

$('btnSaveProject').addEventListener('click', async () => {
  const p = await window.studio.saveDialog({ defaultPath: 'project.kroze.json', filters: [{ name: 'Kroze project', extensions: ['json'] }] });
  if (!p) return;
  const project = { version: 1, settings, lyrics: lyricsEl.value };
  await window.studio.writeFile(p, JSON.stringify(project, null, 2));
  status(`Project saved (settings + lyrics). Media files are not embedded.`, 1);
});

$('btnLoadProject').addEventListener('click', async () => {
  const paths = await window.studio.openDialog({ filters: [{ name: 'Kroze project', extensions: ['json'] }], properties: ['openFile'] });
  if (!paths || !paths[0]) return;
  try {
    const project = JSON.parse(await window.studio.readFile(paths[0], true));
    merge(settings, project.settings || {});
    lyricsEl.value = project.lyrics || '';
    syncControls();
    reparseLyrics();
    status('Project loaded. Re-add your audio / images if needed.', 1);
  } catch (err) {
    status('Could not open project: ' + err.message);
  }
});

// ---------------------------------------------------------------- boot

initBindings();
initGenerator();
requestAnimationFrame(loop);
window.studio?.ffmpegCheck().then((v) => {
  $('ffmpegInfo').textContent = v ? `Encoder: ${v.replace(/ Copyright.*/, '')}` : '⚠ ffmpeg not found — video export unavailable.';
});
generate(true);

// expose for debugging / automated tests
window.__studio = { settings, state, player, syncControls, reparseLyrics, generate };
