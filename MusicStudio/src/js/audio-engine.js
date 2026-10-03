// Audio decoding, playback, spectrum analysis and WAV encoding.

export const FFT_SIZE = 2048;

// In-place radix-2 FFT on separate real/imag arrays.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hann = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

// Analyses an AudioBuffer at arbitrary time positions. Because the analysis is
// computed from the decoded samples (not a live AnalyserNode), the preview and
// the exported video are frame-for-frame identical.
export class Analyzer {
  constructor(buffer) {
    this.sampleRate = buffer.sampleRate;
    this.duration = buffer.duration;
    const len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / buffer.numberOfChannels;
    }
    this.mono = mono;
    this.re = new Float32Array(FFT_SIZE);
    this.im = new Float32Array(FFT_SIZE);
    this.mag = new Float32Array(FFT_SIZE / 2);
    this.wave = new Float32Array(1024);
  }

  // Fills this.mag with normalised (0..1) magnitudes for the window at time t.
  analyse(t) {
    const { re, im, mono, mag } = this;
    const start = Math.floor(t * this.sampleRate) - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < mono.length ? mono[idx] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const m = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (FFT_SIZE / 4);
      const db = 20 * Math.log10(m + 1e-9);
      mag[i] = Math.min(1, Math.max(0, (db + 80) / 70));
    }
    const ws = Math.floor(t * this.sampleRate) - this.wave.length / 2;
    for (let i = 0; i < this.wave.length; i++) {
      const idx = ws + i;
      this.wave[i] = idx >= 0 && idx < mono.length ? mono[idx] : 0;
    }
    return mag;
  }

  binForFreq(f) {
    return Math.min(FFT_SIZE / 2 - 1, Math.max(1, Math.round((f * FFT_SIZE) / this.sampleRate)));
  }

  // Average energy of a frequency range from the last analyse() call.
  band(f0, f1) {
    const a = this.binForFreq(f0), b = Math.max(a + 1, this.binForFreq(f1));
    let s = 0;
    for (let i = a; i < b; i++) s += this.mag[i];
    return s / (b - a);
  }

  // Log-spaced bars between 30 Hz and 16 kHz.
  bars(count, out) {
    const lo = Math.log(30), hi = Math.log(16000);
    for (let i = 0; i < count; i++) {
      const f0 = Math.exp(lo + ((hi - lo) * i) / count);
      const f1 = Math.exp(lo + ((hi - lo) * (i + 1)) / count);
      let a = this.binForFreq(f0), b = this.binForFreq(f1);
      if (b <= a) b = a + 1;
      let m = 0;
      for (let k = a; k < b; k++) m = Math.max(m, this.mag[k]);
      // gentle treble lift so high bars are not always flat
      out[i] = Math.min(1, m * (0.85 + 0.35 * (i / count)));
    }
    return out;
  }
}

export async function decodeAudio(arrayBuffer) {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return await ctx.decodeAudioData(arrayBuffer.slice(0));
}

// Resample to 16 kHz mono for speech recognition.
export async function toMono16k(buffer) {
  const len = Math.ceil(buffer.duration * 16000);
  const ctx = new OfflineAudioContext(1, len, 16000);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

export function encodeWav(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const dataLen = len * ch * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(ab);
}

// Simple transport around an AudioBuffer.
export class Player {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.src = null;
    this.gain = null;
    this.offset = 0;
    this.startedAt = 0;
    this.playing = false;
    this.volume = 0.9;
    this.onEnded = null;
  }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
  }

  setBuffer(buffer) {
    this.stop();
    this.buffer = buffer;
    this.offset = 0;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  get currentTime() {
    if (!this.buffer) return 0;
    if (!this.playing) return this.offset;
    return Math.min(this.duration, this.offset + (this.ctx.currentTime - this.startedAt));
  }

  play() {
    if (!this.buffer || this.playing) return;
    this.ensureCtx();
    this.ctx.resume();
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.onended = () => {
      if (this.src !== src) return;
      this.offset = this.currentTime;
      this.playing = false;
      this.src = null;
      if (this.onEnded) this.onEnded();
    };
    src.start(0, this.offset);
    this.src = src;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.playing = false;
    const s = this.src;
    this.src = null;
    try { s.stop(); } catch (e) { /* ignore */ }
  }

  stop() {
    this.pause();
    this.offset = 0;
  }

  seek(t) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) this.play();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }
}
