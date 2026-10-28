@echo off
:: WESLA Auto-Start with Tunnel
:: This script starts the server and localtunnel automatically

setlocal
cd /d "%~dp0"

:: Kill any existing instances
taskkill /FI "WINDOWTITLE eq WESLA*" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /F >nul 2>&1

:: Wait for ports to be free
timeout /t 2 /nobreak >nul

:: Start WESLA server in background
start "WESLA Server" /B node backend\server.js

:: Wait for server to start
timeout /t 3 /nobreak >nul

:: Start localtunnel and save URL
lt --port 3000 > "%LOCALAPPDATA%\hermes\cache\scratch\lt-url.txt" 2>&1

:: Wait for tunnel to establish
timeout /t 5 /nobreak >nul

:: Show the URL
echo.
echo ========================================
echo WESLA is now running!
echo ========================================
echo.
echo Your trial URL:
type "%LOCALAPPDATA%\hermes\cache\scratch\lt-url.txt" 2>nul | findstr "https://"
echo.
echo Press any key to close this window...
pause >nul
