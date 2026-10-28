@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "REPORT=%~dp0WESLA_Diagnostics.txt"
(
  echo WESLA WHOLESALE diagnostics
  echo Date: %DATE% %TIME%
  echo Folder: %CD%
  echo.
  echo --- node version ---
  node --version 2^>^&1
  echo.
  echo --- node executable ---
  where node 2^>^&1
  echo.
  echo --- node sqlite test ---
  node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('select 1');d.close();console.log('node:sqlite OK')" 2^>^&1
  echo.
  echo --- syntax check ---
  node --check backend\server.js 2^>^&1
  echo.
  echo --- project files ---
  dir backend\server.js frontend\index.html package.json tests\integration.test.js 2^>^&1
  echo.
  echo --- ports 3000-3010 ---
  netstat -ano 2^>^&1 ^| findstr /R /C:":3000 " /C:":3001 " /C:":3002 " /C:":3003 " /C:":3004 " /C:":3005 " /C:":3006 " /C:":3007 " /C:":3008 " /C:":3009 " /C:":3010 "
) > "%REPORT%"
notepad "%REPORT%"
echo Report saved to %REPORT%
pause
