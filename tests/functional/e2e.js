'use strict';
/** Uji fungsional ujung ke ujung lewat gateway: alur bahagia dan jalur negatif utama pemesanan. */
const c = require('../lib/client');

async function main() {
  const r = c.reporter('Uji Fungsional Ujung ke Ujung', 'functional-e2e');
  const customer = await c.login('customer@rangkai.test');
  const other = await c.login('customer2@rangkai.test');
  const operator = await c.login('operator@rangkai.test');
  const tripId = await c.arunikaTrip(4);
  const seat = `EKS1-${1 + Math.floor(Math.random() * 12)}A`;

  r.section('Jadwal');
  const st = await c.call('GET', '/api/stations');
  r.check('F-01', 'Daftar stasiun tersedia', st.status === 200 && st.json.stations.length >= 20, `${st.json?.stations?.length} stasiun`);
  const sch = await c.call('GET', `/api/schedules?from=SGU&to=MN&date=${c.wibDate(4)}`);
  r.check('F-02', 'Pencarian Surabaya-Madiun menemukan Arunika', sch.json?.trips?.some((t) => t.tripId === tripId));
  const rev = await c.call('GET', `/api/schedules?from=YK&to=SGU&date=${c.wibDate(4)}`);
  r.check('F-03', 'Arah sebaliknya pada rute satu arah tidak mengembalikan Arunika', !rev.json?.trips?.some((t) => t.tripId.startsWith('ARN-')));
  const badDate = await c.call('GET', '/api/schedules?from=SGU&to=MN&date=besok');
  r.check('F-04', 'Tanggal salah format ditolak 422', badDate.status === 422);

  r.section('GraphQL');
  const gql = await c.call('POST', '/graphql', { body: { query: `query($t:ID!){seatMap(tripId:$t,from:"SGU",to:"MN"){available total fromIndex toIndex coaches{coach{code} adultFare}}}`, variables: { t: tripId } } });
  r.check('F-05', 'seatMap mengembalikan ruas Surabaya-Madiun', gql.json?.data?.seatMap?.toIndex === 5 && gql.json.data.seatMap.coaches.length === 5, gql.text.slice(0, 120));
  const anon = await c.call('POST', '/graphql', { body: { query: 'mutation{updateTripStatus(id:"x",status:DELAYED){id}}' } });
  r.check('F-06', 'Mutation tanpa scope ditolak', anon.json?.errors?.[0]?.extensions?.code === 'INSUFFICIENT_SCOPE', anon.text.slice(0, 120));
  const fare = sch.json.trips.find((t) => t.tripId === tripId).fares.find((f) => f.seatClass === 'EKSEKUTIF').adult;

  r.section('Seat locking per segmen');
  const l1 = await c.lockSeat(customer.token, tripId, 'SGU', 'MN', [seat]);
  r.check('F-07', 'Lock Surabaya-Madiun berhasil', l1.status === 201, l1.text.slice(0, 120));
  const clash = await c.lockSeat(other.token, tripId, 'JG', 'NGW', [seat]);
  r.check('F-08', 'Ruas yang tumpang tindih ditolak 409 SEAT_CONFLICT', clash.status === 409 && clash.json?.error?.code === 'SEAT_CONFLICT', clash.text.slice(0, 120));
  const l2 = await c.lockSeat(other.token, tripId, 'MN', 'YK', [seat]);
  r.check('F-09', 'Kursi yang sama untuk Madiun-Yogyakarta berhasil', l2.status === 201, l2.text.slice(0, 120));
  const av = await c.call('GET', `/api/trips/${tripId}/availability?from=SGU&to=MN`);
  r.check('F-10', 'Ketersediaan menunjukkan kursi terkunci', av.json?.taken?.some((t) => t.seatId === seat && t.status === 'LOCKED'));

  const key = c.idem();
  const body = { tripId, from: 'SGU', to: 'JG', seats: ['PRM1-16D'] };
  const i1 = await c.call('POST', '/api/locks', { token: other.token, headers: { 'idempotency-key': key }, body });
  const i2 = await c.call('POST', '/api/locks', { token: other.token, headers: { 'idempotency-key': key }, body });
  r.check('F-11', 'Idempotency-Key: kirim ulang mengembalikan lock yang sama', i1.status === 201 && i2.json?.id === i1.json?.id && i2.headers.get('idempotent-replay') === 'true', `${i1.json?.id} / ${i2.json?.id}`);
  const i3 = await c.call('POST', '/api/locks', { token: other.token, headers: { 'idempotency-key': key }, body: { ...body, seats: ['PRM1-16C'] } });
  r.check('F-12', 'Idempotency-Key dengan isi berbeda ditolak 409', i3.status === 409 && i3.json?.error?.code === 'IDEMPOTENCY_KEY_REUSED');
  await c.call('DELETE', `/api/locks/${i1.json.id}`, { token: other.token });
  const noKey = await c.call('POST', '/api/locks', { token: other.token, body });
  r.check('F-13', 'Tanpa Idempotency-Key ditolak 400', noKey.status === 400);

  r.section('Pesanan dan pembayaran');
  const bad = await c.call('POST', '/api/bookings', { token: customer.token, headers: { 'idempotency-key': c.idem() }, body: { lockId: l1.json.id, passengers: [{ seatId: seat, name: 'Sinta', age: 30, nik: '123' }] } });
  r.check('F-14', 'NIK salah format ditolak 422', bad.status === 422 && bad.json?.error?.code === 'INVALID_NIK', bad.text.slice(0, 120));
  const b = await c.createBooking(customer.token, l1.json.id, [seat]);
  r.check('F-15', 'Pesanan dibuat dengan harga dari server', b.status === 201 && b.json?.amount === fare, `amount ${b.json?.amount} vs ${fare}`);
  const idor = await c.call('GET', `/api/bookings/${b.json.id}`, { token: other.token });
  r.check('F-16', 'Pesanan milik orang lain tidak bisa dibaca (404)', idor.status === 404);
  const idorPay = await c.call('POST', '/api/payments', { token: other.token, headers: { 'idempotency-key': c.idem() }, body: { bookingId: b.json.id } });
  r.check('F-17', 'Pesanan orang lain tidak bisa dibayar (404)', idorPay.status === 404);
  const { booking } = await c.payBooking(customer.token, b.json.id);
  r.check('F-18', 'Webhook, event, lalu tiket terbit', booking.status === 'CONFIRMED' && booking.passengers[0].ticketCode?.startsWith('TKT-'));
  const av2 = await c.call('GET', `/api/trips/${tripId}/availability?from=SGU&to=MN`);
  r.check('F-19', 'Status kursi berubah menjadi BOOKED', av2.json?.taken?.some((t) => t.seatId === seat && t.status === 'BOOKED'));

  r.section('Check-in dan manifest');
  const code = booking.passengers[0].ticketCode;
  const forbid = await c.call('POST', '/api/tickets/checkin', { token: customer.token, body: { ticketCode: code } });
  r.check('F-20', 'Pelanggan tidak boleh check-in (403)', forbid.status === 403);
  const man = await c.call('GET', `/api/trips/${tripId}/manifest`, { token: operator.token });
  r.check('F-21', 'Manifest operator memasker NIK', man.json?.passengers?.[0]?.nikMasked?.startsWith('****') && !man.text.includes(c.NIK));
  const ci = await c.call('POST', '/api/tickets/checkin', { token: operator.token, body: { ticketCode: code } });
  r.check('F-22', 'Check-in berhasil', ci.status === 200 && ci.json?.checkedIn === true, ci.text.slice(0, 100));
  const ci2 = await c.call('POST', '/api/tickets/checkin', { token: operator.token, body: { ticketCode: code } });
  r.check('F-23', 'Tiket tidak bisa dipakai dua kali (409)', ci2.status === 409);

  r.section('Pembatalan dan kedaluwarsa');
  const canTrip = await c.arunikaTrip(5);
  const cl = await c.lockSeat(customer.token, canTrip, 'SGU', 'YK', ['SUI1-2A']);
  const cb = await c.createBooking(customer.token, cl.json.id, ['SUI1-2A']);
  await c.payBooking(customer.token, cb.json.id);
  const prev = await c.call('GET', `/api/bookings/${cb.json.id}/refund-preview`, { token: customer.token });
  r.check('F-24', 'Pratinjau refund 90 persen untuk keberangkatan jauh', prev.json?.percent === 90, prev.text);
  const cancel = await c.call('POST', `/api/bookings/${cb.json.id}/cancel`, { token: customer.token });
  r.check('F-25', 'Pembatalan mengembalikan dana', cancel.status === 200 && cancel.json?.status === 'CANCELLED' && cancel.json?.refundAmount === prev.json.refundAmount);
  const relock = await c.lockSeat(other.token, canTrip, 'SGU', 'YK', ['SUI1-2A']);
  r.check('F-26', 'Kursi tersedia lagi setelah dibatalkan', relock.status === 201, relock.text.slice(0, 100));
  await c.call('DELETE', `/api/locks/${relock.json.id}`, { token: other.token });

  const ttlLock = await c.lockSeat(customer.token, canTrip, 'SGU', 'MN', ['SUI1-3A'], { ttlSeconds: 3 });
  const ttlBook = await c.createBooking(customer.token, ttlLock.json.id, ['SUI1-3A']);
  r.check('F-27', 'Pesanan dengan lock berumur 3 detik dibuat', ttlBook.status === 201);
  const expired = await c.waitUntil(async () => {
    const x = await c.call('GET', `/api/bookings/${ttlBook.json.id}`, { token: customer.token });
    return x.json?.status === 'EXPIRED' ? x : null;
  }, { timeoutMs: 8000 });
  r.check('F-28', 'Pesanan tidak dibayar kedaluwarsa otomatis', Boolean(expired));
  const after = await c.lockSeat(other.token, canTrip, 'SGU', 'MN', ['SUI1-3A']);
  r.check('F-29', 'Kursi dilepas otomatis setelah TTL', after.status === 201, after.text.slice(0, 100));
  await c.call('DELETE', `/api/locks/${after.json.id}`, { token: other.token });

  r.section('Pembayaran terlambat');
  const late = await c.lockSeat(customer.token, canTrip, 'SGU', 'MN', ['SUI1-4A'], { ttlSeconds: 4 });
  const lateB = await c.createBooking(customer.token, late.json.id, ['SUI1-4A']);
  const lateP = await c.call('POST', '/api/payments', { token: customer.token, headers: { 'idempotency-key': c.idem() }, body: { bookingId: lateB.json.id, method: 'QRIS' } });
  await new Promise((res) => setTimeout(res, 4500));
  await c.call('POST', `/api/mock-gateway/checkout/${lateP.json.checkoutToken}/pay`, { token: customer.token, body: { outcome: 'success' } });
  const refunded = await c.waitUntil(async () => {
    const x = await c.call('GET', `/api/payments/${lateP.json.payment.id}`, { token: customer.token });
    return x.json?.payment?.status === 'REFUNDED' ? x : null;
  });
  r.check('F-30', 'Bayar setelah TTL: tiket tidak terbit, dana dikembalikan', Boolean(refunded));
  const lateFinal = await c.call('GET', `/api/bookings/${lateB.json.id}`, { token: customer.token });
  r.check('F-31', 'Pesanan terlambat berstatus EXPIRED', lateFinal.json?.status === 'EXPIRED', lateFinal.json?.status);

  r.section('Notifikasi lewat message queue');
  const notif = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/notifications', { token: customer.token });
    return x.json?.notifications?.some((n) => n.title === 'Tiket terbit') ? x : null;
  });
  r.check('F-32', 'Notifikasi tiket terbit diterima lewat event', Boolean(notif));
  r.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
