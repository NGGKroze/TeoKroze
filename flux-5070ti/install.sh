#!/usr/bin/env bash
# Linux версия. Нужни: curl, unzip. Употреба: ./install.sh [--gguf]
set -euo pipefail
cd "$(dirname "$0")"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
get_repo() { [ -d "$2" ] && return; t=$(mktemp -d); curl -L "$1" -o "$t/r.zip"; unzip -q "$t/r.zip" -d "$t"; mkdir -p "$(dirname "$2")"; mv "$t"/*/ "$2"; rm -rf "$t"; }
get_repo https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.zip ComfyUI
get_repo https://github.com/city96/ComfyUI-GGUF/archive/refs/heads/main.zip ComfyUI/custom_nodes/ComfyUI-GGUF
get_repo https://github.com/Comfy-Org/ComfyUI-Manager/archive/refs/heads/main.zip ComfyUI/custom_nodes/ComfyUI-Manager
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
for r in ComfyUI ComfyUI/custom_nodes/ComfyUI-GGUF ComfyUI/custom_nodes/ComfyUI-Manager; do uv pip install --python .venv/bin/python -r $r/requirements.txt; done
hf=https://huggingface.co
get_model() { mkdir -p "ComfyUI/models/$2"; f="ComfyUI/models/$2/$3"; [ -f "$f" ] || { curl -L --fail --retry 5 -C - -o "$f.part" "$1" && mv "$f.part" "$f"; }; }
get_model $hf/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors checkpoints flux1-dev-fp8.safetensors
get_model $hf/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors diffusion_models flux1-dev-kontext_fp8_scaled.safetensors
get_model $hf/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors text_encoders clip_l.safetensors
get_model $hf/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors text_encoders t5xxl_fp8_e4m3fn_scaled.safetensors
get_model $hf/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors vae ae.safetensors
if [ "${1:-}" = "--gguf" ]; then
  get_model $hf/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q8_0.gguf unet flux1-dev-Q8_0.gguf
  get_model $hf/QuantStack/FLUX.1-Kontext-dev-GGUF/resolve/main/flux1-kontext-dev-Q8_0.gguf unet flux1-kontext-dev-Q8_0.gguf
fi
cat > run.sh <<'R'
#!/usr/bin/env bash
cd "$(dirname "$0")/ComfyUI" && ../.venv/bin/python main.py --fast fp16_accumulation fp8_matrix_mult --use-pytorch-cross-attention
R
chmod +x run.sh; echo "Готово: ./run.sh"
