@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Not installed yet - run install.bat first.
    pause
    exit /b 1
)

rem Extra ComfyUI flags. Optional speed-up for RTX 40/50 (fp8 matmul, may slightly change output):
rem   set COMFY_ARGS=--fast fp8_matrix_mult
set COMFY_ARGS=

".venv\Scripts\python.exe" app.py %*
pause
