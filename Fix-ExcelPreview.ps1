<#
.SYNOPSIS
  Diagnoses and repairs the Excel preview handler registration (Outlook classic + Explorer preview pane).

.DESCRIPTION
  1. Always backs up the relevant registry keys (.reg files + Restore.cmd) to a timestamped folder.
  2. Diagnose mode (default): only reports problems, changes nothing.
  3. -Fix: applies the repairs:
       - removes per-user (HKCU) overrides of the preview handler on Excel extensions/ProgIDs
       - removes dead entries from the PreviewHandlers lists (CLSID or DLL missing)
       - (re)points .xls/.xlsx/.xlsm/.xlsb to the installed Excel previewer found in PreviewHandlers
       - enables ShowPreviewHandlers for Explorer
       - makes sure the prevhost.exe DllSurrogate AppID exists
       - stops prevhost.exe so handlers reload

  Run from an elevated 64-bit PowerShell:
     powershell -ExecutionPolicy Bypass -File .\Fix-ExcelPreview.ps1          # diagnose + backup
     powershell -ExecutionPolicy Bypass -File .\Fix-ExcelPreview.ps1 -Fix     # repair
  Restore: run Restore.cmd from the backup folder (as admin).
#>
[CmdletBinding()]
param(
    [switch]$Fix,
    [string]$BackupRoot = (Join-Path $env:USERPROFILE 'Documents\ExcelPreviewBackup')
)

$ErrorActionPreference = 'Stop'

$PreviewIface   = '{8895b1c6-b41f-4c1c-a562-0d564250836f}'   # IPreviewHandler shellex key
$PrevhostAppId  = '{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}'   # prevhost.exe (64-bit surrogate)
$Extensions     = '.xls', '.xlsx', '.xlsm', '.xlsb', '.csv'
$FixExtensions  = '.xls', '.xlsx', '.xlsm', '.xlsb'          # .csv is only backed up/reported
$PreviewLists   = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\PreviewHandlers',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers'
)

