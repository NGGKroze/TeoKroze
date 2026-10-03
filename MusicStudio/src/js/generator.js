// Procedural music generator. Renders a full arrangement (drums, bass, chords,
// pad, lead melody) offline with the Web Audio API. Everything is driven by a
// seed, so the same settings always produce the same track.

export const PRESETS = {
  lofi: {
    label: 'Lo-fi Hip Hop', bpm: 82, scale: 'minor', swing: 0.18,
    chordWave: 'epiano', bassWave: 'sine', leadWave: 'triangle', padWave: 'sawtooth',
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    bass: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    progressions: [[1, 6, 3, 7], [2, 5, 1, 1], [1, 4, 7, 3], [6, 7, 1, 1]],
    seventh: true, crackle: true, masterLP: 6500, sidechain: false, leadDensity: 0.45, reverb: 0.35,
  },
  synthwave: {
    label: 'Synthwave', bpm: 104, scale: 'minor', swing: 0,
    chordWave: 'sawtooth', bassWave: 'sawtooth', leadWave: 'square', padWave: 'sawtooth',
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    bass: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    progressions: [[1, 6, 3, 7], [1, 4, 6, 5], [6, 4, 1, 5]],
    seventh: false, crackle: false, masterLP: 14000, sidechain: true, leadDensity: 0.55, reverb: 0.4,
  },
  house: {
    label: 'Deep House', bpm: 122, scale: 'minor', swing: 0.06,
    chordWave: 'epiano', bassWave: 'square', leadWave: 'sine', padWave: 'sawtooth',
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    bass: [0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0],
    progressions: [[1, 7, 6, 7], [1, 4, 1, 4], [6, 7, 1, 1]],
    seventh: true, crackle: false, masterLP: 16000, sidechain: true, leadDensity: 0.3, reverb: 0.3,
  },
  trap: {
    label: 'Trap', bpm: 140, scale: 'minor', swing: 0,
    chordWave: 'triangle', bassWave: '808', leadWave: 'triangle', padWave: 'sawtooth',
    kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    bass: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    progressions: [[1, 6, 1, 7], [1, 1, 6, 5], [1, 2, 6, 5]],
    seventh: false, crackle: false, masterLP: 16000, sidechain: false, leadDensity: 0.4, reverb: 0.3, halfTimeSnare: true,
  },
  pop: {
    label: 'Chill Pop', bpm: 100, scale: 'major', swing: 0,
    chordWave: 'epiano', bassWave: 'triangle', leadWave: 'triangle', padWave: 'sawtooth',
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    progressions: [[1, 5, 6, 4], [6, 4, 1, 5], [1, 6, 4, 5], [4, 5, 3, 6]],
    seventh: false, crackle: false, masterLP: 15000, sidechain: false, leadDensity: 0.55, reverb: 0.3,
  },
  ambient: {
    label: 'Ambient', bpm: 70, scale: 'major', swing: 0,
    chordWave: 'sine', bassWave: 'sine', leadWave: 'sine', padWave: 'sawtooth',
    kick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    progressions: [[1, 4, 6, 4], [1, 5, 4, 4], [4, 1, 5, 6]],
    seventh: true, crackle: false, masterLP: 9000, sidechain: false, leadDensity: 0.2, reverb: 0.7,
  },
};

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Scale degree (1-based, may exceed 7) -> midi note.
function degreeToMidi(root, scale, degree, octave) {
  const d = degree - 1;
  const oct = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return root + 12 * (octave + oct) + scale[idx];
}

