'use strict';
/** Unit test untuk logika murni service Node. Tanpa jaringan, tanpa database (prinsip FIRST). */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.PII_KEY_BASE64 = crypto.randomBytes(32).toString('base64');
process.env.BLIND_INDEX_KEY = 'kunci-uji';

const { TokenBucketLimiter } = require('../../services/gateway/rate-limit');
const schemas = require('../../services/gateway/schemas');
const { match, ROUTES, isSpecific } = require('../../services/gateway/routes');
const sig = require('../../services/payment/signature');
const rules = require('../../services/auth/rules');
const { mask, maskString } = require('../../services/shared/log');
const pii = require('../../services/shared/pii');
const { matches, resolveQueues } = require('../../services/broker/routing');
const { toNotification, rupiah } = require('../../services/notification/templates');
const { adultFare, seatIds, COACHES, LINES } = require('../../services/catalog/seed');
const { depthLimitRule, fieldLimitRule } = require('../../services/catalog/graphql-guard');
const { safeJoin } = require('../../services/gateway/static');
const { buildSchema, parse, validate, specifiedRules } = require('graphql');
const path = require('node:path');

test('rate limiter: kuota habis lalu terisi lagi seiring waktu', () => {
  let now = 0;
  const l = new TokenBucketLimiter({ now: () => now });
  for (let i = 0; i < 3; i++) assert.equal(l.take('a', 3).allowed, true);
  const blocked = l.take('a', 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  now += 20000;
  assert.equal(l.take('a', 3).allowed, true);
  assert.equal(l.take('a', 3).allowed, false);
});

test('rate limiter: kunci berbeda tidak saling mengganggu', () => {
  const l = new TokenBucketLimiter({ now: () => 0 });
  l.take('a', 1);
  assert.equal(l.take('a', 1).allowed, false);
  assert.equal(l.take('b', 1).allowed, true);
});

test('rate limiter: sweep membuang kunci yang lama diam', () => {
  let now = 0;
  const l = new TokenBucketLimiter({ now: () => now });
  l.take('a', 5);
  now = 700000;
  l.sweep();
  assert.equal(l.buckets.size, 0);
});

test('skema lock: batas jumlah kursi (BVA 0, 1, 4, 5)', () => {
  const body = (n) => ({ tripId: 'T', from: 'A', to: 'B', seats: Array.from({ length: n }, (_, i) => `EKS1-${i + 1}A`) });
  assert.ok(schemas.check('lock', body(0)));
  assert.equal(schemas.check('lock', body(1)), null);
  assert.equal(schemas.check('lock', body(4)), null);
  assert.ok(schemas.check('lock', body(5)));
});

test('skema lock: format kursi, kursi kembar, dan field asing ditolak', () => {
  const ok = { tripId: 'T', from: 'A', to: 'B', seats: ['EKS1-1A'] };
  assert.equal(schemas.check('lock', ok), null);
  assert.ok(schemas.check('lock', { ...ok, seats: ["1' OR 1=1 --"] }));
  assert.ok(schemas.check('lock', { ...ok, seats: ['EKS1-1A', 'EKS1-1A'] }));
  assert.ok(schemas.check('lock', { ...ok, admin: true }));
  assert.ok(schemas.check('lock', { ...ok, ttlSeconds: 2 }));
});

test('routes: rute dikenali, metode salah dibedakan dari rute tak dikenal', () => {
  assert.equal(match('POST', '/api/locks').route.svc, 'booking');
  assert.equal(match('GET', '/api/locks').route, null);
  assert.equal(match('PUT', '/api/locks').methodNotAllowed, true);
  assert.equal(match('GET', '/api/tidak-ada').methodNotAllowed, false);
});

test('routes: endpoint tulis pelanggan selalu mensyaratkan scope', () => {
  for (const [m, p] of [['POST', '/api/locks'], ['POST', '/api/bookings'], ['POST', '/api/payments'], ['POST', '/api/tickets/checkin'], ['GET', '/api/admin/users'], ['GET', '/api/admin/queues']]) {
    assert.ok(match(m, p).route.scopes?.length > 0, `${m} ${p} harus punya scope`);
  }
  assert.ok(ROUTES.filter((r) => r.partner).length >= 3);
  assert.equal(isSpecific('/api/x'), true);
  assert.equal(isSpecific('/masuk'), false);
});

test('webhook: tanda tangan sah diterima, isi yang diubah ditolak', () => {
  const body = '{"a":1}';
  const h = sig.header('rahasia', body, 1000);
  assert.deepEqual(sig.verify('rahasia', h, body, 1000), { ok: true });
  assert.equal(sig.verify('rahasia', h, '{"a":2}', 1000).reason, 'signature');
  assert.equal(sig.verify('salah', h, body, 1000).reason, 'signature');
});

test('webhook: batas toleransi waktu (BVA 5 menit) mencegah replay', () => {
  const body = '{}';
  const t0 = 10_000_000;
  const h = sig.header('s', body, t0);
  assert.equal(sig.verify('s', h, body, t0 + sig.TOLERANCE_MS).ok, true);
  assert.equal(sig.verify('s', h, body, t0 + sig.TOLERANCE_MS + 1).reason, 'timestamp');
  assert.equal(sig.verify('s', 'bukan-format', body, t0).reason, 'format');
});

test('kartu: nomor kartu mentah terdeteksi lewat Luhn', () => {
  assert.equal(sig.looksLikePan('4111 1111 1111 1111'), true);
  assert.equal(sig.looksLikePan('4111111111111112'), false);
  assert.equal(sig.looksLikePan('tok_demo123'), false);
  assert.equal(sig.looksLikePan('1234'), false);
});

test('PKCE S256 sesuai contoh RFC 7636', () => {
  assert.equal(rules.pkceS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('kata sandi: batas panjang dan komposisi', () => {
  assert.ok(rules.validatePassword('abc1234'));
  assert.equal(rules.validatePassword('abcd1234'), null);
  assert.equal(rules.validatePassword(`a1${'x'.repeat(70)}`), null);
  assert.ok(rules.validatePassword(`a1${'x'.repeat(71)}`));
  assert.ok(rules.validatePassword('abcdefgh'));
  assert.ok(rules.validatePassword('12345678'));
  assert.ok(rules.validatePassword(undefined));
});

test('email dan scope: least privilege', () => {
  assert.equal(rules.validateEmail('a@b.co'), null);
  assert.ok(rules.validateEmail('a@b'));
  assert.equal(rules.narrowScope('a c', ['a', 'b']), 'a');
  assert.equal(rules.narrowScope('', ['a', 'b']), 'a b');
  assert.equal(rules.narrowScope('z', ['a']), '');
  assert.ok(rules.scopesForRole('customer').includes('booking:write'));
  assert.ok(!rules.scopesForRole('customer').includes('admin'));
  assert.deepEqual(rules.scopesForRole('hantu'), []);
});

test('masking log: token, NIK, email, dan key tidak tertulis utuh', () => {
  const out = maskString('Bearer abc.def nik 3578015203990001 mail sinta@contoh.id key rk_live_abc123');
  assert.ok(!out.includes('abc.def'));
  assert.ok(!out.includes('3578015203990001'));
  assert.ok(!out.includes('sinta@'));
  assert.ok(!out.includes('rk_live_abc123'));
  assert.deepEqual(mask({ password: 'x', nested: { token: 'y', ok: 1 } }), { password: '***', nested: { token: '***', ok: 1 } });
});

test('enkripsi kolom: bolak-balik benar dan IV selalu baru', () => {
  const a = pii.encrypt('3578015203990001');
  const b = pii.encrypt('3578015203990001');
  assert.notEqual(a, b);
  assert.equal(pii.decrypt(a), '3578015203990001');
  assert.ok(!a.includes('3578'));
  assert.equal(pii.blindIndex(' A@B.co '), pii.blindIndex('a@b.co'));
  assert.equal(pii.safeEqual('a', 'a'), true);
  assert.equal(pii.safeEqual('a', 'ab'), false);
});

test('enkripsi kolom: data yang dirusak gagal didekripsi', () => {
  const blob = pii.encrypt('rahasia');
  const raw = Buffer.from(blob.slice(3), 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => pii.decrypt(`v1:${raw.toString('base64')}`));
});

test('routing broker: pola dan fan-out antrian', () => {
  assert.equal(matches('booking.*', 'booking.created'), true);
  assert.equal(matches('booking.*', 'bookings.created'), false);
  assert.equal(matches('payment.failed', 'payment.failed'), true);
  assert.deepEqual(resolveQueues('payment.succeeded').sort(), ['booking.events', 'notification.events']);
  assert.deepEqual(resolveQueues('audit.login.success'), ['audit.events']);
  assert.deepEqual(resolveQueues('tidak.dikenal'), []);
});

test('templat notifikasi', () => {
  assert.equal(rupiah(150000), 'Rp150.000');
  assert.equal(toNotification('booking.confirmed', { userId: 'u', code: 'ABC', bookingId: 'b' }).title, 'Tiket terbit');
  assert.match(toNotification('booking.cancelled', { userId: 'u', refundAmount: 5000 }).body, /Rp5\.000/);
  assert.equal(toNotification('tidak.dikenal', {}), null);
});

test('katalog: tarif, kursi, dan rute konsisten', () => {
  assert.equal(adultFare('EKSEKUTIF', 155), 185000);
  assert.equal(adultFare('PREMIUM', 1), 31000);
  assert.equal(seatIds(COACHES[0]).length, 16);
  assert.equal(new Set(COACHES.flatMap(seatIds)).size, COACHES.flatMap(seatIds).length);
  for (const l of LINES) {
    const km = l.stops.map((s) => s[2]);
    assert.deepEqual(km, [...km].sort((a, b) => a - b), `km ${l.code} harus naik`);
  }
});

test('GraphQL guard: query terlalu dalam dan terlalu besar ditolak', () => {
  const schema = buildSchema('type Query{a:A} type A{a:A b:Int}');
  const run = (q, rule) => validate(schema, parse(q), [...specifiedRules, rule]);
  assert.equal(run('{a{a{b}}}', depthLimitRule(3)).length, 0);
  assert.equal(run('{a{a{a{b}}}}', depthLimitRule(3)).length, 1);
  assert.equal(run('{a{...F}} fragment F on A{a{a{b}}}', depthLimitRule(3)).length, 1);
  assert.equal(run('{a{b}}', fieldLimitRule(2)).length, 0);
  assert.equal(run('{a{b b b}}', fieldLimitRule(2)).length, 1);
});

test('path traversal: keluar dari folder dasar ditolak', () => {
  const base = path.resolve('/srv/web');
  assert.ok(safeJoin(base, 'assets/app.js').startsWith(base));
  assert.ok(safeJoin(base, '../../etc/passwd').startsWith(base), 'dinormalisasi tetap di dalam folder');
});
