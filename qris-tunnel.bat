@echo off
title Rangkai - Tautan publik QRIS
cd /d "%~dp0"
echo Membuka tautan publik khusus halaman QRIS. Jalankan run.bat lebih dulu.
echo Tutup jendela ini atau tekan Ctrl+C untuk menutup tautan.
node scripts\qris-tunnel.js
pause
