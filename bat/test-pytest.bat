@echo off
title Rangkai - PyTest
cd /d "%~dp0.."
call "%~dp0_check.bat" || goto theend
node --disable-warning=ExperimentalWarning scripts\run-tests.js pytest
echo.
echo Hasil tersimpan di folder reports.
:theend
pause
