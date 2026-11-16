# Paket Serah-terima Code Freeze: Kelompok A ke Kelompok B

Sistem: **Rangkai**, reservasi kereta antarkota dengan kunci kursi per ruas (topik A).
Pembangun: **Kelompok A**. Penguji: **Kelompok B**. Tag: **`v1.0-freeze`**. Branch: **`codefreeze`**.

**Mulai dari sini:** baca [`PANDUAN-SERAH-TERIMA.pdf`](PANDUAN-SERAH-TERIMA.pdf) (24 halaman, bahasa sederhana, dengan diagram), jalankan smoke test (Bab 6, hlm. 13), lalu isi [`FORMULIR-SERAH-TERIMA.md`](FORMULIR-SERAH-TERIMA.md).

**Pengujian resmi dilakukan di deployment Railway:** https://rangkai-production.up.railway.app. Alamat lokal (`run.bat`) dicantumkan untuk eksplorasi atau uji yang berisiko merusak data.

## Isi paket (sesuai "Prosedur Code Freeze" bagian 4)

| No | Item wajib | Lokasi di repo (path, branch `codefreeze`) | URL deployment (Railway) | URL lokal | Penjelasan di PDF |
|---|---|---|---|---|---|
| 1 | Spesifikasi OpenAPI lengkap untuk endpoint REST (82 path, 98 operasi) | `docs/openapi.yaml`<br>`serah-terima/dokumen/openapi.yaml` | Swagger: https://rangkai-production.up.railway.app/docs<br>File: https://rangkai-production.up.railway.app/docs/openapi.yaml | Swagger: http://localhost:8080/docs<br>File: http://localhost:8080/docs/openapi.yaml | Bab 3 hlm. 6, Bab 4.1 hlm. 9 |
| 2 | Skema GraphQL dengan contoh query/mutation | `docs/schema.graphql`<br>`docs/graphql-examples.md`<br>`services/catalog/schema.graphql`<br>`serah-terima/dokumen/schema.graphql`<br>`serah-terima/dokumen/graphql-examples.md` | Skema: https://rangkai-production.up.railway.app/graphql/schema<br>Endpoint: `POST` https://rangkai-production.up.railway.app/graphql | Skema: http://localhost:8080/graphql/schema<br>Endpoint: `POST` http://localhost:8080/graphql | Bab 6.2 hlm. 13, Bab 7.7 hlm. 17 |
| 3 | README: cara mengakses sistem, daftar endpoint, cara autentikasi | `README.md` (root)<br>`serah-terima/dokumen/README-SISTEM.md` | [README.md di GitHub](https://github.com/Berliana237/UAS-webservice-dan-sorftware/blob/codefreeze/README.md), bagian "Akses cepat", "Daftar endpoint", "Cara autentikasi" | Berkas `README.md` di folder proyek | Bab 4 hlm. 9, Bab 5.1 hlm. 11 |
| 4 | Daftar environment variable dengan placeholder | `.env.example`<br>`docs/04-environment-variables.md`<br>`serah-terima/dokumen/04-environment-variables.md`<br>`serah-terima/dokumen/env.example.txt` | [04-environment-variables.md](https://github.com/Berliana237/UAS-webservice-dan-sorftware/blob/codefreeze/docs/04-environment-variables.md)<br>[.env.example](https://github.com/Berliana237/UAS-webservice-dan-sorftware/blob/codefreeze/.env.example) | `.env` dibuat otomatis oleh `run.bat` dari `.env.example` | Bab 3 hlm. 6, Bab 4.3 hlm. 10 |
| 5 | URL deployment yang stabil | `README.md` bagian "Akses cepat (deployment)" | Aplikasi: https://rangkai-production.up.railway.app<br>Cek: https://rangkai-production.up.railway.app/healthz | Aplikasi: http://localhost:8080<br>Cek: http://localhost:8080/healthz | Bab 4 hlm. 9 |
| 6 | Nama tag dan hash commit (`v1.0-freeze`) | Tag Git `v1.0-freeze` di branch `codefreeze`; `README.md` bagian "Serah-terima code freeze" | https://github.com/Berliana237/UAS-webservice-dan-sorftware/tree/v1.0-freeze | `git rev-list -n 1 v1.0-freeze` | Sampul hlm. 1, Bab 3.2 hlm. 8, Bab 11.2 hlm. 22 |
| 7 | Kredensial uji khusus penguji (terpisah dari pembangun) | [`serah-terima/KREDENSIAL-UJI.md`](KREDENSIAL-UJI.md)<br>`services/auth/store.js` (`TESTER_ACCOUNTS`) | Masuk: https://rangkai-production.up.railway.app/masuk<br>Swagger Authorize: https://rangkai-production.up.railway.app/docs | Masuk: http://localhost:8080/masuk<br>Swagger: http://localhost:8080/docs | Bab 5 hlm. 11 |
| 8 | Data uji: skrip seed dan cara reset ke kondisi awal | [`serah-terima/DATA-UJI-DAN-RESET.md`](DATA-UJI-DAN-RESET.md)<br>`scripts/reset-test-data.js`<br>`services/catalog/seed.js`<br>`services/auth/store.js` (`seedUsers`) | `POST` https://rangkai-production.up.railway.app/api/admin/test-data/reset | `POST` http://localhost:8080/api/admin/test-data/reset atau `node scripts/reset-test-data.js` | Bab 8 hlm. 19 |
| 9 | Keterbatasan yang diketahui | `README.md` bagian "Keterbatasan yang diketahui" | [README.md di GitHub](https://github.com/Berliana237/UAS-webservice-dan-sorftware/blob/codefreeze/README.md) | Berkas `README.md` | Bab 10 hlm. 21, Bab 9 hlm. 20 |
| 10 | Kontak penanggung jawab teknis | `serah-terima/README.md` (berkas ini)<br>`README.md` bagian "Serah-terima code freeze" | Jap Robertus Kurniawan Setiabudi (NRP 5803024004), lewat GitHub Issues dan grup pasangan A-B | - | Bab 12 hlm. 23 |

## Alat bantu pengujian

| Berkas | Gunanya | Penjelasan di PDF |
|---|---|---|
| [`smoke-test.js`](smoke-test.js) | Smoke test otomatis (Node.js 18+, tanpa instal).<br>Railway: `node serah-terima/smoke-test.js --password "PengujiB-Rangkai26"`<br>Lokal: tambah `--base http://localhost:8080` | Bab 6.1 hlm. 13 |
| [`postman/Rangkai.postman_collection.json`](postman/Rangkai.postman_collection.json) | 272 request, 399 pengecekan otomatis | Bab 4.2 hlm. 9 |
| [`postman/Rangkai.penguji.postman_environment.json`](postman/Rangkai.penguji.postman_environment.json) | Environment Postman: URL Railway dan akun penguji sudah terisi. Untuk lokal ganti `baseUrl` menjadi http://localhost:8080 | Bab 4.2 hlm. 9 |
| [`FORMULIR-SERAH-TERIMA.md`](FORMULIR-SERAH-TERIMA.md) | Formulir gerbang serah-terima (DITERIMA / DITOLAK) | Bab 6.4 hlm. 14, Lampiran A hlm. 24 |
| [`../.github/ISSUE_TEMPLATE/bug_report.md`](../.github/ISSUE_TEMPLATE/bug_report.md) | Templat laporan bug (muncul otomatis saat membuat issue baru) | Bab 11.1 hlm. 22 |
| `../tests/` | Uji otomatis milik pembangun sebagai referensi: unit, PyTest EP/BVA, fungsional, konkurensi, keamanan, k6 | Bab 7 hlm. 15 |

## Aturan setelah freeze (ringkas, Bab 11 hlm. 22)

1. Penguji membuka **issue** untuk setiap temuan memakai templat.
2. Pembangun memperbaiki **hanya di branch `codefreeze`**, dengan pesan commit yang menyebut nomor issue (`Fix #7: ...`).
3. Lingkungan uji dideploy ulang dari isi branch `codefreeze`, lalu pembangun memberi tahu penguji.
4. Penguji melakukan retest, lalu **menutup issue** bila perbaikan terbukti.
