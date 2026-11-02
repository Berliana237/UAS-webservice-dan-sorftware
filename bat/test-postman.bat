@echo off
title Rangkai - Postman Newman
cd /d "%~dp0.."
call "%~dp0_check.bat" || goto theend
node --disable-warning=ExperimentalWarning scripts\run-tests.js postman
echo.
echo Hasil tersimpan di folder reports.
:theend
pause
