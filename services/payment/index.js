'use strict';
/**
 * Payment service. Status bayar hanya dipercaya dari webhook bertanda tangan (QRIS) atau keputusan admin (transfer VA),
 * tidak pernah dari klaim klien. Nominal selalu diambil dari booking-service, dan data kartu tidak pernah disimpan.
 *
 * QRIS: kode QR berisi tautan ke halaman konfirmasi. Dipindai dari ponsel di jaringan yang sama, pembayaran langsung berhasil.
 * VA BCA dan Mandiri: pengguna mengunggah bukti transfer, admin menerima atau menolak, dan keputusan itu masih bisa diubah.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('../shared/config');
const { createApp, finish, ApiError, unavailable } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const dbm = require('../shared/db');
const pii = require('../shared/pii');
const sig = require('./signature');
const { sniffMime, MAX_PROOF_BYTES } = require('./proof');

const { log, http, registry, bus, verifier } = kit('payment');
const db = dbm.open('payment');
db.exec(`
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, user_id TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL,
  provider_ref TEXT UNIQUE NOT NULL, checkout_hash TEXT NOT NULL, va_number TEXT, refund_amount INTEGER NOT NULL DEFAULT 0,
  contact_name_enc TEXT, contact_email_enc TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pay_booking ON payments(booking_id);
CREATE TABLE IF NOT EXISTS proofs(id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, user_id TEXT NOT NULL, file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  file_path TEXT NOT NULL, note TEXT, status TEXT NOT NULL, reason TEXT, reviewed_by TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_proof_payment ON proofs(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proof_status ON proofs(status, created_at);
CREATE TABLE IF NOT EXISTS idempotency(user_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id, idem_key));
CREATE TABLE IF NOT EXISTS webhook_events(event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
`);
const UPLOADS = path.join(config.dataDir, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const st = {
  insert: db.prepare(`INSERT INTO payments(id,booking_id,user_id,amount,method,status,provider_ref,checkout_hash,va_number,contact_name_enc,contact_email_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  byId: db.prepare('SELECT * FROM payments WHERE id=?'),
  byRef: db.prepare('SELECT * FROM payments WHERE provider_ref=?'),
  byCheckout: db.prepare('SELECT * FROM payments WHERE checkout_hash=?'),
  forBooking: db.prepare('SELECT * FROM payments WHERE booking_id=? ORDER BY created_at DESC'),
  succeededForBooking: db.prepare(`SELECT * FROM payments WHERE booking_id=? AND status='SUCCEEDED'`),
  reviewingForBooking: db.prepare(`SELECT * FROM payments WHERE booking_id=? AND status='UNDER_REVIEW'`),
  setStatus: db.prepare('UPDATE payments SET status=?, updated_at=? WHERE id=?'),
  setRefund: db.prepare(`UPDATE payments SET status='REFUNDED', refund_amount=?, updated_at=? WHERE id=?`),
  cancelOpen: db.prepare(`UPDATE payments SET status='CANCELLED', updated_at=? WHERE booking_id=? AND status IN ('PENDING','AWAITING_TRANSFER','REJECTED')`),
  idemGet: db.prepare('SELECT * FROM idempotency WHERE user_id=? AND idem_key=?'),
  // Status 0 = sedang diproses. Baris ini dipesan lebih dulu agar kiriman bersamaan tidak membuat pembayaran ganda.
  idemReserve: db.prepare(`INSERT OR IGNORE INTO idempotency(user_id,idem_key,request_hash,status,body,created_at) VALUES(?,?,?,0,'',?)`),
  idemDone: db.prepare('UPDATE idempotency SET status=?, body=? WHERE user_id=? AND idem_key=?'),
  idemDrop: db.prepare('DELETE FROM idempotency WHERE user_id=? AND idem_key=? AND status=0'),
  seenEvent: db.prepare('INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?,?)'),
  insertProof: db.prepare('INSERT INTO proofs(id,payment_id,user_id,file_name,mime,size,file_path,note,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'),
  proof: db.prepare('SELECT * FROM proofs WHERE id=?'),
  proofsFor: db.prepare('SELECT * FROM proofs WHERE payment_id=? ORDER BY created_at DESC'),
  proofsByStatus: db.prepare(`SELECT * FROM proofs WHERE (?='ALL' OR status=?) ORDER BY created_at DESC LIMIT 200`),
  decide: db.prepare('UPDATE proofs SET status=?, reason=?, reviewed_by=?, reviewed_at=? WHERE id=?'),
};

const secret = () => process.env.WEBHOOK_SECRET || '';
const METHODS = ['QRIS', 'VA_BCA', 'VA_MANDIRI'];
const BANK = { VA_BCA: { name: 'BCA', prefix: '39358' }, VA_MANDIRI: { name: 'Mandiri', prefix: '89508' } };
const VA_HOLD_HOURS = 2;
const REVIEW_HOLD_HOURS = 24;

const publicProof = (p) => ({ id: p.id, fileName: p.file_name, mimeType: p.mime, size: p.size, note: p.note, status: p.status, reason: p.reason, reviewedAt: p.reviewed_at, createdAt: p.created_at });
const publicPayment = (p) => ({
  id: p.id, bookingId: p.booking_id, amount: p.amount, method: p.method, status: p.status, vaNumber: p.va_number, bank: BANK[p.method]?.name || null,
  refundAmount: p.refund_amount, createdAt: p.created_at, updatedAt: p.updated_at, proofs: st.proofsFor.all(p.id).map(publicProof),
});

/* ---------- Token Client Credentials untuk memanggil booking-service ---------- */
let svcToken = { value: null, exp: 0 };
async function serviceToken() {
  if (svcToken.value && svcToken.exp > Date.now() + 30000) return svcToken.value;
  const r = await http.request(`${config.urls.auth}/oauth/token`, {
    method: 'POST',
    body: { grant_type: 'client_credentials', client_id: 'svc-payment', client_secret: process.env.SVC_PAYMENT_CLIENT_SECRET, scope: 'internal:booking.read internal:booking.write' },
  });
  if (r.status !== 200) throw new Error('gagal memperoleh token layanan');
  svcToken = { value: r.json.access_token, exp: Date.now() + r.json.expires_in * 1000 };
  return svcToken.value;
}
async function bookingCall(pathname, opts = {}) {
  try {
    return await registry.call('booking', pathname, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${await serviceToken()}` } });
  } catch (e) {
    log.warn('booking tidak bisa dihubungi', { err: e.message });
    throw unavailable('pemesanan');
  }
}
const fetchBooking = (id, detail = false) => bookingCall(`/internal/bookings/${encodeURIComponent(id)}${detail ? '?detail=1' : ''}`);
const extendHold = (bookingId, hours) => bookingCall(`/internal/bookings/${encodeURIComponent(bookingId)}/hold`, { method: 'POST', body: { hours } });

const app = createApp('payment', log, { rawJson: true });
const jsonBody = express.json({ limit: '32kb' });
const uploadBody = express.json({ limit: '6mb' });
const auth = verifier.requireAuth(['payment:write']);
const reviewer = verifier.requireAuth(['payment:review']);
const audit = (action, actor, target, extra = {}) => bus.publishSafe(`audit.${action}`, { action, service: 'payment', actor, target, at: Date.now(), ...extra });

/* ---------- Membuat pembayaran ---------- */
app.post('/api/payments', jsonBody, auth, async (req, res) => {
  const key = req.headers['idempotency-key'];
  if (!key || key.length < 8 || key.length > 128) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib diisi (8 sampai 128 karakter).');
  const hash = pii.sha256(JSON.stringify(req.body || {}));
  const { bookingId, method = 'QRIS' } = req.body || {};
  if (!bookingId) throw new ApiError(422, 'VALIDATION_FAILED', 'bookingId wajib diisi.');
  if (!METHODS.includes(method)) throw new ApiError(422, 'VALIDATION_FAILED', `Metode harus salah satu dari: ${METHODS.join(', ')}.`);

  if (st.idemReserve.run(req.user.sub, key, hash, Date.now()).changes === 0) {
    const previous = await settledIdempotency(req.user.sub, key);
    if (previous.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key sudah dipakai untuk isi permintaan yang berbeda.');
    return res.status(previous.status).set('Idempotent-Replay', 'true').json(JSON.parse(previous.body));
  }
  try {
    const body = await createPayment(req.user, bookingId, method);
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

async function createPayment(user, bookingId, method) {
  const r = await fetchBooking(bookingId);
  if (r.status === 404) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Pesanan tidak ditemukan.');
  if (r.status !== 200) throw unavailable('pemesanan');
  const booking = r.json;
  if (booking.userId !== user.sub) throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Pesanan tidak ditemukan.'); // tidak membocorkan keberadaan pesanan orang lain
  if (booking.status !== 'PENDING_PAYMENT') throw new ApiError(409, 'BOOKING_NOT_PAYABLE', 'Pesanan ini tidak bisa dibayar lagi.', { status: booking.status });
  if (booking.expiresAt <= Date.now()) throw new ApiError(409, 'BOOKING_EXPIRED', 'Waktu pembayaran sudah habis.');
  if (st.succeededForBooking.get(bookingId)) throw new ApiError(409, 'ALREADY_PAID', 'Pesanan ini sudah dibayar.');
  if (st.reviewingForBooking.get(bookingId)) throw new ApiError(409, 'PAYMENT_UNDER_REVIEW', 'Bukti transfer pesanan ini sedang diperiksa admin. Tunggu hasilnya dulu.');

  const now = Date.now();
  const id = `pay_${crypto.randomBytes(9).toString('hex')}`;
  const providerRef = `MOCK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const checkoutToken = pii.randomToken(24);
  const va = BANK[method] ? `${BANK[method].prefix}${String(parseInt(crypto.randomBytes(5).toString('hex'), 16)).padStart(11, '0').slice(0, 11)}` : null;
  const status = method === 'QRIS' ? 'PENDING' : 'AWAITING_TRANSFER';
  // Nominal berasal dari booking-service. Hanya satu pembayaran terbuka per pesanan, agar tidak terjadi tagihan ganda.
  db.tx(() => {
    st.cancelOpen.run(now, bookingId);
    st.insert.run(id, bookingId, user.sub, booking.amount, method, status, providerRef, pii.sha256(checkoutToken), va,
      user.name ? pii.encrypt(user.name) : null, user.email ? pii.encrypt(user.email) : null, now, now);
  });
  let expiresAt = booking.expiresAt;
  if (va) {
    // Transfer bank butuh waktu: kursi ditahan 2 jam agar pengguna tidak terburu-buru.
    const h = await extendHold(bookingId, VA_HOLD_HOURS);
    if (h.status === 200) expiresAt = h.json.expiresAt;
  }
  audit('payment.created', user.sub, id, { method });
  return {
    payment: publicPayment(st.byId.get(id)), checkoutToken, expiresAt,
    instructions: method === 'QRIS'
      ? { qrisUrl: `${config.qrPublicBase()}/qris/${checkoutToken}`, merchant: 'RANGKAI KERETA', note: 'Pindai dengan kamera atau aplikasi apa pun dari ponsel yang terhubung ke jaringan yang sama.' }
      : { bank: BANK[method].name, virtualAccount: va, note: 'Transfer tepat sesuai nominal, lalu unggah bukti transfer.' },
  };
}

app.get('/api/payments', verifier.requireAuth(), (req, res) => {
  const bookingId = String(req.query.bookingId || '');
  if (!bookingId) throw new ApiError(422, 'VALIDATION_FAILED', 'Parameter bookingId wajib diisi.');
  res.json({ payments: st.forBooking.all(bookingId).filter((p) => p.user_id === req.user.sub).map(publicPayment) });
});

app.get('/api/payments/:id', verifier.requireAuth(), (req, res) => {
  const p = st.byId.get(req.params.id);
  if (!p || p.user_id !== req.user.sub) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Pembayaran tidak ditemukan.');
  res.json({ payment: publicPayment(p) });
});

/* ---------- Bukti transfer VA ---------- */
app.post('/api/payments/:id/proof', uploadBody, auth, async (req, res) => {
  const p = st.byId.get(req.params.id);
  if (!p || p.user_id !== req.user.sub) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Pembayaran tidak ditemukan.');
  if (!BANK[p.method]) throw new ApiError(409, 'NOT_A_TRANSFER', 'Bukti hanya untuk pembayaran virtual account.');
  if (!['AWAITING_TRANSFER', 'REJECTED'].includes(p.status)) throw new ApiError(409, 'PROOF_NOT_ACCEPTED', 'Pembayaran ini tidak sedang menunggu bukti transfer.', { status: p.status });
  const { fileName = 'bukti', dataBase64, note = '' } = req.body || {};
  if (typeof dataBase64 !== 'string' || !dataBase64.length) throw new ApiError(422, 'VALIDATION_FAILED', 'Berkas bukti transfer wajib diunggah.', { fields: { file: 'Pilih berkas bukti transfer.' } });
  if (String(note).length > 300) throw new ApiError(422, 'VALIDATION_FAILED', 'Catatan maksimal 300 karakter.', { fields: { note: 'Maksimal 300 karakter.' } });
  const buf = Buffer.from(dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buf.length === 0 || buf.length > MAX_PROOF_BYTES) throw new ApiError(422, 'VALIDATION_FAILED', 'Ukuran berkas 1 byte sampai 3 MB.', { fields: { file: 'Maksimal 3 MB.' } });
  // Jenis berkas ditentukan dari isinya, bukan dari nama atau klaim klien.
  const kind = sniffMime(buf);
  if (!kind) throw new ApiError(422, 'VALIDATION_FAILED', 'Format berkas harus JPG, PNG, WEBP, atau PDF.', { fields: { file: 'JPG, PNG, WEBP, atau PDF.' } });
  const proofId = `prf_${crypto.randomBytes(8).toString('hex')}`;
  const dir = path.join(UPLOADS, p.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${proofId}.${kind.ext}`);
  fs.writeFileSync(filePath, buf);
  const safeName = String(fileName).replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'bukti';
  db.tx(() => {
    st.insertProof.run(proofId, p.id, req.user.sub, safeName, kind.mime, buf.length, path.relative(UPLOADS, filePath), String(note).trim() || null, 'SUBMITTED', Date.now());
    st.setStatus.run('UNDER_REVIEW', Date.now(), p.id);
  });
  // Selama diperiksa admin, kursi ditahan sampai 24 jam.
  const h = await extendHold(p.booking_id, REVIEW_HOLD_HOURS).catch(() => null);
  bus.publishSafe('payment.proof_submitted', { paymentId: p.id, bookingId: p.booking_id, userId: p.user_id, amount: p.amount, at: Date.now() }, { key: p.booking_id });
  audit('payment.proof_submitted', req.user.sub, proofId);
  res.status(201).json({ payment: publicPayment(st.byId.get(p.id)), expiresAt: h?.status === 200 ? h.json.expiresAt : null });
});

app.get('/api/payments/proofs/:proofId/file', verifier.requireAuth(), (req, res) => {
  const proof = st.proof.get(req.params.proofId);
  const scopes = String(req.user.scope || '').split(' ');
  if (!proof || (proof.user_id !== req.user.sub && !scopes.includes('payment:review'))) throw new ApiError(404, 'PROOF_NOT_FOUND', 'Bukti tidak ditemukan.');
  const full = path.resolve(UPLOADS, proof.file_path);
  if (!full.startsWith(UPLOADS + path.sep) || !fs.existsSync(full)) throw new ApiError(404, 'PROOF_NOT_FOUND', 'Berkas bukti tidak ditemukan.');
  res.setHeader('Content-Type', proof.mime);
  res.setHeader('Content-Disposition', `inline; filename="${proof.file_name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(full).pipe(res);
});

/* ---------- Admin: verifikasi transfer manual ---------- */
async function lookupUsers(ids) {
  if (!ids.length) return {};
  try {
    const r = await http.request(`${config.urls.auth}/internal/users/lookup`, { method: 'POST', body: { ids } });
    return Object.fromEntries((r.json?.users || []).map((u) => [u.id, u]));
  } catch { return {}; }
}

app.get('/api/admin/transfers', reviewer, async (req, res) => {
  const status = ['SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(req.query.status) ? req.query.status : 'ALL';
  const proofs = st.proofsByStatus.all(status, status);
  const payments = new Map(proofs.map((x) => [x.payment_id, st.byId.get(x.payment_id)]));
  const users = await lookupUsers([...new Set(proofs.map((x) => x.user_id))]);
  const bookings = {};
  await Promise.all([...new Set([...payments.values()].map((p) => p.booking_id))].map(async (bid) => {
    const r = await fetchBooking(bid, true).catch(() => null);
    if (r?.status === 200) bookings[bid] = r.json;
  }));
  res.json({
    total: proofs.length,
    transfers: proofs.map((x) => {
      const p = payments.get(x.payment_id);
      const u = users[x.user_id] || {};
      return {
        proof: publicProof(x), payment: { id: p.id, method: p.method, bank: BANK[p.method]?.name, vaNumber: p.va_number, amount: p.amount, status: p.status },
        user: { id: x.user_id, name: u.name || (p.contact_name_enc ? pii.decrypt(p.contact_name_enc) : null), email: u.email || (p.contact_email_enc ? pii.decrypt(p.contact_email_enc) : null), nik: u.nik || null, phone: u.phone || null },
        booking: bookings[p.booking_id] || { id: p.booking_id },
      };
    }),
  });
});

app.post('/api/admin/transfers/:proofId/decision', jsonBody, reviewer, (req, res) => {
  const proof = st.proof.get(req.params.proofId);
  if (!proof) throw new ApiError(404, 'PROOF_NOT_FOUND', 'Bukti tidak ditemukan.');
  const { decision, reason = '' } = req.body || {};
  if (!['ACCEPT', 'REJECT'].includes(decision)) throw new ApiError(422, 'VALIDATION_FAILED', 'Keputusan harus ACCEPT atau REJECT.', { fields: { decision: 'ACCEPT atau REJECT.' } });
  if (decision === 'REJECT' && String(reason).trim().length < 5) throw new ApiError(422, 'VALIDATION_FAILED', 'Tulis alasan penolakan minimal 5 karakter, agar pengguna tahu yang harus diperbaiki.', { fields: { reason: 'Minimal 5 karakter.' } });
  const p = st.byId.get(proof.payment_id);
  const latest = st.proofsFor.all(p.id)[0];
  if (latest.id !== proof.id) throw new ApiError(409, 'PROOF_SUPERSEDED', 'Pengguna sudah mengunggah bukti yang lebih baru. Periksa bukti terbaru.');
  if (['CANCELLED', 'REFUNDED'].includes(p.status)) throw new ApiError(409, 'PAYMENT_CLOSED', 'Pembayaran ini sudah ditutup.', { status: p.status });
  const now = Date.now();
  const wasPaid = p.status === 'SUCCEEDED';
  db.tx(() => {
    st.decide.run(decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', decision === 'REJECT' ? String(reason).trim() : null, req.user.sub, now, proof.id);
    st.setStatus.run(decision === 'ACCEPT' ? 'SUCCEEDED' : 'REJECTED', now, p.id);
  });
  const base = { paymentId: p.id, bookingId: p.booking_id, userId: p.user_id, amount: p.amount, at: now };
  if (decision === 'ACCEPT' && !wasPaid) bus.publishSafe('payment.succeeded', base, { key: p.booking_id, id: `pay-${p.id}-accept-${proof.id}-${now}` });
  // Ditolak, termasuk setelah sempat diterima: pesanan kembali menunggu pembayaran dan pengguna bisa mengunggah ulang.
  if (decision === 'REJECT' && wasPaid) bus.publishSafe('payment.reversed', { ...base, reason: String(reason).trim() }, { key: p.booking_id, id: `pay-${p.id}-reverse-${now}` });
  if (decision === 'REJECT' && !wasPaid) {
    bus.publishSafe('payment.proof_rejected', { ...base, reason: String(reason).trim() }, { key: p.booking_id, id: `pay-${p.id}-reject-${proof.id}-${now}` });
    // Beri waktu untuk mengunggah bukti baru: kursi ditahan lagi sampai 24 jam (maksimal 1 jam sebelum berangkat).
    extendHold(p.booking_id, REVIEW_HOLD_HOURS).catch((e) => log.warn('perpanjang tahan kursi gagal', { err: e.message }));
  }
  audit(`payment.transfer_${decision.toLowerCase()}`, req.user.sub, proof.id, { paymentId: p.id });
  res.json({ proof: publicProof(st.proof.get(proof.id)), payment: publicPayment(st.byId.get(p.id)) });
});

/* ---------- Webhook: satu-satunya sumber kebenaran status bayar QRIS ---------- */
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

/* ---------- Penyedia QRIS dan gateway simulasi (lingkungan demo) ---------- */
function fireWebhook(p, { outcome = 'success', amount = p.amount } = {}) {
  const event = JSON.stringify({ eventId: `evt_${crypto.randomBytes(9).toString('hex')}`, type: outcome === 'fail' ? 'payment.failed' : 'payment.succeeded', providerRef: p.provider_ref, amount, paidAt: Date.now() });
  // Sedikit jeda seperti gateway asli: hasil datang lewat webhook, bukan lewat respons ini.
  setTimeout(() => {
    http.request(`${config.selfUrl('payment', config.ports.payment)}/api/payments/webhook`, {
      method: 'POST', body: event, headers: { 'content-type': 'application/json', 'x-rangkai-signature': sig.header(secret(), event) },
    }).catch((e) => log.warn('webhook simulasi gagal', { err: e.message }));
  }, 300);
}

if (config.mockGateway) {
  /** Halaman QRIS di ponsel memanggil ini. Token checkout sekali pakai dan tidak bisa ditebak. */
  app.get('/api/qris/:token', async (req, res) => {
    const p = st.byCheckout.get(pii.sha256(req.params.token));
    if (!p || p.method !== 'QRIS') throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'Kode QR tidak dikenal atau sudah kedaluwarsa.');
    const b = await fetchBooking(p.booking_id, true).catch(() => null);
    const d = b?.status === 200 ? b.json : {};
    res.json({ merchant: 'RANGKAI KERETA', amount: p.amount, status: p.status, bookingCode: d.code || null, trainName: d.trainName || null, from: d.from || null, to: d.to || null, departureAt: d.departureAt || null });
  });
  app.post('/api/qris/:token/pay', (req, res) => {
    const p = st.byCheckout.get(pii.sha256(req.params.token));
    if (!p || p.method !== 'QRIS') throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'Kode QR tidak dikenal atau sudah kedaluwarsa.');
    if (p.status !== 'PENDING') return res.status(200).json({ accepted: false, status: p.status, message: p.status === 'SUCCEEDED' ? 'Pembayaran ini sudah berhasil.' : 'Kode QR ini sudah tidak berlaku.' });
    fireWebhook(p);
    audit('payment.qris_scanned', null, p.id);
    res.status(202).json({ accepted: true, message: 'Pembayaran diproses. Layar pemesanan akan berubah otomatis.' });
  });

  /** Tombol simulasi bila kode QR tidak bisa dipindai dari ponsel. */
  app.post('/api/mock-gateway/checkout/:token/pay', jsonBody, auth, (req, res) => {
    const { outcome = 'success', cardNumber, amountOverride } = req.body || {};
    if (cardNumber !== undefined || Object.values(req.body || {}).some(sig.looksLikePan)) {
      throw new ApiError(422, 'RAW_CARD_REJECTED', 'Nomor kartu mentah ditolak. Sistem tidak pernah menerima data kartu.');
    }
    const p = st.byCheckout.get(pii.sha256(req.params.token));
    if (!p || p.user_id !== req.user.sub) throw new ApiError(404, 'CHECKOUT_NOT_FOUND', 'Sesi pembayaran tidak ditemukan.');
    if (p.status !== 'PENDING') throw new ApiError(409, 'CHECKOUT_CLOSED', 'Sesi pembayaran sudah selesai.', { status: p.status });
    fireWebhook(p, { outcome, amount: amountOverride ?? p.amount });
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
