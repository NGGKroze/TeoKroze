#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
APP_HOME="${XDG_CACHE_HOME:-$HOME/.cache}/asphalte_workshop"
VENV_DIR="$APP_HOME/venv"
HASH_FILE="$APP_HOME/requirements.sha256"
mkdir -p "$APP_HOME"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Creating shared local Python environment - one time only..."
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
NEW_HASH=$(python3 - <<'PY'
import hashlib
print(hashlib.sha256(open('requirements.txt','rb').read()).hexdigest())
PY
)
OLD_HASH=""
[ -f "$HASH_FILE" ] && OLD_HASH=$(cat "$HASH_FILE")
if [ "$NEW_HASH" != "$OLD_HASH" ]; then
  echo "Installing or updating required packages..."
  python -m pip install --disable-pip-version-check -r requirements.txt
  printf '%s' "$NEW_HASH" > "$HASH_FILE"
fi
python server.py "$@"
