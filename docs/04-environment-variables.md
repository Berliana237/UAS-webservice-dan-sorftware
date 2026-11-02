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

## Umum

| Nama | Default | Keterangan |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:8080` | URL publik, dipakai redirect OAuth2 |
| `CORS_ORIGINS` | `http://localhost:8080,https://localhost:8443` | Origin yang diizinkan, dipisah koma |
| `PORT_OFFSET` | `0` | Menggeser semua port |
| `PORT` | | Port gateway dari platform seperti Render |
| `DATA_DIR` | `data` | Folder database |
| `CERT_DIR` | `certs` | Folder sertifikat mTLS |
| `TRUST_PROXY` | `0` | `1` bila di belakang proxy platform |
| `GATEWAY_HOST` | `127.0.0.1` | Alamat gateway, `0.0.0.0` di container |
| `BIND_HOST` | `127.0.0.1` | Alamat service internal, `0.0.0.0` di Docker Compose |
| `BOOKING_INSTANCES` | `2` | Jumlah instance booking |
| `MOCK_GATEWAY` | `1` | `0` mematikan gateway pembayaran simulasi |
| `LOAD_USERS` | `0` | Jumlah akun `loadN@rangkai.test` untuk load test |

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
| `RATE_LOCK_PER_MIN` | `30` | Per pengguna |
| `RATE_PAYMENT_PER_MIN` | `30` | Per pengguna |
| `RATE_GRAPHQL_PER_MIN` | `600` | Per pengguna atau IP |
| `RATE_PUBLIC_READ_PER_MIN` | `600` | Per pengguna atau IP |

## Untuk Docker Compose

`REGISTRY_HOST`, `BROKER_HOST`, `AUTH_HOST`, `CATALOG_HOST`, `PAYMENT_HOST`, `NOTIFICATION_HOST`, `BOOKING_HOST`, `BOOKING_PORT`, `INSTANCE_ID`. Sudah diisi di `docker-compose.yml`.
