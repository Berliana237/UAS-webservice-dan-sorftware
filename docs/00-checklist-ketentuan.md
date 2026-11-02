# Checklist Ketentuan Soal

Pemetaan setiap ketentuan di soal Web Service dan Software Testing ke bukti di proyek ini.
Status: **Selesai** = ada dan sudah diuji di mesin ini. **Perlu tindakan Anda** = hanya bisa dilakukan oleh kelompok.

## Syarat arsitektur minimal

| Ketentuan | Status | Bukti |
|---|---|---|
| 2 service terpisah atau lebih | Selesai | 8 service, 9 proses. Lihat `services/` |
| 1 mekanisme komunikasi asinkron | Selesai | `services/broker`, outbox di `OutboxEvents.java`, uji `tests/weeks/week11.js` |
| 1 keamanan lanjutan (OAuth2/API key/mTLS) | Selesai | Ketiganya: `services/auth`, `services/shared/mtls.js`, `tests/security/run.js` |
| 1 protokol selain REST (GraphQL/gRPC) | Selesai | GraphQL: `services/catalog/schema.graphql` |
| Justifikasi pilihan protokol (konsumen, variasi data, performa, legacy) | Selesai | `docs/02-justifikasi-protokol.md` |

## Kebutuhan topik A (reservasi kereta)

| Ketentuan | Status | Bukti |
|---|---|---|
| Ketersediaan kursi real-time | Selesai | SSE `GET /api/trips/{id}/seats/stream`, lintas instance lewat `SeatEventHub.java` |
| Locking saat booking bersamaan | Selesai | `SeatLockService.java`, `tests/concurrency/run.js` |
| Kursi per gerbong dan nomor kursi | Selesai | `services/catalog/seed.js` (COACHES), peta kursi di web |
| Satu kursi untuk beberapa segmen rute | Selesai | PRIMARY KEY `seat_claims(trip, kursi, segmen)`, uji K-03 dan F-09 |
| Seat locking per segmen | Selesai | `SegmentRange.java`, uji `SeatLockServiceTest`, `SqliteSeatStoreIntegrationTest` |

## Rancangan keamanan (dokumen minggu 8)

| Rancangan | Status | Bukti |
|---|---|---|
| OAuth2 Authorization Code + PKCE | Selesai | `services/auth/index.js` |
| JWT berumur pendek sekitar 15 menit | Selesai | `ACCESS_TOKEN_TTL_SECONDS=900`, uji W8-03 |
| Refresh token dengan rotasi | Selesai | Uji S-14, S-15 |
| RBAC scope customer, operator, admin | Selesai | `services/auth/rules.js` |
| Pengecekan kepemilikan di server (IDOR) | Selesai | Uji S-01 sampai S-05 |
| Gateway: validasi token, rate limit per user/IP, validasi skema, CORS terbatas | Selesai | `services/gateway`, `tests/weeks/week09.js` |
| mTLS antar service, sertifikat per service | Selesai | `scripts/gen-certs.js`, uji S-43 sampai S-49 |
| Lock per segmen TTL sekitar 10 menit | Selesai | `LOCK_TTL_SECONDS=600`, sweeper di `Workers.java` |
| Idempotency key booking dan pembayaran | Selesai | Uji F-11, F-12, K-05, K-08a |
| Enkripsi kolom sensitif (nama, NIK, kontak) | Selesai | `FieldCrypto.java`, `services/shared/pii.js`, uji S-51 |
| TLS 1.2+ saat transit | Selesai | Gateway port 8443 dan mTLS internal `minVersion: TLSv1.2` |
| Masking data pada log | Selesai | `services/shared/log.js`, `Masking.java`, uji S-50 |
| Verifikasi tanda tangan webhook | Selesai | `services/payment/signature.js`, uji S-29 sampai S-31 |
| Tidak menyimpan data kartu (tokenisasi) | Selesai | Uji S-33 |
| Secret di environment | Selesai | `.env` dibuat `scripts/setup.js`, `.gitignore` |
| Hak akses minimum database per service | Selesai | Tiap service punya file database sendiri |
| Prepared statement | Selesai | Semua query, uji S-42 |
| Audit log tanpa token/password, alert pola mencurigakan | Selesai | `services/notification`, uji S-52 sampai S-54 |
| Header keamanan (HSTS dan lainnya) | Selesai | `services/gateway/index.js`, uji S-34 sampai S-38. HSTS aktif di HTTPS |
| Pemindaian dependensi | Sebagian | Jalankan `npm audit` dan lihat catatan di `docs/01-rancangan-keamanan.md` |

## Timeline Web Service minggu 8-11

