"""Общ помощник за Python модулите на Logistics Packing Solution.

Обвивката (WinUI) стартира всеки Python модул като отделен процес и му подава:
  TEOKROZE_PORT      - порт, на който да слуша (127.0.0.1)
  TEOKROZE_DATA_DIR  - папка с права за запис (качени файлове, резултати)
Процесът трябва да спре сам, когато обвивката се затвори - следим stdin (EOF = родителят е умрял).
"""
import os
import sys
import threading
import webbrowser
from pathlib import Path


def _watch_parent() -> None:
    try:
        while sys.stdin.buffer.read(1024):
            pass
    except Exception:
        pass
    os._exit(0)


def setup(run_py: str) -> dict:
    module_dir = Path(run_py).resolve().parent
    backend = module_dir / "backend"
    data = Path(os.environ.get("TEOKROZE_DATA_DIR") or (module_dir / "_data"))
    data.mkdir(parents=True, exist_ok=True)
    os.environ["TEOKROZE_DATA_DIR"] = str(data)
    port = int(os.environ.get("TEOKROZE_PORT", "0"))
    if not port:
        raise SystemExit("TEOKROZE_PORT не е зададен (модулът се стартира от обвивката).")

    # Никакви собствени прозорци/табове - показва се във вградения браузър на обвивката.
    webbrowser.open = webbrowser.open_new = webbrowser.open_new_tab = lambda *a, **k: False

    sys.path.insert(0, str(backend))
    os.chdir(backend)
    if os.environ.get("TEOKROZE_WATCH_STDIN", "1") == "1":
        threading.Thread(target=_watch_parent, daemon=True).start()
    return {"port": port, "data": data, "backend": backend}
