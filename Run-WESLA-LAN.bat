@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title WESLA LAN Test
where node >nul 2>&1
if errorlevel 1 goto no_node
if not exist "backend\server.js" goto missing_files
if not exist "frontend\index.html" goto missing_files
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('select 1');d.close()" >nul 2>&1
if errorlevel 1 goto bad_node
set "HOST=0.0.0.0"
set "PORT="
echo ==================================================
echo WESLA LAN TEST
echo Use only a trusted Private Wi-Fi network and test data.
echo Keep this window open while testing.
echo ==================================================
echo.
echo Local IPv4 addresses on this PC:
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '{0} : {1}' -f $_.InterfaceAlias, $_.IPAddress }"
echo.
echo Use the exact Wi-Fi IP and port printed by server.js.
echo Do NOT type localhost, 127.0.0.1, or 0.0.0.0 on your phone.
echo Never use real passport images, debt records, or receipts in LAN tests.
echo.
node backend\server.js
set "APP_EXIT=%ERRORLEVEL%"
echo.
echo Server stopped. Exit code: %APP_EXIT%
pause
exit /b %APP_EXIT%
:no_node
echo ERROR: Node.js was not found in PATH.
echo Install Node.js 22.13 or newer, then reopen this file.
pause
exit /b 1
:bad_node
echo ERROR: This Node.js installation does not support node:sqlite.
echo Install Node.js 22.13 or newer.
pause
exit /b 1
:missing_files
echo ERROR: backend\server.js or frontend\index.html is missing.
echo Extract the complete ZIP first.
pause
exit /b 1
