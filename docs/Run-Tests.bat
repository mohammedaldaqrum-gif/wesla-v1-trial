@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 goto no_node
node --check backend\server.js
if errorlevel 1 goto fail
node --check scripts\restore-backup.js
if errorlevel 1 goto fail
node tests\check-frontend.js
if errorlevel 1 goto fail
node --test tests\integration.test.js tests\regression-v49.test.js tests\restore-backup.test.js
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" goto fail
echo.
echo Running financial audit harness...
node tests\audit-harness.js
set "RC=%ERRORLEVEL%"
echo.
echo Final test process exit code: %RC%
pause
exit /b %RC%
:no_node
echo ERROR: Node.js was not found in PATH.
pause
exit /b 1
:fail
echo One or more checks failed. Review the messages above.
pause
exit /b 1
