"""Стартира ASPHALTE (backend/server.py) като модул на Logistics Packing Solution."""
import os
import runpy
import sys
import teokroze_sidecar

ctx = teokroze_sidecar.setup(__file__)
os.environ["ASPHALTE_PORT"] = str(ctx["port"])
sys.argv = ["server.py", "--no-browser", "--keep-alive"]
runpy.run_path(str(ctx["backend"] / "server.py"), run_name="__main__")
