// Canvas renderer: background (colour / gradient / image / video), audio
// visualizer styles, overlay text, lyrics and post effects.

import { drawLyrics } from './lyrics.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hueShift(hex, deg) {
  if (!deg) return hex;
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1;
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

export class Renderer {
  constructor() {
    this.bars = new Float32Array(256);
    this.smooth = new Float32Array(256);
    this.peaks = new Float32Array(256);
    this.bgCache = null;
    this.bgKey = '';
    this.grain = null;
    this.reset();
  }

  reset() {
    this.smooth.fill(0);
    this.peaks.fill(0);
    this.bassAvg = 0.3;
    this.pulse = 0;
    this.energy = 0;
    this.particles = [];
    this.rand = seeded(1234);
    this.flash = 0;
  }

  // ---------------- background ----------------

  buildBgCache(W, H, img, blur) {
    const key = `${img.src}|${W}x${H}|${blur}`;
    if (this.bgKey === key && this.bgCache) return this.bgCache;
    const pad = 1.18; // headroom for zoom/drift
    const c = document.createElement('canvas');
    c.width = Math.round(W * pad);
    c.height = Math.round(H * pad);
    const g = c.getContext('2d');
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const sc = Math.max(c.width / iw, c.height / ih) * (blur > 0 ? 1.08 : 1);
    if (blur > 0) g.filter = `blur(${blur * W / 1280}px)`;
    g.drawImage(img, (c.width - iw * sc) / 2, (c.height - ih * sc) / 2, iw * sc, ih * sc);
    this.bgCache = c;
    this.bgKey = key;
    return c;
  }

