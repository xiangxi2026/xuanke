@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   高一选科填报系统
echo ========================================
echo.
echo 正在启动服务...
echo.
node server.js
pause
