"""PDF -> текст по страници с координати (PyMuPDF); при липса на текстов слой автоматично OCR."""
from . import ocr


def extract_pdf(data: bytes, ocr_mode: str = "auto", lang: str = "eng", dpi: int = 300, min_chars: int = 20) -> dict:
    """ocr_mode: 'off' | 'auto' (само за страници без текст) | 'force' (всички страници).
    Връща {"pages":[{"n","width","height","text","words":[[x0,y0,x1,y1,дума]], "ocr":bool}], "ocr_available":bool, "warnings":[...]}.
    Координатите са в точки на PDF (72/инч), началото е горе вляво."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        try:
            import pymupdf as fitz
        except ImportError as exc:
            raise RuntimeError("Липсва PyMuPDF.") from exc

    doc = fitz.open(stream=data, filetype="pdf")
    pages, warnings = [], []
    can_ocr = ocr.ocr_available()
    for i, page in enumerate(doc):
        rect = page.rect
        words = [[round(w[0], 2), round(w[1], 2), round(w[2], 2), round(w[3], 2), w[4]] for w in page.get_text("words")]
        text = page.get_text("text")
        used_ocr = False
        need_ocr = ocr_mode == "force" or (ocr_mode == "auto" and len(text.strip()) < min_chars)
        if need_ocr:
            if not can_ocr:
                warnings.append(f"Страница {i + 1}: няма текстов слой, а OCR не е наличен.")
            else:
                from PIL import Image
                pix = page.get_pixmap(dpi=dpi)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                otext, owords = ocr.ocr_image(img, lang=lang)
                k = 72.0 / dpi
                words = [[round(w[0] * k, 2), round(w[1] * k, 2), round(w[2] * k, 2), round(w[3] * k, 2), w[4]] for w in owords]
                text, used_ocr = otext, True
        pages.append({"n": i + 1, "width": round(rect.width, 2), "height": round(rect.height, 2), "text": text, "words": words, "ocr": used_ocr})
    return {"pages": pages, "ocr_available": can_ocr, "warnings": warnings}
