# Justifikasi Pilihan Protokol: GraphQL

Sistem memakai **REST untuk operasi transaksional** (lock, pesanan, pembayaran) dan **GraphQL sebagai protokol non-REST** untuk membaca data jadwal dan peta kursi. Pilihan ini mengikuti kerangka keputusan sesi 7 Web Service.

| Pertimbangan | Analisis | Keputusan |
|---|---|---|
| **Konsumen API** | Ada beberapa konsumen dengan kebutuhan berbeda: web menampilkan peta kursi lengkap, papan keberangkatan hanya butuh jam dan nama kereta, ponsel dan partner butuh ringkasan ketersediaan. Semuanya berbasis HTTP, termasuk browser yang tidak bisa memanggil gRPC secara langsung tanpa proxy. | GraphQL lebih cocok |
| **Variasi data** | Data bersifat graf dan bersarang: perjalanan, stasiun, segmen, gerbong, kursi, status per segmen. Dengan REST, tiap tampilan perlu endpoint khusus atau beberapa panggilan. | GraphQL lebih cocok |
| **Kebutuhan performa** | Peta kursi lengkap memuat 240 kursi dan diambil ulang tiap ada perubahan. Klien bisa meminta `available` saja saat polling, sehingga muatan kecil. Komunikasi internal berfrekuensi tinggi tetap efisien lewat HTTP keep-alive dan mTLS. gRPC unggul di throughput internal, tetapi manfaatnya belum sebanding pada skala ini. | GraphQL cukup |
| **Sistem legacy** | Tidak ada sistem lama yang harus diintegrasikan, sehingga tidak ada kendala kontrak lama. | Netral |

## Mengapa bukan gRPC

gRPC tidak bisa dipanggil langsung dari browser, butuh file `.proto` dan tool khusus untuk diuji. Soal sendiri mencatat bahwa gRPC "lebih sulit diuji". GraphQL bisa diuji Kelompok B lewat Postman tanpa konfigurasi tambahan, dan bisa ikut dalam satu koleksi impor.

## Mengapa operasi tulis tetap REST

Operasi tulis utama membutuhkan hal yang lebih alami di REST: status HTTP yang jelas (201, 409, 429), header `Idempotency-Key`, dan rate limit per rute di gateway. Mutation GraphQL hanya dipakai untuk fungsi operator (`createTrip`, `updateTripStatus`) dan dilindungi scope `schedule:write`.

## Risiko GraphQL dan penanganannya

| Risiko | Penanganan | Bukti |
|---|---|---|
| Query terlalu dalam atau besar membebani server | Batas kedalaman 8 dan batas 200 field, panjang query 8.000 karakter | `graphql-guard.js`, uji S-22 |
| N+1 ke booking-service | `seatMap` mengambil semua klaim satu perjalanan sekali jalan | `buildSeatMap` di `services/catalog/index.js` |
| Rate limit per rute sulit | Satu kelas kuota `graphql` per pengguna atau IP | `services/gateway/routes.js` |
| Otorisasi per field | Mutation memeriksa scope di resolver, query publik tidak memuat data pribadi | `hasScope` di catalog |
