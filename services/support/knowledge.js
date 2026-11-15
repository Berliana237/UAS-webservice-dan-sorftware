'use strict';
/**
 * Basis pengetahuan Pusat Bantuan. Sumber yang sama dipakai untuk daftar FAQ di halaman dan sebagai bekal asisten AI,
 * sehingga jawaban AI tidak bertentangan dengan FAQ. {SENIOR} diganti persentase diskon lansia yang berlaku saat itu.
 */
const FAQ = [
  {
    id: 'akun', title: 'Akun dan profil',
    items: [
      ['Bagaimana cara membuat akun?', 'Tekan Daftar di pojok kanan atas, isi nama, email, dan kata sandi minimal 8 karakter yang memuat huruf dan angka. Setelah itu Anda langsung masuk.', 'daftar akun buat registrasi baru'],
      ['Saya lupa kata sandi. Apa yang harus dilakukan?', 'Fitur atur ulang lewat email belum tersedia. Hubungi admin Rangkai, admin dapat mengganti kata sandi akun Anda setelah memastikan identitas. Setelah masuk, segera ganti lewat halaman Profil.', 'lupa kata sandi password reset'],
      ['Akun saya terkunci setelah salah kata sandi.', 'Demi keamanan, akun dikunci 1 menit setelah 5 kali salah kata sandi berturut-turut. Tunggu sebentar lalu coba lagi dengan kata sandi yang benar.', 'akun terkunci kunci salah password'],
      ['Untuk apa data di halaman Profil?', 'Nama, nomor HP, NIK, dan tanggal lahir di Profil dipakai untuk mengisi otomatis data penumpang pertama saat memesan. Anda tetap bisa mengubahnya di formulir pemesanan. Data yang belum diisi tidak akan terisi otomatis.', 'profil isi otomatis data penumpang usia tanggal lahir'],
      ['Bagaimana mengganti kata sandi?', 'Buka Profil, lalu bagian Keamanan akun. Masukkan kata sandi saat ini dan kata sandi baru. Setelah diganti, sesi di perangkat lain otomatis dikeluarkan.', 'ganti ubah kata sandi password'],
    ],
  },
  {
    id: 'pesan', title: 'Memesan tiket',
    items: [
      ['Bagaimana cara memesan tiket?', 'Buka Cari Tiket, pilih stasiun asal, tujuan, tanggal, dan bila perlu nama kereta. Pilih perjalanan, pilih kursi di denah gerbong, tekan Tahan kursi, isi data penumpang, lalu bayar. Tiket dengan kode QR terbit setelah pembayaran diterima.', 'cara pesan beli tiket langkah'],
      ['Apa maksud kursi dijual per ruas?', 'Satu kursi dikunci hanya pada ruas yang Anda lewati. Contoh: penumpang lain duduk di kursi 7A dari Gambir ke Yogyakarta, kursi yang sama tetap bisa Anda pesan dari Yogyakarta ke Malang. Karena itu pilihan kursi lebih banyak.', 'ruas segmen kursi berbagi per ruas'],
      ['Berapa lama kursi ditahan?', 'Kursi ditahan 10 menit sejak Anda menekan Tahan kursi. Bila memilih transfer virtual account, waktu tahan diperpanjang menjadi 2 jam, dan menjadi 24 jam setelah bukti transfer diunggah. Bila waktu habis sebelum dibayar, kursi dilepas otomatis.', 'waktu tahan kursi berapa lama hitung mundur ttl'],
      ['Berapa kursi yang bisa dipesan sekaligus?', 'Tidak ada batas jumlah kursi dalam satu pesanan. Tekan beberapa kursi di denah, lalu tekan sekali lagi untuk melepas pilihan. Setiap kursi diisi satu penumpang.', 'maksimal kursi banyak sekaligus rombongan'],
      ['Kenapa ada kursi yang tidak bisa ditekan?', 'Kursi kuning sedang ditahan penumpang lain yang belum membayar, dan kursi gelap sudah terisi pada ruas Anda. Kursi yang ditahan bisa kosong kembali bila tidak dibayar. Denah diperbarui secara langsung.', 'kursi abu kuning tidak bisa dipilih ditahan terisi'],
      ['Apa arti kursi berhadapan di denah?', 'Di tengah gerbong Ekonomi dan Eksekutif ada dua pasang baris yang saling berhadapan, cocok untuk keluarga. Garis sandaran di denah menunjukkan arah duduk. Gerbong Luxury dan Panoramic semuanya menghadap satu arah.', 'kursi berhadapan arah duduk denah sandaran'],
      ['Berapa gerbong tiap kereta?', 'Setiap rangkaian punya 9 gerbong penumpang. Susunannya mengikuti kelas kereta, misalnya Gajayana punya 1 gerbong Luxury dan 8 gerbong Eksekutif.', 'gerbong jumlah rangkaian'],
      ['Apa beda kelas Ekonomi, Eksekutif, dan Luxury?', 'Ekonomi berkonfigurasi 2-2 dengan harga paling terjangkau (Argo Parahyangan memakai Ekonomi Premium). Eksekutif berkonfigurasi 2-2 dengan ruang kaki lebih lega. Luxury berkonfigurasi 1-1 dengan kursi lebih privat, sedangkan Panoramic punya jendela lebar dan termasuk kelas Luxury.', 'kelas ekonomi eksekutif luxury panoramic beda'],
      ['Bagaimana tarif dihitung?', 'Tarif dihitung dari tarif dasar kelas ditambah tarif per kilometer sepanjang ruas yang Anda pilih, lalu dibulatkan ke atas per Rp1.000. Semakin pendek ruasnya, semakin murah.', 'harga tarif hitung biaya'],
      ['Apakah anak dan bayi membayar?', 'Ya. Bayi (0 sampai 3 tahun), anak (4 sampai 16 tahun), dan dewasa (17 sampai 59 tahun) membayar tarif normal dan mendapat kursi sendiri. Lansia (60 tahun ke atas) mendapat potongan {SENIOR} persen. Label golongan muncul otomatis saat usia diisi.', 'bayi anak lansia golongan usia diskon potongan tarif'],
      ['NIK seperti apa yang diterima?', 'NIK berupa 16 digit angka. Penumpang 17 tahun ke atas wajib mengisi NIK, sedangkan di bawah itu boleh dikosongkan. Satu NIK tidak boleh dipakai dua kali dalam satu pesanan.', 'nik ktp identitas 16 digit'],
    ],
  },
  {
    id: 'bayar', title: 'Pembayaran',
    items: [
      ['Metode pembayaran apa saja yang tersedia?', 'QRIS, Virtual Account BCA, dan Virtual Account Mandiri. Sistem ini lingkungan demo, jadi tidak ada uang sungguhan yang berpindah.', 'metode pembayaran bayar qris va bca mandiri'],
      ['Bagaimana membayar dengan QRIS?', 'Pindai kode QR di layar pembayaran memakai kamera ponsel, Google Lens, atau aplikasi pemindai lain. Ponsel harus terhubung ke Wi-Fi yang sama dengan komputer yang menjalankan Rangkai. Setelah tautan dibuka, pembayaran langsung diproses dan layar pemesanan berubah otomatis. Bila tidak bisa memindai, buka bagian "Tidak bisa memindai?" untuk simulasi.', 'qris pindai scan kode qr google lens'],
      ['Bagaimana membayar dengan virtual account?', 'Pilih VA BCA atau Mandiri, transfer tepat sesuai nominal ke nomor yang muncul, lalu unggah bukti transfer (JPG, PNG, WEBP, atau PDF maksimal 3 MB) beserta catatan bila perlu. Admin memeriksa bukti Anda dan hasilnya dikirim lewat notifikasi.', 'virtual account va transfer bukti unggah upload'],
      ['Pembayaran saya ditolak. Apa yang harus dilakukan?', 'Ketuk notifikasi penolakan, Anda akan dibawa ke pesanan di Perjalanan saya. Di sana tertulis alasan penolakan. Unggah ulang bukti yang benar lalu kirim lagi, selama waktu tahan kursi belum habis.', 'ditolak tolak reject unggah ulang bukti'],
      ['Saya sudah bayar tetapi waktu habis.', 'Bila pembayaran QRIS diterima setelah waktu tahan habis, tiket tidak diterbitkan dan dana dikembalikan otomatis. Anda akan mendapat notifikasi "Dana dikembalikan".', 'terlambat bayar habis waktu refund otomatis'],
      ['Apakah data kartu saya disimpan?', 'Tidak. Rangkai tidak menerima atau menyimpan nomor kartu. Status pembayaran hanya dipercaya dari pemberitahuan bertanda tangan milik penyedia pembayaran atau dari keputusan admin.', 'kartu kredit data keamanan pembayaran'],
    ],
  },
  {
    id: 'tiket', title: 'Tiket, pembatalan, dan refund',
    items: [
      ['Di mana saya melihat tiket?', 'Buka Perjalanan saya, lalu pilih pesanan. Tiket berisi kode QR per penumpang. Tunjukkan kode itu kepada petugas saat naik. Tiket juga bisa dicetak.', 'lihat tiket kode qr boarding'],
      ['Berapa pengembalian dana bila saya membatalkan?', 'Tergantung sisa waktu sebelum berangkat: 72 jam atau lebih 90 persen, 24 sampai 72 jam 75 persen, 3 sampai 24 jam 50 persen, dan kurang dari 3 jam tidak ada pengembalian. Setelah kereta berangkat, pesanan tidak bisa dibatalkan. Besar pengembalian ditampilkan sebelum Anda mengonfirmasi.', 'batal pembatalan refund pengembalian dana persen'],
      ['Bagaimana bila kereta dibatalkan atau terlambat?', 'Bila perjalanan dibatalkan operator, pesanan dibatalkan dan dana dikembalikan penuh. Bila terlambat, Anda menerima notifikasi berisi perkiraan keterlambatan.', 'kereta batal terlambat delay'],
    ],
  },
  {
    id: 'notif', title: 'Notifikasi',
    items: [
      ['Notifikasi apa saja yang dikirim?', 'Pengingat batas bayar 5 menit sebelum habis, pembayaran berhasil, pembayaran ditolak beserta alasannya, tiket terbit, kereta terlambat, dan pengingat 3 jam sebelum berangkat. Tekan ikon lonceng di header untuk melihatnya.', 'notifikasi pengingat lonceng pemberitahuan'],
    ],
  },
  {
    id: 'privasi', title: 'Keamanan dan privasi',
    items: [
      ['Bagaimana data pribadi saya dilindungi?', 'Nama, NIK, nomor HP, dan email dienkripsi di basis data. NIK hanya ditampilkan 4 digit terakhir di tiket dan manifest. Log sistem menyamarkan data pribadi. Selengkapnya ada di halaman Keamanan dan Privasi.', 'privasi data pribadi enkripsi aman'],
      ['Apakah percakapan dengan asisten disimpan?', 'Percakapan tidak disimpan di basis data. Sebelum dikirim ke penyedia AI, angka 16 digit, email, dan nomor telepon di pesan Anda disamarkan otomatis. Jangan pernah membagikan kata sandi kepada siapa pun, termasuk asisten.', 'asisten ai chat percakapan simpan privasi'],
    ],
  },
];

