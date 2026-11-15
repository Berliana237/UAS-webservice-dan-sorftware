# Pembagian Tugas Kelompok A

Proyek lintas mata kuliah Web Service x Software Testing. Menurut rotasi pada soal, sistem Kelompok A (Rangkai, topik reservasi tiket transportasi) **diuji Kelompok B**, dan Kelompok A **menguji sistem Kelompok E** (platform crowdfunding/donasi). Tidak ada kelompok yang menguji sistemnya sendiri.

Calvin Liu Victory hanya mengambil mata kuliah Web Service, dan Evander Doxa Widiyanto hanya mengambil mata kuliah Software Testing. Karena itu porsi Web Service dibagi ke empat orang tanpa Evander, dan porsi Software Testing dibagi ke empat orang tanpa Calvin.

## Anggota dan porsi kontribusi

| NRP | Nama | Web Service | Software Testing |
|---|---|---|---|
| 5803024004 | Jap Robertus Kurniawan Setiabudi | 27% | 27% |
| 5803024005 | Daniel | 27% | 27% |
| 5803024015 | Berliana Az Zahra Tristianti | 26% | **28%** |
| 5803024003 | Calvin Liu Victory | 20% | tidak mengambil |
| 5803024016 | Evander Doxa Widiyanto | tidak mengambil | 18% |
| | **Total** | **100%** | **100%** |

## Web Service (kelompok pembangun)

Pembagian mengikuti rubrik: arsitektur & desain (20%), justifikasi protokol (10%), implementasi teknis (25%), keamanan (15%), dokumentasi API (15%), respons terhadap bug report (15%).

| Anggota | Tanggung jawab | Komponen rubrik |
|---|---|---|
| **Jap Robertus** (27%) | Ketua teknis. Rancangan arsitektur microservices dan diagram. booking-service Java: seat locking per segmen (`BEGIN IMMEDIATE`, TTL 10 menit, kursi terkunci saat dipilih lewat `POST`/`PUT /api/locks`), outbox, pembaruan kursi real-time (SSE). API Gateway: routing, validasi skema, rate limit, load balancing booking-a/booking-b. Integrasi seluruh service, deployment Railway dan volume data. Koordinator respons bug report dari Kelompok B | Arsitektur, implementasi, respons bug |
| **Daniel** (27%) | auth-service: OAuth2 Authorization Code + PKCE, JWT RS256, refresh token berotasi, Client Credentials, API key partner. mTLS antar service dan pembuatan sertifikat. Message broker (topik, lease, retry, DLQ), service registry (heartbeat, discovery), dan notification-service (konsumen event, notifikasi, audit log). Rancangan keamanan (`01-rancangan-keamanan.md`) | Keamanan, implementasi |
| **Berliana** (26%) | catalog-service dan GraphQL (skema, resolver, batas kedalaman/kompleksitas query), `schema.graphql` dan `graphql-examples.md`. payment-service: QRIS simulasi, webhook bertanda tangan HMAC, unggah bukti transfer, refund. Justifikasi pilihan protokol (`02-justifikasi-protokol.md`). Spesifikasi OpenAPI dan Swagger UI | Justifikasi protokol, dokumentasi API, implementasi |
| **Calvin** (20%) | Aplikasi web (SPA) termasuk tampilan responsif ponsel/tablet, support-service (FAQ + chat AI). README, daftar environment variable, koleksi Postman beserta environment template untuk penguji | Dokumentasi API, implementasi |

## Software Testing (kelompok penguji, menguji sistem Kelompok E)

Pembagian mengikuti rubrik: test plan (20%), test case design (25%), eksekusi pengujian (25%), kualitas bug report (20%), retest & verifikasi (10%). Pengujian internal sistem Rangkai sendiri (folder `tests/`, `docs/testing/`) dikerjakan dengan pembagian yang sama.

