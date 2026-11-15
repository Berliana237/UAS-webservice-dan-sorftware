/** Keamanan dan Privasi: kebijakan yang menjelaskan data apa yang dikumpulkan, cara melindunginya, dan hak pengguna. */
import { $, $$ } from '../core.js';

const SECTIONS = [
  ['ringkas', 'Ringkasan', `<p>Kami hanya mengumpulkan data yang diperlukan untuk menjual tiket, menerbitkan karcis, dan memenuhi kewajiban keselamatan perjalanan. Data pribadi Anda dienkripsi, tidak dijual, dan tidak dipakai untuk iklan.</p>
    <p>Rangkai adalah proyek tugas kuliah. Kebijakan ini disusun mengikuti prinsip Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP), namun seluruh data, kereta, dan pembayaran dalam aplikasi ini adalah simulasi.</p>`],
  ['data', 'Data yang kami kumpulkan', `<ul>
    <li><strong>Data akun:</strong> nama, email, kata sandi (disimpan sebagai hash scrypt, bukan teks asli), dan peran akun.</li>
    <li><strong>Data profil opsional:</strong> nomor HP, NIK, dan tanggal lahir, untuk mengisi data penumpang secara otomatis.</li>
    <li><strong>Data penumpang:</strong> nama, usia, NIK (wajib untuk usia 17 tahun ke atas), dan nomor HP opsional untuk setiap kursi.</li>
    <li><strong>Data transaksi:</strong> pesanan, kursi, ruas perjalanan, nominal, metode pembayaran, dan bukti transfer yang Anda unggah.</li>
    <li><strong>Data teknis:</strong> alamat IP dan waktu akses untuk pembatasan laju (rate limit) dan deteksi penyalahgunaan. Alamat IP disamarkan di log.</li>
  </ul><p>Kami <strong>tidak pernah</strong> menerima nomor kartu kredit. Permintaan yang berisi nomor kartu ditolak oleh sistem.</p>`],
  ['tujuan', 'Untuk apa data dipakai', `<ul>
    <li>Menahan kursi, membuat pesanan, dan menerbitkan tiket bernama.</li>
    <li>Memverifikasi pembayaran, termasuk pemeriksaan bukti transfer oleh petugas.</li>
    <li>Mengirim notifikasi penting: batas bayar, hasil verifikasi, keterlambatan, dan pengingat berangkat.</li>
    <li>Menyusun manifest penumpang untuk masinis dan petugas, sesuai kebutuhan keselamatan.</li>
    <li>Menjaga keamanan sistem: mendeteksi percobaan masuk berulang, pemakaian token curian, dan lalu lintas mencurigakan.</li>
  </ul>`],
  ['lindung', 'Cara kami melindungi data', `<ul>
    <li><strong>Enkripsi saat disimpan:</strong> nama, NIK, nomor HP, dan email dienkripsi AES-256-GCM per kolom. Pencarian email memakai hash, bukan teks asli.</li>
    <li><strong>Enkripsi saat dikirim:</strong> antar-layanan memakai mutual TLS dengan sertifikat per layanan. Layanan yang tidak dikenal ditolak.</li>
    <li><strong>Masuk yang aman:</strong> OAuth 2.0 Authorization Code dengan PKCE. Token akses hanya di memori peramban dan berlaku 15 menit; refresh token disimpan di cookie HttpOnly dan dirotasi setiap dipakai.</li>
    <li><strong>Pembatasan akses:</strong> setiap endpoint memeriksa peran dan scope. Masinis hanya melihat manifest perjalanan yang menjadi tugasnya.</li>
    <li><strong>Penyamaran tampilan:</strong> tiket dan manifest hanya menampilkan 4 digit terakhir NIK. Log sistem menyamarkan data pribadi.</li>
    <li><strong>Audit:</strong> tindakan penting, seperti perubahan peran dan keputusan verifikasi transfer, dicatat tanpa menyimpan kata sandi atau token.</li>
  </ul>`],
  ['ai', 'Asisten AI', `<p>Asisten Kiko di Pusat Bantuan memakai layanan AI pihak ketiga (Google Gemini). Sebelum pesan dikirim, angka 16 digit, alamat email, dan nomor telepon disamarkan otomatis. Percakapan tidak disimpan di basis data kami dan tidak terhubung dengan akun Anda.</p>
    <p>Jangan pernah menuliskan kata sandi atau kode rahasia di percakapan. Kiko tidak akan pernah memintanya.</p>`],
  ['bagi', 'Berbagi data', `<p>Data hanya dibagikan bila diperlukan untuk layanan:</p><ul>
    <li><strong>Penyedia pembayaran</strong> menerima nominal dan referensi transaksi, bukan data identitas penumpang.</li>
    <li><strong>Mitra resmi</strong> melalui API partner hanya memperoleh jadwal dan ketersediaan kursi, tanpa data pribadi.</li>
    <li><strong>Aparat berwenang</strong> bila diwajibkan oleh hukum yang berlaku.</li>
  </ul>`],
  ['simpan', 'Lama penyimpanan', `<ul>
    <li>Bukti transfer disimpan selama pesanan aktif dan masa sengketa pembayaran.</li>
    <li>Data pesanan dan manifest disimpan untuk riwayat perjalanan dan pelaporan operasional.</li>
    <li>Log teknis dirotasi secara berkala dan tidak memuat data pribadi utuh.</li>
  </ul>`],
  ['hak', 'Hak Anda', `<ul>
    <li><strong>Mengakses dan memperbarui</strong> data profil kapan saja di halaman Profil.</li>
    <li><strong>Mengganti kata sandi</strong>; semua sesi di perangkat lain akan dikeluarkan.</li>
    <li><strong>Meminta penghapusan akun</strong> melalui admin. Riwayat transaksi yang wajib disimpan akan dianonimkan.</li>
    <li><strong>Menarik persetujuan</strong> atas data opsional dengan mengosongkan kolom profil.</li>
  </ul>`],
  ['tips', 'Tips menjaga akun', `<ul>
    <li>Gunakan kata sandi unik minimal 8 karakter dengan campuran huruf dan angka.</li>
    <li>Rangkai tidak pernah meminta kata sandi atau kode lewat telepon, email, atau chat.</li>
    <li>Akun dikunci sementara setelah 5 kali salah kata sandi. Bila itu bukan Anda, segera ganti kata sandi.</li>
    <li>Keluar dari akun saat memakai perangkat bersama.</li>
  </ul>`],
  ['kontak', 'Kontak', `<p>Pertanyaan tentang privasi dapat disampaikan ke <strong>privasi@rangkai.test</strong> atau melalui Pusat Bantuan. Kebijakan ini terakhir diperbarui 9 November 2026.</p>`],
];

