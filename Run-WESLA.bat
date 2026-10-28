@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title WESLA Wholesale Local Test
where node >nul 2>&1
if errorlevel 1 goto no_node
if not exist "backend\server.js" goto missing_files
if not exist "frontend\index.html" goto missing_files
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('select 1');d.close()" >nul 2>&1
if errorlevel 1 goto bad_node
echo Starting WESLA Wholesale...
echo Keep this window open while using the app.
echo The temporary owner password is printed by the server on first setup.
echo.
node backend\server.js
set "APP_EXIT=%ERRORLEVEL%"
if not "%APP_EXIT%"=="0" echo Server exited with an error. Copy the error text above.
echo.
echo Server stopped.
pause
exit /b %APP_EXIT%
:no_node
echo ERROR: Node.js was not found in PATH.
echo Install Node.js 22.13 or newer, then reopen this file.
pause
exit /b 1
:bad_node
echo ERROR: This Node.js installation does not support node:sqlite.
echo Install Node.js 22.13 or newer, then reopen this file.
pause
exit /b 1
:missing_files
echo ERROR: backend\server.js or frontend\index.html is missing.
echo Extract the complete ZIP file to a normal writable folder first.
pause
exit /b 1