function chordNotes(root, scale, degree, seventh) {
  const notes = [0, 2, 4].map((k) => degreeToMidi(root, scale, degree + k, 4));
  if (seventh) notes.push(degreeToMidi(root, scale, degree + 6, 4));
  return notes;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Section layout: which instruments play in each 4-bar block.
function buildSections(totalBars) {
  const blocks = Math.max(1, Math.round(totalBars / 4));
  const out = [];
  for (let b = 0; b < blocks; b++) {
    let name;
    if (b === 0) name = 'intro';
    else if (b === blocks - 1 && blocks > 2) name = 'outro';
    else name = ['verse', 'verse', 'chorus', 'chorus', 'break', 'chorus'][(b - 1) % 6];
    out.push(name);
  }
  return out;
}

const SECTION_MIX = {
  intro: { kick: 0, snare: 0, hat: 0.5, bass: 0, chords: 1, pad: 1, lead: 0 },
  verse: { kick: 1, snare: 1, hat: 0.8, bass: 1, chords: 1, pad: 0.5, lead: 0.6 },
  chorus: { kick: 1, snare: 1, hat: 1, bass: 1, chords: 1, pad: 1, lead: 1 },
  break: { kick: 0, snare: 0, hat: 0.4, bass: 0.6, chords: 1, pad: 1, lead: 0.4 },
  outro: { kick: 0.6, snare: 0, hat: 0.5, bass: 0.6, chords: 1, pad: 1, lead: 0 },
};

export async function generateMusic(opts, onProgress) {
  const p = PRESETS[opts.preset] || PRESETS.lofi;
  const bpm = opts.bpm || p.bpm;
  const scaleName = opts.scale === 'auto' || !opts.scale ? p.scale : opts.scale;
  const scale = SCALES[scaleName];
  const root = KEYS.indexOf(opts.key || 'A') + 12; // midi of key in octave 0 (C0=12)
  const rand = rng(opts.seed || 1);
  const mix = Object.assign({ drums: 0.8, bass: 0.8, chords: 0.7, pad: 0.5, lead: 0.7 }, opts.mix || {});

  const beat = 60 / bpm;
  const step = beat / 4;
  const barLen = beat * 4;
  const totalBars = Math.max(4, Math.round((opts.duration || 60) / barLen / 4) * 4);
  const sections = buildSections(totalBars);
  const duration = totalBars * barLen + 2.5; // tail for reverb
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);

  // ---- master chain ----
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.masterLP;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  master.connect(lp); lp.connect(comp); comp.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 3.2, 3);
  const revGain = ctx.createGain();
  revGain.gain.value = p.reverb;
  reverb.connect(revGain); revGain.connect(master);

  // sidechain-style ducking bus for chords/pad
  const duckBus = ctx.createGain();
  duckBus.connect(master);
  const noise = makeNoise(ctx, 1.5);

  const sendTo = (node, dry, wet) => {
    const d = ctx.createGain(); d.gain.value = dry;
    const w = ctx.createGain(); w.gain.value = wet;
    node.connect(d); node.connect(w); w.connect(reverb);
    return d;
  };

  // ---- instruments ----
  const kick = (t, vel) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.5);
    if (p.sidechain) {
      duckBus.gain.setValueAtTime(0.35, t);
      duckBus.gain.linearRampToValueAtTime(1, t + beat * 0.8);
    }
  };
  const snare = (t, vel) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(f); f.connect(g);
    sendTo(g, 1, 0.25).connect(master);
    n.start(t); n.stop(t + 0.3);
    const o = ctx.createOscillator(); const og = ctx.createGain();
    o.frequency.value = 185;
    og.gain.setValueAtTime(vel * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.12);
  };
  const hat = (t, vel, open) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    const len = open ? 0.25 : 0.05;
    g.gain.setValueAtTime(vel * 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.25;
    n.connect(f); f.connect(g); g.connect(pan); pan.connect(master);
    n.start(t, rand() * 1); n.stop(t + len + 0.02);
  };

  const synthVoice = (wave, freq, t, len, vel, dest, cutoff, attack = 0.01, release = 0.15, detune = 0) => {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.8;
    const oscs = [];
    if (wave === 'epiano') {
      // FM-ish electric piano: sine carrier + quickly decaying modulator
      const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = freq;
      const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * 2;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(freq * 1.2, t);
      mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + 0.6);
      mod.connect(mg); mg.connect(car.frequency);
      oscs.push(car, mod);
      car.connect(f);
    } else if (wave === '808') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq * 2, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(2.2 * x); }
      sh.curve = curve;
      o.connect(sh); sh.connect(f); oscs.push(o);
    } else {
      for (const dt of detune ? [-detune, detune] : [0]) {
        const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq; o.detune.value = dt;
        o.connect(f); oscs.push(o);
      }
    }
    const peak = vel / (oscs.length > 1 && wave !== 'epiano' ? 1.6 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (wave === 'epiano' || wave === '808') g.gain.exponentialRampToValueAtTime(peak * 0.35, t + Math.min(len, 1.2));
    g.gain.setValueAtTime(wave === 'epiano' || wave === '808' ? peak * 0.35 : peak, t + len);
    g.gain.linearRampToValueAtTime(0, t + len + release);
    f.connect(g); g.connect(dest);
    for (const o of oscs) { o.start(t); o.stop(t + len + release + 0.05); }
  };

  const chordBus = ctx.createGain(); chordBus.gain.value = mix.chords * 0.16;
  chordBus.connect(duckBus);
  const chordWet = ctx.createGain(); chordWet.gain.value = 0.5; chordBus.connect(chordWet); chordWet.connect(reverb);
  const padBus = ctx.createGain(); padBus.gain.value = mix.pad * 0.07;
  padBus.connect(duckBus);
  const padWet = ctx.createGain(); padWet.gain.value = 0.9; padBus.connect(padWet); padWet.connect(reverb);
  const bassBus = ctx.createGain(); bassBus.gain.value = mix.bass * 0.38; bassBus.connect(master);
  const leadBus = ctx.createGain(); leadBus.gain.value = mix.lead * 0.13; leadBus.connect(master);
  const delay = ctx.createDelay(2); delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const delWet = ctx.createGain(); delWet.gain.value = 0.35;
  leadBus.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(delWet); delWet.connect(master);
  const leadRev = ctx.createGain(); leadRev.gain.value = 0.5; leadBus.connect(leadRev); leadRev.connect(reverb);
  const drumGain = mix.drums;

  // ---- arrangement ----
  const prog = p.progressions[Math.floor(rand() * p.progressions.length)];
  const altProg = p.progressions[Math.floor(rand() * p.progressions.length)];

  // A 2-bar melodic motif (in scale degrees relative to chord root), reused with variation.
  const makeMotif = () => {
    const m = [];
    for (let s = 0; s < 32; s++) {
      const strong = s % 4 === 0;
      if (rand() < (strong ? p.leadDensity + 0.25 : p.leadDensity * 0.6)) {
        const choices = strong ? [0, 2, 4, 7] : [0, 1, 2, 3, 4, 5, 7];
        m.push({ s, deg: choices[Math.floor(rand() * choices.length)], len: 1 + Math.floor(rand() * 3) });
      }
    }
    return m;
  };
  const motifA = makeMotif();
  const motifB = makeMotif();

  for (let bar = 0; bar < totalBars; bar++) {
    const section = sections[Math.floor(bar / 4)] || 'verse';
    const sm = SECTION_MIX[section];
    const useProg = section === 'chorus' ? prog : (section === 'break' ? altProg : prog);
    const degree = useProg[bar % useProg.length];
    const barStart = bar * barLen + 0.05;
    const notes = chordNotes(root, scale, degree, p.seventh);

    // chords: rhythm depends on genre
    if (sm.chords > 0) {
      if (p.chordWave === 'epiano' && opts.preset !== 'ambient') {
        const hits = opts.preset === 'house' ? [0, 6, 10] : [0, 10];
        for (const h of hits) {
          for (const n of notes) synthVoice('epiano', midiHz(n), barStart + h * step, step * (h === 0 ? 6 : 4), 0.5 * sm.chords, chordBus, 4000);
        }
      } else {
        for (const n of notes) synthVoice(p.chordWave, midiHz(n), barStart, barLen * 0.95, 0.45 * sm.chords, chordBus, opts.preset === 'synthwave' ? 2200 : 3000, 0.04, 0.4, 8);
      }
    }
    // pad
    if (sm.pad > 0) {
      for (const n of notes.slice(0, 3)) synthVoice(p.padWave, midiHz(n + 12), barStart, barLen, 0.5 * sm.pad, padBus, 1400, 0.8, 1.2, 14);
    }
    // bass
    if (sm.bass > 0) {
      const bassNote = degreeToMidi(root, scale, degree, opts.preset === 'trap' ? 1 : 2);
      for (let s = 0; s < 16; s++) {
        if (!p.bass[s]) continue;
        let len = step;
        let k = s + 1;
        while (k < 16 && !p.bass[k]) { len += step; k++; }
        const oct = opts.preset === 'synthwave' && s % 2 === 1 ? 12 : 0;
        synthVoice(p.bassWave, midiHz(bassNote + oct), barStart + s * step, Math.min(len, barLen) * 0.9, 0.9 * sm.bass, bassBus, p.bassWave === 'sawtooth' ? 900 : 2500, 0.005, 0.08);
      }
    }
    // drums
    if (drumGain > 0) {
      for (let s = 0; s < 16; s++) {
        const swing = s % 2 === 1 ? p.swing * step : 0;
        const t = barStart + s * step + swing;
        if (p.kick[s] && sm.kick) kick(t, 0.95 * drumGain * sm.kick);
        if (p.snare[s] && sm.snare) snare(t, 0.8 * drumGain * sm.snare);
        if (p.hat[s] && sm.hat) {
          let v = (s % 4 === 0 ? 0.9 : 0.6) * drumGain * sm.hat;
          if (opts.preset === 'trap' && bar % 2 === 1 && s >= 12) {
            // hi-hat roll
            for (let r = 0; r < 3; r++) hat(t + (r * step) / 3, v * 0.8, false);
            continue;
          }
          hat(t, v, opts.preset === 'house' && s % 4 === 2);
        }
      }
      // fill at the end of each 4-bar block
      if (bar % 4 === 3 && sm.snare) {
        for (const s of [13, 14, 15]) snare(barStart + s * step, 0.5 * drumGain);
      }
    }
    // lead melody
    if (sm.lead > 0) {
      const motif = (section === 'chorus' ? motifB : motifA);
      const half = (bar % 2) * 16;
      for (const n of motif) {
        if (n.s < half || n.s >= half + 16) continue;
        let deg = degree + n.deg;
        if (bar % 4 === 3 && rand() < 0.3) deg += rand() < 0.5 ? 1 : -1; // variation
        const midi = degreeToMidi(root, scale, deg, 5);
        synthVoice(p.leadWave, midiHz(midi), barStart + (n.s - half) * step, step * n.len * 0.9, 0.7 * sm.lead, leadBus, 3500, 0.01, 0.2, p.leadWave === 'square' ? 6 : 0);
      }
    }
    if (onProgress) onProgress((bar + 1) / totalBars * 0.3);
  }

  if (p.crackle) {
    const len = Math.floor(duration * sr);
    const cbuf = ctx.createBuffer(1, len, sr);
    const d = cbuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.015 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.6 : 0);
    }
    const c = ctx.createBufferSource(); c.buffer = cbuf;
    const cg = ctx.createGain(); cg.gain.value = 0.25;
    c.connect(cg); cg.connect(master); c.start(0);
  }

  // fade out over the last bar
  const end = totalBars * barLen;
  master.gain.setValueAtTime(0.85, end - barLen);
  master.gain.linearRampToValueAtTime(0, end + 2);

  if (onProgress) onProgress(0.35);
  const rendered = await ctx.startRendering();
  // normalise to -0.5 dBFS so nothing clips and quiet styles are not too soft
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const d = rendered.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak > 0) {
    const k = 0.944 / peak;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const d = rendered.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  if (onProgress) onProgress(1);
  return {
    buffer: rendered,
    info: { bpm, key: opts.key || 'A', scale: scaleName, bars: totalBars, sections, preset: p.label },
  };
}
