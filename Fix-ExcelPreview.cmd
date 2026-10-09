@echo off
rem ===========================================================================
rem  Fix-ExcelPreview.cmd
rem  Diagnoses / repairs the Excel preview handler (Outlook classic + Explorer).
rem
rem    Fix-ExcelPreview.cmd          -> menu (1 = diagnose, 2 = fix)
rem    Fix-ExcelPreview.cmd diag     -> diagnose only (backup is still made)
rem    Fix-ExcelPreview.cmd fix      -> apply repairs
rem
rem  Must run as Administrator. A registry backup + Restore.cmd is ALWAYS
rem  written to %USERPROFILE%\ExcelPreviewBackup\<timestamp>\ first.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title Excel Preview Handler - diagnose / fix

rem --- 32-bit cmd on 64-bit Windows: relaunch in 64-bit cmd ------------------
if defined PROCESSOR_ARCHITEW6432 (
    "%SystemRoot%\Sysnative\cmd.exe" /c ""%~f0" %*"
    exit /b
)

rem --- admin check ------------------------------------------------------------
fltmc >nul 2>&1 || (
    echo Run this file as Administrator: right-click, then Run as administrator.
    pause
    exit /b 1
)

set "IFACE={8895b1c6-b41f-4c1c-a562-0d564250836f}"
set "APPID={6d2b5079-2f0b-48dd-ab7f-97cec514d30b}"
set "PH=SOFTWARE\Microsoft\Windows\CurrentVersion\PreviewHandlers"
set "EXTS=.xls .xlsx .xlsm .xlsb .csv"
set "FIXEXTS=.xls .xlsx .xlsm .xlsb"
set "ISSUES=0"

rem --- mode ---------------------------------------------------------------------
set "MODE=%~1"
if /i "%MODE%"=="diag" goto :start
if /i "%MODE%"=="fix" goto :start
echo.
echo  Excel Preview Handler
echo  ---------------------
echo   1  Diagnose only (backup + report, nothing is changed)
echo   2  Fix (backup + repair)
echo   3  Exit
echo.
choice /c 123 /n /m "Choose 1, 2 or 3: "
if errorlevel 3 exit /b 0
if errorlevel 2 (set "MODE=fix") else (set "MODE=diag")

:start
echo.
echo Mode: %MODE%

rem --- discover ProgIDs of the extensions ---------------------------------------
set "PROGS="
set "PROGLIST="
for %%E in (%EXTS%) do call :collect %%E

rem --- discover Excel preview handlers listed in PreviewHandlers -----------------
set "EXCL="
call :scan "HKLM\%PH%"
call :scan "HKCU\%PH%"

rem --- backup ----------------------------------------------------------------------
set "TS=%date%_%time%"
set "TS=!TS:/=-!"
set "TS=!TS::=-!"
set "TS=!TS:.=-!"
set "TS=!TS:,=-!"
set "TS=!TS: =_!"
set "TS=!TS:\=-!"
set "BK=%USERPROFILE%\ExcelPreviewBackup\!TS!_%RANDOM%"
mkdir "!BK!" >nul 2>&1
set "N=0"
> "!BK!\Restore.cmd" echo @echo off
>> "!BK!\Restore.cmd" echo echo Restoring registry backup. Run this as Administrator.
>> "!BK!\Restore.cmd" echo pause

for %%E in (%EXTS%) do (
    call :bk "HKLM\SOFTWARE\Classes\%%E"
    call :bk "HKCU\Software\Classes\%%E"
    call :notexistdel "HKLM\SOFTWARE\Classes\%%E\shellex\%IFACE%"
)
for %%P in (!PROGLIST!) do (
    call :bk "HKLM\SOFTWARE\Classes\%%P"
    call :bk "HKCU\Software\Classes\%%P"
)
call :bk "HKLM\%PH%"
call :bk "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\PreviewHandlers"
call :bk "HKCU\%PH%"
call :bk "HKLM\SOFTWARE\Classes\AppID\%APPID%"
call :notexistdel "HKLM\SOFTWARE\Classes\AppID\%APPID%"
call :bk "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
for %%V in (16.0 15.0 14.0) do (
    call :bk "HKCU\SOFTWARE\Microsoft\Office\%%V\Excel\Security"
    call :bk "HKCU\SOFTWARE\Policies\Microsoft\Office\%%V\Excel\Security"
)
for %%G in (!EXCL!) do (
    call :bk "HKLM\SOFTWARE\Classes\CLSID\%%G"
    call :bk "HKCU\Software\Classes\CLSID\%%G"
)
>> "!BK!\Restore.cmd" echo echo Done. Restart Explorer and Outlook.
>> "!BK!\Restore.cmd" echo pause
echo [INFO] Backup: !BK!  (!N! keys exported)
echo [INFO] To undo: run !BK!\Restore.cmd as Administrator
echo.

rem =====================  CHECKS / FIXES  =========================================

