# Rangkai: Reservasi Kereta Antarkota

Sistem reservasi kereta dengan **seat locking per segmen**: satu kursi bisa dipakai beberapa penumpang pada ruas berbeda, misalnya Surabaya-Madiun dan Madiun-Yogyakarta. Proyek lintas mata kuliah Web Service x Software Testing (Kelompok A).

## Menjalankan

Butuh **Node.js 22.13+** dan **JDK 21**. Semua perintah di bawah untuk Windows.

| Berkas | Fungsi |
|---|---|
| `run.bat` | Menyalakan seluruh sistem dan membuka browser |
| `stop.bat` | Menghentikan seluruh sistem |
| `test.bat` | Menu semua pengujian dan demo per minggu |

Saat pertama kali, `run.bat` memasang dependensi, membuat `.env` berisi secret acak, membuat sertifikat mTLS, dan membangun booking-service.

| Alamat | Isi |
|---|---|
| http://localhost:8080 | Aplikasi web |
| https://localhost:8443 | Aplikasi lewat TLS 1.2+ (sertifikat dev, akan muncul peringatan browser) |
| http://localhost:8080/docs | Dokumen API (Swagger UI) |
| `POST /graphql` | Endpoint GraphQL |

### Akun demo

Kata sandi semua akun demo: **`Rangkai2026!`** (hanya untuk lingkungan demo, diatur oleh `SEED_USER_PASSWORD`).

| Peran | Email | Bisa melakukan |
|---|---|---|
| Pelanggan | `customer@rangkai.test`, `customer2@rangkai.test` | Memesan, membayar, membatalkan |
| Operator | `operator@rangkai.test` | Check-in, manifest, mengubah status perjalanan |
| Admin | `admin@rangkai.test` | Tambahan: kesehatan sistem, antrian, API key, audit |

## Arsitektur

```mermaid
flowchart LR
  B[Browser SPA] --> GW
  P[Postman / Partner] --> GW
  GW[API Gateway<br/>token, scope, rate limit,<br/>skema, CORS, load balancer]
  GW -- mTLS --> AU[auth<br/>OAuth2 + API key]
  GW -- mTLS --> CA[catalog<br/>REST + GraphQL]
  GW -- mTLS --> BA[booking-a<br/>Java]
  GW -- mTLS --> BB[booking-b<br/>Java]
  GW -- mTLS --> PA[payment]
  GW -- mTLS --> NO[notification + audit]
  CA -- mTLS --> BA
  PA -- mTLS + Client Credentials --> BB
  BA -. outbox .-> MQ[(broker<br/>message queue)]
  BB -. outbox .-> MQ
  PA -. event .-> MQ
  CA -. event .-> MQ
  MQ -. booking.events .-> BA
  MQ -. booking.events .-> BB
  MQ -. payment.events .-> PA
  MQ -. notification, audit .-> NO
  REG[registry<br/>service discovery]
  AU & CA & BA & BB & PA & NO & MQ -- heartbeat --> REG
  GW -- cari instance --> REG
```

| Service | Port | Bahasa | Tanggung jawab |
|---|---|---|---|
| gateway | 8080, 8443 | Node | Satu pintu masuk: token, scope, rate limit, skema, CORS, load balancing, web, docs |
| registry | 8761 | Node | Service discovery berbasis heartbeat |
| broker | 8770 | Node | Message queue durable: routing topik, lease, retry, DLQ |
| auth | 8771 | Node | OAuth2 Authorization Server, JWT RS256, API key |
| catalog | 8772 | Node | Jadwal, formasi gerbong, REST + GraphQL |
| booking-a, booking-b | 8781, 8782 | Java 21 | Seat locking per segmen, pesanan, tiket |
| payment | 8773 | Node | Pembayaran, webhook bertanda tangan, refund |
| notification | 8774 | Node | Konsumen event: notifikasi, audit, peringatan |

Rincian: [docs/03-arsitektur.md](docs/03-arsitektur.md). Pemetaan setiap ketentuan soal: [docs/00-checklist-ketentuan.md](docs/00-checklist-ketentuan.md).

## Daftar endpoint

Spesifikasi lengkap: [docs/openapi.yaml](docs/openapi.yaml) dan [docs/schema.graphql](docs/schema.graphql), contoh query di [docs/graphql-examples.md](docs/graphql-examples.md).

| Kelompok | Endpoint | Akses |
|---|---|---|
| OAuth2 | `GET /oauth/authorize`, `POST /oauth/login`, `POST /oauth/token`, `POST /oauth/revoke`, `GET /oauth/userinfo`, `GET /.well-known/*` | Publik / token |
| Akun | `POST /api/auth/register`, `GET /api/auth/me` | Publik / token |
| Jadwal | `GET /api/stations`, `GET /api/schedules`, `GET /api/trips/{id}`, `GET /api/trips/{id}/seats` | Publik |
| GraphQL | `POST /graphql`, `GET /graphql/schema` | Publik, mutation butuh scope |
| Kursi | `GET /api/trips/{id}/availability`, `GET /api/trips/{id}/seats/stream` (SSE) | Publik |
| Kursi | `POST /api/locks`, `GET /api/locks/{id}`, `DELETE /api/locks/{id}` | `booking:*` |
| Pesanan | `POST /api/bookings`, `GET /api/bookings`, `GET /api/bookings/{id}`, `GET .../refund-preview`, `POST .../cancel` | `booking:*` |
| Pembayaran | `POST /api/payments`, `GET /api/payments/{id}`, `POST /api/mock-gateway/checkout/{token}/pay` | `payment:write` |
| Webhook | `POST /api/payments/webhook` | Tanda tangan HMAC |
| Notifikasi | `GET /api/notifications`, `POST /api/notifications/{id}/read` | Token |
| Operator | `POST /api/trips`, `PATCH /api/trips/{id}`, `GET /api/trips/{id}/manifest`, `POST /api/tickets/checkin` | Scope operator |
| Partner | `GET /api/partner/v1/stations`, `.../schedules`, `.../trips/{id}/availability` | API key atau Client Credentials |
| Admin | `/api/admin/users`, `/api/admin/api-keys`, `/api/admin/audit`, `/api/admin/alerts`, `/api/admin/registry`, `/api/admin/queues`, `/api/admin/booking-stats` | Scope admin |

