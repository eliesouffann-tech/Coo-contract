@echo off
chcp 65001 >nul
title WhatsApp AI Agent

echo.
echo  ██╗    ██╗██╗  ██╗ █████╗ ████████╗███████╗ █████╗ ██████╗ ██████╗
echo  ██║    ██║██║  ██║██╔══██╗╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔══██╗
echo  ██║ █╗ ██║███████║███████║   ██║   ███████╗███████║██████╔╝██████╔╝
echo  ██║███╗██║██╔══██║██╔══██║   ██║   ╚════██║██╔══██║██╔═══╝ ██╔═══╝
echo  ╚███╔███╔╝██║  ██║██║  ██║   ██║   ███████║██║  ██║██║     ██║
echo   ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
echo.
echo  AI Agent for WhatsApp
echo  ════════════════════════════════════════
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js לא מותקן.
    echo  [!] הורד מ: https://nodejs.org
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo  [+] מתקין תלויות...
call npm install --silent
if %errorlevel% neq 0 (
    echo  [!] שגיאה בהתקנה
    pause
    exit /b 1
)

:: Check if configured
if exist .env (
    echo  [+] הגדרות קיימות — מפעיל סוכן...
    echo.
    node src/index.js
) else (
    echo  [+] פותח אשף הגדרה...
    echo.
    node scripts/setup-web.js
)

pause
