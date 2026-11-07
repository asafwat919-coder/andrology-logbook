@echo off
title Electronic Andrology Logbook
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo.
  echo  Install it once, then double-click this file again:
  echo    1. Go to https://nodejs.org and download the "LTS" version
  echo    2. Run the installer with the default options
  echo    3. Close this window and double-click "Start Logbook.bat" again
  echo.
  echo  Opening the download page now...
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

echo Starting Electronic Andrology Logbook...
start "" /b cmd /c "timeout /t 3 >nul && start http://localhost:3000"
node server.js
echo.
echo The server has stopped.
pause
