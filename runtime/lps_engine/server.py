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

from . import __version__, ocr, pdf

MAX_BODY = 200 * 1024 * 1024
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
        if urlparse(self.path).path == "/health":
            return self._json({"ok": True, "app": "lps-engine", "version": __version__, "tesseract": ocr.tesseract_info()})
        self._json({"error": "not found"}, 404)

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
