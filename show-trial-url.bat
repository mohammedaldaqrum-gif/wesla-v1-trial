@echo off
:: WESLA - Show Current Trial URL
:: This shows the current tunnel URL without restarting anything

setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo WESLA Trial - Current Access URL
echo ========================================
echo.

:: Check if URL file exists
if exist "%LOCALAPPDATA%\hermes\cache\scratch\lt-url.txt" (
    echo Your trial URL:
    type "%LOCALAPPDATA%\hermes\cache\scratch\lt-url.txt" 2>nul | findstr "https://"
) else (
    echo No active tunnel found.
    echo Starting auto-start sequence...
    call auto-start-with-tunnel.bat
)

echo.
echo ========================================
echo.
echo If the URL doesn't work, try:
echo 1. Restart this script
echo 2. Or run: lt --port 3000
echo.
pause
