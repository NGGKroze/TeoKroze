@echo off
cd /d "%~dp0"
".venv\Scripts\python.exe" download_models.py
pause
