@echo off
setlocal
cd /d "%~dp0"
node core\server\v2-main.mjs --root "%~dp0." --port 8794
if errorlevel 1 pause
