@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   温州世外高二选科系统
echo ========================================
echo.
echo 正在启动服务...
echo.
node server.js
pause
