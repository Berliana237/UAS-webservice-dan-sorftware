'use strict';
/** Mengubah event domain menjadi kalimat untuk pengguna. Fungsi murni, diuji unit test. */
const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;

function toNotification(topic, p) {
  switch (topic) {
    case 'booking.created':
      return { userId: p.userId, kind: 'booking', title: 'Pesanan dibuat', body: `Selesaikan pembayaran ${rupiah(p.amount)} sebelum waktu habis agar kursi Anda tetap aman.`, ref: p.bookingId };
    case 'booking.confirmed':
      return { userId: p.userId, kind: 'ticket', title: 'Tiket terbit', body: `Kode booking ${p.code}. Tunjukkan QR tiket saat naik kereta. Selamat jalan!`, ref: p.bookingId };
    case 'booking.cancelled':
      return { userId: p.userId, kind: 'booking', title: 'Pesanan dibatalkan', body: p.refundAmount > 0 ? `Pengembalian dana ${rupiah(p.refundAmount)} sedang diproses.` : 'Kursi Anda sudah dilepas.', ref: p.bookingId };
    case 'booking.expired':
      return { userId: p.userId, kind: 'booking', title: 'Waktu pembayaran habis', body: 'Kursi dilepas otomatis. Anda bisa memesan lagi kapan saja.', ref: p.bookingId };
    case 'payment.failed':
      return { userId: p.userId, kind: 'payment', title: 'Pembayaran gagal', body: 'Tidak ada dana yang terpotong. Silakan coba metode lain sebelum waktu habis.', ref: p.bookingId };
    case 'payment.refunded':
      return { userId: p.userId, kind: 'payment', title: 'Dana dikembalikan', body: `${rupiah(p.amount)} dikembalikan ke metode pembayaran Anda.`, ref: p.bookingId };
    case 'seat.lock.expired':
      return { userId: p.userId, kind: 'seat', title: 'Kursi dilepas', body: 'Kursi yang Anda tahan sudah melewati batas waktu.', ref: p.lockId };
    default:
      return null;
  }
}

module.exports = { toNotification, rupiah };
