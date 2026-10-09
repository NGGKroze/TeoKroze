<#
  Пълен билд: Python среда -> WinUI приложение -> инсталатор.
  Изисквания (Windows 10/11 x64):
    * .NET 8 SDK
    * Visual Studio 2022 (Community или Build Tools) с workload ".NET desktop development"
      (дава MSBuild и инструментите за WinUI 3 / Windows App SDK)
    * Inno Setup 6 (https://jrsoftware.org/isinfo.php) - само за инсталатора
  Употреба:
    .\build.ps1                 # всичко
    .\build.ps1 -SkipRuntime    # без подготовка на Python (ако вече е готов)
    .\build.ps1 -NoInstaller    # само приложението -> dist\app
    .\build.ps1 -Offline        # Python пакетите от tools\offline-cache
#>
param(
    [switch]$SkipRuntime,
    [switch]$NoInstaller,
    [switch]$Offline,
    [string]$Version = '1.0.0'
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path dist | Out-Null
$log = Join-Path $PSScriptRoot 'dist\build.log'
Start-Transcript -Path $log -Force | Out-Null

try {

    function Find-MSBuild {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path $vswhere) {
            $p = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
            if ($p) { return $p }
        }
        throw 'MSBuild не е намерен. Инсталирайте Visual Studio 2022 (или Build Tools) с workload ".NET desktop development".'
    }

    Write-Host '== 1/4 Тестове на ядрото ==' -ForegroundColor Cyan
    dotnet test tests\LogisticsPacking.Core.Tests -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Тестовете не минаха.' }

    if (-not $SkipRuntime) {
        Write-Host '== 2/4 Python среда ==' -ForegroundColor Cyan
        if ($Offline) { & .\tools\prepare_runtime.ps1 -Offline } else { & .\tools\prepare_runtime.ps1 }
    }

    Write-Host '== 3/4 Приложение (WinUI 3) ==' -ForegroundColor Cyan
    $out = Join-Path $PSScriptRoot 'dist\app'
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    $msbuild = Find-MSBuild
    Write-Host "MSBuild: $msbuild"
    $msbLog = Join-Path $PSScriptRoot 'dist\msbuild.log'
    $msbErr = Join-Path $PSScriptRoot 'dist\msbuild-errors.log'
    & $msbuild src\LogisticsPacking.App\LogisticsPacking.App.csproj /restore /t:Publish `
        /p:Configuration=Release /p:Platform=x64 /p:RuntimeIdentifier=win-x64 /p:SelfContained=true `
        /p:Version=$Version /p:PublishDir="$out\" /v:minimal `
        "/flp1:logfile=$msbLog;verbosity=detailed" "/flp2:logfile=$msbErr;errorsonly"
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '--- Грешки от MSBuild ---' -ForegroundColor Red
        if (Test-Path $msbErr) { Get-Content $msbErr | Select-Object -Unique | ForEach-Object { Write-Host $_ } }
        Write-Host "Подробен лог: $msbLog" -ForegroundColor Yellow
        throw 'Билдът на приложението се провали.'
    }

    if ($NoInstaller) { Write-Host "Готово: $out" -ForegroundColor Green } else {

    Write-Host '== 4/4 Инсталатор ==' -ForegroundColor Cyan
    $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw 'Inno Setup 6 не е намерен (ISCC.exe).' }
    & $iscc "/DAppVersion=$Version" "/DSourceDir=$out" installer\LogisticsPacking.iss
    if ($LASTEXITCODE -ne 0) { throw 'Компилацията на инсталатора се провали.' }
    Write-Host "Готово: dist\installer\LogisticsPacking-Setup-$Version.exe" -ForegroundColor Green
    }
}
catch {
    Write-Host ''
    Write-Host "ГРЕШКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Пълен лог: $log" -ForegroundColor Yellow
    $failed = $true
}
finally {
    try { Stop-Transcript | Out-Null } catch { }
}
Read-Host 'Натиснете Enter за затваряне'
if ($failed) { exit 1 }
