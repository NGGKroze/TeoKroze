#!/usr/bin/env python3
"""Сравнява стойностите от референтен файл с етикети (xlsx) с текста, който модулът е показал.
python tools/compare_ref.py <модулен_txt> <референтен.xlsx> [-v]   (txt идва от tools/realdata.mjs)"""
import re, sys, openpyxl, warnings
warnings.filterwarnings("ignore")
def norm(x): return re.sub(r"[^0-9A-ZА-Я]", "", str(x).upper())
txt = open(sys.argv[1], encoding="utf-8").read()
hay = norm(txt)
wb = openpyxl.load_workbook(sys.argv[2], data_only=True)
toks = {}
for ws in wb.worksheets:
    for row in ws.iter_rows(values_only=True):
        for c in row:
            if c in (None, ""): continue
            for part in re.split(r"[\n]", str(c)):
                t = norm(part)
                if len(t) >= 2: toks[t] = part.strip()
miss = [(t, v) for t, v in toks.items() if t not in hay]
print(f"{sys.argv[2].split('/')[-1]}: {len(toks)-len(miss)}/{len(toks)} стойности са в изхода на модула")
if "-v" in sys.argv or miss:
    for t, v in miss[:40]: print("   липсва:", repr(v)[:90])
