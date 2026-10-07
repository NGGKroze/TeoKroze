# Flux.1 Dev генератор + Kontext редактор (ComfyUI) за RTX 5070 Ti 16GB
# Употреба: install.bat            -> fp8 модели (препоръчително, най-бързо)
#           install.bat -Gguf      -> допълнително Q8_0 GGUF версии (по-близко до fp16 качество)
param([switch]$Gguf)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root
$ProgressPreference = 'SilentlyContinue'

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# 1) uv (сам сваля Python 3.12 - не трябва да е инсталиран Python/git)
Step "uv"
$uvDir = Join-Path $root 'uv'
$uv = Join-Path $uvDir 'uv.exe'
if (-not (Test-Path $uv)) {
    New-Item -ItemType Directory -Force $uvDir | Out-Null
    Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile "$uvDir\uv.zip"
    Expand-Archive "$uvDir\uv.zip" $uvDir -Force
    Remove-Item "$uvDir\uv.zip"
}

# 2) ComfyUI + custom nodes (zip от GitHub, без git)
function Get-Repo($url, $dest) {
    if (Test-Path $dest) { return }
    $zip = Join-Path $root 'tmp_repo.zip'
    $tmp = Join-Path $root 'tmp_repo'
    Invoke-WebRequest $url -OutFile $zip
    Expand-Archive $zip $tmp -Force
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    Move-Item (Get-ChildItem $tmp | Select-Object -First 1).FullName $dest
    Remove-Item $zip, $tmp -Recurse -Force
}
Step "ComfyUI"
Get-Repo 'https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.zip' "$root\ComfyUI"
Step "Custom nodes (GGUF, Manager)"
Get-Repo 'https://github.com/city96/ComfyUI-GGUF/archive/refs/heads/main.zip' "$root\ComfyUI\custom_nodes\ComfyUI-GGUF"
Get-Repo 'https://github.com/Comfy-Org/ComfyUI-Manager/archive/refs/heads/main.zip' "$root\ComfyUI\custom_nodes\ComfyUI-Manager"

# 3) venv + PyTorch за Blackwell (RTX 50xx изисква CUDA 12.8+ => cu128)
Step "Python venv + PyTorch (CUDA 12.8)"
& $uv venv "$root\.venv" --python 3.12
$py = "$root\.venv\Scripts\python.exe"
& $uv pip install --python $py torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
& $uv pip install --python $py -r "$root\ComfyUI\requirements.txt"
& $uv pip install --python $py -r "$root\ComfyUI\custom_nodes\ComfyUI-GGUF\requirements.txt"
& $uv pip install --python $py -r "$root\ComfyUI\custom_nodes\ComfyUI-Manager\requirements.txt"

# 4) Модели (възобновяемо сваляне; нищо от това не е gated)
function Get-Model($url, $dir, $name) {
    $d = Join-Path $root "ComfyUI\models\$dir"
    New-Item -ItemType Directory -Force $d | Out-Null
    $f = Join-Path $d $name
    if (Test-Path $f) { Write-Host "вече има: $name"; return }
    Write-Host "сваляне: $name"
    & curl.exe -L --fail --retry 5 -C - -o "$f.part" $url
    if ($LASTEXITCODE -ne 0) { throw "Неуспешно сваляне: $name" }
    Move-Item "$f.part" $f
}
Step "Модели (~29 GB за fp8 набора)"
$hf = 'https://huggingface.co'
# Генератор: FLUX.1 dev fp8
Get-Model "$hf/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors" 'checkpoints' 'flux1-dev-fp8.safetensors'
# Редактор: FLUX.1 Kontext dev fp8
Get-Model "$hf/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors" 'diffusion_models' 'flux1-dev-kontext_fp8_scaled.safetensors'
# Text encoders + VAE (общи)
Get-Model "$hf/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" 'text_encoders' 'clip_l.safetensors'
Get-Model "$hf/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors" 'text_encoders' 't5xxl_fp8_e4m3fn_scaled.safetensors'
Get-Model "$hf/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors" 'vae' 'ae.safetensors'
if ($Gguf) {
    Get-Model "$hf/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q8_0.gguf" 'unet' 'flux1-dev-Q8_0.gguf'
    Get-Model "$hf/QuantStack/FLUX.1-Kontext-dev-GGUF/resolve/main/flux1-kontext-dev-Q8_0.gguf" 'unet' 'flux1-kontext-dev-Q8_0.gguf'
}

Step "Готово"
Write-Host "Стартирай run.bat -> http://127.0.0.1:8188"
Write-Host "Workflow: меню Workflow > Browse Templates > Flux > 'Flux Dev' (генератор) и 'Flux Kontext Dev' (редактор)."
