import io
import json
import math
import os
import re
import tempfile
import threading
import time
import traceback
import webbrowser
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageOps, ImageFilter
import pytesseract
from flask import Flask, jsonify, request, send_file, send_from_directory
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Side, Font, PatternFill
from openpyxl.utils import get_column_letter
from werkzeug.utils import secure_filename

APP_VERSION = "V35 clean label borders + 2 labels per worksheet"
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.environ.get("TEOKROZE_DATA_DIR", BASE_DIR))  # TEOKROZE: папка за запис
UPLOAD_DIR = DATA_DIR / "_uploads"
OUT_DIR = DATA_DIR / "_output"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

SIZES = ["XS", "S", "M", "L", "XL", "XXL"]
DEFAULT_WAREHOUSE = "C-LOG LONGUEIL SAINTE MARIE\nPar Logistique Paris Oise\nBâtiment C - Cellule n°1, 2 et 3\n60126 LONGUEIL SAINTE MARIE\nFRANCE"
DEFAULT_EXPEDITEUR = "PELINTEX\n5 Hristo Botev blvd.\n7000 RUSE\nBULGARIA"

app = Flask(__name__, static_folder=str(STATIC_DIR))

# -----------------------------------------------------------------------------
# Tesseract discovery
# -----------------------------------------------------------------------------

