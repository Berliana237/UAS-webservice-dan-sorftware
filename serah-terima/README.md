# Paket Serah-terima Code Freeze: Kelompok A ke Kelompok B

Sistem: **Rangkai**, reservasi kereta antarkota dengan kunci kursi per ruas (topik A).
Pembangun: **Kelompok A**. Penguji: **Kelompok B**.

**Mulai dari sini:** baca `PANDUAN-SERAH-TERIMA.pdf` (penjelasan lengkap, bahasa sederhana, beserta diagram), lalu jalankan smoke test (bab 6) dan isi `FORMULIR-SERAH-TERIMA.md`.

## Isi paket (sesuai "Prosedur Code Freeze" bagian 4)

| No | Item wajib | Di mana |
|---|---|---|
| 1 | Spesifikasi OpenAPI lengkap untuk endpoint REST | `dokumen/openapi.yaml`, juga tampil di https://rangkai-production.up.railway.app/docs |
| 2 | Skema GraphQL dengan contoh query/mutation | `dokumen/schema.graphql`, `dokumen/graphql-examples.md`, juga di `/graphql/schema` |
| 3 | README: cara akses, daftar endpoint, cara autentikasi | `dokumen/README-SISTEM.md` (salinan `README.md` di root) |
| 4 | Daftar environment variable dengan placeholder | `dokumen/04-environment-variables.md`, `dokumen/env.example.txt` |
| 5 | URL deployment yang stabil | https://rangkai-production.up.railway.app (cek: `/healthz`) |
| 6 | Nama tag dan hash commit yang dibekukan | Tag `v1.0-freeze`. Hash tercantum di GitHub Release `v1.0-freeze` dan di PDF yang dilampirkan di Release, atau jalankan `git rev-list -n 1 v1.0-freeze` |
| 7 | Kredensial uji khusus penguji | `KREDENSIAL-UJI.md` (4 akun `@penguji.rangkai` dan API key penguji) |
| 8 | Data uji: skrip seed dan cara reset | `DATA-UJI-DAN-RESET.md`, skrip `../scripts/reset-test-data.js`, endpoint `POST /api/admin/test-data/reset` |
| 9 | Keterbatasan yang diketahui | `PANDUAN-SERAH-TERIMA.pdf` bab 10 dan README root bagian "Keterbatasan yang diketahui" |
| 10 | Kontak penanggung jawab teknis | Jap Robertus Kurniawan Setiabudi (NRP 5803024004), lewat GitHub Issues repositori ini dan grup pasangan A-B |

## Alat bantu pengujian

| Berkas | Gunanya |
|---|---|
| `smoke-test.js` | Smoke test otomatis 9 sampai 10 pemeriksaan (Node.js 18+, tanpa instal): `node serah-terima/smoke-test.js --password "<kata sandi penguji>"` |
| `postman/Rangkai.postman_collection.json` | 272 request dengan 399 pengecekan otomatis, dikelompokkan per minggu dan per fitur |
| `postman/Rangkai.penguji.postman_environment.json` | Environment Postman: URL Railway dan akun penguji sudah terisi |
| `FORMULIR-SERAH-TERIMA.md` | Formulir gerbang serah-terima (DITERIMA / DITOLAK) |
| `../.github/ISSUE_TEMPLATE/bug_report.md` | Templat laporan bug (otomatis muncul saat membuat issue baru di GitHub) |
| `../tests/` | Uji otomatis milik pembangun (unit, PyTest EP/BVA, fungsional, konkurensi, keamanan, k6) sebagai referensi |

## Aturan setelah freeze (ringkas)

1. Penguji membuka **issue** untuk setiap temuan memakai templat.
2. Pembangun memperbaiki **hanya di branch `codefreeze`**, dengan pesan commit yang menyebut nomor issue (`Fix #7: ...`).
3. Lingkungan uji dideploy ulang dari branch `codefreeze`, lalu pembangun memberi tahu penguji.
4. Penguji melakukan retest, lalu **menutup issue** bila perbaikan terbukti.
