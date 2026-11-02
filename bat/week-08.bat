@echo off
title Rangkai - Demo Minggu 8
cd /d "%~dp0.."
call "%~dp0_check.bat" || goto theend
node --disable-warning=ExperimentalWarning scripts\run-tests.js week8
echo.
echo Hasil tersimpan di folder reports.
:theend
pause
