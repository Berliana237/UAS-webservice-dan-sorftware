# Kredensial Uji Khusus Kelompok Penguji

Akun dan API key di bawah ini **khusus untuk Kelompok B (penguji)**, terpisah dari akun yang dipakai Kelompok A (pembangun).
Semua data yang dibuat dengan akun ini bisa dikembalikan ke kondisi awal (lihat `DATA-UJI-DAN-RESET.md`).

URL lingkungan uji (dipakai untuk pengujian): **https://rangkai-production.up.railway.app**
URL lokal (`run.bat`): **http://localhost:8080**. Akun dan kata sandi sama, karena `run.bat` mengisi `TESTER_PASSWORD=PengujiB-Rangkai26` dan `TEST_RESET_ENABLED=1` saat membuat `.env` baru. Bila `.env` sudah ada, tambahkan dua baris itu secara manual. API key di bawah hanya berlaku di Railway; di lokal buat sendiri lewat `POST /api/admin/api-keys` dengan akun admin penguji.

## Akun penguji (kata sandi sama untuk keempat akun)

Kata sandi: **`PengujiB-Rangkai26`**

| Peran | Email | Dipakai untuk menguji |
|---|---|---|
| Pelanggan | `pelanggan1@penguji.rangkai` | Cari jadwal, tahan kursi, pesan, bayar, batal, profil, notifikasi |
| Pelanggan | `pelanggan2@penguji.rangkai` | Pelanggan kedua: rebutan kursi, akses data milik orang lain (BOLA) |
| Masinis | `masinis@penguji.rangkai` | Jadwal dinas, manifest, check-in tiket, lapor keterlambatan |
| Admin | `admin@penguji.rangkai` | Data operasional, pengguna, verifikasi transfer, sistem, audit, API key, **reset data uji** |

Akun pelanggan tambahan boleh dibuat sendiri lewat `POST /api/auth/register` atau halaman **Daftar**. Agar ikut terhapus saat reset, **gunakan domain `@penguji.rangkai`**, misalnya `b.uji3@penguji.rangkai`.

## API key penguji (partner)

| Isian | Nilai |
|---|---|
| Nama | Kelompok B - Penguji |
| Header | `X-API-Key` |
| Nilai | `rk_live_98DN5eKsLa7itpV2pRYn_0VJvHtgKI7g1uo-zEPiWVI` |
| Scope | `partner:read` (endpoint `/api/partner/v1/*`) |
| Batas | **600 permintaan per menit** (lebih longgar dari pengguna biasa) |
| Berlaku sampai | 2027-01-15 |

## Client Credentials partner dan secret webhook

`partnerClientSecret` (untuk `client_id=partner-demo`) dan `webhookSecret` (untuk menandatangani webhook pembayaran di koleksi Postman) **tidak ditulis di repositori publik**. Minta langsung ke penanggung jawab teknis Kelompok A lewat grup pasangan A-B. Tanpa keduanya, hanya beberapa request di folder Postman "Client Credentials" dan "webhook" yang gagal; bagian lain tetap berjalan.

## Cara memakai di Swagger dan Postman

- **Swagger** (Railway https://rangkai-production.up.railway.app/docs, lokal http://localhost:8080/docs): klik **Authorize** > bagian OAuth2 `authorizationCode` > Authorize > masuk dengan akun di atas. Untuk API key: bagian `apiKey` > tempel nilai API key.
- **Postman**: import `postman/Rangkai.postman_collection.json` dan `postman/Rangkai.penguji.postman_environment.json` dari folder ini. Environment itu sudah berisi URL Railway dan akun penguji.
- **Skrip**: `node serah-terima/smoke-test.js --password "PengujiB-Rangkai26" --apikey "rk_live_98DN5eKsLa7itpV2pRYn_0VJvHtgKI7g1uo-zEPiWVI"`