rem --- Office bitness -------------------------------------------------------------
set "PLAT="
for /f "tokens=3" %%p in ('reg query "HKLM\SOFTWARE\Microsoft\Office\ClickToRun\Configuration" /v Platform 2^>nul ^| find "Platform"') do set "PLAT=%%p"
if defined PLAT (
    echo [INFO] Office Click-to-Run platform: !PLAT!
    if /i not "!PLAT!"=="x64" call :bad Office is not x64 - 64-bit Explorer/Outlook need an x64 previewer
) else (
    echo [INFO] Office Click-to-Run platform not found - MSI install or no Office
)

rem --- Excel handlers --------------------------------------------------------------
set "GOOD="
if not defined EXCL (
    call :bad No Excel entry in PreviewHandlers - run Online Repair of Office
) else (
    for %%G in (!EXCL!) do call :reporth %%G
)

rem --- HKCU overrides ----------------------------------------------------------------
for %%E in (%EXTS%) do call :hkcuov "HKCU\Software\Classes\%%E\shellex\%IFACE%"
for %%P in (!PROGLIST!) do call :hkcuov "HKCU\Software\Classes\%%P\shellex\%IFACE%"

rem --- HKLM extension mapping --------------------------------------------------------
for %%E in (%FIXEXTS%) do call :extmap %%E

rem --- dead entries in the 64-bit PreviewHandlers list --------------------------------
for /f "tokens=1,2,*" %%a in ('reg query "HKLM\%PH%" 2^>nul') do if /i "%%b"=="REG_SZ" call :deadchk "%%a" "%%c"

rem --- Explorer: show preview handlers --------------------------------------------------
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v ShowPreviewHandlers 2>nul | find "0x1" >nul
if errorlevel 1 (
    call :bad ShowPreviewHandlers is not 1
    if "%MODE%"=="fix" (
        reg add "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v ShowPreviewHandlers /t REG_DWORD /d 1 /f >nul 2>&1 && call :act ShowPreviewHandlers set to 1
    )
) else (
    call :okk ShowPreviewHandlers = 1
)

rem --- prevhost surrogate AppID -----------------------------------------------------------
reg query "HKLM\SOFTWARE\Classes\AppID\%APPID%" >nul 2>&1
if errorlevel 1 (
    call :bad prevhost AppID missing
    if "%MODE%"=="fix" (
        reg add "HKLM\SOFTWARE\Classes\AppID\%APPID%" /v DllSurrogate /t REG_EXPAND_SZ /d "%%SystemRoot%%\system32\prevhost.exe" /f >nul 2>&1 && call :act prevhost AppID created
    )
) else (
    call :okk prevhost AppID present
)

rem --- report only: Excel File Block ---------------------------------------------------------
for %%V in (16.0 15.0 14.0) do (
    call :fileblock "HKCU\SOFTWARE\Microsoft\Office\%%V\Excel\Security\FileBlock"
    call :fileblock "HKCU\SOFTWARE\Policies\Microsoft\Office\%%V\Excel\Security\FileBlock"
)

rem =====================  FINISH  ==========================================================
echo.
if "%MODE%"=="fix" (
    taskkill /f /im prevhost.exe >nul 2>&1
    echo [FIX ] prevhost.exe stopped.
    echo Close and reopen Outlook and test. If Explorer still fails, sign out and in.
    echo Backup / undo: !BK!\Restore.cmd
) else (
    echo !ISSUES! issue^(s^) found. Nothing was changed. Run again and choose Fix to repair.
)
echo.
pause
exit /b 0

rem ===================================================================================
rem  subroutines
rem ===================================================================================

:okk
echo [ OK ] %*
exit /b

:bad
echo [WARN] %*
set /a ISSUES+=1
exit /b

:act
echo [FIX ] %*
exit /b

rem --- :getdef <key>  -> RET = default value of key (empty if none) ---------------------
:getdef
set "RET="
for /f "tokens=* delims=" %%L in ('reg query "%~1" /ve 2^>nul') do set "LN=%%L" & call :parsedef
exit /b

:parsedef
if not "!LN:*REG_SZ    =!"=="!LN!" set "RET=!LN:*REG_SZ    =!"
if not "!LN:*REG_EXPAND_SZ    =!"=="!LN!" (
    set "RET=!LN:*REG_EXPAND_SZ    =!"
    call set "RET=!RET!"
)
if "!RET:~0,6!"=="(value" set "RET="
exit /b

rem --- :collect <ext> -> adds its ProgID to PROGLIST, PROG_<ext> -------------------------
:collect
call :getdef "HKLM\SOFTWARE\Classes\%~1"
if not defined RET call :getdef "HKCU\Software\Classes\%~1"
if not defined RET exit /b
set "PROG_%~1=!RET!"
echo !PROGS! | find /i "[!RET!]" >nul && exit /b
set "PROGS=!PROGS![!RET!]"
set "PROGLIST=!PROGLIST! !RET!"
exit /b

