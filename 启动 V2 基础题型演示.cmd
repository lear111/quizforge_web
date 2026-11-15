@echo off
chcp 65001 >nul
cd /d "%~dp0"
node core\scripts\build\ensure-ui.mjs
if errorlevel 1 goto :failed
node core\server\v2-main.mjs --root examples\v2 --port 8794
pause
exit /b
:failed
pause
exit /b 1
