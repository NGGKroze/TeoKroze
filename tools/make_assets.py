#!/usr/bin/env python3
"""Генерира текстурите за темите: стенни пана (фон) и камъни за плочките и иконата на програмата.
python tools/make_assets.py   ->  src/LogisticsPacking.App/Assets/{wall_<тема>.jpg,tile_<тема>.jpg,app.ico,app.png}
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src" / "LogisticsPacking.App" / "Assets"
rng = np.random.default_rng(20261009)


def noise(w, h, cell):
    """Гладък шум: случайна решетка, увеличена с бикубично интерполиране."""
    gw, gh = max(2, w // cell + 2), max(2, h // cell + 2)
    g = (rng.random((gh, gw)) * 255).astype(np.uint8)
    img = Image.fromarray(g).resize((gw * cell, gh * cell), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)[:h, :w] / 255.0


def fbm(w, h, base, octaves=5):
    total, amp, norm = np.zeros((h, w), np.float32), 1.0, 0.0
    for i in range(octaves):
        total += amp * noise(w, h, max(2, base // (2 ** i)))
        norm += amp
        amp *= 0.5
    return total / norm


def lerp(a, b, t):
    return a + (b - a) * t


def colorize(lum, lo, hi):
    """lum 0..1 -> цвят между lo и hi (RGB 0..255)."""
    lo, hi = np.array(lo, np.float32), np.array(hi, np.float32)
    return lo + (hi - lo) * lum[..., None]


def to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def marble(w, h, lo, hi, vein, vein_amount=0.55):
    """Мрамор: облачна основа между lo..hi и жилки в цвят vein."""
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    turb = fbm(w, h, 300, 5)
    veins = np.abs(np.sin((x * 1.6 + y * 0.9) * np.pi * 2 + turb * 6.0))
    fine = np.abs(np.sin((x * 3.2 - y * 2.4) * np.pi * 2 + fbm(w, h, 200, 4) * 7.0))
    v = np.clip(1.0 - veins, 0, 1) ** 12 * vein_amount + np.clip(1.0 - fine, 0, 1) ** 24 * vein_amount * 0.4
    base = colorize(fbm(w, h, 400, 5), lo, hi)
    arr = base * (1 - v[..., None]) + np.array(vein, np.float32) * v[..., None]
    return to_img(arr).filter(ImageFilter.GaussianBlur(2.0))


def travertine(w, h, lo, hi, pore):
    """Травертин: хоризонтални слоеве и фини удължени пори."""
    layers = np.asarray(Image.fromarray((fbm(max(8, w // 10), h, 60, 5) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), np.float32) / 255.0
    arr = colorize(0.25 + 0.75 * layers, lo, hi)
    img = to_img(arr)
    d = ImageDraw.Draw(img)
    for _ in range(int(w * h / 900)):
        px, py = int(rng.integers(0, w)), int(rng.integers(0, h))
        ln = int(rng.integers(6, 40))
        d.line([px, py, px + ln, py + int(rng.integers(-1, 2))], fill=tuple(int(c) for c in pore), width=int(rng.integers(1, 3)))
    return img.filter(ImageFilter.GaussianBlur(0.8))


def granite(w, h, base, crystals, spread=0.08, streak_amount=0.16):
    """Лъскав гранит: основа base (RGB 0..255), кристали [(rgb, вероятност)], диагонален отблясък."""
    lum = 0.88 + spread * (fbm(w, h, 170, 5) - 0.5) * 2 + (noise(w, h, 3) - 0.5) * 0.14 + (noise(w, h, 8) - 0.5) * 0.10
    arr = np.array(base, np.float32)[None, None, :] * lum[..., None]
    img = to_img(arr)
    d = ImageDraw.Draw(img)
    cols = [c for c, _ in crystals]
    probs = np.array([p for _, p in crystals], np.float64)
    probs /= probs.sum()
    for _ in range(int(w * h / 60)):
        px, py = int(rng.integers(0, w)), int(rng.integers(0, h))
        s = float(rng.choice([0.6, 0.9, 1.3, 1.7]))
        d.ellipse([px, py, px + s, py + s], fill=tuple(cols[int(rng.choice(len(cols), p=probs))]))
    img = img.filter(ImageFilter.GaussianBlur(0.5))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    streak = np.exp(-(((xx / w) * 0.9 + (yy / h) * 0.55 - 0.62) ** 2) / 0.012) * streak_amount
    glow = np.clip(1.0 - yy / h, 0, 1) * 0.07
    out = np.asarray(img, dtype=np.float32) + ((streak + glow) * 255)[..., None]
    return to_img(out)


def panelize(img, cols=3, rows=2, gap=6):
    """Стенни пана: плочи с фуга, лек различен тон на всяка и фасет по ръбовете."""
    w, h = img.size
    arr = np.asarray(img, dtype=np.float32).copy()
    sw, sh = w / cols, h / rows
    for r in range(rows):
        for c in range(cols):
            x0, x1, y0, y1 = int(c * sw), int((c + 1) * sw), int(r * sh), int((r + 1) * sh)
            arr[y0:y1, x0:x1] *= 1.0 + float(rng.uniform(-0.035, 0.035))
    dark = arr.mean(axis=(0, 1)) * 0.38
    out = to_img(arr)
    d = ImageDraw.Draw(out, "RGBA")
    for c in range(1, cols):
        x = int(c * sw)
        d.rectangle([x - gap // 2, 0, x + gap // 2, h], fill=tuple(int(v) for v in dark) + (255,))
        d.line([x - gap // 2 - 2, 0, x - gap // 2 - 2, h], fill=(0, 0, 0, 40), width=2)
        d.line([x + gap // 2 + 1, 0, x + gap // 2 + 1, h], fill=(255, 255, 255, 70), width=2)
    for r in range(1, rows):
        y = int(r * sh)
        d.rectangle([0, y - gap // 2, w, y + gap // 2], fill=tuple(int(v) for v in dark) + (255,))
        d.line([0, y - gap // 2 - 2, w, y - gap // 2 - 2], fill=(0, 0, 0, 40), width=2)
        d.line([0, y + gap // 2 + 1, w, y + gap // 2 + 1], fill=(255, 255, 255, 70), width=2)
    return out


# Тема: стена (мрамор/травертин, на пана) + плочка (гранит). Цветовете са RGB.
THEMES = {
    "granite": dict(
        wall=lambda w, h: marble(w, h, (214, 210, 202), (246, 244, 240), (96, 98, 104), 0.55),
        tile=lambda w, h: granite(w, h, (178, 180, 184), [((246, 246, 244), .30), ((82, 84, 90), .32), ((150, 138, 130), .20), ((40, 41, 45), .18)])),
    "midnight": dict(
        wall=lambda w, h: marble(w, h, (14, 24, 52), (36, 56, 106), (190, 205, 235), 0.50),
        tile=lambda w, h: granite(w, h, (52, 76, 132), [((190, 205, 240), .32), ((14, 22, 48), .36), ((120, 140, 190), .20), ((226, 232, 248), .12)], 0.10, 0.20)),
    "pearl": dict(
        wall=lambda w, h: marble(w, h, (236, 212, 216), (252, 240, 241), (190, 130, 146), 0.50),
        tile=lambda w, h: granite(w, h, (226, 186, 194), [((255, 248, 248), .36), ((176, 120, 134), .28), ((205, 160, 168), .24), ((120, 76, 90), .12)], 0.07, 0.22)),
    "emerald": dict(
        wall=lambda w, h: marble(w, h, (10, 44, 32), (26, 84, 62), (226, 240, 232), 0.60),
        tile=lambda w, h: granite(w, h, (48, 112, 84), [((214, 236, 224), .30), ((8, 36, 26), .36), ((120, 170, 146), .22), ((236, 246, 240), .12)], 0.10, 0.18)),
    "travertine": dict(
        wall=lambda w, h: travertine(w, h, (206, 190, 160), (240, 230, 208), (150, 130, 100)),
        tile=lambda w, h: granite(w, h, (204, 188, 158), [((250, 244, 228), .30), ((130, 110, 80), .30), ((168, 146, 112), .26), ((84, 68, 46), .14)], 0.07, 0.16)),
}


def icon():
    s = 512
    img = THEMES["granite"]["tile"](s, s).convert("RGBA")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([14, 14, s - 15, s - 15], radius=70, outline=(141, 109, 60, 255), width=10)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 190)
    except OSError:
        font = ImageFont.load_default()
    d.text((s / 2, s / 2), "LPS", font=font, fill=(38, 39, 43, 255), anchor="mm")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=84, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, th in THEMES.items():
        panelize(th["wall"](1920, 1200)).save(OUT / f"wall_{name}.jpg", quality=84)
        th["tile"](1024, 640).save(OUT / f"tile_{name}.jpg", quality=88)
    ic = icon()
    ic.save(OUT / "app.png")
    ic.save(OUT / "app.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("готово:", ", ".join(sorted(p.name for p in OUT.iterdir())))
