# Bug Report

Berisi bug asli yang ditemukan pengujian internal saat pembangunan, beserta retest-nya. Formatnya bisa dipakai Kelompok B.

## Templat

| Bagian | Isi |
|---|---|
| ID, judul | BUG-xxx, satu kalimat gejala |
| Severity | Critical, High, Medium, Low (dampak) |
| Priority | P1, P2, P3 (urgensi) |
| Lingkungan | Versi, OS, tool |
| Prasyarat | Keadaan sebelum menguji |
| Langkah reproduksi | Bernomor, bisa diulang |
| Hasil diharapkan dan aktual | Keduanya, dengan bukti |
| Saran | Arah perbaikan |
| Status | Open, Fixed, Verified, Won't fix |

---

## BUG-001: Idempotency-Key pembayaran bisa membuat pembayaran ganda saat kiriman bersamaan

| | |
|---|---|
| **Severity** | High. Satu pesanan bisa punya banyak pembayaran aktif, yang berisiko tagihan ganda |
| **Priority** | P1 |
| **Ditemukan oleh** | `tests/concurrency/run.js`, skenario K-08a |
| **Komponen** | `services/payment/index.js`, `POST /api/payments` |

**Langkah reproduksi**

1. Masuk sebagai pelanggan, tahan kursi, buat pesanan.
2. Kirim `POST /api/payments` 8 kali **secara bersamaan** dengan `Idempotency-Key` yang sama.

**Hasil diharapkan:** satu pembayaran. Kiriman lain mengembalikan hasil yang sama.

**Hasil aktual:** 8 pembayaran berbeda.

```
[GAGAL] K-08a Idempotency-Key pada pembayaran hanya membuat satu pembayaran
        pay_7435a81788423fb50f,pay_bac78bf8f2424e1066,pay_4f7e0529a04eb4d160, ... (8 id)
```

**Akar masalah:** urutannya periksa kunci, `await` panggilan ke booking-service, lalu simpan kunci. Selama `await`, kiriman lain lolos pemeriksaan (race check-then-act).

**Perbaikan**

- Kunci dipesan lebih dulu dengan `INSERT OR IGNORE` berstatus 0 sebelum ada `await`. Kiriman berikutnya menunggu hasil kiriman pertama.
- Bila kiriman pertama gagal, pesanan kunci dihapus agar klien bisa mencoba lagi.
- Tambahan: hanya satu pembayaran aktif per pesanan. Pembayaran `PENDING` lama dibatalkan saat pembayaran baru dibuat.

**Retest:** K-08a lulus (8 kiriman, 1 pembayaran), K-08b lulus (1 tiket). **Status: Verified.**

---

## BUG-002: Gateway memutus koneksi saat body terlalu besar, klien tidak menerima 413

| | |
|---|---|
| **Severity** | Medium. Permintaan tetap ditolak, tetapi klien mendapat `socket hang up` tanpa penjelasan |
| **Priority** | P2 |
| **Ditemukan oleh** | Newman, request "Body terlalu besar". Juga menghentikan `tests/security/run.js` pada S-20 |
| **Komponen** | `services/gateway/index.js`, `readBody` |

**Langkah reproduksi**

1. Kirim `POST /api/auth/register` dengan body 70 KB.

**Hasil diharapkan:** 413 `PAYLOAD_TOO_LARGE`.

**Hasil aktual:** `socket hang up`, tanpa respons.

**Akar masalah:** `req.destroy()` dipanggil begitu batas terlampaui, sehingga socket tertutup sebelum respons ditulis.

**Perbaikan:** sisa body dibuang tanpa memutus koneksi, lalu kirim 413 dengan `Connection: close`.

**Retest:** S-20 lulus, request Postman lulus. **Status: Verified.**

---

## BUG-003: Status "Caps Lock aktif" selalu tampil di halaman masuk

| | |
|---|---|
| **Severity** | Low. Pesan menyesatkan, tidak menghalangi login |
| **Priority** | P3 |
| **Ditemukan oleh** | Pemeriksaan manual di browser |
| **Komponen** | `web/assets/css/pages.css` |

**Langkah reproduksi**

1. Buka `/masuk`.

**Hasil diharapkan:** pesan hanya muncul saat Caps Lock menyala.

**Hasil aktual:** pesan selalu terlihat.

**Akar masalah:** `.af small { display: block }` mengalahkan atribut `hidden`.

**Perbaikan:** aturan global `[hidden] { display: none !important }`.

**Retest:** Pesan hilang. **Status: Verified.**

---

## BUG-004: Pemandangan hero tidak tampil di beranda

| | |
|---|---|
| **Severity** | Medium. Tampilan beranda kehilangan latar |
| **Priority** | P2 |
| **Ditemukan oleh** | Pemeriksaan manual di browser |
| **Komponen** | `web/assets/js/ui.js` |

**Akar masalah:** kelas mode `hero` pada elemen pemandangan bertabrakan dengan `.hero` milik tata letak beranda, sehingga elemen kehilangan `position: absolute`.

**Perbaikan:** kelas mode menjadi `m-hero` dan `m-window`.

**Retest:** Pemandangan dan kereta tampil. **Status: Verified.**

---

## BUG-005: Kata sandi demo terpotong saat membaca .env

| | |
|---|---|
| **Severity** | Medium. Akun demo tidak bisa dipakai dengan kata sandi yang didokumentasikan |
| **Priority** | P2 |
| **Ditemukan oleh** | Pemeriksaan keluaran `run.bat` |
| **Komponen** | `scripts/setup.js` |

**Akar masalah:** nilai `Rangkai#2026`. Tanda `#` dibaca sebagai awal komentar oleh `process.loadEnvFile`, sehingga kata sandi menjadi `Rangkai`.

**Perbaikan:** kata sandi demo diganti `Rangkai2026!`.

**Retest:** Keluaran menampilkan kata sandi utuh, login berhasil. **Status: Verified.**

---

## Ringkasan

| ID | Judul | Severity | Status |
|---|---|---|---|
| BUG-001 | Idempotency pembayaran ganda | High | Verified |
| BUG-002 | Body besar tanpa respons 413 | Medium | Verified |
| BUG-003 | Caps Lock selalu tampil | Low | Verified |
| BUG-004 | Hero tidak tampil | Medium | Verified |
| BUG-005 | Kata sandi demo terpotong | Medium | Verified |

Tidak ada bug terbuka dari pengujian internal. Pengujian independen oleh Kelompok B bisa menemukan hal lain, dan temuannya dicatat di sini mulai minggu 13.
