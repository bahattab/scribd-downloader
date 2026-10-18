@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.10 or later from https://www.python.org/downloads/
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto failed
.venv\Scripts\python.exe scribd_worker.py --check
if errorlevel 1 goto failed
echo Setup complete. Run Start-Windows.cmd to open EB Docs.
echo Chrome is also required. Selenium may download a matching driver on first use.
pause
exit /b 0
:failed
echo Setup did not complete. Check internet access and the message above.
pause
exit /b 1
