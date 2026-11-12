@echo off
chcp 65001 >nul
cd /d "%~dp0"
node core\server\v2-main.mjs --root examples\v2 --port 8794
pause
