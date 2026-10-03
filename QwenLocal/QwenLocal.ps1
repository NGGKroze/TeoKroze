<#
  Qwen Local - one-click installer and control panel for running
  Qwen3.8-Flash-Next locally (llama.cpp + Unsloth GGUF) for coding.

  Usage:
    QwenLocal.bat                  -> opens the GUI
    QwenLocal.bat -Action Install  -> install/update llama.cpp + model (console)
    QwenLocal.bat -Action Start    -> start the local server
    QwenLocal.bat -Action Stop     -> stop the local server
    QwenLocal.bat -Action Tools    -> (re)write coding tool configs
    QwenLocal.bat -Action Tune     -> benchmark --n-cpu-moe values and keep the fastest

  Works with Windows PowerShell 5.1 (built into Windows 10/11). ASCII only on purpose.
#>
param(
    [ValidateSet('Gui', 'Install', 'Start', 'Stop', 'Tools', 'Tune')]
    [string]$Action = 'Gui',
    [string]$InstallDir = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- constants
$Script:AppName      = 'Qwen Local'
$Script:HfRepo       = 'unsloth/Qwen3.8-Flash-Next-GGUF'
$Script:ModelAlias   = 'qwen3.8-flash-next'
$Script:LlamaRepo    = 'ggml-org/llama.cpp'
$Script:DefaultDir   = 'S:\QwenLocal'
$Script:ScriptPath   = $MyInvocation.MyCommand.Path
$Script:ScriptDir    = Split-Path -Parent $Script:ScriptPath

# Approximate download sizes (GB) used only for the "recommended" hint before
# the real file list is fetched from Hugging Face.
$Script:KnownQuants = [ordered]@{
    'UD-IQ1_M'    = 74.5
    'UD-IQ2_M'    = 77.0
    'UD-Q2_K_XL'  = 78.9
    'UD-IQ3_XXS'  = 82.0
    'UD-Q3_K_XL' = 95.0
    'UD-Q4_K_XL' = 111.3
}

# ---------------------------------------------------------------- config
function Get-DefaultConfig {
    [ordered]@{
        InstallDir = $Script:DefaultDir
        Quant      = 'UD-Q2_K_XL'
        Backend    = 'Auto'      # Auto | CUDA | Vulkan | CPU
        Profile    = 'Auto'      # Auto | Fit | MoE-Offload (16 GB GPU + 64 GB RAM class)
        NCpuMoe    = 36          # MoE layers kept in RAM (MoE-Offload profile); 48 = all
        Threads    = 0           # 0 = physical core count
        CtxSize    = 65536
        Port       = 8080
        Host       = '127.0.0.1'
        HfToken    = ''
        ExtraArgs  = ''
        ModelFile  = ''          # first shard, filled in after install
        LlamaBuild = ''
    }
}

function Get-ConfigPath([string]$dir) { Join-Path $dir 'config.json' }

function Read-Config([string]$dir) {
    $cfg = Get-DefaultConfig
    $p = Get-ConfigPath $dir
    if (Test-Path $p) {
        $saved = Get-Content $p -Raw | ConvertFrom-Json
        foreach ($k in @($cfg.Keys)) {
            if ($null -ne $saved.$k -and "$($saved.$k)" -ne '') { $cfg[$k] = $saved.$k }
        }
    }
    $cfg.InstallDir = $dir
    $cfg
}

function Save-Config($cfg) {
    New-Item -ItemType Directory -Force -Path $cfg.InstallDir | Out-Null
    ($cfg | ConvertTo-Json) | Set-Content -Path (Get-ConfigPath $cfg.InstallDir) -Encoding ASCII
}

function Resolve-InstallDir {
    if ($InstallDir) { return $InstallDir }
    # When running from inside an install, use that folder.
    if (Test-Path (Join-Path $Script:ScriptDir 'config.json')) { return $Script:ScriptDir }
    return $Script:DefaultDir
}

# ---------------------------------------------------------------- logging
$Script:LogFile = $null
function Write-Log([string]$msg, [string]$color = 'Gray') {
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg
    Write-Host $line -ForegroundColor $color
    if ($Script:LogFile) { Add-Content -Path $Script:LogFile -Value $line -Encoding ASCII }
}

# ---------------------------------------------------------------- system info
function Get-SystemInfo {
    $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
    $vramGB = 0
    $hasNvidia = $false
    $smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if ($smi) {
        try {
            $ErrorActionPreference = 'Continue'
            $out = & $smi.Source --query-gpu=memory.total --format=csv,noheader,nounits 2>$null
            $ErrorActionPreference = 'Stop'
            foreach ($l in $out) { if ($l -match '^\s*(\d+)') { $vramGB += [int]$Matches[1] / 1024; $hasNvidia = $true } }
        } catch { }
    }
    if (-not $hasNvidia -and ($gpus -match 'NVIDIA')) { $hasNvidia = $true }
    [pscustomobject]@{
        RamGB     = $ramGB
        VramGB    = [math]::Round($vramGB, 1)
        Gpus      = $gpus
        HasNvidia = $hasNvidia
    }
}

function Get-FreeSpaceGB([string]$path) {
    $root = [IO.Path]::GetPathRoot($path)
    if (-not $root -or -not (Test-Path $root)) { return -1 }
    $d = New-Object IO.DriveInfo($root)
    [math]::Round($d.AvailableFreeSpace / 1GB, 1)
}

function Get-RecommendedQuant($sys, $quantSizes) {
    # The ~17 GB n-gram (per_layer_token_embd) table stays memory-mapped and is paged
    # from SSD on demand, so the resident footprint is roughly file size - 17 GB.
    # Keep ~15 GB for Windows, KV cache and context: size <= RAM + VRAM.
    $budget = $sys.RamGB + $sys.VramGB
    $best = $null
    foreach ($q in $quantSizes.Keys) { if ($quantSizes[$q] -le $budget) { $best = $q } }
    $best
}

function Resolve-Profile([string]$profileName, $sys) {
    if ($profileName -ne 'Auto') { return $profileName }
    # Small GPU + model bigger than VRAM: keep attention/shared weights on the GPU,
    # MoE experts in RAM (what 5070 Ti / 4080 / 16 GB owners run).
    if ($sys.HasNvidia -and $sys.VramGB -ge 10 -and $sys.VramGB -lt 48) { return 'MoE-Offload' }
    'Fit'
}

function Get-PhysicalCores {
    try { [int](Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum } catch { 8 }
}

function Resolve-Backend([string]$backend, $sys) {
    if ($backend -ne 'Auto') { return $backend }
    if ($sys.HasNvidia) { return 'CUDA' }
    if ($sys.Gpus -match 'AMD|Radeon|Intel\(R\) Arc') { return 'Vulkan' }
    'CPU'
}

# ---------------------------------------------------------------- downloads
function Invoke-Curl([string]$url, [string]$outFile, [string]$token = '') {
    # curl.exe ships with Windows 10 1803+; -C - resumes interrupted downloads.
    $curlArgs = @('-L', '--fail', '--retry', '5', '--retry-delay', '5', '-C', '-', '-o', $outFile)
    if ($token) { $curlArgs += @('-H', "Authorization: Bearer $token") }
    $curlArgs += $url
    & curl.exe @curlArgs
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 33) {
        throw "Download failed (curl exit $LASTEXITCODE): $url"
    }
}

function Get-HfHeaders([string]$token) {
    $h = @{ 'User-Agent' = 'QwenLocal' }
    if ($token) { $h['Authorization'] = "Bearer $token" }
    $h
}

function Get-QuantName([string]$path) {
    if ($path -match '/') { return ($path -split '/')[0] }
    $file = [IO.Path]::GetFileNameWithoutExtension($path)
    $file = $file -replace '-\d{5}-of-\d{5}$', ''
    if ($file -match '((UD-)?(I?Q\d[A-Z0-9_]*|BF16|F16|MXFP4[A-Z0-9_]*))$') { return $Matches[1] }
    $file
}

# Returns ordered hashtable: quant -> @{ SizeGB; Files = @(@{Path;Size}) }
function Get-HfQuants([string]$token) {
    $url = "https://huggingface.co/api/models/$($Script:HfRepo)/tree/main?recursive=true"
    $items = Invoke-RestMethod -Uri $url -Headers (Get-HfHeaders $token)
    $result = [ordered]@{}
    $ggufs = $items | Where-Object { $_.type -eq 'file' -and $_.path -like '*.gguf' -and $_.path -notmatch 'mmproj' } |
        Sort-Object path
    foreach ($it in $ggufs) {
        $q = Get-QuantName $it.path
        if (-not $result.Contains($q)) { $result[$q] = @{ SizeGB = 0.0; Files = @() } }
        $size = $it.size
        if ($it.lfs -and $it.lfs.size) { $size = $it.lfs.size }
        $result[$q].Files += @{ Path = $it.path; Size = [int64]$size }
        $result[$q].SizeGB += [math]::Round($size / 1e9, 1)
    }
    $result
}

function Install-LlamaCpp($cfg, [string]$backend) {
    $binDir = Join-Path $cfg.InstallDir 'llama.cpp'
    $dlDir  = Join-Path $cfg.InstallDir 'downloads'
    New-Item -ItemType Directory -Force -Path $binDir, $dlDir | Out-Null

    Write-Log "Looking up latest llama.cpp release ($backend build)..." 'Cyan'
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$($Script:LlamaRepo)/releases/latest" -Headers @{ 'User-Agent' = 'QwenLocal' }
    $assets = $rel.assets

    switch ($backend) {
        'CUDA' {
            # Prefer CUDA 12.x (widest driver support), fall back to any CUDA build.
            $main = $assets | Where-Object { $_.name -match '^llama-.*-bin-win-cuda-12[\d.]*-x64\.zip$' } | Select-Object -Last 1
            if (-not $main) { $main = $assets | Where-Object { $_.name -match '^llama-.*-bin-win-cuda-[\d.]+-x64\.zip$' } | Select-Object -Last 1 }
            $cudaVer = $null
            if ($main -and $main.name -match 'cuda-([\d.]+)-x64') { $cudaVer = $Matches[1] }
            $rt = $assets | Where-Object { $_.name -match "^cudart-.*win-cuda-$([regex]::Escape($cudaVer))-x64\.zip$" } | Select-Object -First 1
            $pkgs = @($main, $rt) | Where-Object { $_ }
        }
        'Vulkan' { $pkgs = @($assets | Where-Object { $_.name -match '^llama-.*-bin-win-vulkan-x64\.zip$' } | Select-Object -First 1) }
        default  { $pkgs = @($assets | Where-Object { $_.name -match '^llama-.*-bin-win-(cpu|avx2)-x64\.zip$' } | Select-Object -First 1) }
    }
    if (-not $pkgs -or -not $pkgs[0]) { throw "Could not find a Windows $backend build in llama.cpp release $($rel.tag_name)." }

    if ($cfg.LlamaBuild -eq "$($rel.tag_name)-$backend" -and (Test-Path (Join-Path $binDir 'llama-server.exe'))) {
        Write-Log "llama.cpp $($rel.tag_name) ($backend) already installed." 'Green'
        return
    }

    # Stop a running server so its DLLs can be replaced.
    Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-ChildItem $binDir -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

    foreach ($a in $pkgs) {
        $zip = Join-Path $dlDir $a.name
        Write-Log "Downloading $($a.name) ..."
        Invoke-Curl $a.browser_download_url $zip
        Write-Log "Extracting $($a.name) ..."
        $tmp = Join-Path $dlDir ('x_' + [IO.Path]::GetFileNameWithoutExtension($a.name))
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        # Some releases nest files in a subfolder; flatten so llama-server.exe sits in $binDir.
        $exeDir = Get-ChildItem $tmp -Recurse -Filter '*.dll' | Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
        if (-not $exeDir) { $exeDir = $tmp }
        Copy-Item -Path (Join-Path $exeDir '*') -Destination $binDir -Recurse -Force
        Remove-Item $tmp -Recurse -Force
        Remove-Item $zip -Force
    }
    if (-not (Test-Path (Join-Path $binDir 'llama-server.exe'))) { throw 'llama-server.exe not found after extraction.' }
    $cfg.LlamaBuild = "$($rel.tag_name)-$backend"
    Write-Log "llama.cpp $($rel.tag_name) ($backend) installed." 'Green'
}

function Install-Model($cfg) {
    Write-Log "Fetching file list for $($Script:HfRepo) ..." 'Cyan'
    $quants = Get-HfQuants $cfg.HfToken
    if (-not $quants.Contains($cfg.Quant)) {
        throw "Quant '$($cfg.Quant)' not found. Available: $(($quants.Keys) -join ', ')"
    }
    $q = $quants[$cfg.Quant]
    $modelDir = Join-Path $cfg.InstallDir "models\$($cfg.Quant)"
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

    $need = 0
    foreach ($f in $q.Files) {
        $dest = Join-Path $modelDir ([IO.Path]::GetFileName($f.Path))
        $have = 0; if (Test-Path $dest) { $have = (Get-Item $dest).Length }
        $need += [math]::Max(0, $f.Size - $have)
    }
    $needGB = [math]::Round($need / 1GB, 1)
    $free = Get-FreeSpaceGB $cfg.InstallDir
    Write-Log ("{0}: {1} file(s), {2} GB total, {3} GB left to download, {4} GB free on drive." -f $cfg.Quant, $q.Files.Count, $q.SizeGB, $needGB, $free)
    if ($free -ge 0 -and $needGB -gt ($free - 2)) { throw "Not enough free space on $([IO.Path]::GetPathRoot($cfg.InstallDir)) (need ~$needGB GB)." }

    $i = 0
    foreach ($f in $q.Files) {
        $i++
        $dest = Join-Path $modelDir ([IO.Path]::GetFileName($f.Path))
        if ((Test-Path $dest) -and (Get-Item $dest).Length -eq $f.Size) {
            Write-Log "[$i/$($q.Files.Count)] $([IO.Path]::GetFileName($f.Path)) already complete."
            continue
        }
        Write-Log "[$i/$($q.Files.Count)] Downloading $([IO.Path]::GetFileName($f.Path)) ($([math]::Round($f.Size/1GB,1)) GB) - safe to stop and resume later" 'Cyan'
        $url = "https://huggingface.co/$($Script:HfRepo)/resolve/main/$($f.Path)?download=true"
        Invoke-Curl $url $dest $cfg.HfToken
        if ((Get-Item $dest).Length -ne $f.Size) { throw "Size mismatch for $dest - run Install again to resume." }
    }
    $cfg.ModelFile = Join-Path $modelDir ([IO.Path]::GetFileName($q.Files[0].Path))
    Write-Log "Model ready: $($cfg.ModelFile)" 'Green'
}

# ---------------------------------------------------------------- server
function Get-PlacementArgs($cfg, [string]$profileName) {
    if ($profileName -eq 'MoE-Offload') {
        $threads = [int]$cfg.Threads; if ($threads -le 0) { $threads = Get-PhysicalCores }
        return @(
            '-ngl', '99',                              # all layers to GPU...
            '--n-cpu-moe', $cfg.NCpuMoe,               # ...except the experts of the first N MoE layers
            '-ot', 'per_layer_token_embd=CPU',         # n-gram lookup table: host/SSD, no math on it
            '-ctk', 'q8_0', '-ctv', 'q8_0',            # halve KV cache VRAM so more experts fit on GPU
            '--threads', $threads, '--threads-batch', $threads,
            '--batch-size', '2048', '--ubatch-size', '1024'   # bigger ubatch = much faster prompt processing with CPU experts
        )
    }
    @('--fit', 'on', '--fit-target', '4096', '--batch-size', '1024', '--ubatch-size', '512')
}

function Get-ServerArgs($cfg) {
    $profileName = Resolve-Profile $cfg.Profile (Get-SystemInfo)
    $a = @(
        '-m', "`"$($cfg.ModelFile)`"",
        '--alias', $Script:ModelAlias,
        '--host', $cfg.Host,
        '--port', $cfg.Port,
        '--ctx-size', $cfg.CtxSize,
        '--parallel', '1',
        '--flash-attn', 'on',
        '--jinja'
    )
    $a += Get-PlacementArgs $cfg $profileName
    $a += @(
        '--temp', '1.0',
        '--top-p', '0.95',
        '--top-k', '20',
        '--min-p', '0.0'
    )
    if ($cfg.ExtraArgs) { $a += $cfg.ExtraArgs }
    $a
}

function Write-Launchers($cfg) {
    $dir = $cfg.InstallDir
    $exe = Join-Path $dir 'llama.cpp\llama-server.exe'
    $argLine = (Get-ServerArgs $cfg) -join ' '
    @"
@echo off
title Qwen3.8-Flash-Next server (http://$($cfg.Host):$($cfg.Port))
"$exe" $argLine
pause
"@ | Set-Content -Path (Join-Path $dir 'start-server.bat') -Encoding ASCII
}

function Test-Server($cfg) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($cfg.Port)/health" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

function Find-ModelFile($cfg) {
    $dir = Join-Path $cfg.InstallDir "models\$($cfg.Quant)"
    if (-not (Test-Path $dir)) { return '' }
    $f = Get-ChildItem $dir -Filter '*.gguf' | Where-Object { $_.Name -notmatch 'mmproj' } | Sort-Object Name | Select-Object -First 1
    if ($f) { return $f.FullName }
    ''
}

function Start-QwenServer($cfg) {
    if (-not $cfg.ModelFile -or -not (Test-Path $cfg.ModelFile)) { $cfg.ModelFile = Find-ModelFile $cfg }
    if (-not $cfg.ModelFile) { throw "Model $($cfg.Quant) not installed yet - run Install first." }
    if (Test-Server $cfg) { Write-Log 'Server is already running.' 'Green'; return }
    Write-Launchers $cfg
    Start-Process -FilePath (Join-Path $cfg.InstallDir 'start-server.bat') -WorkingDirectory $cfg.InstallDir
    Write-Log "Server starting on http://$($cfg.Host):$($cfg.Port) (loading ~100 GB can take a few minutes)..." 'Cyan'
}

function Stop-QwenServer {
    $p = Get-Process llama-server -ErrorAction SilentlyContinue
    if ($p) { $p | Stop-Process -Force; Write-Log 'Server stopped.' 'Green' } else { Write-Log 'Server is not running.' }
}

# ---------------------------------------------------------------- tuning
# Finds the lowest --n-cpu-moe (most experts on the GPU) that still fits in VRAM
# and gives the best generation speed. Each value is a separate llama-bench run so
# an out-of-memory value just gets skipped.
function Invoke-Tune($cfg) {
    $bench = Join-Path $cfg.InstallDir 'llama.cpp\llama-bench.exe'
    if (-not (Test-Path $bench)) { throw 'llama-bench.exe not found - run Install first.' }
    if (-not $cfg.ModelFile -or -not (Test-Path $cfg.ModelFile)) { $cfg.ModelFile = Find-ModelFile $cfg }
    if (-not $cfg.ModelFile) { throw "Model $($cfg.Quant) not installed yet - run Install first." }
    Stop-QwenServer
    $threads = [int]$cfg.Threads; if ($threads -le 0) { $threads = Get-PhysicalCores }
    $results = @()
    foreach ($n in 24, 28, 32, 36, 40, 44, 48) {
        Write-Log "Benchmarking --n-cpu-moe $n (first run loads the model, be patient)..." 'Cyan'
        $benchArgs = @('-m', $cfg.ModelFile, '-ngl', '99', '-ncmoe', $n, '-ot', 'per_layer_token_embd=CPU',
            '-fa', '1', '-ctk', 'q8_0', '-ctv', 'q8_0', '-t', $threads, '-b', '2048', '-ub', '1024',
            '-p', '1024', '-n', '128', '-r', '2', '-o', 'csv')
        $ErrorActionPreference = 'Continue'   # PS 5.1 turns redirected native stderr into errors
        $csv = & $bench @benchArgs 2>$null
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0 -or -not $csv) { Write-Log "  n-cpu-moe $n : failed (probably out of VRAM)" 'Yellow'; continue }
        $rows = @($csv | ConvertFrom-Csv)
        $pp = $rows | Where-Object { [int]$_.n_prompt -gt 0 } | Select-Object -First 1
        $tg = $rows | Where-Object { [int]$_.n_gen -gt 0 } | Select-Object -First 1
        if (-not $tg) { Write-Log "  n-cpu-moe $n : no result" 'Yellow'; continue }
        $r = [pscustomobject]@{ NCpuMoe = $n; Gen = [math]::Round([double]$tg.avg_ts, 1); Prompt = [math]::Round([double]$pp.avg_ts, 0) }
        Write-Log ("  n-cpu-moe {0,2} : {1,6} tok/s generation, {2,6} tok/s prompt" -f $r.NCpuMoe, $r.Gen, $r.Prompt) 'Green'
        $results += $r
        # Speed only drops as more experts move to RAM; stop once it falls clearly.
        $best = $results | Sort-Object Gen -Descending | Select-Object -First 1
        if ($r.Gen -lt $best.Gen * 0.85) { break }
    }
    if (-not $results) { throw 'Every benchmark run failed. Try a smaller quant or the Fit profile.' }
    $best = $results | Sort-Object Gen -Descending | Select-Object -First 1
    # Leave one layer of headroom for long contexts (KV cache grows with context).
    $cfg.NCpuMoe = [math]::Min(48, $best.NCpuMoe + 2)
    $cfg.Profile = 'MoE-Offload'
    Save-Config $cfg
    Write-Launchers $cfg
    Write-Log "Best: n-cpu-moe $($best.NCpuMoe) at $($best.Gen) tok/s. Saved n-cpu-moe $($cfg.NCpuMoe) (+2 headroom for context)." 'Green'
}

# ---------------------------------------------------------------- coding tools
function Write-ToolConfigs($cfg) {
    $base = "http://127.0.0.1:$($cfg.Port)"
    $out = Join-Path $cfg.InstallDir 'tool-configs'
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $m = $Script:ModelAlias

    # OpenCode (terminal coding agent) - drop into your project root or ~/.config/opencode/
    @"
{
  "`$schema": "https://opencode.ai/config.json",
  "provider": {
    "llamacpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (local)",
      "options": { "baseURL": "$base/v1" },
      "models": { "$m": { "name": "Qwen3.8 Flash-Next (local)" } }
    }
  },
  "model": "llamacpp/$m"
}
"@ | Set-Content (Join-Path $out 'opencode.json') -Encoding ASCII

    # Continue (VS Code / JetBrains extension) - merge into ~/.continue/config.yaml
    @"
name: Local Qwen
version: 1.0.0
schema: v1
models:
  - name: Qwen3.8 Flash-Next (local)
    provider: openai
    model: $m
    apiBase: $base/v1
    apiKey: none
    roles: [chat, edit, apply]
"@ | Set-Content (Join-Path $out 'continue-config.yaml') -Encoding ASCII

    # Aider launcher - run inside your project folder
    @"
@echo off
rem Run this from inside your project folder (or pass a path). Requires: pip install aider-chat
aider --openai-api-base $base/v1 --openai-api-key none --model openai/$m %*
"@ | Set-Content (Join-Path $out 'aider-local.bat') -Encoding ASCII

    # Claude Code launcher - llama-server exposes an Anthropic-compatible /v1/messages endpoint
    @"
@echo off
rem Points Claude Code at the local llama-server instead of the Anthropic API.
set ANTHROPIC_BASE_URL=$base
set ANTHROPIC_AUTH_TOKEN=local
set ANTHROPIC_MODEL=$m
set ANTHROPIC_SMALL_FAST_MODEL=$m
claude %*
"@ | Set-Content (Join-Path $out 'claude-code-local.bat') -Encoding ASCII

    @"
Qwen3.8-Flash-Next local endpoint
=================================
OpenAI-compatible base URL : $base/v1
Anthropic-compatible URL   : $base
Model id                   : $m
API key                    : anything (e.g. "none")
Built-in web chat          : $base

Cline / Roo Code (VS Code):
  API Provider = "OpenAI Compatible", Base URL = $base/v1, API Key = none, Model ID = $m
  Set context window to $($cfg.CtxSize).

Continue: copy the "models" entry from continue-config.yaml into %USERPROFILE%\.continue\config.yaml
OpenCode: copy opencode.json into your project root (or %USERPROFILE%\.config\opencode\opencode.json)
Aider:    run aider-local.bat inside your project folder
Claude Code: run claude-code-local.bat inside your project folder
"@ | Set-Content (Join-Path $out 'README.txt') -Encoding ASCII

    Write-Log "Coding tool configs written to $out" 'Green'
}

