'use strict';
/** Demo Minggu 11: komunikasi asinkron lewat message queue. Termasuk konsumen mati, broker mati, retry, dan DLQ. */
const c = require('../lib/client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queues(admin) {
  const q = await c.call('GET', '/api/admin/queues', { token: admin.token });
  return Object.fromEntries(q.json.queues.map((x) => [x.queue, x]));
}

async function booked(user, trip, seat) {
  const l = await c.lockSeat(user.token, trip, 'SGU', 'MN', [seat]);
  const b = await c.createBooking(user.token, l.json.id, [seat]);
  return b.json;
}

async function run({ stack } = {}) {
  const r = c.reporter('Demo Minggu 11: Message Queue', 'week-11');
  const admin = await c.login('admin@rangkai.test');
  const user = await c.registerUser('antrian');
  const trip = await c.arunikaTrip(6);
  const seat = () => `PRM1-${1 + Math.floor(Math.random() * 16)}A`;

  r.section('Alur event: pembayaran ke tiket ke notifikasi');
  const s1 = seat();
  const b = await booked(user, trip, s1);
  r.check('W11-01', 'Pesanan dibuat dan event booking.created masuk antrian', b.status === 'PENDING_PAYMENT');
  const { booking } = await c.payBooking(user.token, b.id);
  r.check('W11-02', 'Webhook diubah jadi event, lalu booking-service menerbitkan tiket', booking.status === 'CONFIRMED');
  const note = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/notifications', { token: user.token });
    return x.json.notifications.some((n) => n.title === 'Tiket terbit');
  });
  r.check('W11-03', 'notification-service menerima event dan membuat notifikasi', Boolean(note));
  const before = await queues(admin);
  r.info(`Statistik antrian: ${JSON.stringify(Object.values(before).map((q) => ({ q: q.queue, terbit: q.published, selesai: q.acked })))}`);
  r.check('W11-04', 'Antrian booking.events memproses pesan', before['booking.events'].acked >= 1);

  r.section('Retry dan dead letter queue');
  const dlqBefore = before['notification.events'].dead || 0;
  await c.call('POST', '/api/admin/queues/publish-test', { token: admin.token, body: { poison: true, note: 'demo DLQ' } });
  r.info('Pesan beracun gagal diproses, dicoba ulang dengan jeda bertambah...');
  const dead = await c.waitUntil(async () => ((await queues(admin))['notification.events'].dead || 0) > dlqBefore, { timeoutMs: 15000, everyMs: 500 });
  r.check('W11-05', 'Setelah gagal berulang, pesan masuk DLQ', Boolean(dead));
  const dlq = await c.call('GET', '/api/admin/queues/notification.events/dlq', { token: admin.token });
  r.check('W11-06', 'Isi DLQ bisa diperiksa, termasuk penyebabnya', dlq.json.messages.some((m) => /beracun/.test(m.lastError)), dlq.json.messages[0]?.lastError);
  const replay = await c.call('POST', '/api/admin/queues/notification.events/dlq/replay', { token: admin.token, body: {} });
  r.check('W11-07', 'Pesan DLQ bisa dikirim ulang', replay.json.replayed >= 1, `${replay.json.replayed} pesan`);

  r.section('Pesan uji normal');
  const ping = await c.call('POST', '/api/admin/queues/publish-test', { token: admin.token, body: { note: `ping-${Date.now()}` } });
  const consumed = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/admin/queue-consumed', { token: admin.token });
    return x.json.consumed.some((m) => m.msg_id === ping.json.id);
  });
  r.check('W11-08', 'Pesan normal dikonsumsi sekali', Boolean(consumed));

  if (!stack) {
    r.info('Uji konsumen mati dan broker mati butuh kontrol proses. Jalankan bat\\week-11.bat.');
    return r.finish();
  }

  r.section('Asinkron: konsumen mati, pesan tidak hilang');
  stack.kill('notification');
  await sleep(500);
  const s2 = seat();
  const b2 = await booked(user, trip, s2);
  await c.payBooking(user.token, b2.id);
  const waiting = await c.waitUntil(async () => ((await queues(admin))['notification.events'].ready || 0) >= 1, { timeoutMs: 6000, everyMs: 300 });
  r.check('W11-09', 'Alur pesan tetap jalan walau notification mati, pesan menumpuk', Boolean(waiting));
  stack.start('notification');
  const drained = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/notifications', { token: user.token }).catch(() => null);
    return x?.json?.notifications?.filter((n) => n.title === 'Tiket terbit').length >= 2;
  }, { timeoutMs: 25000, everyMs: 700 });
  r.check('W11-10', 'Setelah hidup lagi, konsumen menghabiskan tumpukan', Boolean(drained));

  r.section('Transactional outbox: broker mati, event tidak hilang');
  stack.kill('broker');
  await sleep(700);
  const s3 = seat();
  const l3 = await c.lockSeat(user.token, trip, 'SGU', 'MN', [s3]);
  const b3 = await c.createBooking(user.token, l3.json.id, [s3]);
  r.check('W11-11', 'Pesanan tetap tersimpan saat broker mati', b3.status === 201, `status ${b3.status}`);
  const pending = await c.call('GET', '/api/admin/booking-stats', { token: admin.token });
  r.check('W11-12', 'Event tertahan aman di outbox', pending.json.outboxPending >= 1, `outbox ${pending.json.outboxPending}`);
  stack.start('broker');
  const flushed = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/admin/booking-stats', { token: admin.token });
    return x.json?.outboxPending === 0;
  }, { timeoutMs: 25000, everyMs: 700 });
  r.check('W11-13', 'Setelah broker hidup, relay mengirim semua event tertunda', Boolean(flushed));
  const created = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/notifications', { token: user.token });
    return x.json?.notifications?.filter((n) => n.title === 'Pesanan dibuat').length >= 3;
  }, { timeoutMs: 15000, everyMs: 700 });
  r.check('W11-14', 'Event dari masa broker mati sampai ke pengguna', Boolean(created));
  return r.finish();
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
