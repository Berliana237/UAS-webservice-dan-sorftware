# Rancangan Keamanan dan Implementasinya

Lanjutan dari dokumen minggu 8. Empat risiko utama: pengambilalihan akun atau akses data pengguna lain, penyalahgunaan kursi, pemalsuan pembayaran, dan kebocoran data pribadi.

## Komponen, mekanisme, alasan

| Komponen | Mekanisme keamanan | Alasan | Implementasi |
|---|---|---|---|
| Autentikasi pengguna | OAuth2 Authorization Code + PKCE, JWT RS256 15 menit, refresh token berotasi dengan deteksi pemakaian ulang | Kredensial tidak dikelola tiap service, token pendek membatasi dampak bocor | `services/auth/index.js` |
| Otorisasi | RBAC scope customer, operator, admin. Kepemilikan dicek di service | Mencegah IDOR dan eskalasi hak | `services/auth/rules.js`, `BookingService.owned()` |
| API Gateway | Validasi token dan scope, rate limit per user/IP/key, validasi skema, CORS terbatas | Satu titik kontrol, melindungi dari brute force dan scraping | `services/gateway` |
| Antar service | mTLS sertifikat per service, Client Credentials untuk panggilan sensitif | Hanya service terdaftar yang bisa saling memanggil | `services/shared/mtls.js`, `Mtls.java` |
| Partner | API key: hash SHA-256, tampil sekali, scope, kuota, masa berlaku, rotasi, pencabutan | Mengidentifikasi aplikasi, bukan pengguna | `services/auth/store.js` |
| Seat locking | Klaim per segmen dengan TTL 10 menit, atomik, Idempotency-Key | Mencegah double booking dan transaksi ganda | `SeatLockService.java` |
| Data pribadi | AES-256-GCM untuk nama, NIK, kontak, email. Blind index HMAC untuk mencari email. Masking di log | Data identitas wajib dilindungi | `FieldCrypto.java`, `services/shared/pii.js` |
| Pembayaran | Tanda tangan webhook HMAC-SHA256 + timestamp, nominal dicocokkan ulang, nomor kartu ditolak | Mencegah webhook palsu dan manipulasi nominal | `services/payment` |
| Database | Satu file per service, prepared statement | Mencegah SQL injection dan membatasi dampak | Semua service |
| Logging | Audit log lewat antrian tanpa token/password, peringatan pola mencurigakan | Investigasi insiden | `services/notification` |
| Konfigurasi | Secret di environment, `.env` tidak masuk repository, header keamanan | Mengurangi kerentanan umum | `.gitignore`, gateway |

## Empat mekanisme, empat pertanyaan

| Mekanisme | Pertanyaan yang dijawab | Dipakai di |
|---|---|---|
| JWT | Siapa pengguna ini, tanpa query database tiap request? | Semua request pengguna, diverifikasi gateway lalu diverifikasi lagi oleh service |
| OAuth2 | Apakah aplikasi ini boleh bertindak atas nama pengguna? | Login web dan Postman (PKCE), payment ke booking dan partner (Client Credentials) |
| API key | Aplikasi mana yang memanggil, berapa kuotanya? | Rute `/api/partner/v1/*` |
| mTLS | Apakah kedua ujung koneksi benar-benar dipercaya? | Seluruh komunikasi internal |

## Alur penting

**Dua lapis otorisasi.** Gateway memeriksa tanda tangan, masa berlaku, dan scope. Service tujuan memverifikasi JWT lagi dan memeriksa kepemilikan data. Pesanan milik orang lain dijawab 404, bukan 403, supaya keberadaannya tidak bocor.

**Seat locking.** Tabel `seat_claims` memakai PRIMARY KEY `(trip_id, seat_id, segment_idx)`. Lock menulis satu baris per kursi per segmen dalam satu transaksi `BEGIN IMMEDIATE`. Karena dijaga database, bukan lock di memori, jaminan tetap benar walau booking-service berjalan di beberapa instance. Kursi yang lewat TTL dianggap kosong dan langsung bisa diambil, walau sweeper belum sempat membersihkan.

**Pembayaran.** Klien tidak pernah bisa menyatakan "sudah bayar". Status datang dari webhook bertanda tangan, diteruskan sebagai event ke booking-service, yang memeriksa nominal dan memastikan kursi masih dipegang. Bila pembayaran datang setelah TTL, tiket tidak terbit dan dana dikembalikan otomatis.

**Transactional outbox.** Event ditulis dalam transaksi yang sama dengan perubahan data, lalu dikirim oleh relay. Broker mati tidak membuat event hilang (uji W11-11 sampai W11-14).

## Batasan yang disadari

- **API key di-cache gateway 3 detik**, jadi pencabutan berlaku paling lambat 3 detik kemudian. Ini pertukaran sengaja antara beban ke auth-service dan kecepatan pencabutan.
- **CA internal dibuat lokal** oleh `scripts/gen-certs.js`. Di produksi, gunakan CA terkelola dan rotasi sertifikat otomatis.
- **Rate limit disimpan di memori gateway**, jadi tidak berbagi kuota bila gateway dijalankan lebih dari satu instance. Untuk itu perlu penyimpanan bersama seperti Redis.
- **Pemindaian dependensi** dijalankan manual: `npm audit` untuk Node, dan `mvn org.owasp:dependency-check-maven:check` untuk Java.
- **Render dan Vercel mengakhiri TLS di platform**, sehingga pada deployment satu container, mTLS hanya melintasi localhost di dalam container. Demonstrasi lintas jaringan memakai `docker-compose.yml`, sesuai catatan di materi sesi 8.
