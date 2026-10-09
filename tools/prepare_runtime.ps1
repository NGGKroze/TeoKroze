<#
  Подготвя runtime\python (вграден Python + пакетите) и runtime\tesseract (OCR).
  Резултатът НЕ се качва в git (виж .gitignore), а се пакетира от инсталатора.

  Нормално (с интернет):      .\tools\prepare_runtime.ps1
  Подготовка на кеш за офлайн машина (на машина с интернет):   .\tools\prepare_runtime.ps1 -PrepareCache
  Офлайн (от tools\offline-cache):                               .\tools\prepare_runtime.ps1 -Offline
#>
param(
    [switch]$PrepareCache,
    [switch]$Offline,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$root    = Resolve-Path (Join-Path $PSScriptRoot '..')
$runtime = Join-Path $root 'runtime'
$py      = Join-Path $runtime 'python'
$cache   = Join-Path $PSScriptRoot 'offline-cache'
$pyVer   = '3.12.8'
$pyZip   = "python-$pyVer-embed-amd64.zip"
$pyUrl   = "https://www.python.org/ftp/python/$pyVer/$pyZip"
$getPip  = 'get-pip.py'
$reqs    = Join-Path $runtime 'requirements-runtime.txt'

function Get-Cached([string]$url, [string]$name) {
    New-Item -ItemType Directory -Force -Path $cache | Out-Null
    $dest = Join-Path $cache $name
    if (-not (Test-Path $dest)) {
        if ($Offline) { throw "Липсва $dest (офлайн режим). Подгответе кеша с -PrepareCache на машина с интернет." }
        Write-Host "Сваляне: $url"
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    }
    return $dest
}

if ($PrepareCache) {
    Get-Cached $pyUrl $pyZip | Out-Null
    Get-Cached "https://bootstrap.pypa.io/$getPip" $getPip | Out-Null
    # Колелата за вградения Python (3.12, win_amd64)
    $wheels = Join-Path $cache 'wheels'
    New-Item -ItemType Directory -Force -Path $wheels | Out-Null
    & python -m pip download -r $reqs -d $wheels --platform win_amd64 --python-version 3.12 --only-binary=:all: pip setuptools wheel
    if ($LASTEXITCODE -ne 0) { throw 'pip download се провали' }
    Write-Host "Кешът е готов: $cache  (копирайте папката tools\offline-cache на офлайн машината)"
    return
}

if ((Test-Path (Join-Path $py 'python.exe')) -and -not $Force) {
    Write-Host 'runtime\python вече съществува (използвайте -Force за ново създаване).'
} else {
    if (Test-Path $py) { Remove-Item -Recurse -Force $py }
    New-Item -ItemType Directory -Force -Path $py | Out-Null
    Expand-Archive -Path (Get-Cached $pyUrl $pyZip) -DestinationPath $py -Force

    # Позволяваме site-packages в embeddable дистрибуцията
    $pth = Get-ChildItem $py -Filter 'python*._pth' | Select-Object -First 1
    (Get-Content $pth.FullName) -replace '^#\s*import site', 'import site' | Set-Content $pth.FullName

    $pipArgs = @()
    $wheels = Join-Path $cache 'wheels'
    if ($Offline) { $pipArgs += @('--no-index', '--find-links', $wheels) }
    $env:PYTHONUTF8 = '1'
    & (Join-Path $py 'python.exe') (Get-Cached "https://bootstrap.pypa.io/$getPip" $getPip) --no-warn-script-location @pipArgs
    if ($LASTEXITCODE -ne 0) { throw 'get-pip се провали' }
    & (Join-Path $py 'python.exe') -m pip install --no-warn-script-location -r $reqs @pipArgs
    if ($LASTEXITCODE -ne 0) { throw 'pip install се провали' }
    Get-ChildItem $py -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'runtime\python е готов.'
}

# --- Tesseract (OCR за сканирани PDF: COURREGES, ACNE, ASPHALTE) ---
$tess = Join-Path $runtime 'tesseract'
if (-not (Test-Path (Join-Path $tess 'tesseract.exe'))) {
    $installed = @('C:\Program Files\Tesseract-OCR', 'C:\Program Files (x86)\Tesseract-OCR') |
        Where-Object { Test-Path (Join-Path $_ 'tesseract.exe') } | Select-Object -First 1
    if ($installed) {
        New-Item -ItemType Directory -Force -Path $tess | Out-Null
        Copy-Item -Path (Join-Path $installed '*') -Destination $tess -Recurse -Force
        Write-Host "Tesseract е копиран от $installed"
    } else {
        Write-Warning ('Tesseract не е намерен. Инсталирайте го (UB-Mannheim build) на тази машина и пуснете скрипта пак, ' +
            'или копирайте папката му в runtime\tesseract. Без него OCR на сканирани PDF няма да работи.')
    }
}