| Anggota | Tanggung jawab | Komponen rubrik |
|---|---|---|
| **Berliana** (28%) | Koordinator pengujian. Menyusun test plan (ruang lingkup, strategi fungsional/performa/keamanan, jadwal, kriteria masuk-keluar, risiko). Test case design: EP, BVA, decision table, state transition. Penanggung jawab bab 5 laporan dan komunikasi dengan Kelompok E | Test plan, test case design |
| **Jap Robertus** (27%) | Pengujian performa dan beban (k6) serta skenario konkurensi. Penyiapan tooling (Postman/Newman, k6) dan otomasi. Pengujian fungsional ujung ke ujung dari sisi antarmuka | Eksekusi pengujian |
| **Daniel** (27%) | Pengujian fungsional API lewat Postman/Newman dan PyTest (jalur sukses dan negatif). Pengujian keamanan (OWASP API Top 10: autentikasi, otorisasi BOLA/BFLA, rate limit, injeksi). Retest dan verifikasi perbaikan dari Kelompok E | Eksekusi, retest & verifikasi |
| **Evander** (18%) | Penulisan bug report (langkah reproduksi, bukti, severity, prioritas, saran perbaikan). Pengumpulan bukti pengujian (tangkapan layar, log), rekap hasil, dan bagian 6.2 laporan | Kualitas bug report |

## Timeline minggu 8 sampai UAS

| Minggu | Web Service (membangun Rangkai) | Software Testing (menguji Kelompok E) |
|---|---|---|
| 8 | Keamanan lanjutan: OAuth2 + PKCE, JWT, API key, mTLS (Daniel, Robertus). Rancangan keamanan awal | Teori strategi pengujian. Berliana memulai rancangan test plan, semua penguji mempelajari topik Kelompok E |
| 9 | API Gateway & reverse proxy: routing, validasi skema, rate limit, CORS (Robertus). Kerangka aplikasi web (Calvin) | Teori test plan & test case design. Berliana dan Daniel menyusun draf test case (EP, BVA) |
| 10 | Service discovery dan load balancing booking-a/booking-b (Robertus, Daniel). GraphQL catalog (Berliana) | Test plan dirancang lengkap (Berliana), pembagian skenario fungsional/performa/keamanan |
| 11 | Message queue: broker, outbox, DLQ, konsumen notifikasi (Daniel). Konsumen payment (Berliana) | Finalisasi test plan, penyiapan tools Postman, PyTest, k6 (Robertus, Daniel). Templat bug report (Evander) |
| 12 | **Code freeze**: OpenAPI dan Swagger, skema GraphQL (Berliana), README dan daftar env (Calvin), deploy stabil di Railway (Robertus) | Menerima akses sistem Kelompok E, smoke test, verifikasi dokumentasi (semua penguji) |
| 13 | Standby menerima bug report awal dari Kelompok B, triase severity (Robertus) | Eksekusi pengujian fungsional dan keamanan (Daniel), performa dan ujung ke ujung (Robertus). Bug report dikirim (Evander) |
| 14 | Perbaikan bug sesuai laporan Kelompok B (penanggung jawab sesuai komponen), catatan respons di laporan | Retest dan verifikasi perbaikan (Daniel), finalisasi bug report (Evander, Berliana) |
| 15 | Finalisasi laporan bagian pembangun (bab 4 dan 6.1), persiapan demo | Finalisasi laporan pengujian (bab 5 dan 6.2), bahan presentasi (Berliana, Evander) |
| UAS | Demo sistem dan laporan desain individual (Robertus, Daniel, Berliana, Calvin) | Presentasi hasil pengujian dan temuan (Berliana, Robertus, Daniel, Evander) |

## Pembagian bab laporan gabungan

| Bab | Penulis |
|---|---|
| 1-3 Abstrak, Pendahuluan, Tinjauan Pustaka | Calvin (sisi sistem), Evander (sisi pengujian) |
| 4.1 Arsitektur, 4.2 Teknologi | Jap Robertus |
| 4.3 Justifikasi Protokol | Berliana |
| 4.4 Implementasi Keamanan | Daniel |
| 6.1 Hasil Implementasi | Jap Robertus, Calvin |
| 6.3 Pembahasan Bersama (temuan Kelompok B dan respons kami) | Jap Robertus, Daniel |
| 5 dan 6.2 untuk sistem Kelompok E | Berliana (koordinator), Jap Robertus, Daniel, Evander |
| 7-8 Kesimpulan, Daftar Pustaka | Daniel, Berliana |
