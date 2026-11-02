# Test Plan Rangkai

Disusun mengikuti struktur IEEE 829 yang disederhanakan. Dokumen ini menjadi pengujian internal pembangun dan bahan bagi Kelompok B sebagai penguji independen.

## 1. Tujuan

Memastikan sistem reservasi memenuhi kebutuhan fungsional, tahan terhadap booking bersamaan, memenuhi target performa, dan aman menurut OWASP API Security Top 10.

## 2. Ruang lingkup

**Termasuk:** autentikasi dan otorisasi, jadwal REST dan GraphQL, seat locking per segmen, pesanan, pembayaran lewat webhook, pembatalan dan refund, check-in, gateway, discovery, load balancing, message queue, antarmuka web.

**Tidak termasuk:** integrasi payment gateway sungguhan, performa pada platform hosting, kompatibilitas browser lama.

## 3. Risiko dan prioritas

| Risiko | Dampak | Kemungkinan | Prioritas | Mitigasi uji |
|---|---|---|---|---|
| Double booking pada segmen yang sama | Tinggi | Sedang | **P1** | Uji konkurensi, JUnit |
| Pesanan orang lain bisa diakses (IDOR) | Tinggi | Sedang | **P1** | Uji keamanan API1 |
| Pembayaran palsu menerbitkan tiket | Tinggi | Rendah | **P1** | Uji webhook dan nominal |
| Event hilang saat broker mati | Tinggi | Rendah | **P1** | Demo minggu 11 |
| Kebocoran NIK | Tinggi | Rendah | **P1** | Uji log dan database |
| Kursi tertahan selamanya | Sedang | Rendah | P2 | Uji TTL dan sweeper |
| Instance mati menjatuhkan layanan | Sedang | Sedang | P2 | Demo failover minggu 10 |
| Lambat saat penjualan dibuka | Sedang | Sedang | P2 | Load test |
| Pengguna bingung saat kursi diambil orang | Rendah | Sedang | P3 | Uji manual UI |

## 4. Strategi dan level pengujian

| Level | Tujuan | Tool | Berkas | Lokasi |
|---|---|---|---|---|
| Unit | Logika bisnis Java | JUnit 5, JaCoCo | `bat\test-junit.bat` | `services/booking/src/test` |
| Unit | Logika murni Node | node:test | `bat\test-node.bat` | `tests/node` |
| Integrasi | Seat locking di SQLite lintas koneksi | JUnit 5 | `bat\test-junit.bat` | `SqliteSeatStoreIntegrationTest` |
| API | EP dan BVA | PyTest | `bat\test-pytest.bat` | `tests/pytest` |
| API | Semua endpoint | Postman, Newman | `bat\test-postman.bat` | `postman/` |
| Sistem | Alur ujung ke ujung | Skrip Node | `bat\test-functional.bat` | `tests/functional` |
| Konkurensi | Rebutan kursi | Skrip Node | `bat\test-concurrency.bat` | `tests/concurrency` |
| Performa | Beban dan rebutan | k6 | `bat\test-load.bat` | `tests/load` |
| Keamanan | OWASP API Top 10, mTLS | Skrip Node. Disarankan: OWASP ZAP | `bat\test-security.bat` | `tests/security` |
| Ketahanan | Instance dan broker mati | Skrip Node | `bat\week-10.bat`, `bat\week-11.bat` | `tests/weeks` |
| Antarmuka | Usability dan aksesibilitas | Manual | Bagian UI di `test-cases.md` | |

**Teknik desain test:** Equivalence Partitioning, Boundary Value Analysis, decision table, state transition, dan error guessing.

## 5. Kriteria masuk dan keluar

**Masuk:** `run.bat` menyala, `/healthz` 200, data seed tersedia.

**Keluar:**

- Semua test P1 lulus
- Tidak ada bug severity Critical atau High yang terbuka
- Tidak ada pelanggaran invarian kursi pada uji konkurensi
- Target performa terpenuhi

## 6. Target performa

| Metrik | Target |
|---|---|
| p95 peta kursi GraphQL | di bawah 800 ms |
| p95 lock kursi | di bawah 1000 ms |
| Error 5xx | di bawah 1% |
| Double booking | 0 |

Beban: 30 pembaca tetap, 25 lock per detik, dan 8 pengguna alur lengkap selama 45 detik. Target ini berlaku untuk laptop pengembangan, bukan kapasitas produksi.

## 7. Lingkungan

Windows 11, Node.js 24, Java 21, SQLite, stack pengujian di port 9080 dengan database baru (`data-test`). Rate limit pengujian dinaikkan agar pengujian beban tidak terhenti, kecuali rate limit login yang tetap diuji.

## 8. Data uji

Akun seed, 60 akun beban, NIK fiktif `3578015203990001`, kursi diacak agar test mandiri.

## 9. Peran dan jadwal

| Minggu | Kegiatan |
|---|---|
| 8-9 | Strategi, teori, kerangka test plan |
| 10 | Menyusun test plan dan test case |
| 11 | Finalisasi, menyiapkan tool |
| 12 | Kelompok penguji menerima akses (code freeze) |
| 13 | Eksekusi fungsional, performa, keamanan |
| 14 | Retest, finalisasi bug report |
| UAS | Presentasi hasil |

## 10. Keterlacakan kebutuhan

| Kebutuhan | Test |
|---|---|
| Lock per segmen | F-07 sampai F-10, K-01 sampai K-03, JUnit `overlapDecidesConflict`, PyTest `test_overlap_decision` |
| Atomisitas banyak kursi | K-04, JUnit `multiSeatLockIsAtomic` |
| TTL 10 menit | F-27 sampai F-29, K-07, JUnit `expiredClaimCanBeTaken` |
| Idempotency | F-11 sampai F-13, K-05, K-08a |
| Harga di server | F-15, PyTest `test_fare_by_age_boundaries` |
| Status pembayaran hanya dari webhook | S-29 sampai S-32, F-18 |
| Pembayaran terlambat dikembalikan | F-30, F-31 |
| Pembatalan dan refund | F-24 sampai F-26, JUnit `percentByTimeLeft` |
| OAuth2 PKCE | W8-01 sampai W8-05, S-12, S-13, S-15 |
| API key | W8-09 sampai W8-14 |
| mTLS | S-43 sampai S-49 |
| Gateway | W9-01 sampai W9-17 |
| Discovery dan load balancing | W10-01 sampai W10-07 |
| Message queue | W11-01 sampai W11-14 |
| Real-time | Uji manual UI U-05 |
