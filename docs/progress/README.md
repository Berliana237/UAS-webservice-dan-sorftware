# Progres Minggu 8 sampai 11

Panduan singkat untuk presentasi ke dosen. Tiap minggu punya tiga bukti: demo otomatis (`bat\`), folder Postman, dan laporan di `reports/`.

| Minggu | Materi | Demo | Folder Postman | Laporan |
|---|---|---|---|---|
| 8 | Keamanan lanjutan | `bat\week-08.bat` | Minggu 8 - Keamanan Lanjutan | `reports/week-08.md` |
| 9 | API Gateway dan reverse proxy | `bat\week-09.bat` | Minggu 9 - API Gateway dan Reverse Proxy | `reports/week-09.md` |
| 10 | Service discovery, load balancing | `bat\week-10.bat` | Minggu 10 - Service Discovery dan Load Balancing | `reports/week-10.md` |
| 11 | Message queue | `bat\week-11.bat` | Minggu 11 - Message Queue | `reports/week-11.md` |

Hasil eksekusi terakhir: [hasil-pengujian.md](hasil-pengujian.md).

---

## Minggu 8: Keamanan Lanjutan

**Target:** mulai implementasi OAuth2/API key/mTLS. Tugas: rancangan keamanan dan satu paragraf protokol non-REST.

**Yang dikerjakan**

- Authorization Server sendiri: Authorization Code + PKCE, JWT RS256 15 menit, refresh token berotasi dengan deteksi pemakaian ulang, JWKS.
- Client Credentials untuk payment ke booking dan untuk partner.
- API key: hash, tampil sekali, scope, kuota, masa berlaku, rotasi, pencabutan.
- mTLS seluruh komunikasi internal, sertifikat per service, pembatasan per endpoint menurut CN.
- RBAC tiga peran dan pengecekan kepemilikan dua lapis.
- Rancangan keamanan: [01-rancangan-keamanan.md](../01-rancangan-keamanan.md). Revisi Word ada di `web service week 8 (revisi GraphQL).docx`.
- Tugas Software Testing sesi 8: `services/booking/src/test`, jalankan `bat\test-junit.bat`.

**Yang ditunjukkan ke dosen**

1. Jalankan `bat\week-08.bat`.
2. Di Postman, jalankan folder "Minggu 8". Tunjukkan "Token dengan code_verifier salah ditolak" dan "Seluruh keluarga token dicabut".
3. Jalankan `bat\test-security.bat`, tunjukkan bagian mTLS: tanpa sertifikat, sertifikat CA lain, sertifikat sah tetapi tidak berhak.
4. Di web: masuk sebagai admin, Konsol, tab API key. Tunjukkan key yang hanya tampil sekali.

---

## Minggu 9: API Gateway dan Reverse Proxy

**Yang dikerjakan**

- Gateway Node buatan sendiri sebagai satu pintu masuk. Tabel rute di `services/gateway/routes.js`.
- Reverse proxy ke 6 service dan aplikasi web, termasuk streaming SSE.
- Validasi token dan scope, validasi skema dengan Ajv, CORS terbatas, header keamanan, batas body.
- Rate limit token bucket per IP, pengguna, atau API key, dengan `Retry-After`.
- Pemantau pola mencurigakan yang menerbitkan peringatan keamanan.
- Swagger UI di `/docs`.

**Yang ditunjukkan ke dosen**

1. Jalankan `bat\week-09.bat`.
2. Di Postman, jalankan folder "Minggu 9". Tunjukkan header `X-Upstream-Instance`, `X-Request-Id`, dan `X-RateLimit-Remaining`.
3. Tunjukkan bahwa service tidak bisa dipanggil langsung: `https://localhost:8772/health` gagal di browser karena tidak punya sertifikat.
4. Buka `/docs`.

---

## Minggu 10: Service Discovery dan Load Balancing

**Yang dikerjakan**

- Registry berbasis heartbeat, TTL 12 detik, identitas dicocokkan dengan sertifikat.
- Dua instance booking-service berbagi satu database.
- Round robin di gateway, melewati instance yang gagal, mencoba ulang ke instance lain.
- Instance yang hidup lagi otomatis masuk kembali.

**Yang ditunjukkan ke dosen**

1. Jalankan `bat\week-10.bat`. Skrip ini **sungguh-sungguh mematikan** booking-a, memastikan permintaan tetap dilayani, menunggu registry mengeluarkannya, lalu menyalakannya lagi.
2. Di Postman, jalankan folder "Minggu 10". Buka Console, tunjukkan pembagian beban.
3. Di web: masuk sebagai admin, Konsol, tab Sistem. Tunjukkan daftar instance.
4. Jalankan `bat\test-concurrency.bat`, tunjukkan K-01c: permintaan dilayani dua instance, tetap satu pemenang.

---

## Minggu 11: Message Queue

**Yang dikerjakan**

- Broker durable: routing topik, lease, ack/nack, retry dengan backoff, DLQ, deduplikasi.
- Transactional outbox di booking-service.
- Konsumen idempotent di booking, payment, dan notification.
- Alur asinkron: webhook, `payment.succeeded`, tiket terbit, `booking.confirmed`, notifikasi. Pembatalan: `booking.cancelled`, `payment.refunded`.
- Audit log dan peringatan keamanan lewat antrian.

**Yang ditunjukkan ke dosen**

1. Jalankan `bat\week-11.bat`. Skrip ini mematikan notification-service dan membuktikan pesan menumpuk lalu habis saat hidup kembali. Lalu mematikan broker dan membuktikan event aman di outbox.
2. Di Postman, jalankan folder "Minggu 11": pesan beracun masuk DLQ, lalu dikirim ulang.
3. Di web: Konsol, tab Sistem. Tekan "Kirim pesan beracun" dan perhatikan kolom DLQ. Tekan "Kirim ulang".

---

## Software Testing, minggu 8 sampai 11

| Minggu | Target | Bukti |
|---|---|---|
| 8 | Unit test JUnit, kick-off proyek | `services/booking/src/test`, `bat\test-junit.bat` |
| 9 | Teori test plan dan test case | Kerangka di `docs/testing/` |
| 10 | Menyusun rancangan test plan | [test-plan.md](../testing/test-plan.md), [test-cases.md](../testing/test-cases.md) |
| 11 | Finalisasi test plan, menyiapkan tool | Postman, Newman, k6, PyTest, skrip keamanan, semua lewat `test.bat` |

Catatan: test plan yang dinilai untuk mata kuliah Software Testing ditujukan ke sistem kelompok lain menurut rotasi. Lihat bagian "Hal yang perlu Anda perhatikan" di [00-checklist-ketentuan.md](../00-checklist-ketentuan.md).
