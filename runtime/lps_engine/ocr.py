"""Единно откриване и ползване на Tesseract (вграден в runtime\\tesseract или от системата)."""
import io
import os
import shutil
from pathlib import Path

_state = {"configured": False, "cmd": None, "pytesseract": None}


def _find_cmd():
    env = os.environ.get("TESSERACT_CMD")
    if env and Path(env).exists():
        return env
    here = Path(__file__).resolve().parent.parent  # runtime/
    for name in ("tesseract.exe", "tesseract"):
        p = here / "tesseract" / name
        if p.exists():
            return str(p)
    for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"):
        if Path(p).exists():
            return p
    return shutil.which("tesseract")


def _configure():
    if _state["configured"]:
        return
    _state["configured"] = True
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception:
        return
    cmd = _find_cmd()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
        tess_dir = Path(cmd).parent
        if "TESSDATA_PREFIX" not in os.environ and (tess_dir / "tessdata").exists():
            os.environ["TESSDATA_PREFIX"] = str(tess_dir / "tessdata")
        _state["cmd"] = cmd
        _state["pytesseract"] = pytesseract


def ocr_available() -> bool:
    _configure()
    return _state["pytesseract"] is not None


def tesseract_info() -> dict:
    _configure()
    info = {"available": ocr_available(), "cmd": _state["cmd"], "languages": []}
    if info["available"]:
        try:
            info["languages"] = sorted(_state["pytesseract"].get_languages(config=""))
        except Exception:
            pass
    return info


def ocr_image(image, lang="eng", psm=6):
    """image: PIL.Image -> (текст, думи[[x0,y0,x1,y1,текст,ред]]) в пиксели на изображението."""
    _configure()
    pt = _state["pytesseract"]
    if pt is None:
        raise RuntimeError("OCR не е наличен (липсва Tesseract или pytesseract/Pillow).")
    data = pt.image_to_data(image, lang=lang, config=f"--psm {psm}", output_type=pt.Output.DICT)
    words, lines = [], {}
    for i, t in enumerate(data["text"]):
        t = (t or "").strip()
        if not t or float(data["conf"][i]) < 0:
            continue
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        words.append([x, y, x + w, y + h, t, key])
        lines.setdefault(key, []).append((x, t))
    text = "\n".join(" ".join(t for _, t in sorted(v)) for _, v in sorted(lines.items()))
    return text, words


def ocr_image_bytes(data: bytes, lang="eng", psm=6) -> dict:
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    text, words = ocr_image(img, lang, psm)
    return {"text": text, "words": [[w[0], w[1], w[2], w[3], w[4]] for w in words]}
