# Data Uji dan Cara Mereset ke Kondisi Awal

## Data awal (seed) yang selalu ada

Dibuat otomatis saat sistem menyala, tidak perlu menjalankan apa pun:

| Data | Isi | Sumber (skrip seed) |
|---|---|---|
| Stasiun dan kereta | 33 stasiun, 8 kereta KAI, 9 gerbong per rangkaian, kelas Ekonomi/Eksekutif/Luxury | `services/catalog/seed.js` |
| Jadwal | Perjalanan harian dibuat otomatis untuk **30 hari ke depan** (diperbarui tiap jam) | `ensureTrips()` di `services/catalog/index.js` |
| Penugasan masinis | Setiap perjalanan diberi masinis tanpa jadwal bentrok | `assignCrew()` di `services/catalog/index.js` |
| Akun penguji | 4 akun `@penguji.rangkai` (lihat `KREDENSIAL-UJI.md`) | `TESTER_ACCOUNTS` di `services/auth/store.js` |
| Akun pembangun | admin dan 40 masinis `@rangkai.test` (milik Kelompok A, jangan dipakai menguji) | `seedUsers()` di `services/auth/store.js` |

Data penguji **dipisah** dari data demo: semua yang dibuat akun berdomain `@penguji.rangkai` (dan akun uji Postman `@uji.rangkai`) dianggap data uji.

## Cara mereset data uji (bisa dilakukan penguji sendiri)

Reset menghapus semua data milik akun uji: pesanan, penumpang, kursi yang ditahan, pembayaran, bukti transfer, notifikasi, dan sesi login. Empat akun penguji resmi **tetap ada**; akun uji lain dihapus. Jadwal, kereta, stasiun, dan akun pembangun **tidak** disentuh.

### Cara 1: lewat Swagger (paling mudah)

1. Buka https://rangkai-production.up.railway.app/docs (lokal: http://localhost:8080/docs), klik **Authorize**, masuk sebagai `admin@penguji.rangkai`.
2. Buka `POST /api/admin/test-data/reset` (tag Admin) > **Try it out**.
3. Isi `dryRun` = `true` lalu **Execute** untuk melihat jumlah data yang akan dihapus (tidak menghapus).
4. Kosongkan `dryRun` (atau `false`) lalu **Execute** untuk benar-benar mereset. Jawaban `200` berisi ringkasan, misalnya `"bookings": 10, "locks": 32`.

### Cara 2: lewat curl / Postman

```
POST https://rangkai-production.up.railway.app/api/admin/test-data/reset?dryRun=true
(lokal: POST http://localhost:8080/api/admin/test-data/reset?dryRun=true)
Authorization: Bearer <access token admin@penguji.rangkai>
```

### Cara 3: di komputer sendiri (lingkungan lokal)

```
stop.bat
node scripts/reset-test-data.js --dry-run
node scripts/reset-test-data.js
run.bat
```

Untuk benar-benar kembali ke kondisi pabrik di lokal: matikan sistem, hapus folder `data/`, lalu jalankan `run.bat` (semua seed dibuat ulang).

## Aturan agar data demo tidak rusak

- Selalu pakai akun `@penguji.rangkai` atau buat akun baru dengan domain itu.
- Uji beban dan uji kegagalan **dikoordinasikan dulu** dengan Kelompok A (jadwal dan skala), lihat `PANDUAN-SERAH-TERIMA.pdf` bab 9.
- Jangan menghapus atau mengubah kereta/stasiun bawaan dengan akun admin penguji. Untuk menguji CRUD data operasional, **buat kereta/stasiun baru** lalu ubah dan hapus yang baru itu saja.
