#!/usr/bin/env python3
"""Контактен лист от снимки: python tools/contact_sheet.py <папка> <изход.png> [колони]"""
import glob, os, sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
fs = sorted(f for f in glob.glob(src + "/*.png") if not os.path.basename(f).startswith("_"))
w, h = 480, 285
rows = (len(fs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * (h + 22)), "white"); d = ImageDraw.Draw(sheet)
for i, f in enumerate(fs):
    x, y = (i % cols) * w, (i // cols) * (h + 22)
    sheet.paste(Image.open(f).convert("RGB").resize((w, h)), (x, y + 22)); d.text((x + 6, y + 5), os.path.basename(f)[:-4], fill="black")
sheet.save(out); print(len(fs), "снимки ->", out)
