@echo off
title Rangkai - Semua pengujian
cd /d "%~dp0.."
call "%~dp0_check.bat" || goto theend
node --disable-warning=ExperimentalWarning scripts\run-tests.js all
echo.
echo Hasil tersimpan di folder reports.
:theend
pause
