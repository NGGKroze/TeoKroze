"""Стартира ACNE (backend/app.py) като модул на Logistics Packing Solution."""
import os
import sys

# Вграденият Python (embeddable) игнорира PYTHONPATH, затова общият помощник се добавя изрично.
sys.path.insert(0, os.environ.get("TEOKROZE_RUNTIME") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runtime"))
import teokroze_sidecar
from urllib.parse import urlparse

ctx = teokroze_sidecar.setup(__file__)
import app  # noqa: E402  (backend/app.py - непроменен, освен папката за данни)

# Оригиналът се самоубива при затваряне/презареждане на страницата - в обвивката това не е нужно.
_orig_post = app.Handler.do_POST


def _do_post(self):
    if urlparse(self.path).path in ("/api/shutdown", "/api/window-closed"):
        self.send_json({"ok": True, "ignored": True})
        return
    return _orig_post(self)


app.Handler.do_POST = _do_post
app.ThreadingHTTPServer(("127.0.0.1", ctx["port"]), app.Handler).serve_forever()
