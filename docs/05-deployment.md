# Deployment

> Status: berkas di bawah sudah disiapkan, tetapi **belum dijalankan**. Docker tidak terpasang di mesin pembuatan, dan deploy ke Render butuh akun kelompok. Uji dulu sebelum minggu 12.

## Render (URL stabil untuk penguji)

Soal mewajibkan URL deployment yang stabil saat code freeze.

1. Unggah proyek ke repository GitHub. Pastikan `.env`, `certs/`, dan `data/` tidak ikut (sudah ada di `.gitignore`).
2. Di Render: **New > Blueprint**, pilih repository. Render membaca `render.yaml`.
3. Isi variabel yang diminta:
   - `PUBLIC_URL` dan `CORS_ORIGINS`: alamat dari Render, misalnya `https://rangkai.onrender.com`
   - `SEED_USER_PASSWORD`: kata sandi akun demo untuk penguji
   - `PII_KEY_BASE64`: hasil perintah di bawah

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

4. Setelah aktif, buka `/healthz`, lalu `/docs`.

**Hal yang perlu diketahui:**

- Semua service berjalan dalam satu container. Render mengakhiri TLS di platform dan paket gratis tidak punya jaringan privat, jadi ini cara yang paling realistis.
- Sertifikat mTLS dibuat saat container menyala. Baris `setup` di `scripts/start-all.js` mengurus ini.
- Paket gratis Render hanya punya memori 512 MB dan tertidur saat tidak dipakai. Sistem ini bisa melewati batas itu. `render.yaml` memakai paket `starter` dan `BOOKING_INSTANCES=1`. Bila ingin tetap gratis, pertimbangkan VM kecil dengan Docker Compose.
- Tanpa disk persisten, database kembali ke data awal tiap deploy. Tambahkan Render Disk pada `/app/data` bila data harus bertahan.

## Docker Compose (mTLS lintas container)

Materi sesi 8 menganjurkan demonstrasi mTLS di Docker Compose. Tiap service berjalan di container sendiri.

```bash
node scripts/setup.js
```

```bash
docker compose up --build
```

Buka http://localhost:8080. Sertifikat dari folder `certs` dipasang ke tiap container. Sertifikat booking berlaku untuk nama `booking-a` dan `booking-b`.

## Mengizinkan penguji mengakses

Berikan kepada Kelompok B: URL, kata sandi demo, `docs/04-environment-variables.md`, dan koleksi Postman beserta `Rangkai.template.postman_environment.json`. Isi `baseUrl` dengan URL deployment.