  drawBackground(ctx, W, H, S, t, media) {
    const B = S.background;
    const zoom = 1 + (B.zoomPulse / 100) * this.pulse * 0.08 + (B.drift ? 0.03 * Math.sin(t * 0.15) : 0);
    const dx = B.drift ? Math.sin(t * 0.11) * W * 0.02 : 0;
    const dy = B.drift ? Math.cos(t * 0.09) * H * 0.02 : 0;

    if (B.type === 'image' && media.bgImage) {
      const c = this.buildBgCache(W, H, media.bgImage, B.blur);
      const w = (c.width / 1.18) * zoom * 1.06, h = (c.height / 1.18) * zoom * 1.06;
      ctx.drawImage(c, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
    } else if (B.type === 'video' && media.bgVideo && media.bgVideo.readyState >= 2) {
      const v = media.bgVideo;
      const vw = v.videoWidth, vh = v.videoHeight;
      const sc = Math.max(W / vw, H / vh) * zoom * (B.blur > 0 ? 1.06 : 1);
      ctx.save();
      if (B.blur > 0) ctx.filter = `blur(${B.blur * W / 1280}px)`;
      ctx.drawImage(v, (W - vw * sc) / 2 + dx, (H - vh * sc) / 2 + dy, vw * sc, vh * sc);
      ctx.restore();
    } else if (B.type === 'color') {
      ctx.fillStyle = B.color1;
      ctx.fillRect(0, 0, W, H);
    } else {
      const ang = t * 0.05;
      const g = ctx.createLinearGradient(
        W / 2 - Math.cos(ang) * W, H / 2 - Math.sin(ang) * H,
        W / 2 + Math.cos(ang) * W, H / 2 + Math.sin(ang) * H);
      g.addColorStop(0, B.color1);
      g.addColorStop(1, B.color2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (B.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${B.dim / 100})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------- visualizer ----------------

  makeGradient(ctx, x0, y0, x1, y1, V, hue) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, hueShift(V.color1, hue));
    g.addColorStop(1, hueShift(V.color2, hue));
    return g;
  }

  drawVisualizer(ctx, W, H, S, t, dt, analyzer, media) {
    const V = S.visualizer;
    if (V.style === 'none') return;
    const n = Math.max(8, Math.min(256, V.bars | 0));
    analyzer.bars(n, this.bars);
    const sm = Math.pow(V.smoothing / 100, dt * 60 / 1);
    for (let i = 0; i < n; i++) {
      const v = Math.min(1, Math.pow(this.bars[i], 1.6) * (V.sensitivity / 100) * 1.4);
      this.smooth[i] = v > this.smooth[i] ? v * 0.6 + this.smooth[i] * 0.4 : this.smooth[i] * sm + v * (1 - sm);
      this.peaks[i] = Math.max(this.smooth[i], this.peaks[i] - dt * 0.5);
    }
    const hue = V.rainbow ? (t * 20) % 360 : 0;
    const scale = V.scale / 100;
    const cx = W / 2 + (V.offsetX / 100) * W;
    const cy = H * (V.posY / 100);
    ctx.save();
    if (V.glow > 0) {
      ctx.shadowColor = hueShift(V.color1, hue);
      ctx.shadowBlur = (V.glow / 100) * H * 0.04;
    }
    ctx.globalAlpha = V.opacity / 100;

    const s = this.smooth;
    switch (V.style) {
      case 'bars':
      case 'mirror': {
        const totalW = W * (V.width / 100);
        const bw = totalW / n;
        const maxH = H * 0.35 * scale;
        const x0 = cx - totalW / 2;
        ctx.fillStyle = this.makeGradient(ctx, 0, cy - maxH, 0, cy + (V.style === 'mirror' ? maxH : 0), V, hue);
        for (let i = 0; i < n; i++) {
          const h = Math.max(2, s[i] * maxH);
          const x = x0 + i * bw + bw * 0.15;
          const w = bw * 0.7;
          const r = Math.min(w / 2, V.rounded ? w / 2 : 0);
          if (V.style === 'mirror') {
            roundRect(ctx, x, cy - h, w, h * 2, r);
          } else {
            roundRect(ctx, x, cy - h, w, h, r);
            if (V.peaks) ctx.fillRect(x, cy - this.peaks[i] * maxH - 6, w, 3);
          }
        }
        break;
      }
      case 'circle': {
        const R = Math.min(W, H) * 0.17 * scale * (1 + this.pulse * 0.06);
        const maxH = Math.min(W, H) * 0.2 * scale;
        ctx.strokeStyle = this.makeGradient(ctx, cx - R, cy - R, cx + R, cy + R, V, hue);
        ctx.lineCap = V.rounded ? 'round' : 'butt';
        const total = n * 2;
        ctx.lineWidth = Math.max(2, (2 * Math.PI * R / total) * 0.6);
        ctx.beginPath();
        for (let k = 0; k < total; k++) {
          const i = k < n ? k : total - 1 - k; // mirrored around the circle
          const a = (k / total) * Math.PI * 2 - Math.PI / 2 + t * (V.rotate / 100) * 0.5;
          const h = 3 + s[i] * maxH;
          ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          ctx.lineTo(cx + Math.cos(a) * (R + h), cy + Math.sin(a) * (R + h));
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        // centre image / disc
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
        ctx.clip();
        if (media.centerImage) {
          const img = media.centerImage;
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const sc = Math.max((R * 1.84) / iw, (R * 1.84) / ih);
          ctx.translate(cx, cy);
          if (V.spinCenter) ctx.rotate(t * 0.4);
          ctx.drawImage(img, -iw * sc / 2, -ih * sc / 2, iw * sc, ih * sc);
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
        ctx.restore();
        break;
      }
      case 'wave': {
        const wave = analyzer.wave;
        const totalW = W * (V.width / 100);
        const amp = H * 0.18 * scale * (V.sensitivity / 100);
        ctx.lineWidth = Math.max(2, H * 0.004);
        ctx.strokeStyle = this.makeGradient(ctx, cx - totalW / 2, 0, cx + totalW / 2, 0, V, hue);
        for (let layer = 0; layer < 3; layer++) {
          ctx.globalAlpha = (V.opacity / 100) * (1 - layer * 0.3);
          ctx.beginPath();
          const step = Math.max(1, Math.floor(wave.length / 512));
          for (let i = 0; i < wave.length; i += step) {
            const x = cx - totalW / 2 + (i / wave.length) * totalW;
            const y = cy + wave[(i + layer * 40) % wave.length] * amp * (1 - layer * 0.2) * 2.2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'mountains': {
        const totalW = W * (V.width / 100);
        const maxH = H * 0.4 * scale;
        const x0 = cx - totalW / 2;
        for (let layer = 2; layer >= 0; layer--) {
          ctx.globalAlpha = (V.opacity / 100) * (0.35 + (2 - layer) * 0.3);
          ctx.fillStyle = this.makeGradient(ctx, 0, cy - maxH, 0, cy, V, hue + layer * 25);
          ctx.beginPath();
          ctx.moveTo(x0, cy);
          for (let i = 0; i <= n; i++) {
            const v = s[Math.min(n - 1, i)] * (1 + layer * 0.25);
            const x = x0 + (i / n) * totalW;
            const px = x0 + ((i - 0.5) / n) * totalW;
            const pv = s[Math.max(0, Math.min(n - 1, i - 1))] * (1 + layer * 0.25);
            ctx.quadraticCurveTo(px, cy - pv * maxH, x, cy - v * maxH);
          }
          ctx.lineTo(x0 + totalW, cy);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'rings': {
        const R = Math.min(W, H) * 0.12 * scale;
        const rings = 6;
        for (let r = 0; r < rings; r++) {
          const band = s[Math.floor((r / rings) * n)];
          ctx.globalAlpha = (V.opacity / 100) * (0.25 + band * 0.75);
          ctx.strokeStyle = hueShift(r % 2 ? V.color2 : V.color1, hue + r * 15);
          ctx.lineWidth = Math.max(2, H * 0.004 + band * H * 0.012);
          ctx.beginPath();
          ctx.arc(cx, cy, R * (1 + r * 0.45) * (1 + band * 0.25), 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'particles': {
        this.updateParticles(W, H, dt, cx, cy, V, scale);
        for (const p of this.particles) {
          ctx.globalAlpha = (V.opacity / 100) * Math.min(1, p.life * 2) * 0.9;
          ctx.fillStyle = hueShift(p.c ? V.color2 : V.color1, hue);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (1 + this.pulse * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
        const R = Math.min(W, H) * 0.08 * scale * (1 + this.pulse * 0.25 + this.energy * 0.3);
        ctx.globalAlpha = V.opacity / 100;
        ctx.strokeStyle = this.makeGradient(ctx, cx - R, cy - R, cx + R, cy + R, V, hue);
        ctx.lineWidth = H * 0.006;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  updateParticles(W, H, dt, cx, cy, V, scale) {
    const rate = (40 + this.energy * 400 + this.pulse * 300) * (V.sensitivity / 100);
    let toSpawn = rate * dt;
    while (toSpawn > 0 && this.particles.length < 900) {
      if (toSpawn < 1 && this.rand() > toSpawn) break;
      toSpawn -= 1;
      const a = this.rand() * Math.PI * 2;
      const sp = (0.05 + this.rand() * 0.25) * Math.min(W, H) * scale;
      this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: (1 + this.rand() * 3) * H / 1080, life: 1.5 + this.rand() * 2, c: this.rand() < 0.5 });
    }
    const boost = 1 + this.energy * 3 + this.pulse * 2;
    for (const p of this.particles) {
      p.x += p.vx * dt * boost;
      p.y += p.vy * dt * boost;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.x > -50 && p.x < W + 50 && p.y > -50 && p.y < H + 50);
  }

  // ambient floating dust
  drawDust(ctx, W, H, t, amount) {
    const r = seeded(99);
    ctx.save();
    ctx.fillStyle = '#fff';
    const count = Math.round(amount * 1.2);
    for (let i = 0; i < count; i++) {
      const bx = r() * W, by = r() * H, sp = 0.2 + r(), size = (0.5 + r() * 2.2) * H / 1080;
      const x = (bx + Math.sin(t * 0.3 * sp + i) * 30) % W;
      const y = ((by - t * 20 * sp) % H + H) % H;
      ctx.globalAlpha = 0.15 + 0.35 * Math.abs(Math.sin(t * sp + i));
      ctx.beginPath();
      ctx.arc(x, y, size * (1 + this.pulse * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawOverlayText(ctx, W, H, S) {
    const T = S.text;
    if (!T.title && !T.artist) return;
    ctx.save();
    const size = H * T.size / 100;
    const pos = T.position;
    const margin = H * 0.06;
    ctx.textBaseline = 'alphabetic';
    let x = margin, align = 'left', y = H - margin - size * 1.1;
    if (pos === 'top-left') { y = margin + size; }
    else if (pos === 'top-center') { x = W / 2; align = 'center'; y = margin + size; }
    else if (pos === 'bottom-center') { x = W / 2; align = 'center'; }
    else if (pos === 'center') { x = W / 2; align = 'center'; y = H / 2 - size * 0.3; }
    ctx.textAlign = align;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = size * 0.3;
    ctx.fillStyle = T.color;
    ctx.font = `800 ${size}px ${T.font}`;
    if (T.title) ctx.fillText(T.title, x, y);
    ctx.font = `400 ${size * 0.6}px ${T.font}`;
    ctx.globalAlpha = 0.8;
    if (T.artist) ctx.fillText(T.artist, x, y + size * 0.85);
    ctx.restore();
  }

  drawEffects(ctx, W, H, S) {
    const E = S.effects;
    if (E.flash > 0 && this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * E.flash / 100 * 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (E.vignette > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${E.vignette / 100})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (E.grain > 0) {
      if (!this.grain) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        const id = g.createImageData(256, 256);
        const r = seeded(7);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = r() * 255;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = 255;
        }
        g.putImageData(id, 0, 0);
        this.grain = c;
      }
      ctx.save();
      ctx.globalAlpha = E.grain / 100 * 0.18;
      ctx.globalCompositeOperation = 'overlay';
      const ox = Math.floor(this.rand() * 256), oy = Math.floor(this.rand() * 256);
      const pat = ctx.createPattern(this.grain, 'repeat');
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W + 256, H + 256);
      ctx.restore();
    }
  }

  // Render one frame at time t (seconds). dt = seconds since previous frame.
  render(ctx, W, H, S, t, dt, analyzer, lines, media) {
    dt = Math.min(0.1, Math.max(0.001, dt));
    if (analyzer) {
      analyzer.analyse(t);
      const bass = analyzer.band(30, 150);
      const all = analyzer.band(30, 8000);
      this.energy = this.energy * 0.8 + all * 0.2;
      if (bass > this.bassAvg * 1.25 && bass > 0.45 && this.pulse < 0.5) {
        this.pulse = 1;
        this.flash = 1;
      }
      this.bassAvg = this.bassAvg * Math.pow(0.5, dt * 2) + bass * (1 - Math.pow(0.5, dt * 2));
    }
    this.pulse *= Math.exp(-dt * 7);
    this.flash *= Math.exp(-dt * 10);

    ctx.save();
    const shake = S.effects.shake / 100 * this.pulse * H * 0.012;
    if (shake > 0.2) ctx.translate((this.rand() - 0.5) * shake * 2, (this.rand() - 0.5) * shake * 2);
    this.drawBackground(ctx, W, H, S, t, media);
    if (S.effects.dust > 0) this.drawDust(ctx, W, H, t, S.effects.dust);
    if (analyzer) this.drawVisualizer(ctx, W, H, S, t, dt, analyzer, media);
    this.drawOverlayText(ctx, W, H, S);
    drawLyrics(ctx, W, H, lines, t - (S.lyrics.offset || 0), S.lyrics, this.pulse);
    ctx.restore();
    this.drawEffects(ctx, W, H, S);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  if (r <= 0) { ctx.fillRect(x, y, w, h); return; }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
