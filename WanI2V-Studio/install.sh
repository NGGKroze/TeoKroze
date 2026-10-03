#!/usr/bin/env bash
# Wan I2V Studio installer for Linux (NVIDIA GPU). Everything stays in this folder.
set -euo pipefail
cd "$(dirname "$0")"

COMFY_COMMIT="e9027f2b30f37bb3052714eb08fcf479542f4fc0"
TORCH_INDEX="https://download.pytorch.org/whl/cu130"
export UV_PYTHON_INSTALL_DIR="$PWD/tools/python" UV_CACHE_DIR="$PWD/tools/uv-cache"

command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader \
  || echo "WARNING: nvidia-smi not found - install the NVIDIA driver first."

UV="$PWD/tools/uv/uv"
if [ ! -x "$UV" ]; then
  mkdir -p tools/uv
  curl -LsSf https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz \
    | tar -xz -C tools/uv --strip-components=1
fi

[ -x .venv/bin/python ] || { "$UV" python install 3.12; "$UV" venv .venv --python 3.12; }

if [ ! -f ComfyUI/main.py ]; then
  curl -L "https://github.com/comfyanonymous/ComfyUI/archive/$COMFY_COMMIT.tar.gz" | tar -xz -C tools
  mv "tools/ComfyUI-$COMFY_COMMIT" ComfyUI
fi

"$UV" pip install --python .venv/bin/python torch torchvision torchaudio --index-url "$TORCH_INDEX"
"$UV" pip install --python .venv/bin/python -r ComfyUI/requirements.txt -r requirements.txt
.venv/bin/python -c "import torch; print('torch', torch.__version__, 'CUDA:', torch.cuda.is_available())"
.venv/bin/python download_models.py
echo "Install complete. Start with ./run.sh"
