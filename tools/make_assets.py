#!/usr/bin/env python3
"""Генерира текстурите за интерфейса: мрамор (фон), гранит (плочки) и иконата на програмата.
python tools/make_assets.py   ->  src/LogisticsPacking.App/Assets/{marble.jpg,granite.jpg,app.ico,app.png}
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


def marble(w=2048, h=1280):
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    turb = fbm(w, h, 300, 5)
    veins = np.abs(np.sin((x * 1.6 + y * 0.9) * np.pi * 2 + turb * 6.0))
    fine = np.abs(np.sin((x * 3.2 - y * 2.4) * np.pi * 2 + fbm(w, h, 200, 4) * 7.0))
    v = np.clip(1.0 - veins, 0, 1) ** 12 * 0.55 + np.clip(1.0 - fine, 0, 1) ** 24 * 0.22
    cloud = fbm(w, h, 400, 5)
    base = 0.93 - 0.07 * cloud                    # светъл, леко облачен
    lum = np.clip(base - v * 0.42, 0, 1)
    r = lum * 0.985 + 0.012
    g = lum * 0.975 + 0.010
    b = lum * 0.955 + 0.012                        # лек топъл нюанс
    arr = np.stack([r, g, b], -1)
    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2))


def granite(w=1024, h=640):
    base = 0.20 + 0.10 * fbm(w, h, 160, 5)
    grain = noise(w, h, 3) * 0.10 + noise(w, h, 7) * 0.06
    lum = base + grain - 0.08
    arr = np.stack([lum * 1.00, lum * 1.00, lum * 1.03], -1)
    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    for _ in range(int(w * h / 55)):               # петънца: светли и тъмни кристали
        px, py = int(rng.integers(0, w)), int(rng.integers(0, h))
        s = float(rng.choice([0.6, 0.9, 1.3, 1.8]))
        t = rng.random()
        col = (150, 148, 144) if t < 0.38 else (28, 28, 30) if t < 0.72 else (120, 104, 98)
        d.ellipse([px, py, px + s, py + s], fill=col)
    return img.filter(ImageFilter.GaussianBlur(0.55))


def icon():
    s = 512
    img = granite(s, s).convert("RGBA")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([14, 14, s - 15, s - 15], radius=70, outline=(176, 141, 87, 255), width=10)
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 190)
    except OSError:
        font = ImageFont.load_default()
    d.text((s / 2, s / 2), "LPS", font=font, fill=(236, 230, 214, 255), anchor="mm")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=84, fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    marble().save(OUT / "marble.jpg", quality=88)
    granite().save(OUT / "granite.jpg", quality=90)
    ic = icon()
    ic.save(OUT / "app.png")
    ic.save(OUT / "app.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("готово:", ", ".join(sorted(p.name for p in OUT.iterdir())))
