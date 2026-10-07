@echo off
cd /d "%~dp0ComfyUI"
rem Оптимизации за RTX 5070 Ti (Blackwell, 16GB): fp16 accumulation + fp8 matmul (бърз fp8 Flux)
"%~dp0.venv\Scripts\python.exe" main.py --fast fp16_accumulation fp8_matrix_mult --use-pytorch-cross-attention --auto-launch
pause
