@echo off
title Rangkai - Menu Pengujian
cd /d "%~dp0"
call "%~dp0bat\_check.bat" || goto theend
:menu
cls
echo ====================================================
echo   Rangkai - Menu Pengujian
echo   Hasil tersimpan di folder reports
echo ====================================================
echo.
echo   Progress per minggu
echo     1. Minggu 8   Keamanan lanjutan
echo     2. Minggu 9   API Gateway dan reverse proxy
echo     3. Minggu 10  Service discovery dan load balancing
echo     4. Minggu 11  Message queue
echo.
echo   Pengujian
echo     5. JUnit 5 (mvn test) dan coverage JaCoCo
echo     6. Unit test Node
echo     7. PyTest (EP dan BVA lewat API)
echo     8. Postman lewat Newman, laporan HTML
echo     9. Fungsional ujung ke ujung
echo    10. Konkurensi seat locking
echo    11. Keamanan (OWASP dan mTLS)
echo    12. Load test (k6)
echo.
echo     A. Jalankan SEMUA
echo     Q. Keluar
echo.
set "pilih="
set /p "pilih=Pilih: "
if /i "%pilih%"=="q" goto theend
set "suite="
if "%pilih%"=="1" set suite=week8
if "%pilih%"=="2" set suite=week9
if "%pilih%"=="3" set suite=week10
if "%pilih%"=="4" set suite=week11
if "%pilih%"=="5" set suite=unit-java
if "%pilih%"=="6" set suite=unit-node
if "%pilih%"=="7" set suite=pytest
if "%pilih%"=="8" set suite=postman
if "%pilih%"=="9" set suite=functional
if "%pilih%"=="10" set suite=concurrency
if "%pilih%"=="11" set suite=security
if "%pilih%"=="12" set suite=load
if /i "%pilih%"=="a" set suite=all
if not defined suite goto menu
node --disable-warning=ExperimentalWarning scripts\run-tests.js %suite%
echo.
pause
goto menu
:theend
