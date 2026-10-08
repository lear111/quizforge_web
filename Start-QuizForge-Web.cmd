@echo off
setlocal
title QuizForge Web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-QuizForge-Web.ps1" %*
set "quizforgeExit=%ERRORLEVEL%"
if not "%quizforgeExit%"=="0" pause
exit /b %quizforgeExit%
