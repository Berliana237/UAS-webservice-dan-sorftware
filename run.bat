@echo off
title Rangkai - Reservasi Kereta Antarkota
cd /d "%~dp0"
echo ====================================================
echo   Rangkai - menyalakan aplikasi
echo ====================================================
echo.
call "%~dp0bat\_check.bat" || goto theend
set OPEN_BROWSER=1
node scripts\start-all.js
echo.
echo [!] Aplikasi berhenti. Baca pesan di atas, atau lihat folder reports\logs.
:theend
echo.
pause
