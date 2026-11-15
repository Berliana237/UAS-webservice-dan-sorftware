# Pembagian Tugas Kelompok A

Proyek lintas mata kuliah Web Service x Software Testing. Menurut rotasi pada soal, sistem Kelompok A (Rangkai, topik reservasi tiket transportasi) **diuji Kelompok B**, dan Kelompok A **menguji sistem Kelompok E** (platform crowdfunding/donasi). Tidak ada kelompok yang menguji sistemnya sendiri.

## Anggota dan porsi kontribusi

| NIM | Nama | Web Service | Software Testing |
|---|---|---|---|
| 5803024004 | Jap Robertus Kurniawan Setiabudi | **25%** | 20% |
| 5803024005 | Daniel | **24%** | 20% |
| 5803024015 | Berliana Az Zahra Tristianti | 21% | **24%** |
| 5803024003 | Calvin Liu Victory | 15% | 20% |
| 5803024016 | Evander Doxa Widiyanto | 15% | 16% |
| | **Total** | **100%** | **100%** |

## Web Service (kelompok pembangun)

Pembagian mengikuti rubrik: arsitektur & desain (20%), justifikasi protokol (10%), implementasi teknis (25%), keamanan (15%), dokumentasi API (15%), respons terhadap bug report (15%).

| Anggota | Tanggung jawab | Komponen rubrik |
|---|---|---|
| **Jap Robertus** (25%) | Ketua teknis. Rancangan arsitektur microservices dan diagram. booking-service Java (seat locking per segmen, `BEGIN IMMEDIATE`, TTL lock, outbox, SSE kursi). API Gateway (routing, validasi skema, rate limit, load balancing booking-a/booking-b). Integrasi seluruh service, deployment Railway dan volume data. Koordinator respons bug report dari Kelompok B | Arsitektur, implementasi, respons bug |
| **Daniel** (24%) | auth-service: OAuth2 Authorization Code + PKCE, JWT RS256, refresh token berotasi, Client Credentials, API key partner. mTLS antar service dan pembuatan sertifikat. Message broker (topik, lease, retry, DLQ) dan service registry (heartbeat, discovery). Rancangan keamanan (`01-rancangan-keamanan.md`) | Keamanan, implementasi |
| **Berliana** (21%) | catalog-service dan GraphQL (skema, resolver, batas kedalaman/kompleksitas query). `schema.graphql` dan `graphql-examples.md`. Justifikasi pilihan protokol (`02-justifikasi-protokol.md`) dan bagian 4.3 laporan | Justifikasi protokol, dokumentasi |
| **Calvin** (15%) | payment-service: QRIS simulasi, webhook bertanda tangan HMAC, unggah bukti transfer, refund. notification-service: konsumen event, notifikasi, audit log. Unit test JUnit untuk aturan tarif dan refund | Implementasi, keamanan |
| **Evander** (15%) | Aplikasi web (SPA) dan support-service (FAQ + chat AI). Spesifikasi OpenAPI dan Swagger UI, README, daftar environment variable, koleksi Postman beserta environment template untuk penguji | Dokumentasi API |

## Software Testing (kelompok penguji, menguji sistem Kelompok E)

Pembagian mengikuti rubrik: test plan (20%), test case design (25%), eksekusi pengujian (25%), kualitas bug report (20%), retest & verifikasi (10%). Pengujian internal sistem Rangkai sendiri (folder `tests/`, `docs/testing/`) dikerjakan dengan pembagian yang sama.

