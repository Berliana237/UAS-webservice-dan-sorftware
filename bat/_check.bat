@echo off
rem Pemeriksaan bersama: Node, Java, dependensi, secret, sertifikat, dan jar booking-service.
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js tidak ditemukan. Pasang versi 22 atau lebih baru dari https://nodejs.org
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [X] Node.js terlalu lama. Dibutuhkan versi 22.13 atau lebih baru.
  exit /b 1
)
where java >nul 2>&1
if errorlevel 1 (
  echo [X] Java tidak ditemukan. Pasang JDK 21 dari https://adoptium.net
  exit /b 1
)
if not exist "node_modules\express" (
  echo Memasang dependensi Node, sekali saja...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [X] npm install gagal. Periksa koneksi internet.
    exit /b 1
  )
)
node scripts\setup.js
if errorlevel 1 exit /b 1
if not exist "services\booking\target\booking-service.jar" (
  echo Membangun booking-service, sekali saja, butuh internet untuk Maven...
  pushd services\booking
  call mvnw.cmd -B -q package -DskipTests
  set BUILD_ERR=%errorlevel%
  popd
  if not exist "services\booking\target\booking-service.jar" (
    echo [X] Gagal membangun booking-service.
    exit /b 1
  )
)
exit /b 0