const APP_FACTS = `
Rangkai adalah aplikasi reservasi kereta antarkota (proyek tugas kuliah, lingkungan demo, pembayaran simulasi).
Halaman: Beranda (profil perusahaan dan jadwal), Cari Tiket, Perjalanan saya (pesanan, pembayaran, tiket), Profil, Pusat Bantuan, Keamanan dan Privasi.
Peran: pelanggan memesan tiket; masinis melihat jadwal dinas, manifest, dan memeriksa karcis; admin mengelola data operasional, pengguna, armada, dan memverifikasi transfer.
Alur: Cari Tiket, pilih perjalanan, pilih kursi (maks 4), Tahan kursi (10 menit), isi data penumpang, bayar (QRIS atau VA BCA/Mandiri), tiket QR terbit.
Kursi dijual per ruas. Kursi kuning = ditahan orang lain, gelap = terisi, emas = pilihan Anda, titik kecil = terpakai di ruas lain tapi kosong di ruas Anda.
Golongan: bayi 0-3, anak 4-16, dewasa 17-59 (tarif normal), lansia 60+ (potongan {SENIOR} persen). NIK 16 digit wajib untuk 17 tahun ke atas.
Refund: >=72 jam 90%, >=24 jam 75%, >=3 jam 50%, <3 jam 0%, setelah berangkat tidak bisa batal. Kereta dibatalkan operator: refund penuh.
Tarif = (tarif dasar kelas + tarif per km x km ruas), dibulatkan ke atas per Rp1.000.
`;

module.exports = { FAQ, APP_FACTS };