| Anggota | Tanggung jawab | Komponen rubrik |
|---|---|---|
| **Berliana** (24%) | Koordinator pengujian. Menyusun test plan (ruang lingkup, strategi fungsional/performa/keamanan, jadwal, kriteria masuk-keluar, risiko). Test case design EP, BVA, decision table, state transition. Penanggung jawab bab 5 laporan dan komunikasi dengan Kelompok E | Test plan, test case design |
| **Calvin** (20%) | Pengujian keamanan (OWASP API Top 10: autentikasi, otorisasi BOLA/BFLA, rate limit, injeksi). Penulisan bug report (langkah reproduksi, bukti, severity, prioritas, saran perbaikan) | Eksekusi, bug report |
| **Jap Robertus** (20%) | Pengujian performa dan beban (k6), skenario konkurensi. Penyiapan tooling (Postman/Newman, k6) dan otomasi | Eksekusi pengujian |
| **Daniel** (20%) | Pengujian fungsional API lewat Postman/Newman dan PyTest (jalur sukses dan negatif). Retest dan verifikasi perbaikan dari Kelompok E | Eksekusi, retest |
| **Evander** (16%) | Pengujian fungsional ujung ke ujung dari sisi antarmuka. Pengumpulan bukti (tangkapan layar, log), rekap hasil, dan bagian 6.2 laporan | Eksekusi, laporan |

## Timeline minggu 8 sampai UAS

| Minggu | Web Service (membangun Rangkai) | Software Testing (menguji Kelompok E) |
|---|---|---|
| 8 | Keamanan lanjutan: OAuth2 + PKCE, JWT, API key, mTLS (Daniel, Robertus). Rancangan keamanan awal | Teori strategi pengujian. Berliana memulai rancangan test plan, semua anggota mempelajari topik Kelompok E |
| 9 | API Gateway & reverse proxy: routing, validasi skema, rate limit, CORS (Robertus, Evander) | Teori test plan & test case design. Berliana dan Calvin menyusun draf test case (EP, BVA) |
| 10 | Service discovery dan load balancing booking-a/booking-b (Robertus, Daniel). GraphQL catalog (Berliana) | Test plan dirancang lengkap (Berliana), pembagian skenario fungsional/performa/keamanan |
| 11 | Message queue: broker, outbox, DLQ, konsumen notifikasi dan payment (Daniel, Calvin) | Finalisasi test plan, penyiapan tools Postman, PyTest, k6 (Robertus, Daniel) |
| 12 | **Code freeze**: OpenAPI, skema GraphQL, README, daftar env, deploy stabil di Railway (Robertus, Evander, Berliana) | Menerima akses sistem Kelompok E, smoke test, verifikasi dokumentasi (semua) |
| 13 | Standby menerima bug report awal dari Kelompok B, triase severity (Robertus) | Eksekusi pengujian fungsional (Daniel, Evander), performa (Robertus), keamanan (Calvin). Bug report dikirim (Calvin) |
| 14 | Perbaikan bug sesuai laporan Kelompok B (penanggung jawab sesuai komponen), catatan respons di laporan | Retest dan verifikasi perbaikan (Daniel), finalisasi bug report (Calvin, Berliana) |
| 15 | Finalisasi laporan bagian pembangun (bab 4 dan 6.1), persiapan demo | Finalisasi laporan pengujian (bab 5 dan 6.2), bahan presentasi (Berliana, Evander) |
| UAS | Demo sistem dan laporan desain individual (semua anggota) | Presentasi hasil pengujian dan temuan (semua anggota) |

## Pembagian bab laporan gabungan

| Bab | Penulis |
|---|---|
| 1-3 Abstrak, Pendahuluan, Tinjauan Pustaka | Evander, Calvin |
| 4.1 Arsitektur, 4.2 Teknologi | Jap Robertus |
| 4.3 Justifikasi Protokol | Berliana |
| 4.4 Implementasi Keamanan | Daniel |
| 6.1 Hasil Implementasi | Jap Robertus, Daniel |
| 6.3 Pembahasan Bersama (temuan Kelompok B dan respons kami) | Jap Robertus |
| 5 dan 6.2 untuk sistem Kelompok E | Berliana (koordinator), Calvin, Daniel, Evander, Jap Robertus |
| 7-8 Kesimpulan, Daftar Pustaka | Daniel, Berliana |
