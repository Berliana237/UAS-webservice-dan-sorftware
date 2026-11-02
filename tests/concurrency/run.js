'use strict';
/**
 * Uji konkurensi seat locking per segmen, end-to-end lewat gateway dan dua instance booking-service.
 * Invarian utama yang diperiksa: tidak boleh ada dua pemegang aktif pada (trip, kursi, segmen) yang sama.
 */
const c = require('../lib/client');

const USERS = Number(process.env.CONCURRENCY_USERS || 50);

/** Stop perjalanan Arunika: urutan indeks segmen dipakai untuk menghitung tumpang tindih. */
const STOPS = ['SGU', 'MR', 'JG', 'KTS', 'NJ', 'MN', 'NGW', 'SLO', 'YK'];

const overlap = (a, b) => a.from < b.to && b.from < a.to;

async function main() {
  const r = c.reporter(`Uji Konkurensi Seat Locking (${USERS} pengguna)`, 'concurrency');
  const logins = await Promise.all(Array.from({ length: USERS }, (_, i) => c.login(`load${i + 1}@rangkai.test`)));
  const tokens = logins.map((l) => l.token);
  r.info(`${tokens.length} pengguna siap masuk.`);
  const day = 8;
  const tripId = await c.arunikaTrip(day);
  const trip2 = await c.arunikaTrip(day + 1);
  const trip3 = await c.arunikaTrip(day + 2);
  const trip4 = await c.arunikaTrip(day + 3);

  r.section('K-01 Semua merebut kursi dan ruas yang sama');
  const t0 = Date.now();
  const same = await Promise.all(tokens.map((t) => c.lockSeat(t, tripId, 'SGU', 'MN', ['EKS1-1A'])));
  const ms = Date.now() - t0;
  const wins = same.filter((x) => x.status === 201);
  const lost = same.filter((x) => x.status === 409 && x.json?.error?.code === 'SEAT_CONFLICT');
  const instances = new Set(same.map((x) => x.headers.get('x-upstream-instance')));
  r.check('K-01a', 'Tepat satu pemenang', wins.length === 1, `pemenang ${wins.length}`);
  r.check('K-01b', 'Sisanya 409 SEAT_CONFLICT, tanpa 5xx', lost.length === USERS - 1, `conflict ${lost.length}, status lain ${[...new Set(same.map((x) => x.status))].join(',')}`);
  r.check('K-01c', 'Permintaan dilayani oleh dua instance booking-service', instances.size === 2, [...instances].join(', '));
  r.info(`${USERS} permintaan selesai dalam ${ms} ms`);

  r.section('K-02 Ruas sebagian tumpang tindih');
  const ranges = [['SGU', 'MN'], ['JG', 'SLO'], ['MR', 'JG'], ['NGW', 'YK'], ['MN', 'NGW'], ['KTS', 'NGW'], ['SLO', 'YK'], ['SGU', 'MR']];
  const attempts = await Promise.all(ranges.map(([from, to], i) => c.lockSeat(tokens[20 + i], tripId, from, to, ['EKS1-2A'])));
  const accepted = attempts.map((a, i) => ({ ok: a.status === 201, from: STOPS.indexOf(ranges[i][0]), to: STOPS.indexOf(ranges[i][1]) })).filter((a) => a.ok);
  const clean = accepted.every((a, i) => accepted.slice(i + 1).every((b) => !overlap(a, b)));
  r.check('K-02a', 'Lock yang diterima tidak ada yang tumpang tindih', clean && accepted.length >= 1, `${accepted.length} diterima: ${accepted.map((a) => `[${a.from},${a.to})`).join(' ')}`);
  const nonFive = attempts.every((a) => a.status === 201 || a.status === 409);
  r.check('K-02b', 'Semua respons 201 atau 409', nonFive);

  r.section('K-03 Ruas bersebelahan pada satu kursi');
  const legs = STOPS.slice(0, -1).map((from, i) => [from, STOPS[i + 1]]);
  const adj = await Promise.all(legs.map(([from, to], i) => c.lockSeat(tokens[30 + i], tripId, from, to, ['EKS1-3A'])));
  r.check('K-03', `${legs.length} ruas berturut-turut pada kursi yang sama semuanya berhasil`, adj.every((a) => a.status === 201), adj.map((a) => a.status).join(','));

  r.section('K-04 Klaim banyak kursi bersifat atomik');
  const trio = await Promise.all([
    c.lockSeat(tokens[0], trip2, 'SGU', 'YK', ['PRM1-1A', 'PRM1-1B']),
    c.lockSeat(tokens[1], trip2, 'SGU', 'YK', ['PRM1-1B', 'PRM1-1C']),
    c.lockSeat(tokens[2], trip2, 'SGU', 'YK', ['PRM1-1C', 'PRM1-1D']),
    c.lockSeat(tokens[3], trip2, 'SGU', 'YK', ['PRM1-1D', 'PRM1-1A']),
  ]);
  const won = trio.filter((x) => x.status === 201).flatMap((x) => x.json.seats);
  const av = await c.call('GET', `/api/trips/${trip2}/availability?from=SGU&to=YK`);
  const held = av.json.taken.map((t) => t.seatId).sort();
  r.check('K-04', 'Kursi terkunci hanya milik pemenang, tidak ada klaim setengah jalan', JSON.stringify(held) === JSON.stringify([...won].sort()), `dipegang ${held.join(',')}`);

  r.section('K-05 Idempotency-Key dikirim bersamaan');
  const key = c.idem();
  const body = { tripId: trip2, from: 'SGU', to: 'MN', seats: ['PRM2-5A'] };
  const dup = await Promise.all(Array.from({ length: 20 }, () => c.call('POST', '/api/locks', { token: tokens[10], headers: { 'idempotency-key': key }, body })));
  const ids = new Set(dup.filter((d) => d.status === 201).map((d) => d.json.id));
  r.check('K-05a', '20 kiriman menghasilkan satu lock', ids.size === 1, [...ids].join(','));
  r.check('K-05b', 'Tidak ada kiriman yang gagal', dup.every((d) => d.status === 201), [...new Set(dup.map((d) => d.status))].join(','));

  r.section('K-06 Badai acak');
  const STORM = 240;
  const seats = ['EKS2-7A', 'EKS2-7B', 'EKS2-7C', 'EKS2-7D', 'EKS2-8A'];
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  const jobs = Array.from({ length: STORM }, (_, i) => {
    const a = rnd(STOPS.length - 1);
    const b = a + 1 + rnd(STOPS.length - 1 - a);
    return { seat: seats[rnd(seats.length)], a, b, token: tokens[i % tokens.length] };
  });
  const results = [];
  for (let i = 0; i < jobs.length; i += 40) {
    results.push(...await Promise.all(jobs.slice(i, i + 40).map((j) => c.lockSeat(j.token, trip3, STOPS[j.a], STOPS[j.b], [j.seat]))));
  }
  const accepted2 = jobs.map((j, i) => ({ ...j, from: j.a, to: j.b, ok: results[i].status === 201 })).filter((j) => j.ok);
  let violations = 0;
  for (const s of seats) {
    const list = accepted2.filter((j) => j.seat === s);
    for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) if (overlap(list[i], list[k])) violations += 1;
  }
  const statuses = results.reduce((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {});
  r.check('K-06a', `${STORM} percobaan acak: tidak ada dua pemegang pada segmen yang sama`, violations === 0, `pelanggaran ${violations}; diterima ${accepted2.length}`);
  r.check('K-06b', 'Tidak ada error 5xx', !Object.keys(statuses).some((k) => Number(k) >= 500), JSON.stringify(statuses));

  r.section('K-07 Rebutan tepat saat TTL habis');
  const first = await c.lockSeat(tokens[20], trip4, 'SGU', 'MN', ['SUI1-1A'], { ttlSeconds: 3 });
  r.check('K-07a', 'Lock singkat dibuat', first.status === 201);
  await new Promise((res) => setTimeout(res, Math.max(0, first.json.expiresAt - Date.now()) + 50));
  const race = await Promise.all(tokens.slice(21, 41).map((t) => c.lockSeat(t, trip4, 'SGU', 'MN', ['SUI1-1A'])));
  r.check('K-07b', 'Setelah TTL habis tepat satu pengguna mendapatkannya', race.filter((x) => x.status === 201).length === 1, race.map((x) => x.status).join(','));

  r.section('K-08 Pembayaran ganda bersamaan');
  const payer = tokens[45];
  const l = await c.lockSeat(payer, trip4, 'MN', 'YK', ['SUI1-2A']);
  const b = await c.createBooking(payer, l.json.id, ['SUI1-2A']);
  const key2 = c.idem();
  const pays = await Promise.all(Array.from({ length: 8 }, () => c.call('POST', '/api/payments', { token: payer, headers: { 'idempotency-key': key2 }, body: { bookingId: b.json.id, method: 'QRIS' } })));
  const payIds = new Set(pays.filter((p) => p.status === 201).map((p) => p.json.payment.id));
  r.check('K-08a', 'Idempotency-Key pada pembayaran hanya membuat satu pembayaran', payIds.size === 1, [...payIds].join(','));
  const token = pays.find((p) => p.status === 201).json.checkoutToken;
  await Promise.all(Array.from({ length: 5 }, () => c.call('POST', `/api/mock-gateway/checkout/${token}/pay`, { token: payer, body: { outcome: 'success' } })));
  const done = await c.waitUntil(async () => { const x = await c.call('GET', `/api/bookings/${b.json.id}`, { token: payer }); return x.json?.status === 'CONFIRMED' ? x.json : null; });
  r.check('K-08b', 'Pesanan terkonfirmasi sekali dengan satu kode tiket', done?.passengers?.length === 1 && Boolean(done.passengers[0].ticketCode));
  const stats = await c.login('admin@rangkai.test');
  const st = await c.call('GET', '/api/admin/booking-stats', { token: stats.token });
  r.info(`Statistik akhir: ${JSON.stringify(st.json)}`);
  r.finish({ users: USERS, firstRoundMs: ms });
}

main().catch((e) => { console.error(e); process.exit(1); });
