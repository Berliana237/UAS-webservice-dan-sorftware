@echo off
title Rangkai - JUnit 5
cd /d "%~dp0.."
call "%~dp0_check.bat" || goto theend
node --disable-warning=ExperimentalWarning scripts\run-tests.js unit-java
echo.
echo Hasil tersimpan di folder reports.
:theend
pause
