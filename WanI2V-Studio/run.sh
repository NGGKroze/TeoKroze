#!/usr/bin/env bash
cd "$(dirname "$0")"
# Optional speed-up for RTX 40/50: export COMFY_ARGS="--fast fp8_matrix_mult"
exec .venv/bin/python app.py "$@"
