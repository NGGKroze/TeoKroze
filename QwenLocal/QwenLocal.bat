@echo off
rem Qwen Local - double-click to open the installer / control panel.
if "%~1"=="" (
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0QwenLocal.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0QwenLocal.ps1" %*
)
