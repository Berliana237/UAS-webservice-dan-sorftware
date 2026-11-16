# Formulir Serah-terima Code Freeze

Diisi oleh **kelompok penguji** setelah menjalankan smoke test 15 sampai 30 menit (lihat `PANDUAN-SERAH-TERIMA.pdf` bab 6).
Simpan formulir yang sudah diisi (foto atau salinan digital), lalu lampirkan ke GitHub Release `v1.0-freeze` atau kumpulkan ke dosen.

| Isian | Nilai |
|---|---|
| Kelompok pembangun / penguji | **A** / **B** |
| Tag & hash commit | `v1.0-freeze` / `________________________` (salin dari GitHub Release atau `git rev-list -n 1 v1.0-freeze`) |
| URL yang diuji | https://rangkai-production.up.railway.app |

| No | Pemeriksaan | Cara memeriksa (ringkas) | Hasil (centang) |
|---|---|---|---|
| 1 | Kelima item dokumentasi inti tersedia dan terbaca | Buka `serah-terima/dokumen/` dan `/docs` di URL | [ ] Ya  [ ] Tidak |
| 2 | URL deployment menjawab (request pertama boleh lambat bila layanan "tertidur") | Buka `/healthz`, harus `"status":"UP"` | [ ] Ya  [ ] Tidak |
| 3 | Contoh endpoint di README berfungsi sesuai yang tertulis | `GET /api/stations`, `GET /api/schedules`, `POST /graphql` | [ ] Ya  [ ] Tidak |
| 4 | Autentikasi (token/API key) bekerja dengan kredensial uji | Login `pelanggan1@penguji.rangkai` lalu `GET /api/auth/me` | [ ] Ya  [ ] Tidak |
| 5 | Data uji bisa direset dengan cara yang dijelaskan | `POST /api/admin/test-data/reset` dengan `admin@penguji.rangkai` | [ ] Ya  [ ] Tidak |

Hasil skrip otomatis `node serah-terima/smoke-test.js`: ____ lulus / ____ gagal

**Keputusan:**  [ ] DITERIMA   [ ] DITOLAK

**Alasan (jika ditolak):** ______________________________________________

**Nama penguji & waktu:** ______________________________________________

**Tanda tangan / nama perwakilan pembangun (Kelompok A):** ______________________

> Jika ditolak, Kelompok A memperbaiki kekurangan paket dan menyerahkan ulang dalam batas waktu yang ditetapkan dosen (usulan awal 2 hari). Jika kedua kelompok berselisih, dosen menjadi penengah.
