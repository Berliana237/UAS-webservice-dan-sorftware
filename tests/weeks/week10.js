'use strict';
/** Demo Minggu 10: service discovery, load balancing, dan failover. Mematikan satu instance sungguhan. */
const c = require('../lib/client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sample(n) {
  const counts = {};
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const x = await c.call('GET', '/api/bookings/instance');
    if (x.status === 200) counts[x.json.instance] = (counts[x.json.instance] || 0) + 1; else failed += 1;
  }
  return { counts, failed };
}

async function run({ stack } = {}) {
  const r = c.reporter('Demo Minggu 10: Service Discovery dan Load Balancing', 'week-10');
  const admin = await c.login('admin@rangkai.test');

  r.section('Service discovery');
  const reg = await c.call('GET', '/api/admin/registry', { token: admin.token });
  const svc = Object.fromEntries(reg.json.services.map((s) => [s.name, s.instances]));
  for (const name of ['broker', 'auth', 'catalog', 'payment', 'notification']) r.check(`W10-${name}`, `${name} terdaftar di registry`, svc[name]?.length >= 1, svc[name]?.map((i) => i.instanceId).join(','));
  r.check('W10-01', 'Booking punya dua instance terdaftar', svc.booking?.length === 2, svc.booking?.map((i) => `${i.instanceId} (${i.url})`).join(', '));

  r.section('Load balancing round robin');
  const lb = await sample(20);
  r.info(`Pembagian 20 permintaan: ${JSON.stringify(lb.counts)}`);
  r.check('W10-02', 'Beban terbagi rata ke dua instance', lb.counts['booking-a'] >= 8 && lb.counts['booking-b'] >= 8, JSON.stringify(lb.counts));

  if (!stack) {
    r.info('Uji failover butuh kontrol proses. Jalankan bat\\week-10.bat agar instance bisa dimatikan otomatis.');
    return r.finish();
  }

  r.section('Failover: booking-a dimatikan');
  stack.kill('booking-a');
  await sleep(600);
  const during = await sample(12);
  r.info(`Selama instance mati: ${JSON.stringify(during.counts)}, gagal ${during.failed}`);
  r.check('W10-03', 'Permintaan tetap dilayani tanpa kegagalan', during.failed === 0 && during.counts['booking-b'] >= 1, `gagal ${during.failed}`);

  const user = await c.login('customer@rangkai.test');
  const trip = await c.arunikaTrip(7);
  const lk = await c.lockSeat(user.token, trip, 'SGU', 'MN', [`EKS2-${1 + Math.floor(Math.random() * 12)}D`]);
  r.check('W10-04', 'Seat locking tetap berjalan saat satu instance mati', lk.status === 201, `status ${lk.status}`);
  if (lk.status === 201) await c.call('DELETE', `/api/locks/${lk.json.id}`, { token: user.token });

  r.info('Menunggu heartbeat kedaluwarsa (12 detik)...');
  const gone = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/admin/registry', { token: admin.token });
    return x.json.services.find((s) => s.name === 'booking').instances.length === 1;
  }, { timeoutMs: 20000, everyMs: 800 });
  r.check('W10-05', 'Registry mengeluarkan instance yang mati', Boolean(gone));

  r.section('Instance kembali hidup');
  stack.start('booking-a');
  const back = await c.waitUntil(async () => {
    const x = await c.call('GET', '/api/admin/registry', { token: admin.token });
    return x.json.services.find((s) => s.name === 'booking').instances.length === 2;
  }, { timeoutMs: 25000, everyMs: 800 });
  r.check('W10-06', 'Instance mendaftar lagi secara otomatis', Boolean(back));
  await sleep(2500);
  const after = await sample(12);
  r.check('W10-07', 'Beban kembali terbagi ke dua instance', after.counts['booking-a'] >= 1 && after.counts['booking-b'] >= 1, JSON.stringify(after.counts));
  return r.finish();
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