function Write-Info($m) { Write-Host "[i] $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "[+] $m" -ForegroundColor Green }
function Write-Bad($m)  { Write-Host "[!] $m" -ForegroundColor Yellow }
function Write-Act($m)  { Write-Host "[*] $m" -ForegroundColor Magenta }

# ---- prerequisites ---------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script from an elevated (Administrator) PowerShell.' }
if (-not [Environment]::Is64BitProcess) { throw 'Run this in 64-bit PowerShell (not the x86 one).' }

# ---- helpers ---------------------------------------------------------------
function ConvertTo-RegExePath([string]$psPath) {
    $psPath -replace '^HKLM:\\', 'HKLM\' -replace '^HKCU:\\', 'HKCU\'
}

function Get-ProgId([string]$ext) {
    foreach ($root in 'HKLM:\SOFTWARE\Classes', 'HKCU:\SOFTWARE\Classes') {
        $p = Join-Path $root $ext
        if (Test-Path $p) {
            $v = (Get-ItemProperty $p -ErrorAction SilentlyContinue).'(default)'
            if ($v) { return $v }
        }
    }
}

function Get-ClsidServer([string]$clsid) {
    # returns @{Exists; Dll; DllExists} for a CLSID (64-bit view)
    $r = @{ Exists = $false; Dll = $null; DllExists = $false }
    foreach ($root in 'HKLM:\SOFTWARE\Classes\CLSID', 'HKCU:\SOFTWARE\Classes\CLSID') {
        $k = Join-Path $root $clsid
        if (Test-Path $k) {
            $r.Exists = $true
            $srv = Join-Path $k 'InprocServer32'
            if (Test-Path $srv) {
                $dll = (Get-ItemProperty $srv -ErrorAction SilentlyContinue).'(default)'
                if ($dll) {
                    $dll = [Environment]::ExpandEnvironmentVariables($dll.Trim('"'))
                    $r.Dll = $dll
                    $r.DllExists = Test-Path -LiteralPath $dll
                }
            }
            break
        }
    }
    $r
}

# ---- 1. collect keys to back up -------------------------------------------
$progIds = @{}
foreach ($e in $Extensions) { $p = Get-ProgId $e; if ($p) { $progIds[$e] = $p } }

$keys = [System.Collections.Generic.List[string]]::new()
foreach ($e in $Extensions) {
    $keys.Add("HKLM:\SOFTWARE\Classes\$e"); $keys.Add("HKCU:\SOFTWARE\Classes\$e")
}
foreach ($p in ($progIds.Values | Sort-Object -Unique)) {
    $keys.Add("HKLM:\SOFTWARE\Classes\$p"); $keys.Add("HKCU:\SOFTWARE\Classes\$p")
}
$PreviewLists | ForEach-Object { $keys.Add($_) }
$keys.Add("HKLM:\SOFTWARE\Classes\AppID\$PrevhostAppId")
$keys.Add('HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced')
foreach ($v in '16.0', '15.0', '14.0') {
    $keys.Add("HKCU:\SOFTWARE\Microsoft\Office\$v\Excel\Security")
    $keys.Add("HKCU:\SOFTWARE\Policies\Microsoft\Office\$v\Excel\Security")
}

# Excel previewer CLSID(s) found in the lists (also back up their CLSID keys)
$excelHandlers = @{}
foreach ($list in $PreviewLists) {
    if (-not (Test-Path $list)) { continue }
    $props = Get-ItemProperty $list
    foreach ($pr in $props.PSObject.Properties) {
        if ($pr.Name -like 'PS*') { continue }
        if ($pr.Name -match '^\{[0-9A-Fa-f-]{36}\}$' -and "$($pr.Value)" -match 'Excel') {
            $excelHandlers[$pr.Name.ToUpper()] = "$($pr.Value)"
            $keys.Add("HKLM:\SOFTWARE\Classes\CLSID\$($pr.Name)")
            $keys.Add("HKCU:\SOFTWARE\Classes\CLSID\$($pr.Name)")
        }
    }
}

# ---- 2. backup -------------------------------------------------------------
$stamp     = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Write-Info "Backup folder: $backupDir"

$restore = [System.Collections.Generic.List[string]]::new()
$restore.Add('@echo off'); $restore.Add('echo Restoring registry backup from %~dp0')
$i = 0
foreach ($k in ($keys | Sort-Object -Unique)) {
    $reg = ConvertTo-RegExePath $k
    $file = Join-Path $backupDir ('{0:D3}.reg' -f $i)
    $existed = Test-Path $k
    if ($existed) {
        & reg.exe export $reg $file /y /reg:64 | Out-Null
        if ($LASTEXITCODE -eq 0) { $restore.Add("reg.exe import `"%~dp0$(Split-Path $file -Leaf)`" /reg:64"); $i++ }
    } else {
        # key did not exist: restore = delete it again
        if ($k -match 'shellex|\\Classes\\') { $restore.Add("reg.exe delete `"$reg`" /f /reg:64 2>nul") }
    }
}
$restore.Add('echo Done. Restart Explorer / Outlook.'); $restore.Add('pause')
Set-Content -Path (Join-Path $backupDir 'Restore.cmd') -Value $restore -Encoding ASCII
Write-Ok "Exported $i key(s). Restore with: $backupDir\Restore.cmd"

# ---- 3. diagnose / fix -----------------------------------------------------
$issues = 0

# 3a. Office bitness
$c2r = 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
if (Test-Path $c2r) {
    $plat = (Get-ItemProperty $c2r).Platform
    Write-Info "Office Click-to-Run platform: $plat (Windows 64-bit)"
    if ($plat -ne 'x64') { Write-Bad 'Office is not x64 - 64-bit Explorer/Outlook previews need an x64 handler.'; $issues++ }
}

# 3b. Excel handlers present?
if ($excelHandlers.Count -eq 0) {
    Write-Bad 'No Excel entry in any PreviewHandlers list. Office previewer is not registered -> run Online Repair of Office (Settings > Apps > Microsoft 365 > Modify > Online Repair).'
    $issues++
} else {
    foreach ($h in $excelHandlers.GetEnumerator()) {
        $s = Get-ClsidServer $h.Key
        $state = if (-not $s.Exists) { 'CLSID MISSING' } elseif (-not $s.DllExists) { "DLL MISSING ($($s.Dll))" } else { "OK ($($s.Dll))" }
        if ($state -like 'OK*') { Write-Ok "$($h.Value) $($h.Key): $state" } else { Write-Bad "$($h.Value) $($h.Key): $state"; $issues++ }
    }
}

# 3c. HKCU overrides
foreach ($e in $Extensions) {
    $targets = @("HKCU:\SOFTWARE\Classes\$e\shellex\$PreviewIface")
    if ($progIds[$e]) { $targets += "HKCU:\SOFTWARE\Classes\$($progIds[$e])\shellex\$PreviewIface" }
    foreach ($t in $targets) {
        if (Test-Path $t) {
            $v = (Get-ItemProperty $t).'(default)'
            Write-Bad "HKCU override: $t = $v"
            $issues++
            if ($Fix) { Remove-Item $t -Recurse -Force; Write-Act "removed $t" }
        }
    }
}

# 3d. HKLM extension/ProgID mapping vs. installed Excel previewer
$goodHandler = $excelHandlers.Keys | Where-Object { $s = Get-ClsidServer $_; $s.Exists -and $s.DllExists } | Select-Object -First 1
foreach ($e in $FixExtensions) {
    $k = "HKLM:\SOFTWARE\Classes\$e\shellex\$PreviewIface"
    $cur = if (Test-Path $k) { (Get-ItemProperty $k).'(default)' } else { $null }
    $curState = if (-not $cur) { 'not set' } else { $cur }
    $curSrv = if ($cur) { Get-ClsidServer $cur } else { $null }
    $ok = $cur -and $curSrv.Exists -and $curSrv.DllExists
    if ($ok) { Write-Ok "$e preview handler -> $cur"; continue }
    # ProgID-level handler may be valid even if the extension has none
    $pid_ = $progIds[$e]
    if (-not $cur -and $pid_) {
        $pk = "HKLM:\SOFTWARE\Classes\$pid_\shellex\$PreviewIface"
        if (Test-Path $pk) {
            $pc = (Get-ItemProperty $pk).'(default)'
            $ps = Get-ClsidServer $pc
            if ($ps.Exists -and $ps.DllExists) { Write-Ok "$e preview handler (via $pid_) -> $pc"; continue }
        }
    }
    Write-Bad "$e preview handler is $curState (invalid)"
    $issues++
    if ($Fix) {
        if ($goodHandler) {
            New-Item -Path $k -Force | Out-Null
            Set-ItemProperty -Path $k -Name '(default)' -Value $goodHandler
            Write-Act "$e -> $goodHandler"
        } else { Write-Bad "no valid Excel previewer to point $e at; repair Office first." }
    }
}

# 3e. dead entries in PreviewHandlers lists
foreach ($list in $PreviewLists) {
    if (-not (Test-Path $list)) { continue }
    $props = Get-ItemProperty $list
    foreach ($pr in $props.PSObject.Properties) {
        if ($pr.Name -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { continue }
        $s = Get-ClsidServer $pr.Name
        # WOW6432 list: CLSID lives in the 32-bit view, so only judge the 64-bit lists
        if ($list -like '*WOW6432Node*') { continue }
        if (-not $s.Exists -or ($s.Dll -and -not $s.DllExists)) {
            Write-Bad "dead entry in $list : $($pr.Name) '$($pr.Value)' ($(if(-not $s.Exists){'CLSID missing'}else{$s.Dll}))"
            $issues++
            if ($Fix) { Remove-ItemProperty -Path $list -Name $pr.Name; Write-Act "removed $($pr.Name) from $list" }
        }
    }
}

# 3f. Explorer: show preview handlers
$adv = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$sph = (Get-ItemProperty $adv -ErrorAction SilentlyContinue).ShowPreviewHandlers
if ($sph -eq 1) { Write-Ok 'ShowPreviewHandlers = 1' }
else {
    Write-Bad "ShowPreviewHandlers = $sph (should be 1)"; $issues++
    if ($Fix) { Set-ItemProperty $adv -Name ShowPreviewHandlers -Type DWord -Value 1; Write-Act 'ShowPreviewHandlers = 1' }
}

# 3g. prevhost AppID surrogate
$app = "HKLM:\SOFTWARE\Classes\AppID\$PrevhostAppId"
if (Test-Path $app) { Write-Ok 'prevhost AppID present' }
else {
    Write-Bad 'prevhost AppID missing'; $issues++
    if ($Fix) {
        New-Item $app -Force | Out-Null
        Set-ItemProperty $app -Name DllSurrogate -Value '%SystemRoot%\system32\prevhost.exe' -Type ExpandString
        Write-Act 'created prevhost AppID'
    }
}

# 3h. report-only: Excel Trust Center settings that block previews
foreach ($v in '16.0', '15.0', '14.0') {
    foreach ($base in "HKCU:\SOFTWARE\Microsoft\Office\$v\Excel\Security", "HKCU:\SOFTWARE\Policies\Microsoft\Office\$v\Excel\Security") {
        $fb = Join-Path $base 'FileBlock'
        if (Test-Path $fb) {
            $blocked = (Get-ItemProperty $fb).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and $_.Value -ne 0 }
            if ($blocked) { Write-Bad "File Block active in $fb : $(($blocked | ForEach-Object { $_.Name + '=' + $_.Value }) -join ', ') (can disable previews; policy keys are not changed)" }
        }
    }
}

# ---- 4. finish -------------------------------------------------------------
if ($Fix) {
    Get-Process prevhost -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Act 'prevhost.exe stopped. Close and reopen Outlook, then re-test (restart Explorer or sign out if Explorer still fails).'
    Write-Ok "Done. Backup: $backupDir"
} else {
    Write-Info "$issues issue(s) found. Nothing was changed. Re-run with -Fix to repair."
}
