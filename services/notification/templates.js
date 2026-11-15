'use strict';
/** Mengubah event domain menjadi kalimat untuk pengguna. Fungsi murni, diuji unit test. */
const rupiah = (n) => `Rp${Number(n || 0).toLocaleString('id-ID')}`;
const jam = (ms) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).replace('.', ':');

/** kind menentukan ikon dan warna di aplikasi. tone: info, success, warning, danger. */
function toNotification(topic, p) {
  switch (topic) {
    case 'booking.created':
      return { userId: p.userId, kind: 'booking', tone: 'info', title: 'Pesanan dibuat', body: `Selesaikan pembayaran ${rupiah(p.amount)} sebelum waktu habis agar kursi tetap aman.`, ref: p.bookingId };
    case 'booking.payment_due_soon':
      return { userId: p.userId, kind: 'reminder', tone: 'warning', title: 'Batas bayar tinggal 5 menit', body: `Pesanan ${p.code} akan dibatalkan otomatis pukul ${jam(p.expiresAt)} bila belum dibayar.`, ref: p.bookingId };
    case 'booking.confirmed':
      return { userId: p.userId, kind: 'ticket', tone: 'success', title: 'Tiket terbit', body: `Kode booking ${p.code}. Tunjukkan QR tiket saat naik kereta. Selamat jalan!`, ref: p.bookingId };
    case 'booking.departure_soon':
      return { userId: p.userId, kind: 'reminder', tone: 'info', title: 'Kereta berangkat sebentar lagi', body: `${p.trainName} berangkat dari ${p.fromName} pukul ${jam(p.departureAt)}. Datang 30 menit lebih awal, ya.`, ref: p.bookingId };
    case 'booking.trip_delayed':
      return { userId: p.userId, kind: 'delay', tone: 'warning', title: `Kereta terlambat ${p.delayMinutes} menit`, body: `${p.trainName} untuk pesanan ${p.code} terlambat sekitar ${p.delayMinutes} menit.${p.departureAt ? ` Perkiraan berangkat dari ${p.fromName || 'stasiun Anda'} pukul ${jam(p.departureAt + p.delayMinutes * 60000)}.` : ''} Mohon maaf atas ketidaknyamanannya.`, ref: p.bookingId };
    case 'booking.trip_on_time':
      return { userId: p.userId, kind: 'delay', tone: 'success', title: 'Kereta kembali tepat waktu', body: `${p.trainName} untuk pesanan ${p.code} berangkat sesuai jadwal${p.departureAt ? `, pukul ${jam(p.departureAt)}` : ''}.`, ref: p.bookingId };
    case 'trip.duty_soon':
      return { userId: p.userId, kind: 'duty', tone: 'info', title: 'Dinas Anda segera berangkat', body: `${p.trainName} dari ${p.fromName} berangkat pukul ${jam(p.departureAt)}${p.delayMinutes ? ` (terlambat ${p.delayMinutes} menit)` : ''}. Ketuk untuk membuka manifest dan denah kursi.`, ref: p.tripId };
    case 'booking.cancelled': {
      const why = p.reason === 'payment_reversed' ? 'Pembayaran Anda dibatalkan setelah pemeriksaan ulang, jadi tiket tidak berlaku.'
        : p.reason === 'trip_cancelled' ? 'Perjalanan dibatalkan oleh operator.' : null;
      const money = p.refundAmount > 0 ? ` Pengembalian dana ${rupiah(p.refundAmount)} sedang diproses.` : '';
      return { userId: p.userId, kind: 'booking', tone: 'danger', title: 'Pesanan dibatalkan', body: `${why || 'Kursi Anda sudah dilepas.'}${money}`, ref: p.bookingId };
    }
    case 'booking.expired':
      return { userId: p.userId, kind: 'booking', tone: 'danger', title: 'Waktu pembayaran habis', body: 'Kursi dilepas otomatis. Anda bisa memesan lagi kapan saja.', ref: p.bookingId };
    case 'payment.succeeded':
      return { userId: p.userId, kind: 'payment', tone: 'success', title: 'Pembayaran berhasil', body: `${rupiah(p.amount)} sudah kami terima. Tiket sedang diterbitkan.`, ref: p.bookingId };
    case 'payment.proof_submitted':
      return { userId: p.userId, kind: 'payment', tone: 'info', title: 'Bukti transfer diterima', body: 'Admin sedang memeriksa bukti Anda. Kursi tetap ditahan selama pemeriksaan.', ref: p.bookingId };
    case 'payment.proof_rejected':
      return { userId: p.userId, kind: 'payment', tone: 'danger', title: 'Pembayaran ditolak', body: `Alasan: ${p.reason}. Ketuk untuk melihat detail dan mengunggah ulang bukti.`, ref: p.bookingId };
    case 'payment.reversed':
      return { userId: p.userId, kind: 'payment', tone: 'danger', title: 'Pembayaran ditolak', body: `Alasan: ${p.reason}. Kursi tetap ditahan. Ketuk untuk mengunggah ulang bukti transfer.`, ref: p.bookingId };
    case 'payment.failed':
      return { userId: p.userId, kind: 'payment', tone: 'warning', title: 'Pembayaran gagal', body: 'Tidak ada dana yang terpotong. Silakan coba lagi sebelum waktu habis.', ref: p.bookingId };
    case 'payment.refunded':
      return { userId: p.userId, kind: 'payment', tone: 'info', title: 'Dana dikembalikan', body: `${rupiah(p.amount)} dikembalikan ke metode pembayaran Anda.`, ref: p.bookingId };
    case 'seat.lock.expired':
      return { userId: p.userId, kind: 'seat', tone: 'warning', title: 'Kursi dilepas', body: 'Kursi yang Anda tahan sudah melewati batas waktu.', ref: null };
    default:
      return null;
  }
}

module.exports = { toNotification, rupiah };