# ---------------------------------------------------------------- install
function Copy-AppToInstallDir($cfg) {
    $dir = $cfg.InstallDir
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if ((Resolve-Path $Script:ScriptDir).Path.TrimEnd('\') -ne (Resolve-Path $dir).Path.TrimEnd('\')) {
        foreach ($f in 'QwenLocal.ps1', 'QwenLocal.bat', 'README.md') {
            $src = Join-Path $Script:ScriptDir $f
            if (Test-Path $src) { Copy-Item $src -Destination $dir -Force }
        }
    }
    # Desktop + Start menu shortcuts
    try {
        $shell = New-Object -ComObject WScript.Shell
        foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
            $lnk = $shell.CreateShortcut((Join-Path $folder 'Qwen Local.lnk'))
            $lnk.TargetPath = Join-Path $dir 'QwenLocal.bat'
            $lnk.WorkingDirectory = $dir
            $lnk.WindowStyle = 7
            $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,12"
            $lnk.Save()
        }
    } catch { Write-Log "Could not create shortcuts: $_" 'Yellow' }
}

function Invoke-Install($cfg) {
    $sys = Get-SystemInfo
    $backend = Resolve-Backend $cfg.Backend $sys
    Write-Log ("RAM {0} GB, VRAM {1} GB, GPU: {2}, backend: {3}" -f $sys.RamGB, $sys.VramGB, ($sys.Gpus -join ' / '), $backend)
    Copy-AppToInstallDir $cfg
    Install-LlamaCpp $cfg $backend
    Save-Config $cfg
    Install-Model $cfg
    Save-Config $cfg
    Write-Launchers $cfg
    Write-ToolConfigs $cfg
    Write-Log 'Install complete. Use "Start server" in Qwen Local, or run start-server.bat.' 'Green'
}

