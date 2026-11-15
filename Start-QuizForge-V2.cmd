@echo off
setlocal
cd /d "%~dp0"
node core\scripts\build\ensure-ui.mjs
if errorlevel 1 goto :failed
node core\server\v2-main.mjs --root "%~dp0." --port 8794
if errorlevel 1 pause
exit /b
:failed
pause
exit /b 1
