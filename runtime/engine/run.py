"""Стартира общия engine като sidecar на обвивката (порт и данни от TEOKROZE_*)."""
import os
import sys

sys.path.insert(0, os.environ.get("TEOKROZE_RUNTIME") or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import teokroze_sidecar  # noqa: E402

ctx = teokroze_sidecar.setup(__file__)
from lps_engine import server  # noqa: E402

server.serve(ctx["port"])
