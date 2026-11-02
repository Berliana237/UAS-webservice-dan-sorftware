'use strict';
/**
 * Payment service. Status bayar hanya dipercaya dari webhook bertanda tangan, bukan dari klaim klien.
 * Nominal selalu diambil dari booking-service, dan data kartu tidak pernah disimpan (tokenisasi oleh gateway simulasi).
 */
const crypto = require('node:crypto');
const express = require('express');
const config = require('../shared/config');
const { createApp, finish, ApiError, unavailable } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const dbm = require('../shared/db');
const pii = require('../shared/pii');
const sig = require('./signature');

const { log, http, registry, bus, verifier } = kit('payment');
const db = dbm.open('payment');
db.exec(`
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, user_id TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
  provider_ref TEXT UNIQUE NOT NULL, checkout_hash TEXT NOT NULL, refund_amount INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pay_booking ON payments(booking_id);
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, idem_key));
CREATE TABLE IF NOT EXISTS webhook_events(event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
`);
const st = {
  insert: db.prepare(`INSERT INTO payments(id,booking_id,user_id,amount,method,status,provider_ref,checkout_hash,created_at,updated_at) VALUES(?,?,?,?,?,'PENDING',?,?,?,?)`),
  byId: db.prepare('SELECT * FROM payments WHERE id=?'),
  byRef: db.prepare('SELECT * FROM payments WHERE provider_ref=?'),
  byCheckout: db.prepare('SELECT * FROM payments WHERE checkout_hash=?'),
  activeForBooking: db.prepare(`SELECT * FROM payments WHERE booking_id=? AND status IN ('PENDING','SUCCEEDED')`),
  succeededForBooking: db.prepare(`SELECT * FROM payments WHERE booking_id=? AND status='SUCCEEDED'`),
  setStatus: db.prepare('UPDATE payments SET status=?, updated_at=? WHERE id=?'),
  setRefund: db.prepare(`UPDATE payments SET status='REFUNDED', refund_amount=?, updated_at=? WHERE id=?`),
  idemGet: db.prepare('SELECT * FROM idempotency WHERE user_id=? AND idem_key=?'),
  // Status 0 = sedang diproses. Baris ini dipesan lebih dulu agar kiriman bersamaan tidak membuat pembayaran ganda.
  idemReserve: db.prepare(`INSERT OR IGNORE INTO idempotency(user_id,idem_key,request_hash,status,body,created_at) VALUES(?,?,?,0,'',?)`),
  idemDone: db.prepare('UPDATE idempotency SET status=?, body=? WHERE user_id=? AND idem_key=?'),
  idemDrop: db.prepare('DELETE FROM idempotency WHERE user_id=? AND idem_key=? AND status=0'),
  cancelPending: db.prepare(`UPDATE payments SET status='CANCELLED', updated_at=? WHERE booking_id=? AND status='PENDING'`),
  seenEvent: db.prepare('INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?,?)'),
};

const secret = () => process.env.WEBHOOK_SECRET || '';
const publicPayment = (p) => ({ id: p.id, bookingId: p.booking_id, amount: p.amount, method: p.method, status: p.status, refundAmount: p.refund_amount, createdAt: p.created_at, updatedAt: p.updated_at });
const METHODS = ['QRIS', 'VA_BCA', 'VA_MANDIRI', 'CARD_TOKEN'];

/* ---------- Token Client Credentials untuk memanggil booking-service ---------- */
let svcToken = { value: null, exp: 0 };
async function serviceToken() {
  if (svcToken.value && svcToken.exp > Date.now() + 30000) return svcToken.value;
  const r = await http.request(`${config.urls.auth}/oauth/token`, {
    method: 'POST',
    body: { grant_type: 'client_credentials', client_id: 'svc-payment', client_secret: process.env.SVC_PAYMENT_CLIENT_SECRET, scope: 'internal:booking.read' },
  });
  if (r.status !== 200) throw new Error('gagal memperoleh token layanan');
  svcToken = { value: r.json.access_token, exp: Date.now() + r.json.expires_in * 1000 };
  return svcToken.value;
}
async function fetchBooking(id) {
  try {
    const r = await registry.call('booking', `/internal/bookings/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${await serviceToken()}` } });
    return r;
  } catch (e) {
    log.warn('booking tidak bisa dihubungi', { err: e.message });
    throw unavailable('pemesanan');
  }
}

const app = createApp('payment', log, { rawJson: true });
const jsonBody = express.json({ limit: '32kb' });
const auth = verifier.requireAuth(['payment:write']);

