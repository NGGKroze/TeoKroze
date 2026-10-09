"""Тестове на lps_engine: python -m unittest discover -s tests/engine   (нужни: PyMuPDF, reportlab; за OCR - Tesseract)"""
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime"))
import lps_engine  # noqa: E402
from lps_engine import ocr, server  # noqa: E402

try:
    import fitz
    from reportlab.pdfgen import canvas
    from PIL import Image
    HAVE = True
except ImportError:  # pragma: no cover
    HAVE = False


def text_pdf() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(72, 760, "PACKING LIST 12345")
    c.setFont("Helvetica", 22)
    c.drawString(72, 700, "CARTON 7 STYLE ABC123")
    c.save()
    return buf.getvalue()


def scanned_pdf() -> bytes:
    """Същото съдържание, но само като картинка (без текстов слой)."""
    src = fitz.open(stream=text_pdf(), filetype="pdf")
    pix = src[0].get_pixmap(dpi=200)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    out = io.BytesIO()
    img.save(out, format="PDF", resolution=200)
    return out.getvalue()


@unittest.skipUnless(HAVE, "липсват PyMuPDF/reportlab/Pillow")
class PdfTests(unittest.TestCase):
    def test_text_layer_is_read_without_ocr(self):
        r = lps_engine.extract_pdf(text_pdf(), "auto")
        p = r["pages"][0]
        self.assertFalse(p["ocr"])
        self.assertIn("PACKING LIST 12345", p["text"])
        w = [x for x in p["words"] if x[4] == "12345"]
        self.assertTrue(w and w[0][0] > 0 and w[0][1] < p["height"])

    @unittest.skipUnless(ocr.ocr_available(), "няма Tesseract")
    def test_scanned_pdf_falls_back_to_ocr(self):
        r = lps_engine.extract_pdf(scanned_pdf(), "auto")
        p = r["pages"][0]
        self.assertTrue(p["ocr"])
        self.assertIn("12345", p["text"].replace(" ", ""))
        self.assertIn("ABC123", p["text"].replace(" ", "").upper())
        # координатите са в точки на PDF (A4 ~ 595x842), не в пиксели
        self.assertTrue(all(0 <= x[0] <= p["width"] + 1 and 0 <= x[1] <= p["height"] + 1 for x in p["words"]))

    def test_ocr_off_does_not_ocr(self):
        r = lps_engine.extract_pdf(scanned_pdf(), "off")
        self.assertFalse(r["pages"][0]["ocr"])


@unittest.skipUnless(HAVE, "липсват PyMuPDF/reportlab/Pillow")
class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import socket
        s = socket.socket(); s.bind(("127.0.0.1", 0)); cls.port = s.getsockname()[1]; s.close()
        server.serve_in_thread(cls.port)
        import time
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/health", timeout=1); break
            except Exception:
                time.sleep(0.1)

    def req(self, path, data=None, origin=None, method=None):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, method=method or ("POST" if data else "GET"))
        if origin:
            r.add_header("Origin", origin)
        return urllib.request.urlopen(r, timeout=30)

    def test_health_and_pdf_endpoint(self):
        h = json.load(self.req("/health", origin="https://dior.lps.local"))
        self.assertTrue(h["ok"])
        res = self.req("/api/pdf/text?ocr=off", text_pdf(), origin="https://dior.lps.local")
        self.assertEqual(res.headers["Access-Control-Allow-Origin"], "https://dior.lps.local")
        self.assertIn("PACKING LIST", json.load(res)["pages"][0]["text"])

    def test_foreign_origin_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.req("/health", origin="https://evil.example.com")
        self.assertEqual(cm.exception.code, 403)

    def test_preflight_allows_private_network(self):
        res = self.req("/api/pdf/text", origin="https://zadig.lps.local", method="OPTIONS")
        self.assertEqual(res.status, 204)
        self.assertEqual(res.headers["Access-Control-Allow-Private-Network"], "true")


if __name__ == "__main__":
    unittest.main()
