"""Локален HTTP сървис на engine-а: само на 127.0.0.1, само за страниците на програмата.

  GET  /health
  POST /api/pdf/text?ocr=auto|off|force&lang=eng&dpi=300   (тяло: PDF)
  POST /api/ocr/image?lang=eng&psm=6                       (тяло: PNG/JPEG)
"""
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import os
import uuid
from collections import OrderedDict
from pathlib import Path

from . import __version__, lab, ocr, pdf

MAX_BODY = 300 * 1024 * 1024
LAB_DIR = Path(__file__).resolve().parent / "lab"
DOCS = OrderedDict()   # кеш на отворените в анализа PDF-и (за рендиране на страници)
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}
# Разрешени са само страниците на програмата (https://<модул>.lps.local) и локалният сървис.
ORIGIN_OK = re.compile(r"^(https://[a-z0-9_-]+\.lps\.local|http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)$")


class Handler(BaseHTTPRequestHandler):
    server_version = "LPS-Engine/" + __version__

    def log_message(self, fmt, *args):  # без шум в конзолата
        pass

    # --- CORS ---
    def _origin(self):
        o = self.headers.get("Origin")
        return o if (o and ORIGIN_OK.match(o)) else None

    def _headers(self, status, ctype="application/json; charset=utf-8", length=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if length is not None:
            self.send_header("Content-Length", str(length))
        o = self._origin()
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._headers(status, length=len(body))
        self.wfile.write(body)

    def _forbidden(self):
        # заявка от непозната страница (напр. сайт в браузъра) - отказваме
        o = self.headers.get("Origin")
        return bool(o) and not self._origin()

    def do_OPTIONS(self):
        if self._forbidden():
            return self._json({"error": "origin"}, 403)
        self.send_response(204)
        o = self._origin()
        if o:
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self._forbidden():
            return self._json({"error": "origin"}, 403)
        path = urlparse(self.path).path
        if path == "/lab" or path.startswith("/lab/"):
            return self._lab_static(path)
        if path == "/api/lab/render":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            data = DOCS.get(q.get("id", ""))
            if data is None:
                return self._json({"error": "документът не е в кеша - качете го наново"}, 404)
            try:
                png = lab.render_page(data, int(q.get("page", 1)), int(q.get("dpi", 80)))
            except Exception as exc:
                return self._json({"error": str(exc)}, 500)
            self._headers(200, "image/png", len(png))
            return self.wfile.write(png)
        if path == "/health":
            return self._json({"ok": True, "app": "lps-engine", "version": __version__, "tesseract": ocr.tesseract_info()})
        self._json({"error": "not found"}, 404)

    def _lab_static(self, path):
        name = "index.html" if path in ("/lab", "/lab/") else path[len("/lab/"):]
        f = (LAB_DIR / name).resolve()
        if LAB_DIR.resolve() not in f.parents or not f.is_file():
            return self._json({"error": "not found"}, 404)
        body = f.read_bytes()
        self._headers(200, MIME.get(f.suffix, "application/octet-stream"), len(body))
        self.wfile.write(body)

    def do_POST(self):
        if self._forbidden():
            return self._json({"error": "origin"}, 403)
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._json({"error": "празно или твърде голямо тяло"}, 400)
        data = self.rfile.read(n)
        try:
            if u.path == "/api/pdf/text":
                return self._json(pdf.extract_pdf(data, q.get("ocr", "auto"), q.get("lang", "eng"), int(q.get("dpi", 300))))
            if u.path == "/api/lab/pdf":
                res = lab.analyze_pdf(data, q.get("ocr", "auto"), q.get("lang", "eng"), int(q.get("dpi", 300)))
                doc_id = q.get("id") or uuid.uuid4().hex[:12]
                DOCS[doc_id] = data
                while len(DOCS) > 6:
                    DOCS.popitem(last=False)
                res["id"] = doc_id
                return self._json(res)
            if u.path == "/api/lab/table":
                return self._json(lab.analyze_table(data, q.get("name", "file.xlsx")))
            if u.path == "/api/lab/save":
                p = json.loads(data.decode("utf-8"))
                out = os.environ.get("TEOKROZE_OUTPUT_DIR") or str(Path.home() / "Documents" / "Logistics Packing")
                return self._json({"path": lab.save_package(out, p.get("name", "file"), p.get("report", {}), p.get("file_b64", ""), p.get("file_name", ""))})
            if u.path == "/api/ocr/image":
                return self._json(ocr.ocr_image_bytes(data, q.get("lang", "eng"), int(q.get("psm", 6))))
        except Exception as exc:  # връщаме разбираема грешка на страницата
            return self._json({"error": str(exc)}, 500)
        self._json({"error": "not found"}, 404)


def serve(port: int):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    httpd.serve_forever()


def serve_in_thread(port: int):
    t = threading.Thread(target=serve, args=(port,), daemon=True)
    t.start()
    return t
