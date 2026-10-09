"""Стартира COURREGES (backend/app.py) като модул на Logistics Packing Solution."""
import os
import sys

# Вграденият Python (embeddable) игнорира PYTHONPATH, затова общият помощник се добавя изрично.
sys.path.insert(0, os.environ.get("TEOKROZE_RUNTIME") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "runtime"))
import runpy
import teokroze_sidecar

ctx = teokroze_sidecar.setup(__file__)
os.environ["PORT"] = str(ctx["port"])
runpy.run_path(str(ctx["backend"] / "app.py"), run_name="__main__")
