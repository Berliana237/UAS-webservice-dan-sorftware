# Daftar Environment Variable

`scripts/setup.js` membuat `.env` otomatis dengan secret acak. Daftar ini untuk penguji dan deployment. Semua nilai contoh adalah placeholder, jangan membagikan secret asli.

## Wajib

| Nama | Contoh | Keterangan |
|---|---|---|
| `PII_KEY_BASE64` | `<base64-32-byte>` | Kunci AES-256-GCM kolom sensitif |
| `BLIND_INDEX_KEY` | `<random-hex>` | HMAC untuk pencarian email terenkripsi |
| `WEBHOOK_SECRET` | `<random-hex>` | Tanda tangan webhook pembayaran |
| `SVC_PAYMENT_CLIENT_SECRET` | `<random-hex>` | Client Credentials payment ke booking |
| `SVC_BOOKING_CLIENT_SECRET` | `<random-hex>` | Client Credentials booking |
| `PARTNER_DEMO_CLIENT_SECRET` | `<random-hex>` | Client Credentials partner demo |
| `SEED_USER_PASSWORD` | `<password-demo>` | Kata sandi akun demo. Kosongkan untuk tidak membuat akun demo |
| `TESTER_PASSWORD` | `<password-penguji>` | Kata sandi 4 akun khusus penguji (`pelanggan1@`, `pelanggan2@`, `masinis@`, `admin@penguji.rangkai`). Kosong = akun penguji tidak dibuat |
| `TEST_RESET_ENABLED` | `0` | `1` mengaktifkan `POST /api/admin/test-data/reset` (reset data uji penguji). Hanya untuk lingkungan uji |

## Umum

| Nama | Default | Keterangan |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | URL publik, dipakai redirect OAuth2 |
| `CORS_ORIGINS` | `http://localhost:8080,https://localhost:8443` | Origin yang diizinkan, dipisah koma |
| `PORT_OFFSET` | `0` | Menggeser semua port |
| `PORT` | | Port gateway dari platform (Railway mengisinya otomatis) |
| `DATA_DIR` | `data` | Folder database |
| `CERT_DIR` | `certs` | Folder sertifikat mTLS |
| `TRUST_PROXY` | `0` | `1` bila di belakang proxy platform |
| `NODE_ENV` | `development` | Mode Node.js |
| `GATEWAY_HOST` | `0.0.0.0` di `.env.example` (`127.0.0.1` bila kosong) | Alamat gateway. `0.0.0.0` agar ponsel di Wi-Fi yang sama bisa membuka tautan QRIS |
| `QR_PUBLIC_BASE` | `auto` | Basis tautan di dalam kode QRIS. `auto` memakai alamat Wi-Fi laptop bila `GATEWAY_HOST=0.0.0.0`, atau isi URL publik deployment |
| `BIND_HOST` | `127.0.0.1` | Alamat service internal, `0.0.0.0` di Docker Compose |
| `BOOKING_INSTANCES` | `2` | Jumlah instance booking |
| `MOCK_GATEWAY` | `1` | `0` mematikan gateway pembayaran simulasi |
| `LOAD_USERS` | `0` | Jumlah akun `loadN@rangkai.test` untuk load test |
| `HISTORY_DAYS` | `60` | Banyaknya hari riwayat perjalanan masa lalu yang dibuat saat seed (untuk halaman Armada & Riwayat) |

## Pusat Bantuan (opsional)

| Variabel | Contoh | Keterangan |
|---|---|---|
| `GEMINI_API_KEY` | `<gemini-api-key>` | Kunci Gemini milik penguji sendiri. Kosong berarti chat menjawab dari FAQ |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Model utama. Bila gagal, dicoba `gemini-3.5-flash-lite`, lalu FAQ |

## Kebijakan

| Nama | Default | Keterangan |
|---|---|---|
| `LOCK_TTL_SECONDS` | `600` | TTL lock kursi |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Masa berlaku access token |
| `REFRESH_TOKEN_TTL_SECONDS` | `604800` | Masa berlaku refresh token |
| `BROKER_MAX_ATTEMPTS` | `4` | Percobaan sebelum masuk DLQ |
| `BROKER_VISIBILITY_MS` | `15000` | Lama lease pesan |

## Rate limit per menit

| Nama | Default | Berlaku untuk |
|---|---|---|
| `RATE_GLOBAL_PER_MIN` | `1200` | Per IP, semua rute API |
| `RATE_LOGIN_PER_MIN` | `10` | Per IP dan akun |
| `RATE_REGISTER_PER_MIN` | `20` | Per IP |
| `RATE_TOKEN_PER_MIN` | `120` | Per IP |
| `RATE_LOCK_PER_MIN` | `120` | Per pengguna (memilih atau melepas satu kursi = satu permintaan) |
| `RATE_PAYMENT_PER_MIN` | `30` | Per pengguna |
| `RATE_GRAPHQL_PER_MIN` | `600` | Per pengguna atau IP |
| `RATE_PUBLIC_READ_PER_MIN` | `600` | Per pengguna atau IP |
| `RATE_SUPPORT_PER_MIN` | `12` | Chat Pusat Bantuan, per IP |

## Untuk Docker Compose

`REGISTRY_HOST`, `BROKER_HOST`, `AUTH_HOST`, `CATALOG_HOST`, `PAYMENT_HOST`, `NOTIFICATION_HOST`, `SUPPORT_HOST`, `BOOKING_HOST`, `BOOKING_PORT`, `INSTANCE_ID`. Sudah diisi di `docker-compose.yml`.

## Khusus pengujian dan pengembangan lokal

Tidak perlu diisi untuk mengakses deployment. Dipakai oleh `test.bat`, `run.bat`, atau skrip di `scripts/` dan `tests/`.

| Variabel | Default | Fungsi |
|---|---|---|
| `SEED_DEMO_CUSTOMERS` | `0` | `1` membuat akun pelanggan demo (`customer@rangkai.test`, `customer2@rangkai.test`) di stack pengujian |
| `SEED_DEMO_HISTORY` | `0` | `1` membuat riwayat pesanan rekaan untuk grafik dan laporan |
| `SUPPORT_CHAT_BUDGET_MS` | `12000` | Batas waktu jawaban chat AI sebelum jatuh ke FAQ |
| `OPEN_BROWSER` | `0` | `1` membuka browser otomatis setelah `run.bat` siap |
| `QRIS_PROXY_PORT` | `8090` | Port proksi lokal untuk `qris-tunnel.bat` |
| `LOAD_DURATION` | sesuai skrip | Durasi load test k6 (`tests/load/k6-booking.js`) |
| `DEBUG_FAIL` | kosong | Isi apa saja agar load test k6 mencetak contoh permintaan yang gagal |
