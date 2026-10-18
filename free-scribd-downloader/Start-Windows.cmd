@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or later from https://nodejs.org/
  pause
  exit /b 1
)
echo Open http://127.0.0.1:3080 in your browser.
echo Close this window to stop EB Docs.
node server.mjs
pause
