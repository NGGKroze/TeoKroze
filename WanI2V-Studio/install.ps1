# Wan I2V Studio installer for Windows (NVIDIA RTX 50xx / 40xx / 30xx).
# Self-contained: everything goes into this folder (Python, ComfyUI, models).
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster
Set-Location -Path $PSScriptRoot

$ComfyCommit = "e9027f2b30f37bb3052714eb08fcf479542f4fc0"   # tested ComfyUI revision
$TorchIndex  = "https://download.pytorch.org/whl/cu130"      # CUDA 13.0 build, supports Blackwell (sm_120)

$Tools = Join-Path $PSScriptRoot "tools"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Tools "python"
$env:UV_CACHE_DIR = Join-Path $Tools "uv-cache"
$env:UV_LINK_MODE = "copy"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step "Checking GPU"
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
} else {
    Write-Warning "nvidia-smi not found. Install the latest NVIDIA driver (570+ for RTX 50xx) before running."
}

Step "Getting uv (Python package manager)"
$uv = Join-Path $Tools "uv\uv.exe"
if (-not (Test-Path $uv)) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Tools "uv") | Out-Null
    $zip = Join-Path $Tools "uv.zip"
    Invoke-WebRequest "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath (Join-Path $Tools "uv") -Force
    Remove-Item $zip
}

Step "Creating Python 3.12 environment"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    & $uv python install 3.12
    & $uv venv .venv --python 3.12
    if ($LASTEXITCODE -ne 0) { throw "venv creation failed" }
}
$py = Resolve-Path ".venv\Scripts\python.exe"

Step "Downloading ComfyUI backend"
if (-not (Test-Path "ComfyUI\main.py")) {
    $zip = Join-Path $Tools "comfyui.zip"
    Invoke-WebRequest "https://github.com/comfyanonymous/ComfyUI/archive/$ComfyCommit.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $Tools -Force
    Move-Item (Join-Path $Tools "ComfyUI-$ComfyCommit") "ComfyUI"
    Remove-Item $zip
}

Step "Installing PyTorch (CUDA 13.0) - ~3 GB download"
& $uv pip install --python $py torch torchvision torchaudio --index-url $TorchIndex
if ($LASTEXITCODE -ne 0) { throw "PyTorch install failed" }

Step "Installing ComfyUI + app dependencies"
& $uv pip install --python $py -r ComfyUI\requirements.txt -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency install failed" }

Step "Verifying CUDA"
& $py -c "import torch; print('torch', torch.__version__, '| CUDA available:', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO GPU')"

Step "Downloading models (~37 GB, resumable - re-run install if interrupted)"
& $py download_models.py
if ($LASTEXITCODE -ne 0) { throw "Model download failed - run install.bat again to resume" }

Write-Host "`nInstall complete. Start the app with run.bat" -ForegroundColor Green
