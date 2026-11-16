---
name: Laporan bug (kelompok penguji)
about: Templat resmi laporan bug setelah code freeze v1.0-freeze
title: "[BUG] "
labels: bug
assignees: ''
---

**Judul:** [singkat dan spesifik, mis. "POST /api/locks menerima kursi yang sudah ditahan"]

**Tingkat keparahan:** Kritis / Tinggi / Sedang / Rendah

**Endpoint / komponen:** [mis. POST /api/bookings, halaman Pilih Kursi]

**Langkah reproduksi:**
1. ...
2. ...
3. ...

**Hasil yang diharapkan:** ...

**Hasil aktual:** ...

**Bukti:** [screenshot, respons JSON, atau log. Sertakan nilai `requestId` dari respons error bila ada]

**Lingkungan:** [URL + hash commit yang diuji, mis. https://rangkai-production.up.railway.app @ v1.0-freeze (hash dari GitHub Release)]

**Akun uji yang dipakai:** [mis. pelanggan1@penguji.rangkai]

---
Catatan untuk pembangun: perbaikan dikerjakan di branch `codefreeze` dengan pesan commit yang menyebut nomor issue, mis. `Fix #7: validasi kursi ganda`. Issue ditutup oleh penguji setelah retest berhasil.
