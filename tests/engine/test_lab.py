"""Тестове на анализа (lps_engine.lab): python -m unittest discover -s tests/engine"""
import io
import json
import sys
import tempfile
import unittest
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lps_engine import lab, server  # noqa: E402
import test_engine as te  # noqa: E402

try:
    import openpyxl
    HAVE = te.HAVE
except ImportError:  # pragma: no cover
    HAVE = False


def sample_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "PL"
    ws.append(["PACKING LIST"])
    ws.append([])
    ws.append(["CTN NO.", "STYLE", "COLOR", "SIZE", "QTY", "TOTAL QTY"])
    ws.append([1, "A100", "BLUE", "M", 10, 10])
    ws.merge_cells("A1:F1")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@unittest.skipUnless(HAVE, "липсват зависимости")
class LabTests(unittest.TestCase):
    def test_group_lines_and_layout(self):
        words = [[10, 10, 50, 20, "CTN"], [100, 11, 130, 21, "STYLE"], [10, 40, 30, 50, "1"], [100, 41, 120, 51, "A100"]]
        lines = lab.group_lines(words)
        self.assertEqual([l["text"] for l in lines], ["CTN STYLE", "1 A100"])
        txt = lab.layout_text(lines, 200)
        self.assertEqual(len(txt.splitlines()), 2)
        # колоната STYLE и A100 са на една и съща позиция
        a, b = txt.splitlines()
        self.assertEqual(a.index("STYLE"), b.index("A100"))

    def test_analyze_pdf_has_lines_and_layout(self):
        r = lab.analyze_pdf(te.text_pdf(), "off")
        p = r["pages"][0]
        self.assertTrue(any("PACKING LIST" in l["text"] for l in p["lines"]))
        self.assertTrue(any("CARTON" in l and " 7 " in l + " " for l in p["layout"].splitlines()))

    def test_render_page_png(self):
        png = lab.render_page(te.text_pdf(), 1, 50)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")

    def test_analyze_xlsx_finds_header_row(self):
        r = lab.analyze_table(sample_xlsx(), "x.xlsx")
        s = r["sheets"][0]
        self.assertEqual(s["name"], "PL")
        self.assertIn("A1:F1", s["merged"])
        self.assertEqual(s["header_candidates"][0]["row"], 3)

    def test_analyze_csv(self):
        r = lab.analyze_table(b"CTN NO;STYLE;COLOR;SIZE;QTY\n1;A;B;M;5\n", "x.csv")
        self.assertEqual(r["sheets"][0]["rows"][1][1], "A")
        self.assertTrue(r["sheets"][0]["header_candidates"])

    def test_save_package_zip(self):
        with tempfile.TemporaryDirectory() as d:
            import base64
            path = lab.save_package(d, "my file.xlsx", {"a": 1}, base64.b64encode(b"DATA").decode(), "my file.xlsx")
            self.assertIn("Анализ", path)
            z = zipfile.ZipFile(path)
            self.assertEqual(json.loads(z.read("report.json")), {"a": 1})
            self.assertEqual(z.read("original/my file.xlsx"), b"DATA")


@unittest.skipUnless(HAVE, "липсват зависимости")
class LabHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import socket, time
        s = socket.socket(); s.bind(("127.0.0.1", 0)); cls.port = s.getsockname()[1]; s.close()
        server.serve_in_thread(cls.port)
        for _ in range(40):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/health", timeout=1); break
            except Exception:
                time.sleep(0.1)

    def test_lab_page_is_served(self):
        html = urllib.request.urlopen(f"http://127.0.0.1:{self.port}/lab").read().decode("utf-8")
        self.assertIn("Анализ на файлове", html)

    def test_pdf_flow_and_render(self):
        base = f"http://127.0.0.1:{self.port}"
        res = json.load(urllib.request.urlopen(urllib.request.Request(base + "/api/lab/pdf?ocr=off", data=te.text_pdf(), method="POST")))
        self.assertIn("id", res)
        png = urllib.request.urlopen(f"{base}/api/lab/render?id={res['id']}&page=1&dpi=40").read()
        self.assertEqual(png[:4], b"\x89PNG")

    def test_table_endpoint(self):
        base = f"http://127.0.0.1:{self.port}"
        res = json.load(urllib.request.urlopen(urllib.request.Request(base + "/api/lab/table?name=a.xlsx", data=sample_xlsx(), method="POST")))
        self.assertEqual(res["sheets"][0]["rows"][3][1], "A100")


if __name__ == "__main__":
    unittest.main()
