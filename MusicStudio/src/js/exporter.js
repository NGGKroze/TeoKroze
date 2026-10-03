// Frame-by-frame video export: every frame is rendered off-screen at the target
// resolution and streamed to ffmpeg (in the main process) together with the
// audio. No dropped frames, any resolution, independent of the preview.

import { Renderer } from './visualizer.js';
import { encodeWav } from './audio-engine.js';

export function dimensions(format) {
  const short = parseInt(format.res, 10);
  const [a, b] = format.aspect.split(':').map(Number);
  let w, h;
  if (a >= b) { h = short; w = Math.round((short * a) / b); }
  else { w = short; h = Math.round((short * b) / a); }
  return { width: w - (w % 2), height: h - (h % 2) };
}

function sliceBuffer(buffer, seconds) {
  const len = Math.min(buffer.length, Math.floor(seconds * buffer.sampleRate));
  if (len >= buffer.length) return buffer;
  const out = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(0, len), c);
  return out;
}

function seekVideo(video, t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.001) return resolve();
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
    setTimeout(done, 2000);
  });
}

export async function exportVideo({ settings, buffer, analyzer, lines, media, outPath, onProgress, isCancelled }) {
  const { width, height } = dimensions(settings.format);
  const fps = parseInt(settings.format.fps, 10);
  const audio = settings.format.range === 'full' ? buffer : sliceBuffer(buffer, parseFloat(settings.format.range));
  const duration = audio.duration;
  const frames = Math.ceil(duration * fps);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const renderer = new Renderer();

  const video = settings.background.type === 'video' ? media.bgVideo : null;
  if (video) video.pause();

  await window.studio.exportStart({
    outPath, width, height, fps,
    wav: encodeWav(audio),
    format: settings.format.container,
    quality: settings.format.quality,
  });

  const t0 = performance.now();
  let pending = null;
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled()) {
        if (pending) await pending.catch(() => {});
        await window.studio.exportCancel();
        return null;
      }
      const t = i / fps;
      if (video && video.duration) await seekVideo(video, t % video.duration);
      renderer.render(ctx, width, height, settings, t, 1 / fps, analyzer, lines, media);
      const data = ctx.getImageData(0, 0, width, height).data;
      if (pending) await pending;
      pending = window.studio.exportFrame(new Uint8Array(data.buffer));
      if (i % 5 === 0) {
        const elapsed = (performance.now() - t0) / 1000;
        const eta = (elapsed / (i + 1)) * (frames - i - 1);
        onProgress((i + 1) / frames, `Frame ${i + 1} / ${frames} · ${(((i + 1) / elapsed) || 0).toFixed(1)} fps · ~${Math.ceil(eta)} s left`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (pending) await pending;
  } catch (err) {
    await window.studio.exportCancel();
    throw err;
  }
  onProgress(1, 'Finalising video…');
  return await window.studio.exportFinish();
}
