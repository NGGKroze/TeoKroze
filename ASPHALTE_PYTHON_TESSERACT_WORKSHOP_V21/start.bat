@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title ASPHALTE Python + Tesseract Workshop

set "APP_HOME=%LOCALAPPDATA%\ASPHALTE_Workshop"
set "VENV_DIR=%APP_HOME%\venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "SETUP_STATE=%APP_HOME%\setup_state.txt"
set "SETUP_SCHEMA=3"
if not exist "%APP_HOME%" mkdir "%APP_HOME%" >nul 2>nul

rem =========================================================
rem Find Python. Python itself is the only external prerequisite.
rem Everything used by the application is installed automatically
rem during the first setup run.
rem =========================================================
set "PY_EXE="
where py >nul 2>nul
if not errorlevel 1 (
  for /f "usebackq delims=" %%P in (`py -3 -c "import sys; print(sys.executable)" 2^>nul`) do set "PY_EXE=%%P"
)
if not defined PY_EXE (
  where python >nul 2>nul
  if not errorlevel 1 (
    for /f "usebackq delims=" %%P in (`python -c "import sys; print(sys.executable)" 2^>nul`) do set "PY_EXE=%%P"
  )
)
if not defined PY_EXE (
  echo.
  echo Python 3 was not found on this PC.
  echo Install Python 3.10 or newer once, then run start.bat again.
  echo.
  pause
  exit /b 1
)
"%PY_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required.
  echo Found: %PY_EXE%
  echo.
  pause
  exit /b 1
)

rem Requirements signature. This is quick and silent. A normal launch does not
rem run pip or Tesseract installation when the setup signature is current.
set "REQ_HASH="
for /f "delims=" %%H in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash -Algorithm SHA256 ''%CD%\requirements.txt'').Hash" 2^>nul') do set "REQ_HASH=%%H"
if not defined REQ_HASH set "REQ_HASH=NOHASH"
set "EXPECTED_STATE=%SETUP_SCHEMA%_!REQ_HASH!"
set "OLD_STATE="
if exist "%SETUP_STATE%" set /p OLD_STATE=<"%SETUP_STATE%"

set "NEED_SETUP="
if not exist "%VENV_PY%" set "NEED_SETUP=1"
if exist "%VENV_PY%" (
  "%VENV_PY%" -c "import sys" >nul 2>nul
  if errorlevel 1 set "NEED_SETUP=1"
)
if /I not "!OLD_STATE!"=="!EXPECTED_STATE!" set "NEED_SETUP=1"

if defined NEED_SETUP goto FIRST_SETUP
goto LAUNCH

:FIRST_SETUP
echo.
echo =========================================================
echo  ASPHALTE - FIRST TIME SETUP
echo =========================================================
echo.
echo Installing application dependencies. This is done once.
echo Future starts will launch the program directly.
echo.

rem Recreate a stale/broken shared environment automatically.
if exist "%VENV_DIR%" (
  "%VENV_PY%" -c "import sys" >nul 2>nul
  if errorlevel 1 (
    echo Repairing old Python environment...
    rmdir /s /q "%VENV_DIR%" >nul 2>nul
  )
)
if not exist "%VENV_PY%" (
  echo [1/3] Creating Python environment...
  "%PY_EXE%" -m venv "%VENV_DIR%"
  if errorlevel 1 goto SETUP_FAILED
)

rem Install Python packages once for this requirements signature.
echo [2/3] Installing Python packages...
"%VENV_PY%" -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto SETUP_FAILED

rem Tesseract is a real application, not a pip package. Install it automatically
rem on first setup so the user is never asked on every launch.
call :FIND_TESSERACT
if not defined TESSERACT_CMD (
  echo [3/3] Installing Tesseract OCR automatically...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Windows Package Manager ^(winget^) is required for automatic Tesseract installation.
    echo Install/update "App Installer" from Microsoft, then run start.bat again.
    goto SETUP_FAILED
  )
  winget install --id UB-Mannheim.TesseractOCR -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if errorlevel 1 (
    rem winget can return a non-zero code when the package is already installed.
    rem Verify the executable before treating this as a failure.
    call :FIND_TESSERACT
    if not defined TESSERACT_CMD (
      echo.
      echo Automatic Tesseract installation failed.
      echo Please install UB-Mannheim Tesseract OCR once, then run start.bat again.
      goto SETUP_FAILED
    )
  )
  call :FIND_TESSERACT
  if not defined TESSERACT_CMD (
    echo.
    echo Tesseract installation finished but tesseract.exe could not be located.
    echo Restart Windows once or install Tesseract manually, then run start.bat again.
    goto SETUP_FAILED
  )
) else (
  echo [3/3] Tesseract OCR already installed.
)

rem Successful first setup. Only after everything is ready do we save the state.
>"%SETUP_STATE%" echo !EXPECTED_STATE!
echo.
echo Setup complete. Future starts will launch directly.
echo.
goto LAUNCH

:LAUNCH
rem Silent executable lookup only; no installer/prompt during a normal launch.
call :FIND_TESSERACT
set "VENV_PYW=%VENV_DIR%\Scripts\pythonw.exe"
rem One-time: desktop shortcut with the app icon (uses ASPHALTE.vbs = no console window).
if not exist "%APP_HOME%\shortcut_v21.txt" (
  cscript //nologo "%~dp0create_shortcut.vbs" >nul 2>nul
  >"%APP_HOME%\shortcut_v21.txt" echo done
)
rem Start hidden (pythonw = no console window). The server closes itself when the
rem browser window is closed, and a second launch just reopens the running instance.
if exist "%VENV_PYW%" (
  start "" "%VENV_PYW%" "%~dp0server.py"
) else (
  start "" /min "%VENV_PY%" "%~dp0server.py"
)
exit /b 0

:FIND_TESSERACT
set "TESSERACT_CMD="
where tesseract >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%T in ('where tesseract 2^>nul') do if not defined TESSERACT_CMD set "TESSERACT_CMD=%%T"
)
if not defined TESSERACT_CMD if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" set "TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe"
if not defined TESSERACT_CMD if exist "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe" set "TESSERACT_CMD=C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
if not defined TESSERACT_CMD if exist "%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe" set "TESSERACT_CMD=%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"
if not defined TESSERACT_CMD if exist "%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe" set "TESSERACT_CMD=%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe"
exit /b 0

:SETUP_FAILED
echo.
echo First-time setup did not finish, so it has NOT been marked complete.
echo Correct the problem above and run start.bat again.
echo.
pause
exit /b 1