export function render(main) {
  main.innerHTML = `<div class="page wrap privacy-page">
    <div class="page-head"><div><p class="eyebrow">Keamanan dan privasi</p><h1 class="h-sm">Data Anda, <em>dijaga dengan serius.</em></h1><p class="sub">Penjelasan singkat dan jujur tentang data yang kami simpan dan cara melindunginya.</p></div></div>
    <div class="priv-badges">
      <div><b>AES-256-GCM</b><span>Enkripsi data pribadi</span></div><div><b>mTLS</b><span>Antar-layanan terenkripsi</span></div><div><b>OAuth 2.0 + PKCE</b><span>Masuk tanpa membocorkan token</span></div><div><b>4 digit</b><span>NIK yang ditampilkan</span></div>
    </div>
    <div class="priv-layout">
      <nav class="toc" aria-label="Daftar isi">${SECTIONS.map(([id, t], i) => `<a href="#${id}" class="${i === 0 ? 'on' : ''}">${t}</a>`).join('')}</nav>
      <article class="prose">${SECTIONS.map(([id, t, html]) => `<h2 id="${id}">${t}</h2>${html}`).join('')}</article>
    </div>
  </div>`;
  $$('.toc a', main).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1)).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  const io = new IntersectionObserver((ents) => ents.forEach((en) => {
    if (en.isIntersecting) $$('.toc a', main).forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
  }), { rootMargin: '-20% 0px -70% 0px' });
  $$('.prose h2', main).forEach((h) => io.observe(h));
  return () => io.disconnect();
}