def configure_tesseract():
    candidates = [
        os.environ.get("TESSERACT_CMD"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for c in candidates:
        if c and Path(c).exists():
            pytesseract.pytesseract.tesseract_cmd = c
            return str(c)
    return "tesseract"

TESSERACT_CMD = configure_tesseract()

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def safe_filename(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._ -]+", "_", str(s or ""))
    s = re.sub(r"\s+", "_", s).strip("._-")
    return s[:150] or "file"


def norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def clean_text(s: str) -> str:
    s = str(s or "").replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_article(s: str) -> str:
    s = norm(s)
    s = s.replace("JSO", "JS0")
    s = s.replace("J500", "JS00")
    # Common OCR/typing issue: letter O used instead of zero in code area.
    s = re.sub(r"(?<=JS)O", "0", s)
    return s


def clean_color_name(s: str) -> str:
    s = clean_text(s)
    s = re.sub(r"\bSPECIAL\b.*$", "", s, flags=re.I)
    s = re.sub(r"\bEX\s*-?\s*MILL\s+DATE\b.*$", "", s, flags=re.I)
    s = re.sub(r"\bP\.?\s+UNIT\s+IN\s+EUR\b.*$", "", s, flags=re.I)
    s = s.replace(" / ", "/").replace("/", " / ")
    s = re.sub(r"\s+", " ", s).strip(" :-")
    return s.upper()


def detect_text_layer(words) -> bool:
    meaningful = [w for w in words if re.search(r"[A-Za-z0-9]", w.get("text", ""))]
    return len(meaningful) > 15

# -----------------------------------------------------------------------------
# PDF/OCR word extraction
# -----------------------------------------------------------------------------

def words_from_pymupdf_page(page):
    words = []
    for w in page.get_text("words"):
        x0, y0, x1, y1, text, *_ = w
        if not clean_text(text):
            continue
        words.append({"x0": float(x0), "y0": float(y0), "x1": float(x1), "y1": float(y1), "text": str(text), "source": "text"})
    return words


def render_page_for_ocr(page, scale=3.2):
    matrix = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    return img


def preprocess_for_ocr(img: Image.Image) -> Image.Image:
    # Keep it conservative; harsh binarization often destroys tiny size cells.
    gray = ImageOps.grayscale(img)
    gray = ImageOps.autocontrast(gray)
    gray = gray.filter(ImageFilter.SHARPEN)
    return gray


def words_from_ocr_page(page):
    img = preprocess_for_ocr(render_page_for_ocr(page))
    data = pytesseract.image_to_data(img, lang="eng", config="--psm 6", output_type=pytesseract.Output.DICT)
    words = []
    for i, text in enumerate(data.get("text", [])):
        text = clean_text(text)
        if not text:
            continue
        try:
            conf = float(data.get("conf", [0])[i])
        except Exception:
            conf = 0
        if conf < 20 and not re.search(r"\d", text):
            continue
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        words.append({"x0": float(x), "y0": float(y), "x1": float(x + w), "y1": float(y + h), "text": text, "source": "ocr", "conf": conf})
    return words


def group_lines(words, ytol=None):
    if not words:
        return []
    if ytol is None:
        source = words[0].get("source", "text")
        ytol = 10.0 if source == "ocr" else 3.8
    words = sorted(words, key=lambda w: ((w["y0"] + w["y1"]) / 2, w["x0"]))
    lines = []
    for w in words:
        cy = (w["y0"] + w["y1"]) / 2
        placed = False
        for line in lines:
            if abs(cy - line["cy"]) <= ytol:
                line["words"].append(w)
                n = len(line["words"])
                line["cy"] = (line["cy"] * (n - 1) + cy) / n
                placed = True
                break
        if not placed:
            lines.append({"cy": cy, "words": [w]})
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
        line["text"] = " ".join(w["text"] for w in line["words"])
        line["y0"] = min(w["y0"] for w in line["words"])
        line["y1"] = max(w["y1"] for w in line["words"])
    lines.sort(key=lambda l: l["cy"])
    return lines

# -----------------------------------------------------------------------------
# COURREGES parser
# -----------------------------------------------------------------------------

def extract_order_number(lines):
    joined = "\n".join(l["text"] for l in lines)
    for pat in [r"No\.?\s*:?\s*(\d{5})", r"ORDER\s+FORM\s+No\.?\s*:?\s*(\d{5})"]:
        m = re.search(pat, joined, flags=re.I)
        if m:
            return m.group(1)
    for line in lines[:30]:
        if any(norm(w["text"]) in {"NO", "N"} or norm(w["text"]).startswith("NO") for w in line["words"]):
            for w in line["words"]:
                n = re.sub(r"\D", "", w["text"])
                if len(n) == 5:
                    return n
    # fallback: first plausible 5-digit near top half
    for line in lines[:40]:
        for w in line["words"]:
            n = re.sub(r"\D", "", w["text"])
            if len(n) == 5 and n.startswith("15"):
                return n
    return ""


def extract_season(lines):
    for line in lines[:50]:
        if "SEASON" in line["text"].upper():
            nums = re.findall(r"\b\d{3}\b", line["text"])
            if nums:
                return nums[-1]
    joined = " ".join(l["text"] for l in lines[:50])
    m = re.search(r"SEASON\s*:?\s*(\d{3})", joined, flags=re.I)
    return m.group(1) if m else ""


def parse_style_line(line):
    words = line["words"]
    # Do not parse a color line as a style because it may contain BICOLOR.
    exact_tokens = {norm(w["text"]) for w in words}
    if "STYLE" not in exact_tokens and not any(re.search(r"\d{3}[A-Z]{3}\d{3}", norm(w["text"])) for w in words):
        return None
    compact = "".join(re.sub(r"[^A-Za-z0-9]", "", w["text"]) for w in words).upper()
    article_matches = list(re.finditer(r"(\d{3}[A-Z]{3}\d{3}[A-Z]{2}\d{4})", compact))
    if not article_matches:
        return None
    article = clean_article(article_matches[-1].group(1))
    article_word = None
    for w in words:
        if clean_article(w["text"]) == article:
            article_word = w
            break
    season = ""
    for w in words:
        n = re.sub(r"\D", "", w["text"])
        if len(n) == 3 and (article_word is None or w["x1"] < article_word["x0"]):
            season = n
    desc_tokens = []
    if article_word:
        desc_tokens = [w["text"] for w in words if w["x0"] > article_word["x1"] + 2]
    else:
        # fallback: not as pretty, but keep the style code correct
        desc_tokens = []
    designation = clean_text(" ".join(desc_tokens)).upper()
    designation = designation.replace("LS TOP", "LSTOP")
    return {"style": article, "designation": designation, "season": season}


def locate_color_on_line(line):
    words = line["words"]
    # IMPORTANT: exact COLOR token only; BICOLOR must not count.
    if not any(norm(w["text"]) == "COLOR" for w in words):
        return None
    after_colon = False
    code = ""
    idx = None
    for k, w in enumerate(words):
        t = w["text"].strip()
        if t == ":" or t.endswith(":"):
            after_colon = True
            continue
        if not after_colon:
            continue
        nt = norm(t)
        if re.fullmatch(r"(?:\d{4}|[A-Z]\d{3}|B\d{3})", nt) and w["x0"] < 260:
            code = nt
            idx = k
            break
    if not code:
        for k, w in enumerate(words):
            nt = norm(w["text"])
            if re.fullmatch(r"(?:\d{4}|[A-Z]\d{3}|B\d{3})", nt) and w["x0"] < 260:
                code = nt
                idx = k
                break
    if not code:
        return None
    name_tokens = []
    if idx is not None:
        for w in words[idx + 1:]:
            if w["x0"] > 260:
                break
            name_tokens.append(w["text"])
    return {"code": code, "name": clean_color_name(" ".join(name_tokens)), "y": line["cy"]}


def locate_size_centers(size_line):
    words = size_line["words"]
    candidates = []
    for w in words:
        t = norm(w["text"])
        if t in {"SIZES", "SIZE", "TOT", "QT", "P", "UNIT", "IN", "EUR"}:
            continue
        if w["x0"] > 0.76 * max(1, max(x["x1"] for x in words)):
            continue
        if re.fullmatch(r"[XSML]+", t):
            candidates.append((t, (w["x0"] + w["x1"]) / 2, w))
    centers = {}
    for t, c, _w in candidates:
        if t in SIZES and t not in centers:
            centers[t] = c
    # Greedy recovery for split X S / X L / X X L OCR tokens.
    if len(centers) < 6 and candidates:
        toks = [(t, c, w) for t, c, w in candidates]
        toks.sort(key=lambda x: x[1])
        used = [False] * len(toks)
        result = {}
        for expected in SIZES:
            for i in range(len(toks)):
                if used[i]:
                    continue
                combo = ""
                idxs = []
                for j in range(i, len(toks)):
                    if used[j]:
                        break
                    combo += toks[j][0]
                    idxs.append(j)
                    if combo == expected:
                        result[expected] = sum(toks[k][1] for k in idxs) / len(idxs)
                        for k in idxs:
                            used[k] = True
                        break
                    if not expected.startswith(combo):
                        break
                if expected in result:
                    break
        centers.update(result)
    if len(centers) >= 4:
        known = sorted((SIZES.index(k), v) for k, v in centers.items() if k in SIZES)
        diffs = [(x2 - x1) / (i2 - i1) for (i1, x1), (i2, x2) in zip(known, known[1:]) if i2 > i1]
        step = sorted(diffs)[len(diffs) // 2] if diffs else 35
        i0, x0 = known[0]
        for i, s in enumerate(SIZES):
            centers.setdefault(s, x0 + (i - i0) * step)
    if len(centers) < 6:
        # Template fallback for OCR if all else fails: derive from SIZES word and TOT word if present.
        size_word = next((w for w in words if norm(w["text"]) in {"SIZES", "SIZE"}), None)
        tot_word = next((w for w in words if norm(w["text"]) == "TOT"), None)
        if size_word and tot_word:
            left = size_word["x1"] + (tot_word["x0"] - size_word["x1"]) * 0.08
            right = tot_word["x0"] - (tot_word["x0"] - size_word["x1"]) * 0.08
            step = (right - left) / 5
            centers = {s: left + i * step for i, s in enumerate(SIZES)}
        else:
            centers = dict(zip(SIZES, [99.5, 134.0, 168.8, 203.5, 237.6, 272.3]))
    return centers


def parse_qty_by_geometry(size_line, qty_line):
    centers = locate_size_centers(size_line)
    xs = [centers[s] for s in SIZES]
    qty = {s: 0 for s in SIZES}
    for i, s in enumerate(SIZES):
        if i == 0:
            left = xs[0] - (xs[1] - xs[0]) / 2
        else:
            left = (xs[i - 1] + xs[i]) / 2
        if i == len(SIZES) - 1:
            right = xs[-1] + (xs[-1] - xs[-2]) / 2
        else:
            right = (xs[i] + xs[i + 1]) / 2
        toks = []
        for w in qty_line["words"]:
            cx = (w["x0"] + w["x1"]) / 2
            if not (left <= cx < right):
                continue
            digits = re.sub(r"\D", "", w["text"])
            if digits:
                toks.append((w["x0"], digits))
        if toks:
            joined = "".join(t for _x, t in sorted(toks))
            # A size cell should never contain hundreds/thousands in these orders.
            if len(joined) <= 3:
                qty[s] = int(joined)
            else:
                qty[s] = int(joined[:3])
    return qty


def parse_page_words(words, page_no=1):
    lines = group_lines(words)
    order = extract_order_number(lines)
    season = extract_season(lines)
    rows = []
    current_style = None
    for idx, line in enumerate(lines):
        style = parse_style_line(line)
        if style:
            current_style = style
            if style.get("season"):
                season = style["season"]
            continue
        color = locate_color_on_line(line)
        if not color or not current_style:
            continue
        size_line = None
        qty_line = None
        for j in range(idx + 1, min(idx + 15, len(lines))):
            up = lines[j]["text"].upper()
            exact = {norm(w["text"]) for w in lines[j]["words"]}
            if "STYLE" in exact or "COLOR" in exact:
                break
            if ("SIZES" in exact or "SIZE" in exact or len(exact.intersection(set(SIZES))) >= 3) and size_line is None:
                size_line = lines[j]
            if any(w["x0"] < 110 and norm(w["text"]).startswith(("Q", "QTIES")) for w in lines[j]["words"]):
                qty_line = lines[j]
            if size_line and qty_line:
                break
        if size_line and qty_line:
            qty = parse_qty_by_geometry(size_line, qty_line)
            total = sum(qty.values())
            if total > 0:
                rows.append({
                    "page": page_no,
                    "orderNumber": order,
                    "season": season or current_style.get("season", ""),
                    "style": current_style["style"],
                    "designation": current_style.get("designation", ""),
                    "colorCode": color["code"],
                    "colorName": color["name"],
                    "exMillDate": "",
                    "ean": "",
                    **{s: qty.get(s, 0) for s in SIZES},
                    "total": total,
                })
    return rows


def parse_pdf_file(path, force_ocr=False):
    doc = fitz.open(path)
    rows = []
    logs = []
    for pno, page in enumerate(doc, 1):
        text_words = words_from_pymupdf_page(page)
        use_ocr = force_ocr or not detect_text_layer(text_words)
        if use_ocr:
            logs.append(f"page {pno}: OCR parse")
            try:
                words = words_from_ocr_page(page)
            except Exception as e:
                logs.append(f"page {pno}: OCR failed: {e}")
                words = text_words
        else:
            logs.append(f"page {pno}: text-layer parse")
            words = text_words
        page_rows = parse_page_words(words, pno)
        if not page_rows and use_ocr and text_words:
            # Fallback if OCR is worse than text layer.
            page_rows = parse_page_words(text_words, pno)
            if page_rows:
                logs.append(f"page {pno}: recovered from text layer after OCR fallback")
        if page_rows:
            logs.append(f"page {pno}: parsed {len(page_rows)} row(s)")
        rows.extend(page_rows)
    return rows, logs

# -----------------------------------------------------------------------------
# Cartons
# -----------------------------------------------------------------------------

def row_qty(row):
    return {s: int(float(row.get(s, 0) or 0)) for s in SIZES}


def _positive_int(value, default):
    try:
        n = int(float(value))
        return n if n > 0 else default
    except Exception:
        return default


def _positive_float(value, default):
    try:
        n = float(value)
        return n if n > 0 else default
    except Exception:
        return default


def row_pack_settings(row, settings):
    """Return the effective packing settings for one style/color row.

    The browser UI can store row-level override values. Empty override fields fall
    back to the global defaults, so existing workflows keep behaving the same.
    """
    global_capacity = _positive_int(settings.get("capacity", 25), 25)
    global_net = _positive_float(settings.get("netPerPiece", 0.35), 0.35)
    global_tare = _positive_float(settings.get("tare", 1.2), 1.2)
    global_box = settings.get("boxSize") or "60/40/40"
    capacity = _positive_int(row.get("overrideCapacity") or row.get("capacityOverride"), global_capacity)
    net_per_piece = _positive_float(row.get("overrideNetPerPiece") or row.get("netPerPieceOverride"), global_net)
    tare = _positive_float(row.get("overrideTare") or row.get("tareOverride"), global_tare)
    box_size = clean_text(row.get("overrideBoxSize") or row.get("boxSizeOverride") or global_box) or global_box
    return capacity, net_per_piece, tare, box_size


def cartonize_row(row, capacity=25, net_per_piece=0.35, tare=1.2, box_size="60/40/40"):
    rem = row_qty(row)
    cartons = []
    # Full single-size cartons first.
    for s in SIZES:
        while rem[s] >= capacity:
            q = {x: 0 for x in SIZES}
            q[s] = capacity
            rem[s] -= capacity
            cartons.append(make_carton(row, q, net_per_piece, tare, box_size))
    # Mixed remainders.
    while sum(rem.values()) > 0:
        q = {x: 0 for x in SIZES}
        space = capacity
        for s in SIZES:
            take = min(rem[s], space)
            if take:
                q[s] = take
                rem[s] -= take
                space -= take
            if space <= 0:
                break
        cartons.append(make_carton(row, q, net_per_piece, tare, box_size))
    return cartons


def make_carton(row, qty, net_per_piece, tare, box_size):
    total = sum(qty.values())
    net = round(total * float(net_per_piece), 2)
    gross = round(net + float(tare), 2)
    return {
        "orderNumber": str(row.get("orderNumber", "")),
        "season": str(row.get("season", "")),
        "style": str(row.get("style", "")),
        "designation": str(row.get("designation", "")),
        "color": f"{row.get('colorCode', '')} - {row.get('colorName', '')}".strip(" -"),
        "qty": qty,
        "totalQty": total,
        "netKg": net,
        "grossKg": gross,
        "boxSize": box_size,
    }

# -----------------------------------------------------------------------------
# Excel styles
# -----------------------------------------------------------------------------

THIN = Side(style="thin", color="000000")
MED = Side(style="medium", color="000000")
BLACK = "000000"
WHITE = "FFFFFF"
LIGHT = "F6F3ED"


def all_border(style="thin"):
    s = Side(style=style, color="000000")
    return Border(left=s, right=s, top=s, bottom=s)


def set_cell(ws, cell, value, bold=False, size=10, fill=None, color="000000", align="center", valign="center", wrap=True):
    c = ws[cell]
    c.value = value
    c.font = Font(name="Calibri", bold=bold, size=size, color=color)
    c.alignment = Alignment(horizontal=align, vertical=valign, wrap_text=wrap)
    c.border = all_border("thin")
    if fill:
        c.fill = PatternFill("solid", fgColor=fill)
    return c


def apply_box(ws, min_row, max_row, min_col, max_col, fill=None, border_style="thin"):
    """Apply border/fill to all cells in a merged-looking block so Excel displays clean outlines."""
    border = all_border(border_style)
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for c in row:
            c.border = border
            if fill:
                c.fill = PatternFill("solid", fgColor=fill)


def merge_set(ws, start_row, start_col, end_row, end_col, value, bold=False, size=10, fill=None, color="000000", align="center", valign="center", wrap=True, border_style="thin"):
    ws.merge_cells(start_row=start_row, start_column=start_col, end_row=end_row, end_column=end_col)
    apply_box(ws, start_row, end_row, start_col, end_col, fill=fill, border_style=border_style)
    return set_cell(ws, f"{get_column_letter(start_col)}{start_row}", value, bold=bold, size=size, fill=fill, color=color, align=align, valign=valign, wrap=wrap)


def style_range(ws, start_row, end_row, start_col=1, end_col=16):
    for row in ws.iter_rows(min_row=start_row, max_row=end_row, min_col=start_col, max_col=end_col):
        for c in row:
            c.font = Font(name="Calibri", size=c.font.sz or 10, bold=c.font.bold, color=c.font.color.rgb if c.font.color and c.font.color.type == 'rgb' else "000000")
            c.alignment = Alignment(horizontal=c.alignment.horizontal or "center", vertical=c.alignment.vertical or "center", wrap_text=True)
            c.border = all_border("thin")

# -----------------------------------------------------------------------------
# Packing list workbook
# -----------------------------------------------------------------------------

def make_packing_workbook(order_rows, settings):
    wb = Workbook()
    ws = wb.active
    ws.title = "Packing List"
    # Approved-style 16-column layout. Keep columns compact so it opens cleanly in Excel.
    widths = {
        "A": 7.5, "B": 12.5, "C": 8.5, "D": 18.0, "E": 25.5, "F": 30.0,
        "G": 5.2, "H": 5.2, "I": 5.2, "J": 5.2, "K": 5.2, "L": 5.2,
        "M": 8.5, "N": 8.5, "O": 8.5, "P": 10.5,
    }
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    ws.sheet_view.showGridLines = False
    for rnum in range(1, 240):
        ws.row_dimensions[rnum].height = 18
    ws.row_dimensions[1].height = 20
    for rnum in range(2, 7):
        ws.row_dimensions[rnum].height = 19
    ws.row_dimensions[7].height = 12

    doc_type = settings.get("docType", "PRODUCTION")
    shipment_date = settings.get("shipmentDate") or datetime.now().strftime("%d/%m/%y")
    pl_number = settings.get("packingListNumber") or "PL-" + datetime.now().strftime("%Y%m%d")
    invoice = settings.get("invoiceNumber", "")
    warehouse = settings.get("warehouse") or DEFAULT_WAREHOUSE
    expediteur = settings.get("expediteur") or DEFAULT_EXPEDITEUR

    # Top approved header block.
    merge_set(ws, 1, 1, 1, 3, "EXPEDITEUR", bold=True, size=9)
    merge_set(ws, 1, 4, 1, 8, "CLIENT", bold=True, size=9)
    merge_set(ws, 2, 1, 6, 3, expediteur, bold=True, size=9, valign="center")
    merge_set(ws, 2, 4, 6, 8, warehouse, bold=True, size=9, valign="center")

    options = ["COLLECTION", "PRE PROD SAMPLE", "PRE SHIP SAMPLE", "PRODUCTION"]
    for idx, opt in enumerate(options, 1):
        merge_set(ws, idx, 9, idx, 10, opt, size=9, align="left")
        set_cell(ws, f"K{idx}", "X" if opt == doc_type else "", bold=True, size=9)
        apply_box(ws, idx, idx, 11, 11)

    info = [("DATE OF SHIPMENT", shipment_date), ("PACKING LIST NUMBER", pl_number), ("INVOICE NUMBER", invoice), ("NUMBER OF CARTONS", "")]
    for idx, (k, v) in enumerate(info, 1):
        merge_set(ws, idx, 12, idx, 14, k, size=9)
        merge_set(ws, idx, 15, idx, 16, v, bold=True, size=9)

    # Build cartons by style/color section. Row-level UI overrides are supported.
    sections = []
    for row in order_rows:
        capacity, net_per_piece, tare, box_size = row_pack_settings(row, settings)
        cartons = cartonize_row(row, capacity, net_per_piece, tare, box_size)
        if cartons:
            sections.append((row, cartons))
    total_cartons = sum(len(c) for _r, c in sections)
    ws["O4"].value = total_cartons

    r = 8
    summary = []
    for order_row, cartons in sections:
        # Title bar
        merge_set(ws, r, 1, r, 16, "PACKING LIST DETAIL PER BOXES/HANGERS", bold=True, size=9, fill=BLACK, color=WHITE, border_style="thin")
        ws.row_dimensions[r].height = 18
        r += 1

        # Header rows.
        header_cells = {
            1: "CARTON\nN°", 2: "ORDER NUMBER", 3: "SEASON", 4: "STYLE", 5: "DESIGNATION", 6: "COLOR",
            13: "TOTAL\nQTY", 14: "NET WT/\nKG", 15: "GR. WT/\nKG", 16: "Box Size",
        }
        for c in range(1, 17):
            set_cell(ws, f"{get_column_letter(c)}{r}", header_cells.get(c, ""), bold=True, size=8)
        merge_set(ws, r, 7, r, 12, "SIZE", bold=True, size=8)
        ws.row_dimensions[r].height = 24
        r += 1
        for c in range(1, 17):
            set_cell(ws, f"{get_column_letter(c)}{r}", "", bold=True, size=8)
        for i, s in enumerate(SIZES, 7):
            set_cell(ws, f"{get_column_letter(i)}{r}", s, bold=True, size=8)
        ws.row_dimensions[r].height = 18
        r += 1

        color_total = {s: 0 for s in SIZES}
        for idx, carton in enumerate(cartons, 1):
            values = [idx, carton["orderNumber"], carton["season"], carton["style"], carton["designation"], carton["color"]]
            for c, v in enumerate(values, 1):
                align = "left" if c in (4, 5, 6) else "center"
                set_cell(ws, f"{get_column_letter(c)}{r}", v, size=8, align=align)
            for i, s in enumerate(SIZES, 7):
                q = carton["qty"].get(s, 0)
                color_total[s] += q
                set_cell(ws, f"{get_column_letter(i)}{r}", q if q else "", size=8)
            set_cell(ws, f"M{r}", carton["totalQty"], size=8)
            set_cell(ws, f"N{r}", carton["netKg"], size=8)
            set_cell(ws, f"O{r}", carton["grossKg"], size=8)
            set_cell(ws, f"P{r}", carton["boxSize"], size=8)
            ws.row_dimensions[r].height = 19
            r += 1

        # Total row
        for c in range(1, 17):
            set_cell(ws, f"{get_column_letter(c)}{r}", "", bold=True, fill=BLACK, color=WHITE, size=8)
        set_cell(ws, f"F{r}", "TOTAL", bold=True, fill=BLACK, color=WHITE, size=8)
        for i, s in enumerate(SIZES, 7):
            set_cell(ws, f"{get_column_letter(i)}{r}", color_total[s], bold=True, fill=BLACK, color=WHITE, size=8)
        set_cell(ws, f"M{r}", sum(color_total.values()), bold=True, fill=BLACK, color=WHITE, size=8)
        ws.row_dimensions[r].height = 18
        summary.append((order_row, color_total, sum(color_total.values())))
        r += 2

    # Summary block.
    r += 1
    merge_set(ws, r, 2, r, 14, "COURRÈGES ORDER SUMMARY", bold=True, size=9, fill=BLACK, color=WHITE)
    ws.row_dimensions[r].height = 18
    r += 1
    headers = ["ORDER\nNUMBER", "SEASON", "STYLE", "DESIGNATION", "COLOR", "SIZE", "", "", "", "", "", "TOTAL"]
    for offset, h in enumerate(headers, 2):
        set_cell(ws, f"{get_column_letter(offset)}{r}", h, bold=True, size=8)
    merge_set(ws, r, 7, r, 12, "SIZE", bold=True, size=8)
    ws.row_dimensions[r].height = 24
    r += 1
    for c in range(2, 15):
        set_cell(ws, f"{get_column_letter(c)}{r}", "", bold=True, size=8)
    for i, s in enumerate(SIZES, 7):
        set_cell(ws, f"{get_column_letter(i)}{r}", s, bold=True, size=8)
    r += 1

    grand = 0
    for order_row, totals, total in summary:
        vals = [order_row.get("orderNumber", ""), order_row.get("season", ""), order_row.get("style", ""), order_row.get("designation", ""), f"{order_row.get('colorCode','')} - {order_row.get('colorName','')}"]
        for c, v in enumerate(vals, 2):
            align = "left" if c in (4, 5, 6) else "center"
            set_cell(ws, f"{get_column_letter(c)}{r}", v, size=8, align=align)
        for i, s in enumerate(SIZES, 7):
            set_cell(ws, f"{get_column_letter(i)}{r}", totals.get(s, 0), size=8)
        set_cell(ws, f"N{r}", total, size=8)
        ws.row_dimensions[r].height = 20
        grand += total
        r += 1
    for c in range(2, 15):
        set_cell(ws, f"{get_column_letter(c)}{r}", "", bold=True, fill=BLACK, color=WHITE, size=8)
    set_cell(ws, f"M{r}", "TOTAL", bold=True, fill=BLACK, color=WHITE, size=8)
    set_cell(ws, f"N{r}", grand, bold=True, fill=BLACK, color=WHITE, size=8)

    # Print/display options.
    ws.freeze_panes = None
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.2
    ws.page_margins.right = 0.2
    ws.page_margins.top = 0.2
    ws.page_margins.bottom = 0.2
    ws.print_area = f"A1:P{r}"
    return wb

# -----------------------------------------------------------------------------
# Label workbook
# -----------------------------------------------------------------------------

def size_mix(qty):
    return " + ".join(s for s in SIZES if qty.get(s, 0))


def pcs_mix(qty):
    return " + ".join(str(qty.get(s, 0)) for s in SIZES if qty.get(s, 0))


def make_label_workbook(cartons_by_section, settings):
    """Create approved-style carton labels.

    V35 change: each worksheet is one printable A4 landscape page with a maximum
    of two labels (left/right). This avoids long worksheets where Excel page
    breaks can split labels, and it removes the old heavy/fragmented border
    artifacts by using consistent thin borders only.
    """
    wb = Workbook()
    # Remove the default sheet; pages are created below.
    default_ws = wb.active
    wb.remove(default_ws)

    warehouse = settings.get("warehouse") or DEFAULT_WAREHOUSE
    expediteur = settings.get("expediteur") or DEFAULT_EXPEDITEUR
    origin = settings.get("origin") or "BULGARIA"

    all_labels = []
    for section_id, cartons in cartons_by_section:
        denom = len(cartons)
        for i, carton in enumerate(cartons, 1):
            c = dict(carton)
            c["cartonNo"] = f"{i} / {denom}"
            all_labels.append(c)

    # Always return a workbook, even when the caller sends an empty selection.
    if not all_labels:
        ws = wb.create_sheet("Labels 1")
        ws["A1"] = "No labels generated"
        return wb

    def setup_sheet(ws):
        ws.sheet_view.showGridLines = False
        # Left label A:H, spacer I, right label J:Q.
        widths = {
            "A": 7.5, "B": 7.5, "C": 7.5, "D": 11.5, "E": 11.5, "F": 11.5, "G": 11.5, "H": 11.5,
            "I": 2.0,
            "J": 7.5, "K": 7.5, "L": 7.5, "M": 11.5, "N": 11.5, "O": 11.5, "P": 11.5, "Q": 11.5,
        }
        for col, width in widths.items():
            ws.column_dimensions[col].width = width
        ws.row_dimensions[1].height = 20
        for rr in range(2, 8):
            ws.row_dimensions[rr].height = 30
        for rr in range(8, 11):
            ws.row_dimensions[rr].height = 23
        for rr in range(11, 21):
            ws.row_dimensions[rr].height = 22
        ws.page_setup.orientation = "landscape"
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 1
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_margins.left = 0.20
        ws.page_margins.right = 0.20
        ws.page_margins.top = 0.20
        ws.page_margins.bottom = 0.20
        ws.print_area = "A1:Q20"

    def block_border(ws, row, col, rows=20, cols=8):
        # Consistent thin borders prevent the odd bold fragments caused by
        # applying medium borders to merged cells.
        thin = all_border("thin")
        for r in range(row, row + rows):
            for c in range(col, col + cols):
                ws.cell(r, c).border = thin

    def mset(ws, r1, c1, r2, c2, value, bold=False, size=11, fill=None,
             color="000000", align="center", valign="center", wrap=True):
        ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
        c = ws.cell(r1, c1)
        c.value = value
        c.font = Font(name="Calibri", size=size, bold=bold, color=color)
        c.alignment = Alignment(horizontal=align, vertical=valign, wrap_text=wrap)
        if fill:
            c.fill = PatternFill("solid", fgColor=fill)
        return c

    def write_one(ws, row, col, carton):
        block_border(ws, row, col)
        # Title.
        mset(ws, row, col, row, col + 7, "COURRÈGES CARTON LABEL", bold=True, fill=BLACK, color=WHITE, size=14)

        # Address blocks. Use middle vertical alignment for the two address blocks.
        mset(ws, row + 1, col, row + 6, col + 2, "WAREHOUSE", bold=True, size=14, valign="center")
        mset(ws, row + 1, col + 3, row + 6, col + 7, warehouse, size=11, align="left", valign="center")
        mset(ws, row + 7, col, row + 9, col + 2, "EXPEDITEUR", bold=True, size=14, valign="center")
        mset(ws, row + 7, col + 3, row + 9, col + 7, expediteur, size=11, align="left", valign="center")

        fields = [
            ("ORDER NUMBER", carton.get("orderNumber", "")),
            ("SEASON", carton.get("season", "")),
            ("STYLE", carton.get("style", "")),
            ("DESIGNATION", carton.get("designation", "")),
            ("COLOR", carton.get("color", "")),
            ("SIZE", size_mix(carton.get("qty", {}))),
            ("CARTON N°", carton.get("cartonNo", "")),
            ("PCS", pcs_mix(carton.get("qty", {}))),
            ("NET KG / GROSS KG", f"{carton.get('netKg','')} / {carton.get('grossKg','')}"),
            ("DIM / ORIGIN", f"{carton.get('boxSize','')} cm / {origin}"),
        ]
        rr = row + 10
        for label, value in fields:
            mset(ws, rr, col, rr, col + 2, label, bold=True, size=11)
            mset(ws, rr, col + 3, rr, col + 7, value, size=11, align="left")
            rr += 1

    # One worksheet per printable page. Maximum 2 labels per sheet.
    for page_start in range(0, len(all_labels), 2):
        page_no = page_start // 2 + 1
        ws = wb.create_sheet(f"Labels {page_no}")
        setup_sheet(ws)
        write_one(ws, 1, 1, all_labels[page_start])
        if page_start + 1 < len(all_labels):
            write_one(ws, 1, 10, all_labels[page_start + 1])

    return wb

# -----------------------------------------------------------------------------
# Labels from finished packing list Excel
# -----------------------------------------------------------------------------

def v(cell):
    return cell.value if cell is not None else None


def text_of(row):
    return " ".join(clean_text(str(c.value or "")) for c in row if c.value is not None)


def parse_finished_packing_list(path):
    wb = load_workbook(path, data_only=True)
    sections = []
    for ws in wb.worksheets:
        r = 1
        while r <= ws.max_row:
            row_text = text_of(ws[r]).upper()
            if "COURR" in row_text and "ORDER SUMMARY" in row_text:
                break
            if "PACKING LIST DETAIL" in row_text:
                # Header structure is the approved file: title row, header row, size row, data rows.
                header_row = r + 1
                size_row = r + 2
                data_row = r + 3
                # Dynamic column detection with approved fallback.
                carton_col, order_col, season_col, style_col, designation_col, color_col = 1, 2, 3, 4, 5, 6
                size_cols = {s: 7 + i for i, s in enumerate(SIZES)}
                total_col, net_col, gross_col, box_col = 13, 14, 15, 16
                section_cartons = []
                rr = data_row
                while rr <= ws.max_row:
                    rt = text_of(ws[rr]).upper()
                    if "COURR" in rt and "ORDER SUMMARY" in rt:
                        r = ws.max_row + 1
                        break
                    if "PACKING LIST DETAIL" in rt:
                        break
                    if "TOTAL" in rt and not v(ws.cell(rr, carton_col)):
                        break
                    carton_no = v(ws.cell(rr, carton_col))
                    if isinstance(carton_no, str) and not carton_no.strip().isdigit():
                        if "TOTAL" in rt:
                            break
                        rr += 1
                        continue
                    try:
                        int_carton = int(float(carton_no))
                    except Exception:
                        rr += 1
                        continue
                    order_num = clean_text(v(ws.cell(rr, order_col)) or "")
                    style = clean_text(v(ws.cell(rr, style_col)) or "")
                    color = clean_text(v(ws.cell(rr, color_col)) or "")
                    if not order_num or not style or not color:
                        rr += 1
                        continue
                    qty = {s: int(float(v(ws.cell(rr, c)) or 0)) for s, c in size_cols.items()}
                    if sum(qty.values()) <= 0:
                        rr += 1
                        continue
                    section_cartons.append({
                        "orderNumber": order_num,
                        "season": clean_text(v(ws.cell(rr, season_col)) or ""),
                        "style": style,
                        "designation": clean_text(v(ws.cell(rr, designation_col)) or ""),
                        "color": color,
                        "qty": qty,
                        "totalQty": int(float(v(ws.cell(rr, total_col)) or sum(qty.values()))),
                        "netKg": v(ws.cell(rr, net_col)) or "",
                        "grossKg": v(ws.cell(rr, gross_col)) or "",
                        "boxSize": clean_text(v(ws.cell(rr, box_col)) or "60/40/40"),
                    })
                    rr += 1
                if section_cartons:
                    sections.append((f"section_{len(sections)+1}", section_cartons))
                r = rr
            r += 1
    return sections

# -----------------------------------------------------------------------------
# Export bundle
# -----------------------------------------------------------------------------

def rows_to_sections(rows, settings):
    sections = []
    for i, row in enumerate(rows, 1):
        capacity, net_per_piece, tare, box_size = row_pack_settings(row, settings)
        cartons = cartonize_row(row, capacity, net_per_piece, tare, box_size)
        key = f"{row.get('orderNumber','')}_{row.get('style','')}_{row.get('colorCode','')}_{i}"
        sections.append((key, cartons))
    return sections


def save_wb_to_bytes(wb):
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio.getvalue()

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")

@app.route("/api/status")
def status():
    return jsonify({"version": APP_VERSION, "tesseract": TESSERACT_CMD})

@app.route("/api/parse-pdfs", methods=["POST"])
def api_parse_pdfs():
    force = request.form.get("forceOcr", "false").lower() == "true"
    files = request.files.getlist("files")
    all_rows = []
    logs = []
    for f in files:
        name = secure_filename(f.filename or "order.pdf")
        path = UPLOAD_DIR / f"{int(time.time()*1000)}_{name}"
        f.save(path)
        try:
            rows, file_logs = parse_pdf_file(str(path), force_ocr=force)
            for row in rows:
                row["sourceFile"] = f.filename
            all_rows.extend(rows)
            logs.append(f"{f.filename}: {len(rows)} row(s) parsed")
            logs.extend([f"  {x}" for x in file_logs])
        except Exception as e:
            logs.append(f"{f.filename}: ERROR {e}")
    return jsonify({"rows": all_rows, "logs": logs})

@app.route("/api/export", methods=["POST"])
def api_export():
    """Export packing list, labels, or both.

    V33 adds a safer single-file path for the UI buttons:
    - kind=packing -> one .xlsx packing list when the selection is one group
    - kind=labels  -> one .xlsx carton-label workbook when the selection is one group
    - kind=zip     -> ZIP containing both, or multiple selected groups

    Errors are returned as plain text instead of a Flask HTML 500 page, so the
    browser popup shows the real reason when something still breaks.
    """
    try:
        payload = request.get_json(force=True)
        rows = payload.get("rows", [])
        settings = payload.get("settings", {})
        group_mode = settings.get("groupMode", "order")
        kind = (payload.get("kind") or settings.get("exportKind") or "zip").lower()
        if kind not in {"zip", "packing", "labels"}:
            kind = "zip"
        if not rows:
            return "No rows to export", 400, {"Content-Type": "text/plain; charset=utf-8"}

        groups = defaultdict(list)
        if group_mode == "styleColor":
            for row in rows:
                groups[(row.get("orderNumber"), row.get("style"), row.get("colorCode"))].append(row)
        else:
            for row in rows:
                groups[(row.get("orderNumber"),)].append(row)

        generated = []
        for key, group_rows in groups.items():
            order = safe_filename(group_rows[0].get("orderNumber", "ORDER"))
            descriptor = safe_filename(group_rows[0].get("style", "MULTI"))
            if group_mode == "styleColor":
                descriptor += "_" + safe_filename(group_rows[0].get("colorCode", "COLOR"))
            base = f"{order}_{descriptor}"
            if kind in {"zip", "packing"}:
                wb_pl = make_packing_workbook(group_rows, settings)
                generated.append((f"{base}_Packing_List.xlsx", save_wb_to_bytes(wb_pl)))
            if kind in {"zip", "labels"}:
                sections = rows_to_sections(group_rows, settings)
                wb_lab = make_label_workbook(sections, settings)
                generated.append((f"{base}_Carton_Labels.xlsx", save_wb_to_bytes(wb_lab)))

        if not generated:
            return "No files were generated", 400, {"Content-Type": "text/plain; charset=utf-8"}

        # For individual buttons, return the workbook directly instead of forcing a ZIP.
        if len(generated) == 1 and kind in {"packing", "labels"}:
            filename, data = generated[0]
            bio = io.BytesIO(data)
            bio.seek(0)
            return send_file(
                bio,
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                as_attachment=True,
                download_name=filename,
            )

        zip_bio = io.BytesIO()
        with zipfile.ZipFile(zip_bio, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename, data in generated:
                zf.writestr(filename, data)
        zip_bio.seek(0)
        return send_file(zip_bio, mimetype="application/zip", as_attachment=True, download_name="COURREGES_exports.zip")
    except Exception:
        msg = "Export failed:\n" + traceback.format_exc()
        return msg, 500, {"Content-Type": "text/plain; charset=utf-8"}

@app.route("/api/labels-from-packing", methods=["POST"])
def api_labels_from_packing():
    settings_raw = request.form.get("settings", "{}")
    try:
        settings = json.loads(settings_raw)
    except Exception:
        settings = {}
    files = request.files.getlist("files")
    zip_bio = io.BytesIO()
    logs = []
    with zipfile.ZipFile(zip_bio, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            name = secure_filename(f.filename or "packing_list.xlsx")
            path = UPLOAD_DIR / f"{int(time.time()*1000)}_{name}"
            f.save(path)
            try:
                sections = parse_finished_packing_list(path)
                logs.append(f"{f.filename}: {sum(len(c) for _, c in sections)} carton row(s) in {len(sections)} detail section(s)")
                if not sections:
                    continue
                wb_lab = make_label_workbook(sections, settings)
                base = safe_filename(Path(f.filename).stem.replace("Packing_List", "Carton_Labels"))
                zf.writestr(f"{base}_Carton_Labels.xlsx", save_wb_to_bytes(wb_lab))
            except Exception as e:
                logs.append(f"{f.filename}: ERROR {e}")
        zf.writestr("labels_from_packing_log.txt", "\n".join(logs))
    zip_bio.seek(0)
    return send_file(zip_bio, mimetype="application/zip", as_attachment=True, download_name="COURREGES_labels_from_packing.zip")

# -----------------------------------------------------------------------------
# Launcher
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    url = f"http://127.0.0.1:{port}"
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, debug=False)