## Cara autentikasi

**Pengguna: Authorization Code + PKCE**

1. Buat `code_verifier` acak, lalu `code_challenge = BASE64URL(SHA256(code_verifier))`.
2. `GET /oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri=http://localhost:8080/auth/callback&code_challenge=...&code_challenge_method=S256&state=...`
   dengan header `Accept: application/json`. Hasilnya `auth_request`.
3. `POST /oauth/login` berisi `{ auth_request, email, password }`. Hasilnya `code` sekali pakai.
4. `POST /oauth/token` (form) berisi `grant_type=authorization_code, client_id, code, code_verifier, redirect_uri`.
5. Kirim `Authorization: Bearer <access_token>`. Token berlaku 15 menit, perpanjang dengan `grant_type=refresh_token`. Refresh token berotasi, dan pemakaian ulang mencabut seluruh sesi.

Klien `rangkai-postman` juga mendaftarkan `https://oauth.pstmn.io/v1/callback`, jadi tab Authorization bawaan Postman bisa dipakai.

**Partner**: header `X-API-Key: rk_live_...` (dibuat admin), atau Client Credentials dengan `client_id=partner-demo` dan secret dari `.env`.

**Idempotency**: `POST /api/locks`, `POST /api/bookings`, `POST /api/payments` wajib membawa header `Idempotency-Key`.

## Pengujian

Jalankan `test.bat`, lalu pilih menu. Tiap pengujian yang butuh sistem berjalan memakai stack sendiri di port 9080 dengan database baru, sehingga hasilnya bisa diulang dan tidak mengganggu `run.bat`. Hasil tersimpan di folder `reports`.

| Berkas di `bat\` | Isi | Laporan |
|---|---|---|
| `week-08.bat` | Demo keamanan lanjutan | `reports/week-08.md` |
| `week-09.bat` | Demo API Gateway | `reports/week-09.md` |
| `week-10.bat` | Demo discovery, load balancing, failover (instance sungguhan dimatikan) | `reports/week-10.md` |
| `week-11.bat` | Demo message queue, DLQ, konsumen dan broker mati | `reports/week-11.md` |
| `test-junit.bat` | JUnit 5 dan JaCoCo | `services/booking/target/site/jacoco/index.html` |
| `test-node.bat` | Unit test Node | `reports/unit-node.txt` |
| `test-pytest.bat` | PyTest, EP dan BVA lewat API | `reports/pytest.html` |
| `test-postman.bat` | Koleksi Postman lewat Newman | `reports/postman.html` |
| `test-functional.bat` | Ujung ke ujung | `reports/functional-e2e.md` |
| `test-concurrency.bat` | Rebutan kursi lintas instance | `reports/concurrency.md` |
| `test-security.bat` | OWASP API Top 10 dan mTLS | `reports/security.md` |
| `test-load.bat` | Load test k6 | `reports/load-k6-summary.json` |
| `test-all.bat` | Semua di atas | `reports/SUMMARY.md` |

### Mengimpor ke Postman

1. Jalankan `run.bat` sekali. Berkas `postman/Rangkai.local.postman_environment.json` dibuat otomatis berisi secret lokal.
2. Di Postman: **Import**, pilih `postman/Rangkai.postman_collection.json` dan environment tadi.
3. Pilih environment **Rangkai (local)** di pojok kanan atas.
4. Jalankan folder **00 Persiapan** dulu, lalu folder lain per minggu. Atau klik kanan koleksi, **Run collection**.

Environment lokal berisi secret. Bagikan `Rangkai.template.postman_environment.json` kepada penguji, bukan berkas lokal.

## Environment variable

Daftar lengkap ada di [.env.example](.env.example) dan [docs/04-environment-variables.md](docs/04-environment-variables.md). Isinya hanya placeholder.

## Deployment

Panduan ada di [docs/05-deployment.md](docs/05-deployment.md): Render (`render.yaml`) dan Docker Compose (`docker-compose.yml`).

## Struktur

```
services/   gateway, registry, broker, auth, catalog, booking (Java), payment, notification, shared
web/        aplikasi web, termasuk karakter Kiko
postman/    koleksi dan environment Postman
tests/      node (unit), pytest, functional, concurrency, security, load, weeks (demo per minggu)
docs/       openapi.yaml, schema.graphql, keamanan, arsitektur, test plan, progres, draf laporan
bat/        file bat per pengujian
```
