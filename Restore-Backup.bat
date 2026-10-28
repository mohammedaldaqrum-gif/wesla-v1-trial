@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title WESLA Restore Database
where node >nul 2>&1
if errorlevel 1 goto no_node
echo.
echo WESLA DATABASE RESTORE
echo Stop the WESLA server first (Ctrl+C).
echo A safety backup of the current database will be created when possible.
echo.
set "BACKUP_PATH=%~1"
if "%BACKUP_PATH%"=="" set /p "BACKUP_PATH=Enter full path to backup .db file: "
if not exist "%BACKUP_PATH%" goto no_file
node scripts\restore-backup.js "%BACKUP_PATH%" --root "%~dp0"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
:no_node
echo ERROR: Node.js 22.13 or newer is required.
pause
exit /b 1
:no_file
echo ERROR: Backup file not found. Provide the full path to a .db backup.
pause
exit /b 1