# ---------------------------------------------------------------- GUI
function Show-Gui {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()

    $cfg = Read-Config (Resolve-InstallDir)
    $sys = Get-SystemInfo
    $quantSizes = [ordered]@{}; foreach ($k in $Script:KnownQuants.Keys) { $quantSizes[$k] = $Script:KnownQuants[$k] }

    $form = New-Object Windows.Forms.Form
    $form.Text = "$($Script:AppName) - Qwen3.8-Flash-Next for coding"
    $form.Size = New-Object Drawing.Size(760, 680)
    $form.StartPosition = 'CenterScreen'
    $form.Font = New-Object Drawing.Font('Segoe UI', 9)
    $form.FormBorderStyle = 'FixedSingle'
    $form.MaximizeBox = $false

    $y = 12
    function Add-Label($text, $x, $yy, $w = 120) {
        $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Location = New-Object Drawing.Point($x, ($yy + 3)); $l.Size = New-Object Drawing.Size($w, 20); $form.Controls.Add($l); $l
    }

    $sysLabel = New-Object Windows.Forms.Label
    $sysLabel.Location = New-Object Drawing.Point(12, $y); $sysLabel.Size = New-Object Drawing.Size(720, 40)
    $sysLabel.Text = ("System: {0} GB RAM, {1} GB NVIDIA VRAM`nGPU: {2}" -f $sys.RamGB, $sys.VramGB, ($sys.Gpus -join ' / '))
    $form.Controls.Add($sysLabel)
    $y += 48

    Add-Label 'Install folder:' 12 $y | Out-Null
    $dirBox = New-Object Windows.Forms.TextBox; $dirBox.Location = New-Object Drawing.Point(135, $y); $dirBox.Size = New-Object Drawing.Size(480, 24); $dirBox.Text = $cfg.InstallDir
    $form.Controls.Add($dirBox)
    $browse = New-Object Windows.Forms.Button; $browse.Text = 'Browse...'; $browse.Location = New-Object Drawing.Point(625, ($y - 1)); $browse.Size = New-Object Drawing.Size(105, 26)
    $form.Controls.Add($browse)
    $y += 32

    $freeLabel = Add-Label '' 135 $y 600
    $y += 26

    Add-Label 'Model quant:' 12 $y | Out-Null
    $quantBox = New-Object Windows.Forms.ComboBox; $quantBox.DropDownStyle = 'DropDownList'; $quantBox.Location = New-Object Drawing.Point(135, $y); $quantBox.Size = New-Object Drawing.Size(300, 24)
    $form.Controls.Add($quantBox)
    $refresh = New-Object Windows.Forms.Button; $refresh.Text = 'Check Hugging Face'; $refresh.Location = New-Object Drawing.Point(445, ($y - 1)); $refresh.Size = New-Object Drawing.Size(140, 26)
    $form.Controls.Add($refresh)
    $y += 30
    $recLabel = Add-Label '' 135 $y 600
    $recLabel.ForeColor = [Drawing.Color]::DarkGreen
    $y += 28

    Add-Label 'GPU backend:' 12 $y | Out-Null
    $backendBox = New-Object Windows.Forms.ComboBox; $backendBox.DropDownStyle = 'DropDownList'; $backendBox.Location = New-Object Drawing.Point(135, $y); $backendBox.Size = New-Object Drawing.Size(140, 24)
    [void]$backendBox.Items.AddRange(@('Auto', 'CUDA', 'Vulkan', 'CPU')); $backendBox.SelectedItem = $cfg.Backend
    $form.Controls.Add($backendBox)
    Add-Label ("(Auto = {0})" -f (Resolve-Backend 'Auto' $sys)) 285 $y 200 | Out-Null
    $y += 32

    Add-Label 'Context size:' 12 $y | Out-Null
    $ctxBox = New-Object Windows.Forms.ComboBox; $ctxBox.DropDownStyle = 'DropDownList'; $ctxBox.Location = New-Object Drawing.Point(135, $y); $ctxBox.Size = New-Object Drawing.Size(140, 24)
    [void]$ctxBox.Items.AddRange(@('32768', '65536', '131072', '262144')); $ctxBox.SelectedItem = "$($cfg.CtxSize)"
    if (-not $ctxBox.SelectedItem) { $ctxBox.SelectedIndex = 1 }
    $form.Controls.Add($ctxBox)
    Add-Label 'Port:' 300 $y 40 | Out-Null
    $portBox = New-Object Windows.Forms.NumericUpDown; $portBox.Location = New-Object Drawing.Point(345, $y); $portBox.Size = New-Object Drawing.Size(90, 24); $portBox.Minimum = 1024; $portBox.Maximum = 65535; $portBox.Value = [int]$cfg.Port
    $form.Controls.Add($portBox)
    $y += 32

    Add-Label 'Speed profile:' 12 $y | Out-Null
    $profileBox = New-Object Windows.Forms.ComboBox; $profileBox.DropDownStyle = 'DropDownList'; $profileBox.Location = New-Object Drawing.Point(135, $y); $profileBox.Size = New-Object Drawing.Size(140, 24)
    [void]$profileBox.Items.AddRange(@('Auto', 'MoE-Offload', 'Fit')); $profileBox.SelectedItem = $cfg.Profile
    if (-not $profileBox.SelectedItem) { $profileBox.SelectedIndex = 0 }
    $form.Controls.Add($profileBox)
    Add-Label 'MoE layers in RAM:' 300 $y 115 | Out-Null
    $moeBox = New-Object Windows.Forms.NumericUpDown; $moeBox.Location = New-Object Drawing.Point(420, $y); $moeBox.Size = New-Object Drawing.Size(60, 24); $moeBox.Minimum = 0; $moeBox.Maximum = 48; $moeBox.Value = [int]$cfg.NCpuMoe
    $form.Controls.Add($moeBox)
    Add-Label ("(Auto = {0}; 'Tune speed' finds the best value)" -f (Resolve-Profile 'Auto' $sys)) 490 $y 245 | Out-Null
    $y += 32

    Add-Label 'HF token (optional):' 12 $y | Out-Null
    $tokenBox = New-Object Windows.Forms.TextBox; $tokenBox.Location = New-Object Drawing.Point(135, $y); $tokenBox.Size = New-Object Drawing.Size(300, 24); $tokenBox.UseSystemPasswordChar = $true; $tokenBox.Text = $cfg.HfToken
    $form.Controls.Add($tokenBox)
    Add-Label 'Extra server args:' 450 $y 110 | Out-Null
    $extraBox = New-Object Windows.Forms.TextBox; $extraBox.Location = New-Object Drawing.Point(560, $y); $extraBox.Size = New-Object Drawing.Size(170, 24); $extraBox.Text = $cfg.ExtraArgs
    $form.Controls.Add($extraBox)
    $y += 40

    $buttons = @{}
    $x = 12
    foreach ($b in @('Install / Update', 'Start server', 'Stop server', 'Tune speed', 'Open web chat', 'Coding tools', 'Open folder')) {
        $btn = New-Object Windows.Forms.Button; $btn.Text = $b; $btn.Location = New-Object Drawing.Point($x, $y); $btn.Size = New-Object Drawing.Size(100, 34)
        $form.Controls.Add($btn); $buttons[$b] = $btn; $x += 103
    }
    $buttons['Install / Update'].Font = New-Object Drawing.Font('Segoe UI', 9, [Drawing.FontStyle]::Bold)
    $y += 44

    $status = New-Object Windows.Forms.Label; $status.Location = New-Object Drawing.Point(12, $y); $status.Size = New-Object Drawing.Size(720, 20)
    $form.Controls.Add($status)
    $y += 24

    $log = New-Object Windows.Forms.TextBox; $log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
    $log.Location = New-Object Drawing.Point(12, $y); $log.Size = New-Object Drawing.Size(720, (630 - $y)); $log.Font = New-Object Drawing.Font('Consolas', 9)
    $log.BackColor = [Drawing.Color]::White
    $form.Controls.Add($log)

    $ui = @{ LogPos = 0 }

    $fillQuants = {
        $sel = $quantBox.SelectedItem
        $quantBox.Items.Clear()
        foreach ($k in $quantSizes.Keys) { [void]$quantBox.Items.Add(('{0}  (~{1} GB)' -f $k, $quantSizes[$k])) }
        $want = if ($sel) { ($sel -split '\s')[0] } else { $cfg.Quant }
        for ($i = 0; $i -lt $quantBox.Items.Count; $i++) { if (($quantBox.Items[$i] -split '\s')[0] -eq $want) { $quantBox.SelectedIndex = $i } }
        if ($quantBox.SelectedIndex -lt 0 -and $quantBox.Items.Count) { $quantBox.SelectedIndex = 0 }
        $rec = Get-RecommendedQuant $sys $quantSizes
        if ($rec) { $recLabel.Text = "Recommended for this PC: $rec (fits in RAM + VRAM with room for context)" }
        else { $recLabel.ForeColor = [Drawing.Color]::DarkRed; $recLabel.Text = 'Warning: this PC has less than ~85 GB RAM+VRAM; the model will page to disk and be very slow.' }
    }
    $updateFree = {
        $free = Get-FreeSpaceGB $dirBox.Text
        if ($free -lt 0) { $freeLabel.ForeColor = [Drawing.Color]::DarkRed; $freeLabel.Text = 'Drive not found - pick another folder.' }
        else { $freeLabel.ForeColor = [Drawing.Color]::Black; $freeLabel.Text = "Free space on $([IO.Path]::GetPathRoot($dirBox.Text)) : $free GB" }
    }
    $collect = {
        $cfg.InstallDir = $dirBox.Text.TrimEnd('\')
        $cfg.Quant = ($quantBox.SelectedItem -split '\s')[0]
        $cfg.Backend = $backendBox.SelectedItem
        $cfg.CtxSize = [int]$ctxBox.SelectedItem
        $cfg.Port = [int]$portBox.Value
        $cfg.HfToken = $tokenBox.Text.Trim()
        $cfg.ExtraArgs = $extraBox.Text.Trim()
        $cfg.Profile = $profileBox.SelectedItem
        $cfg.NCpuMoe = [int]$moeBox.Value
        $saved = Read-Config $cfg.InstallDir   # keep LlamaBuild from disk
        $cfg.LlamaBuild = $saved.LlamaBuild
        $cfg.ModelFile = Find-ModelFile $cfg
        Save-Config $cfg
    }
    $appendLog = { param($t) $log.AppendText($t + "`r`n") }

    & $fillQuants; & $updateFree
    $dirBox.Add_Leave({ & $updateFree })
    $browse.Add_Click({
        $d = New-Object Windows.Forms.FolderBrowserDialog
        $d.Description = 'Choose where to install (model needs 75-115 GB)'
        if ($d.ShowDialog() -eq 'OK') { $dirBox.Text = Join-Path $d.SelectedPath 'QwenLocal'; & $updateFree }
    })
    $refresh.Add_Click({
        try {
            $form.Cursor = 'WaitCursor'
            $hq = Get-HfQuants $tokenBox.Text.Trim()
            $quantSizes.Clear()
            foreach ($k in $hq.Keys) { $quantSizes[$k] = [math]::Round($hq[$k].SizeGB, 1) }
            & $fillQuants
            & $appendLog "Found $($hq.Count) quants on Hugging Face."
        } catch { & $appendLog "Could not reach Hugging Face: $_" }
        finally { $form.Cursor = 'Default' }
    })

    $runAction = {
        param($act)
        & $collect
        $logFile = Join-Path $cfg.InstallDir 'install.log'
        $ui.LogFile = $logFile; $ui.LogPos = 0
        if (Test-Path $logFile) { Remove-Item $logFile -Force }
        $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($Script:ScriptPath)`"", '-Action', $act, '-InstallDir', "`"$($cfg.InstallDir)`"")
        Start-Process powershell.exe -ArgumentList $psArgs -WorkingDirectory $Script:ScriptDir
    }

    $buttons['Install / Update'].Add_Click({
        $free = Get-FreeSpaceGB $dirBox.Text
        if ($free -lt 0) { [Windows.Forms.MessageBox]::Show('That drive does not exist. Choose another install folder.', $Script:AppName) | Out-Null; return }
        $q = ($quantBox.SelectedItem -split '\s')[0]
        $msg = "This downloads llama.cpp and the $q model (~$($quantSizes[$q]) GB) into`n$($dirBox.Text)`n`nA console window shows progress. You can close it and click Install again later to resume.`n`nContinue?"
        if ([Windows.Forms.MessageBox]::Show($msg, $Script:AppName, 'YesNo') -eq 'Yes') { & $runAction 'Install' }
    })
    $buttons['Start server'].Add_Click({ & $runAction 'Start' })
    $buttons['Tune speed'].Add_Click({
        $msg = "Stops the server and benchmarks how many MoE layers to keep in RAM (takes 5-15 minutes). The best value is saved automatically.`n`nContinue?"
        if ([Windows.Forms.MessageBox]::Show($msg, $Script:AppName, 'YesNo') -eq 'Yes') { & $runAction 'Tune' }
    })
    $buttons['Stop server'].Add_Click({ Stop-QwenServer; & $appendLog 'Server stopped.' })
    $buttons['Open web chat'].Add_Click({ Start-Process "http://127.0.0.1:$([int]$portBox.Value)" })
    $buttons['Coding tools'].Add_Click({
        & $collect
        Write-ToolConfigs $cfg
        Start-Process notepad.exe (Join-Path $cfg.InstallDir 'tool-configs\README.txt')
        Start-Process explorer.exe (Join-Path $cfg.InstallDir 'tool-configs')
    })
    $buttons['Open folder'].Add_Click({ if (Test-Path $dirBox.Text) { Start-Process explorer.exe $dirBox.Text } })

    # Poll: tail the worker log and show server status.
    $timer = New-Object Windows.Forms.Timer; $timer.Interval = 1500
    $timer.Add_Tick({
        if ($ui.LogFile -and (Test-Path $ui.LogFile)) {
            $lines = @(Get-Content $ui.LogFile -ErrorAction SilentlyContinue)
            for ($i = $ui.LogPos; $i -lt $lines.Count; $i++) {
                & $appendLog $lines[$i]
                if ($lines[$i] -match 'Saved n-cpu-moe (\d+)') { $moeBox.Value = [int]$Matches[1]; $profileBox.SelectedItem = 'MoE-Offload' }
            }
            $ui.LogPos = $lines.Count
        }
        $c = @{ Port = [int]$portBox.Value }
        if (Test-Server $c) { $status.ForeColor = [Drawing.Color]::DarkGreen; $status.Text = "Server RUNNING - OpenAI API: http://127.0.0.1:$($c.Port)/v1   model: $($Script:ModelAlias)" }
        elseif (Get-Process llama-server -ErrorAction SilentlyContinue) { $status.ForeColor = [Drawing.Color]::DarkOrange; $status.Text = 'Server loading model...' }
        else { $status.ForeColor = [Drawing.Color]::Gray; $status.Text = 'Server stopped.' }
    })
    $timer.Start()

    & $appendLog "Welcome. 1) Check the install folder (default S:\QwenLocal)  2) Pick a quant  3) Install / Update  4) Start server  5) Coding tools."
    [void]$form.ShowDialog()
    $timer.Stop()
}

# ---------------------------------------------------------------- entry point
if ($Action -eq 'Gui') { Show-Gui; return }

$cfg = Read-Config (Resolve-InstallDir)
New-Item -ItemType Directory -Force -Path $cfg.InstallDir | Out-Null
$Script:LogFile = Join-Path $cfg.InstallDir 'install.log'
$Host.UI.RawUI.WindowTitle = "$($Script:AppName) - $Action"
try {
    switch ($Action) {
        'Install' { Invoke-Install $cfg }
        'Start'   { Start-QwenServer $cfg }
        'Stop'    { Stop-QwenServer }
        'Tools'   { Write-ToolConfigs $cfg }
        'Tune'    { Invoke-Tune $cfg }
    }
    if ($Action -eq 'Install' -or $Action -eq 'Tune') { Read-Host 'Done. Press Enter to close' | Out-Null }
} catch {
    Write-Log "ERROR: $_" 'Red'
    Read-Host 'Press Enter to close' | Out-Null
    exit 1
}