| Minggu | Materi | Status | Demo |
|---|---|---|---|
| 8 | Keamanan lanjutan | Selesai | `bat\week-08.bat`, folder Postman "Minggu 8" |
| 9 | API Gateway dan reverse proxy | Selesai | `bat\week-09.bat`, folder Postman "Minggu 9" |
| 10 | Service discovery, load balancing | Selesai | `bat\week-10.bat`, folder Postman "Minggu 10" |
| 11 | Message queue | Selesai | `bat\week-11.bat`, folder Postman "Minggu 11" |

## Dokumentasi wajib saat code freeze (minggu 12)

| Ketentuan | Status | Bukti |
|---|---|---|
| Spesifikasi OpenAPI lengkap | Selesai | `docs/openapi.yaml`, tampil di `/docs` |
| Skema GraphQL dengan contoh query/mutation | Selesai | `docs/schema.graphql`, `docs/graphql-examples.md` |
| README: cara akses, daftar endpoint, cara autentikasi | Selesai | `README.md` |
| Daftar environment variable dengan placeholder | Selesai | `.env.example`, `docs/04-environment-variables.md` |
| URL deployment stabil (Render/Vercel/Cloudflare) | **Perlu tindakan Anda** | Berkas siap (`render.yaml`, `Dockerfile`), tetapi deploy butuh akun kelompok. Lihat `docs/05-deployment.md` |

## Software Testing

| Ketentuan | Status | Bukti |
|---|---|---|
| Tugas sesi 8: class Java minimal 3 method bersyarat | Selesai | `FareCalculator`, `NikValidator`, `RefundPolicy`, `LockPolicy`, `BookingStatus`, `PassengerType` |
| Minimal 8 test | Selesai | Lebih dari 90 test JUnit |
| Minimal 1 `@ParameterizedTest` berdasar BVA | Selesai | Banyak, lihat `DomainRulesTest.java` |
| Minimal 2 `assertThrows` skenario negatif | Selesai | `DomainRulesTest.java`, `SeatLockServiceTest.java` |
| `@BeforeEach` dan `@DisplayName` | Selesai | `SeatLockServiceTest.java` |
| Bukti eksekusi `mvn test` | Selesai sebagian | Jalankan `bat\test-junit.bat`, tangkapan layarnya kelompok yang ambil |
| Prinsip FIRST | Selesai | Unit test tanpa database memakai `InMemorySeatStore` |
| Unit test JUnit untuk logika bisnis service (dianjurkan) | Selesai | `services/booking/src/test` |
| Test plan: fungsional, performa, keamanan | Selesai | `docs/testing/test-plan.md` |
| Test case design: edge case dan skenario negatif | Selesai | `docs/testing/test-cases.md` |
| Eksekusi: load test, uji keamanan dasar | Selesai | `bat\test-load.bat`, `bat\test-security.bat` |
| Bug report: reproduksi, severity, saran | Selesai | `docs/testing/bug-report.md`, berisi bug asli yang ditemukan |
| Retest dan verifikasi | Selesai | Bagian retest di `docs/testing/bug-report.md` |
| Catatan tooling untuk penguji | Selesai | README dan koleksi Postman |

## Laporan gabungan

| Ketentuan | Status | Bukti |
|---|---|---|
| Struktur jurnal dengan label penulis | Selesai sebagai draf | `docs/laporan-gabungan-draft.md`. Bagian kelompok penguji dikosongkan untuk Kelompok B |
| Tabel komponen, mekanisme, alasan | Selesai | `docs/01-rancangan-keamanan.md` |
| Laporan desain individual saat UAS | **Perlu tindakan Anda** | Tiap anggota menulis sendiri, bahan ada di `docs/` |

## Hal yang perlu Anda perhatikan

1. **Dokumen minggu 8 Anda memilih REST, padahal soal mewajibkan protokol selain REST.** Tugasnya meminta "paragraf pilihan protokol non-REST (GraphQL atau gRPC)". Revisinya ada di `web service week 8 (revisi GraphQL).docx`. Berkas asli tidak diubah.
2. **Rotasi penguji.** Menurut tabel soal, sistem Kelompok A diuji Kelompok B, dan Kelompok A menguji sistem Kelompok E. Pengujian di sini adalah pengujian internal pembangun, sekaligus bahan untuk Kelompok B. Test plan yang dinilai untuk mata kuliah Software Testing Anda seharusnya mengenai sistem Kelompok E, dan `docs/testing/` bisa dipakai sebagai templatnya. Tanyakan ke dosen bila kelompok Anda bukan A.
3. **Tabel timeline Software Testing** di PDF sesi 8 tersusun rapat, baca dengan teliti. Versi di PDF Web Service lebih jelas: test plan disusun minggu 10, difinalkan minggu 11, akses sistem diterima minggu 12.
