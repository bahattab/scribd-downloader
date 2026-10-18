@echo off
cd /d "%~dp0"
node --test
if errorlevel 1 goto failed
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m unittest discover -s test -p test_*.py
) else (
  python -m unittest discover -s test -p test_*.py
)
if errorlevel 1 goto failed
echo Automated checks passed. Live Scribd, desktop UI and HTTPS deployment need separate acceptance checks.
pause
exit /b 0
:failed
echo Verification failed. Read the error above.
pause
exit /b 1
