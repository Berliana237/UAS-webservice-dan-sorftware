# Draf Laporan Gabungan: Sistem Reservasi Kereta Antarkota dengan Seat Locking per Segmen

> Draf mengikuti templat di materi sesi 8. Lengkapi nama anggota, daftar pustaka, dan bagian berlabel [kelompok penguji] oleh Kelompok B. Tulis ulang dengan kata sendiri sebelum dikumpulkan.

## 1. Abstrak

Reservasi kereta antarkota menghadapi dua tantangan: kursi yang diperebutkan bersamaan, dan pemanfaatan kursi yang rendah bila satu kursi dianggap terpakai sepanjang rute. Penelitian ini membangun sistem reservasi berbasis microservices yang mengunci kursi per segmen rute, sehingga satu kursi bisa dijual ke beberapa penumpang pada ruas yang tidak tumpang tindih. Sistem terdiri dari delapan service yang berkomunikasi lewat REST, GraphQL, dan message queue, dilindungi OAuth2, API key, dan mTLS. Atomisitas dijamin oleh kunci utama per segmen pada basis data, sehingga tetap benar pada beberapa instance. Pengujian konkurensi menunjukkan tidak ada klaim ganda.

**[Isi hasil akhir dan temuan penguji]**

## 2. Pendahuluan

### 2.1 Latar Belakang [kelompok pembangun]

**[Tulis konteks: reservasi kereta antarkota, ruas perjalanan, kursi kosong pada sebagian rute, lonjakan saat penjualan dibuka.]**

### 2.2 Rumusan Masalah

1. Bagaimana merancang penguncian kursi per segmen yang tetap benar saat booking bersamaan pada beberapa instance?
2. Bagaimana memilih protokol komunikasi untuk konsumen dan variasi data yang berbeda?
3. Bagaimana mengamankan akses pengguna, partner, dan antar service?
4. Seberapa baik sistem memenuhi kebutuhan fungsional, performa, dan keamanan menurut penguji independen?

## 3. Tinjauan Pustaka

**[Lengkapi dengan sitasi: arsitektur web service; REST, GraphQL, gRPC; microservices (Newman, Building Microservices); OAuth 2.0 Security BCP (RFC 9700), PKCE (RFC 7636); transactional outbox; ISTQB untuk pengujian.]**

## 4. Metode Pengembangan [kelompok pembangun]

### 4.1 Arsitektur Sistem

Lihat diagram dan penjelasan di [03-arsitektur.md](03-arsitektur.md).

### 4.2 Teknologi yang Digunakan

Lihat tabel teknologi di [03-arsitektur.md](03-arsitektur.md).

### 4.3 Justifikasi Pilihan Protokol

Lihat [02-justifikasi-protokol.md](02-justifikasi-protokol.md).

### 4.4 Implementasi Keamanan

Lihat [01-rancangan-keamanan.md](01-rancangan-keamanan.md).

## 5. Metode Pengujian [kelompok penguji]

### 5.1 Strategi dan Test Plan

**[Diisi Kelompok B. Rujukan: testing/test-plan.md]**

### 5.2 Test Case Design

**[Diisi Kelompok B. Rujukan: testing/test-cases.md]**

## 6. Hasil dan Pembahasan

### 6.1 Hasil Implementasi [kelompok pembangun]

Sistem berjalan dengan seluruh syarat arsitektur minimal. Hasil pengujian internal ada di [progress/hasil-pengujian.md](progress/hasil-pengujian.md). Pengujian internal menemukan dan memperbaiki lima bug, salah satunya race condition pada idempotency pembayaran, yang hanya muncul pada uji bersamaan ([testing/bug-report.md](testing/bug-report.md)).

Keterbatasan yang disadari: **[lihat bagian "Batasan yang disadari" di 01-rancangan-keamanan.md]**.

### 6.2 Hasil Pengujian [kelompok penguji]

**[Diisi Kelompok B: hasil fungsional, load test, uji keamanan, bug report.]**

### 6.3 Pembahasan Bersama

**[Diisi bersama: temuan penguji, respons pengembang, retest.]**

## 7. Kesimpulan

**[Diisi setelah pengujian independen.]**

## 8. Daftar Pustaka

**[Lengkapi. Rujukan dari materi: RFC 9700, RFC 7636, oauth.net/2, Newman: Building Microservices 2nd Ed., JUnit 5 User Guide, Tahchiev et al.: JUnit in Action, Black et al.: Foundations of Software Testing.]**
