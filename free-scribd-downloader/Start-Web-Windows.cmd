@echo off
cd /d "%~dp0"
if not defined EB_PUBLIC_ORIGIN (
  echo Set EB_PUBLIC_ORIGIN, EB_GATEWAY_TOKEN and configure deploy/Caddyfile first.
  pause
  exit /b 1
)
node web.mjs
pause