rem --- :scan <key> -> adds CLSIDs whose name contains "Excel" to EXCL --------------------
:scan
for /f "tokens=1,2,*" %%a in ('reg query "%~1" 2^>nul') do if /i "%%b"=="REG_SZ" echo %%c| findstr /i "Excel" >nul && set "EXCL=!EXCL! %%a" & set "XN_%%a=%%c"
exit /b

rem --- :chkclsid <clsid> -> CS = ok / nodll / noserver / missing, CS_DLL -------------------
:chkclsid
set "CS=missing"
set "CS_DLL="
set "CB="
if "%~1"=="" exit /b
reg query "HKLM\SOFTWARE\Classes\CLSID\%~1" >nul 2>&1 && set "CB=HKLM\SOFTWARE\Classes\CLSID\%~1"
if not defined CB reg query "HKCU\Software\Classes\CLSID\%~1" >nul 2>&1 && set "CB=HKCU\Software\Classes\CLSID\%~1"
if not defined CB exit /b
set "CS=noserver"
call :getdef "!CB!\InprocServer32"
if not defined RET exit /b
set "CS_DLL=!RET:"=!"
set "CS=nodll"
if exist "!CS_DLL!" set "CS=ok"
exit /b

:reporth
call :chkclsid %~1
set "NM=!XN_%~1!"
if "!CS!"=="ok" (
    call :okk !NM! %~1 - !CS_DLL!
    if not defined GOOD set "GOOD=%~1"
) else (
    call :bad !NM! %~1 is !CS! !CS_DLL!
)
exit /b

rem --- :hkcuov <key> : per-user preview override ---------------------------------------------
:hkcuov
reg query "%~1" >nul 2>&1 || exit /b
call :getdef "%~1"
set "CUR=!RET!"
call :chkclsid "!CUR!"
if "!CS!"=="ok" (
    call :okk HKCU override %~1 = !CUR! is valid, kept
    exit /b
)
call :bad HKCU override %~1 = !CUR! is !CS!
if "%MODE%"=="fix" reg delete "%~1" /f >nul 2>&1 && call :act removed %~1
exit /b

rem --- :extmap <ext> : HKLM extension -> preview handler ---------------------------------------
:extmap
call :getdef "HKLM\SOFTWARE\Classes\%~1\shellex\%IFACE%"
set "CUR=!RET!"
if defined CUR (
    call :chkclsid "!CUR!"
    if "!CS!"=="ok" (
        call :okk %~1 preview handler = !CUR!
        exit /b
    )
)
set "PG=!PROG_%~1!"
if defined PG (
    call :getdef "HKLM\SOFTWARE\Classes\!PG!\shellex\%IFACE%"
    if defined RET (
        set "PGH=!RET!"
        call :chkclsid "!PGH!"
        if "!CS!"=="ok" (
            call :okk %~1 preview handler via !PG! = !PGH!
            exit /b
        )
    )
)
call :bad %~1 has no valid preview handler ^(extension value: !CUR!^)
if "%MODE%"=="fix" (
    if defined GOOD (
        reg add "HKLM\SOFTWARE\Classes\%~1\shellex\%IFACE%" /ve /d "!GOOD!" /f >nul 2>&1 && call :act %~1 now points to !GOOD!
    ) else (
        echo [WARN] no valid Excel previewer found to point %~1 at - repair Office first
    )
)
exit /b

rem --- :deadchk <clsid> <name> : stale PreviewHandlers entries ---------------------------------
:deadchk
call :chkclsid "%~1"
if "!CS!"=="ok" exit /b
set "NM=%~2"
if not "!CS!"=="missing" (
    call :bad !NM! %~1 is !CS! - reported only
    exit /b
)
echo !NM!| findstr /i "Microsoft Office Excel Word PowerPoint Outlook Windows" >nul && (
    call :bad !NM! %~1 CLSID is missing - Microsoft entry, not removed
    exit /b
)
call :bad dead entry !NM! %~1 - CLSID is missing
if "%MODE%"=="fix" reg delete "HKLM\%PH%" /v "%~1" /f >nul 2>&1 && call :act removed %~1
exit /b

rem --- :fileblock <key> : report non-zero File Block values ------------------------------------
:fileblock
reg query "%~1" >nul 2>&1 || exit /b
for /f "tokens=1,2,*" %%a in ('reg query "%~1" 2^>nul') do if /i "%%b"=="REG_DWORD" if /i not "%%c"=="0x0" echo [WARN] File Block %~1 : %%a = %%c ^(can block previews, not changed^)
exit /b

rem --- :bk <key> : export to backup -----------------------------------------------------------
:bk
reg query "%~1" >nul 2>&1 || exit /b
set /a N+=1
reg export "%~1" "!BK!\!N!.reg" /y >nul 2>&1 || exit /b
>> "!BK!\Restore.cmd" echo reg import "%%~dp0!N!.reg"
exit /b

rem --- :notexistdel <key> : if key does not exist now, restore must delete it ------------------
:notexistdel
reg query "%~1" >nul 2>&1 && exit /b
>> "!BK!\Restore.cmd" echo reg delete "%~1" /f
exit /b
