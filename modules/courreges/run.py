"""Стартира COURREGES (backend/app.py) като модул на Logistics Packing Solution."""
import os
import runpy
import teokroze_sidecar

ctx = teokroze_sidecar.setup(__file__)
os.environ["PORT"] = str(ctx["port"])
runpy.run_path(str(ctx["backend"] / "app.py"), run_name="__main__")
