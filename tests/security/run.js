'use strict';
/**
 * Uji keamanan dasar, dipetakan ke OWASP API Security Top 10 (2023).
 * Termasuk uji mTLS langsung ke port service: tanpa sertifikat, sertifikat CA lain, dan sertifikat sah tetapi tidak berhak.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const c = require('../lib/client');

const OFFSET = Number(process.env.PORT_OFFSET || 0);
const CERTS = path.join(c.ROOT, process.env.CERT_DIR || 'certs');
const SVC = { catalog: 8772 + OFFSET, booking: 8781 + OFFSET, payment: 8773 + OFFSET, auth: 8771 + OFFSET };

function direct(port, urlPath, { cert } = {}) {
  return new Promise((resolve) => {
    const opts = { host: 'localhost', port, path: urlPath, ca: fs.readFileSync(path.join(CERTS, 'ca.crt')), servername: 'localhost', timeout: 5000 };
    if (cert) { opts.cert = fs.readFileSync(path.join(CERTS, `${cert}.crt`)); opts.key = fs.readFileSync(path.join(CERTS, `${cert}.key`)); }
    const req = https.get(opts, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  });
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function hmacWebhook(body, secret = process.env.WEBHOOK_SECRET, ts = Date.now()) {
  return `t=${ts},v1=${crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
}

async function main() {
  const r = c.reporter('Uji Keamanan Dasar (OWASP API Top 10)', 'security');
  const a = await c.registerUser('korban');
  const b = await c.registerUser('penyerang');
  const operator = await c.login('operator@rangkai.test');
  const admin = await c.login('admin@rangkai.test');
  const tripId = await c.arunikaTrip(6);
  const seat = `PRM2-${1 + Math.floor(Math.random() * 16)}C`;

  r.section('API1 Broken Object Level Authorization (IDOR)');
  const lock = await c.lockSeat(a.token, tripId, 'SGU', 'MN', [seat]);
  const book = await c.createBooking(a.token, lock.json.id, [seat]);
  for (const [id, name, res] of [
    ['S-01', 'Pesanan orang lain tidak terbaca', await c.call('GET', `/api/bookings/${book.json.id}`, { token: b.token })],
    ['S-02', 'Pesanan orang lain tidak bisa dibatalkan', await c.call('POST', `/api/bookings/${book.json.id}/cancel`, { token: b.token })],
    ['S-03', 'Lock orang lain tidak bisa dilepas', await c.call('DELETE', `/api/locks/${lock.json.id}`, { token: b.token })],
    ['S-04', 'Pratinjau refund orang lain tertutup', await c.call('GET', `/api/bookings/${book.json.id}/refund-preview`, { token: b.token })],
  ]) r.check(id, name, res.status === 404, `status ${res.status}`);
  const pay = await c.call('POST', '/api/payments', { token: a.token, headers: { 'idempotency-key': c.idem() }, body: { bookingId: book.json.id } });
  const payRead = await c.call('GET', `/api/payments/${pay.json.payment.id}`, { token: b.token });
  r.check('S-05', 'Pembayaran orang lain tidak terbaca', payRead.status === 404, `status ${payRead.status}`);

  r.section('API2 Broken Authentication');
  r.check('S-06', 'Tanpa token ditolak', (await c.call('GET', '/api/bookings')).status === 401);
  const [h, p, s] = a.token.split('.');
  const tampered = `${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), scope: 'admin system:read', role: 'admin' })}.${s}`;
  r.check('S-07', 'Token diubah isinya ditolak', (await c.call('GET', '/api/admin/users', { token: tampered })).status === 401);
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'x', scope: 'admin', iss: 'rangkai-auth', aud: 'rangkai-api', exp: 4102444800 })}.`;
  r.check('S-08', 'Token alg:none ditolak', (await c.call('GET', '/api/admin/users', { token: none })).status === 401);
  const jwks = await c.call('GET', '/.well-known/jwks.json');
  const hs = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', scope: 'admin', iss: 'rangkai-auth', aud: 'rangkai-api', exp: 4102444800 })}`;
  const forged = `${hs}.${crypto.createHmac('sha256', JSON.stringify(jwks.json.keys[0])).update(hs).digest('base64url')}`;
  r.check('S-09', 'Serangan penggantian algoritma RS256 ke HS256 ditolak', (await c.call('GET', '/api/admin/users', { token: forged })).status === 401);
  const wrongUser = await c.registerUser('kunci');
  const flow = async (password) => {
    const { challenge } = c.pkcePair();
    const q = new URLSearchParams({ response_type: 'code', client_id: 'rangkai-postman', redirect_uri: `${c.BASE}/auth/callback`, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-keamanan' });
    const auth = await c.call('GET', `/oauth/authorize?${q}`, { headers: { accept: 'application/json' } });
    return c.call('POST', '/oauth/login', { body: { auth_request: auth.json.auth_request, email: wrongUser.email, password } });
  };
  const fails = [];
  for (let i = 0; i < 5; i++) fails.push((await flow('SalahTotal1234')).status);
  const locked = await flow(wrongUser.password);
  r.check('S-10', 'Akun terkunci setelah 5 kali gagal, walau sandi benar', fails.every((x) => x === 401) && locked.status === 423, `gagal ${fails.join(',')}; lalu ${locked.status}`);
  const unknown = await flowUnknown();
  r.check('S-11', 'Pesan gagal login sama untuk email tak dikenal', unknown.json?.error?.code === 'INVALID_CREDENTIALS', unknown.text.slice(0, 80));

  const q2 = new URLSearchParams({ response_type: 'code', client_id: 'rangkai-postman', redirect_uri: 'https://jahat.example/cb', code_challenge: c.pkcePair().challenge, code_challenge_method: 'S256', state: 'state-keamanan' });
  r.check('S-12', 'redirect_uri tidak terdaftar ditolak', (await c.call('GET', `/oauth/authorize?${q2}`)).status === 400);
  const q3 = new URLSearchParams({ response_type: 'code', client_id: 'rangkai-postman', redirect_uri: `${c.BASE}/auth/callback`, state: 'state-keamanan' });
  r.check('S-13', 'Authorization code tanpa PKCE ditolak', (await c.call('GET', `/oauth/authorize?${q3}`)).status === 400);
  const refreshed = await c.call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: a.refresh } });
  r.check('S-14', 'Refresh token berotasi', refreshed.status === 200 && refreshed.json.refresh_token !== a.refresh);
  const reuse = await c.call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: a.refresh } });
  const family = await c.call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: refreshed.json.refresh_token } });
  r.check('S-15', 'Pemakaian ulang refresh token mencabut seluruh keluarga token', reuse.status === 400 && family.status === 400, `${reuse.status}/${family.status}`);

  r.section('API3 Broken Object Property Level Authorization');
  const mass = await c.call('POST', '/api/auth/register', { body: { name: 'Mass', email: 'mass@rangkai.test', password: 'MassAssign123', role: 'admin' } });
  r.check('S-16', 'Mass assignment "role" ditolak skema gateway', mass.status === 422, `status ${mass.status}`);
  const me = await c.call('GET', `/api/bookings/${book.json.id}`, { token: a.token });
  r.check('S-17', 'NIK utuh tidak pernah dikembalikan API', !me.text.includes(c.NIK) && me.json.passengers[0].nikMasked.endsWith('0001'));
  r.check('S-18', 'Respons pesanan tidak membocorkan kolom terenkripsi', !me.text.includes('v1:'));

  r.section('API4 Unrestricted Resource Consumption');
  const burst = await Promise.all(Array.from({ length: 14 }, () => c.call('POST', '/oauth/login', { body: { auth_request: 'x', email: 'rate@rangkai.test', password: 'x' } })));
  const limited = burst.filter((x) => x.status === 429);
  r.check('S-19', 'Rate limit login aktif (429 + Retry-After)', limited.length >= 1 && Boolean(limited[0].headers.get('retry-after')), `${limited.length} dari ${burst.length}`);
  const big = await c.call('POST', '/api/auth/register', { body: JSON.stringify({ name: 'x'.repeat(70000), email: 'a@b.co', password: 'x' }) });
  r.check('S-20', 'Body terlalu besar ditolak 413', big.status === 413, `status ${big.status}`);
  const deep = await c.call('POST', '/graphql', { body: { query: '{trip(id:"x"){stops{station{name}}coaches{code}segments{from{name}to{name}}}}'.replace('{trip', '{a:trip') } });
  r.check('S-21', 'Query GraphQL wajar tetap diterima', deep.status === 200, `status ${deep.status}`);
  const huge = `{${Array.from({ length: 230 }, (_, i) => `a${i}:stations{code}`).join(' ')}}`;
  const tooBig = await c.call('POST', '/graphql', { body: { query: huge } });
  r.check('S-22', 'Query GraphQL terlalu besar ditolak', tooBig.status === 400 && tooBig.json?.errors?.[0]?.extensions?.code === 'QUERY_TOO_LARGE', tooBig.text.slice(0, 100));

  r.section('API5 Broken Function Level Authorization');
  for (const [id, name, res] of [
    ['S-23', 'Pelanggan tidak bisa membaca daftar pengguna', await c.call('GET', '/api/admin/users', { token: b.token })],
    ['S-24', 'Pelanggan tidak bisa membuat API key', await c.call('POST', '/api/admin/api-keys', { token: b.token, body: { name: 'jahat' } })],
    ['S-25', 'Pelanggan tidak bisa melihat manifest', await c.call('GET', `/api/trips/${tripId}/manifest`, { token: b.token })],
    ['S-26', 'Pelanggan tidak bisa mengubah perjalanan', await c.call('PATCH', `/api/trips/${tripId}`, { token: b.token, body: { status: 'CANCELLED' } })],
    ['S-27', 'Operator tidak bisa membaca audit', await c.call('GET', '/api/admin/audit', { token: operator.token })],
    ['S-28', 'Operator tidak bisa memesan kursi', await c.call('POST', '/api/locks', { token: operator.token, headers: { 'idempotency-key': c.idem() }, body: { tripId, from: 'SGU', to: 'MN', seats: ['EKS1-1A'] } })],
  ]) r.check(id, name, res.status === 403, `status ${res.status}`);

  r.section('Integritas pembayaran');
  const fakeBody = JSON.stringify({ eventId: `evt_${Date.now()}`, type: 'payment.succeeded', providerRef: 'MOCK-TIDAKADA', amount: 1 });
  r.check('S-29', 'Webhook tanpa tanda tangan ditolak', (await c.call('POST', '/api/payments/webhook', { body: fakeBody })).status === 401);
  r.check('S-30', 'Webhook dengan kunci salah ditolak', (await c.call('POST', '/api/payments/webhook', { body: fakeBody, headers: { 'x-rangkai-signature': hmacWebhook(fakeBody, 'kunci-salah') } })).status === 401);
  r.check('S-31', 'Webhook dengan timestamp lama ditolak (replay)', (await c.call('POST', '/api/payments/webhook', { body: fakeBody, headers: { 'x-rangkai-signature': hmacWebhook(fakeBody, process.env.WEBHOOK_SECRET, Date.now() - 600000) } })).status === 401);
  const mismatch = await c.call('POST', `/api/mock-gateway/checkout/${pay.json.checkoutToken}/pay`, { token: a.token, body: { outcome: 'success', amountOverride: 1000 } });
  r.check('S-32a', 'Gateway menerima simulasi nominal curang', mismatch.status === 202);
  const stillPending = await c.waitUntil(async () => { const x = await c.call('GET', `/api/payments/${pay.json.payment.id}`, { token: a.token }); return x.json?.payment?.status === 'AMOUNT_MISMATCH' ? x : null; });
  const afterMismatch = await c.call('GET', `/api/bookings/${book.json.id}`, { token: a.token });
  r.check('S-32b', 'Nominal curang ditolak: tiket tidak terbit', Boolean(stillPending) && afterMismatch.json.status === 'PENDING_PAYMENT', afterMismatch.json.status);
  const rawCard = await c.call('POST', '/api/mock-gateway/checkout/x/pay', { token: a.token, body: { cardNumber: '4111111111111111' } });
  r.check('S-33', 'Nomor kartu mentah ditolak', rawCard.status === 422 && rawCard.json?.error?.code === 'RAW_CARD_REJECTED', `status ${rawCard.status}`);

  r.section('API8 Security Misconfiguration');
  const home = await c.call('GET', '/');
  for (const [hdr, id] of [['x-content-type-options', 'S-34'], ['x-frame-options', 'S-35'], ['content-security-policy', 'S-36'], ['referrer-policy', 'S-37']]) r.check(id, `Header ${hdr} terpasang`, Boolean(home.headers.get(hdr)));
  r.check('S-38', 'Header x-powered-by tidak bocor', !home.headers.get('x-powered-by'));
  const evil = await c.call('GET', '/api/stations', { headers: { origin: 'https://jahat.example' } });
  r.check('S-39', 'CORS: origin asing ditolak', evil.status === 403 && !evil.headers.get('access-control-allow-origin'));
  const secret = await c.call('GET', '/.env');
  r.check('S-40', 'File .env tidak bisa diunduh', !secret.text.includes('WEBHOOK_SECRET'));
  const trav = await c.call('GET', '/assets/..%2f..%2f.env');
  r.check('S-41', 'Path traversal ke luar folder web gagal', !trav.text.includes('WEBHOOK_SECRET'), `status ${trav.status}`);
  const err = await c.call('POST', '/api/locks', { token: a.token, headers: { 'idempotency-key': c.idem() }, body: { tripId: "x' OR '1'='1", from: 'SGU', to: 'MN', seats: ['EKS1-1A'] } });
  r.check('S-42', 'Injeksi SQL pada tripId ditolak tanpa membocorkan detail', [404, 422].includes(err.status) && !/sqlite|syntax|stack/i.test(err.text), `status ${err.status}`);

  r.section('Keamanan antar service: mTLS');
  const noCert = await direct(SVC.catalog, '/health');
  r.check('S-43', 'Tanpa sertifikat klien, koneksi ke catalog gagal saat handshake', Boolean(noCert.error) || noCert.status === undefined, String(noCert.error || noCert.status));
  const noCertJava = await direct(SVC.booking, '/health');
  r.check('S-44', 'Tanpa sertifikat klien, koneksi ke booking (Java) gagal', Boolean(noCertJava.error), String(noCertJava.error || noCertJava.status));
  const rogue = await direct(SVC.catalog, '/health', { cert: 'rogue' });
  r.check('S-45', 'Sertifikat dari CA lain ditolak', Boolean(rogue.error), String(rogue.error || rogue.status));
  const valid = await direct(SVC.catalog, '/health', { cert: 'gateway' });
  r.check('S-46', 'Sertifikat service yang sah diterima', valid.status === 200, `status ${valid.status}`);
  const intruder = await direct(SVC.catalog, `/internal/trips/${tripId}`, { cert: 'intruder' });
  r.check('S-47', 'Sertifikat sah tetapi tidak berhak ditolak di endpoint internal Node', intruder.status === 403, `status ${intruder.status}`);
  const intruderJava = await direct(SVC.booking, `/internal/trips/${tripId}/claims`, { cert: 'intruder' });
  r.check('S-48', 'Sertifikat sah tetapi tidak berhak ditolak di endpoint internal Java', intruderJava.status === 403, `status ${intruderJava.status}`);
  const keyVerify = await direct(SVC.auth, '/health', { cert: 'intruder' });
  r.check('S-49', 'Layanan auth hanya menerima koneksi bersertifikat', keyVerify.status === 200 && (await direct(SVC.auth, '/health')).error !== undefined);

  r.section('Masking log dan penyimpanan');
  const logs = path.join(c.ROOT, process.env.LOG_DIR || 'reports/logs');
  let leak = false;
  if (fs.existsSync(logs)) {
    for (const f of fs.readdirSync(logs)) {
      const t = fs.readFileSync(path.join(logs, f), 'utf8');
      if (t.includes(c.NIK) || t.includes(a.token) || t.includes(a.email) || t.includes(a.password)) leak = true;
    }
  }
  r.check('S-50', 'Log tidak memuat NIK, token, email, atau kata sandi', !leak);
  const dataDir = path.join(c.ROOT, process.env.DATA_DIR || 'data');
  let plain = false;
  for (const f of ['booking.db', 'auth.db']) {
    const file = path.join(dataDir, f);
    if (fs.existsSync(file)) { const t = fs.readFileSync(file).toString('latin1'); if (t.includes(c.NIK) || t.includes(a.email)) plain = true; }
  }
  r.check('S-51', 'NIK dan email tidak tersimpan sebagai teks biasa di database', !plain);

  r.section('Audit dan peringatan');
  await new Promise((res) => setTimeout(res, 800));
  const aud = await c.call('GET', '/api/admin/audit?limit=200', { token: admin.token });
  r.check('S-52', 'Audit log mencatat login dan pesanan', aud.json.entries.some((e) => e.action === 'login.success') && aud.json.entries.some((e) => e.action === 'booking.created'));
  r.check('S-53', 'Audit log tidak memuat token atau kata sandi', !/eyJ[A-Za-z0-9_-]{10,}|MassAssign|UjiCoba/.test(aud.text));
  const al = await c.call('GET', '/api/admin/alerts', { token: admin.token });
  r.check('S-54', 'Peringatan keamanan muncul (webhook, nominal, akun terkunci)', ['webhook_rejected', 'payment_amount_mismatch', 'account_locked'].every((k) => al.json.alerts.some((x) => x.kind === k)), al.json.alerts.map((x) => x.kind).slice(0, 6).join(','));
  r.finish();
}

async function flowUnknown() {
  const { challenge } = c.pkcePair();
  const q = new URLSearchParams({ response_type: 'code', client_id: 'rangkai-postman', redirect_uri: `${c.BASE}/auth/callback`, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-keamanan' });
  const auth = await c.call('GET', `/oauth/authorize?${q}`, { headers: { accept: 'application/json' } });
  return c.call('POST', '/oauth/login', { body: { auth_request: auth.json.auth_request, email: 'tidakada@rangkai.test', password: 'Apapun12345' } });
}

main().catch((e) => { console.error(e); process.exit(1); });