/* ---------- Membuat pembayaran ---------- */
app.post('/api/payments', jsonBody, auth, async (req, res) => {
  const key = req.headers['idempotency-key'];
  if (!key || key.length < 8 || key.length > 128) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib diisi (8 sampai 128 karakter).');
  const raw = JSON.stringify(req.body || {});
  const hash = pii.sha256(raw);
  const { bookingId, method = 'QRIS' } = req.body || {};
  if (!bookingId) throw new ApiError(422, 'VALIDATION_FAILED', 'bookingId wajib diisi.');
  if (!METHODS.includes(method)) throw new ApiError(422, 'VALIDATION_FAILED', `Metode harus salah satu dari: ${METHODS.join(', ')}.`);

  if (st.idemReserve.run(req.user.sub, key, hash, Date.now()).changes === 0) {
    const previous = await settledIdempotency(req.user.sub, key);
    if (previous.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key sudah dipakai untuk isi permintaan yang berbeda.');
    return res.status(previous.status).set('Idempotent-Replay', 'true').json(JSON.parse(previous.body));
  }
  try {
    const body = await createPayment(req.user.sub, bookingId, method);
    st.idemDone.run(201, JSON.stringify(body), req.user.sub, key);
    return res.status(201).json(body);
  } catch (e) {
    st.idemDrop.run(req.user.sub, key); // gagal tidak disimpan, klien boleh mencoba lagi dengan kunci yang sama
    throw e;
  }
});

/** Menunggu kiriman pertama yang masih diproses, lalu mengembalikan hasilnya. */
async function settledIdempotency(userId, key) {
  const until = Date.now() + 8000;
  for (;;) {
    const row = st.idemGet.get(userId, key);
    if (row && row.status !== 0) return row;
    if (!row || Date.now() > until) throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Permintaan yang sama masih diproses. Coba lagi sebentar.');
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function createPayment(userId, bookingId, method) {
  const r = await fetchBooking(bookingId);
  if (r.status === 404) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Pesanan tidak ditemukan.');
  if (r.status !== 200) throw unavailable('pemesanan');
  const booking = r.json;
  if (booking.userId !== userId) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Pesanan tidak ditemukan.'); // tidak membocorkan keberadaan pesanan orang lain
  if (booking.status !== 'PENDING_PAYMENT') throw new ApiError(409, 'BOOKING_NOT_PAYABLE', 'Pesanan ini tidak bisa dibayar lagi.', { status: booking.status });
  if (booking.expiresAt <= Date.now()) throw new ApiError(409, 'BOOKING_EXPIRED', 'Waktu pembayaran sudah habis.');
  if (st.succeededForBooking.get(bookingId)) throw new ApiError(409, 'ALREADY_PAID', 'Pesanan ini sudah dibayar.');

  const now = Date.now();
  const id = `pay_${crypto.randomBytes(9).toString('hex')}`;
  const providerRef = `MOCK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const checkoutToken = pii.randomToken(24);
  // Nominal berasal dari booking-service, bukan dari klien. Hanya satu pembayaran aktif per pesanan, agar tidak terjadi tagihan ganda.
  db.tx(() => {
    st.cancelPending.run(now, bookingId);
    st.insert.run(id, bookingId, userId, booking.amount, method, providerRef, pii.sha256(checkoutToken), now, now);
  });
  bus.publishSafe('audit.payment.created', { action: 'payment.created', service: 'payment', actor: userId, target: id, at: now });
  return {
    payment: publicPayment(st.byId.get(id)), checkoutToken, expiresAt: booking.expiresAt,
    instructions: method === 'QRIS' ? { qrString: `MOCKQR:${providerRef}` } : method.startsWith('VA_') ? { virtualAccount: `88${providerRef.slice(5, 15).replace(/\D/g, '7').padEnd(10, '7')}` } : { tokenize: 'Kirim cardToken (tok_...) ke gateway. Nomor kartu mentah ditolak.' },
  };
}

app.get('/api/payments/:id', verifier.requireAuth(), (req, res) => {
  const p = st.byId.get(req.params.id);
  if (!p || p.user_id !== req.user.sub) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Pembayaran tidak ditemukan.');
  res.json({ payment: publicPayment(p) });
});

/* ---------- Webhook: satu-satunya sumber kebenaran status bayar ---------- */
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '32kb' }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const check = sig.verify(secret(), req.headers['x-rangkai-signature'], rawBody);
  if (!check.ok) {
    bus.publishSafe('security.webhook_rejected', { service: 'payment', severity: 'high', reason: check.reason, ip: req.headers['x-forwarded-for'], at: Date.now() });
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Tanda tangan webhook tidak valid.');
  }
  let event;
  try { event = JSON.parse(rawBody); } catch { throw new ApiError(400, 'INVALID_JSON', 'Body bukan JSON yang valid.'); }
  if (!event.eventId || !event.providerRef || !['payment.succeeded', 'payment.failed'].includes(event.type)) throw new ApiError(422, 'INVALID_EVENT', 'Event webhook tidak lengkap.');
  if (st.seenEvent.run(event.eventId, Date.now()).changes === 0) return res.json({ received: true, duplicate: true });

  const p = st.byRef.get(event.providerRef);
  if (!p) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Referensi pembayaran tidak dikenal.');
  if (p.status !== 'PENDING') return res.json({ received: true, ignored: p.status });
  // Nominal dan identitas pesanan dicocokkan ulang sebelum dipercaya.
  if (event.type === 'payment.succeeded' && Number(event.amount) !== p.amount) {
    st.setStatus.run('AMOUNT_MISMATCH', Date.now(), p.id);
    bus.publishSafe('security.payment_amount_mismatch', { service: 'payment', severity: 'high', target: p.id, expected: p.amount, got: Number(event.amount), at: Date.now() });
    throw new ApiError(422, 'AMOUNT_MISMATCH', 'Nominal webhook tidak cocok dengan pesanan.');
  }
  const status = event.type === 'payment.succeeded' ? 'SUCCEEDED' : 'FAILED';
  st.setStatus.run(status, Date.now(), p.id);
  bus.publish(event.type, { paymentId: p.id, bookingId: p.booking_id, userId: p.user_id, amount: p.amount, at: Date.now() }, { key: p.booking_id, id: `pay-${p.id}-${status}` })
    .catch((e) => log.error('event pembayaran gagal dikirim', { err: e.message }));
  res.json({ received: true, status });
});

/* ---------- Gateway pembayaran simulasi (bukan bagian dari sistem nyata) ---------- */
if (config.mockGateway) {
  app.post('/api/mock-gateway/checkout/:token/pay', jsonBody, async (req, res) => {
    const { outcome = 'success', cardToken, cardNumber, amountOverride } = req.body || {};
    if (cardNumber !== undefined || Object.values(req.body || {}).some(sig.looksLikePan)) {
      throw new ApiError(422, 'RAW_CARD_REJECTED', 'Nomor kartu mentah ditolak. Gunakan token kartu (tok_...).');
    }
    if (cardToken !== undefined && !/^tok_[A-Za-z0-9]{6,}$/.test(String(cardToken))) throw new ApiError(422, 'INVALID_CARD_TOKEN', 'Token kartu tidak valid.');
    const p = st.byCheckout.get(pii.sha256(req.params.token));
    if (!p) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'Sesi pembayaran tidak ditemukan.');
    if (p.status !== 'PENDING') throw new ApiError(409, 'CHECKOUT_CLOSED', 'Sesi pembayaran sudah selesai.', { status: p.status });
    const event = JSON.stringify({
      eventId: `evt_${crypto.randomBytes(9).toString('hex')}`, type: outcome === 'fail' ? 'payment.failed' : 'payment.succeeded',
      providerRef: p.provider_ref, amount: amountOverride ?? p.amount, paidAt: Date.now(),
    });
    // Sedikit jeda seperti gateway asli: hasil datang lewat webhook, bukan lewat respons ini.
    setTimeout(() => {
      http.request(`${config.selfUrl('payment', config.ports.payment)}/api/payments/webhook`, {
        method: 'POST', body: event, headers: { 'content-type': 'application/json', 'x-rangkai-signature': sig.header(secret(), event) },
      }).catch((e) => log.warn('webhook simulasi gagal', { err: e.message }));
    }, 300);
    res.status(202).json({ accepted: true, message: 'Gateway memproses pembayaran. Status akan datang lewat webhook.' });
  });
}

/* ---------- Konsumen event: pengembalian dana ---------- */
bus.consume('payment.events', async (m) => {
  const { bookingId, refundAmount } = m.payload;
  const paid = st.succeededForBooking.get(bookingId);
  if (!paid) return; // belum dibayar: tidak ada yang perlu dikembalikan
  const amount = m.topic === 'payment.refund_required' ? paid.amount : Number(refundAmount || 0);
  st.setRefund.run(amount, Date.now(), paid.id);
  await bus.publish('payment.refunded', { paymentId: paid.id, bookingId, userId: paid.user_id, amount, at: Date.now() }, { key: bookingId, id: `refund-${paid.id}` });
});

finish(app, log);
mtls.createServer('payment', app, config.ports.payment, log);
registry.register('payment', config.selfUrl('payment', config.ports.payment), { role: 'payment' });
