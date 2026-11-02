'use strict';
/** Klien uji bersama: HTTP ke gateway, alur OAuth2 PKCE, dan pelapor hasil ber-format seragam. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* opsional */ }
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const PASSWORD = process.env.SEED_USER_PASSWORD || 'Rangkai2026!';
const NIK = '3578015203990001';
const REDIRECT = `${BASE}/auth/callback`;

async function call(method, url, { token, body, headers = {}, form, base = BASE } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); } else if (body !== undefined) { h['content-type'] = h['content-type'] || 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const b64url = (b) => Buffer.from(b).toString('base64url');
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

/** Alur lengkap Authorization Code + PKCE, sama seperti yang dilakukan SPA. */
async function login(email, password = PASSWORD, clientId = 'rangkai-postman', base = BASE) {
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(12));
  const redirect = `${base}/auth/callback`;
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state });
  const a = await call('GET', `/oauth/authorize?${q}`, { headers: { accept: 'application/json' }, base });
  if (a.status !== 200) throw new Error(`authorize gagal ${a.status}: ${a.text}`);
  const l = await call('POST', '/oauth/login', { body: { auth_request: a.json.auth_request, email, password }, base });
  if (l.status !== 200) throw Object.assign(new Error(`login gagal ${l.status}: ${l.text}`), { status: l.status, json: l.json });
  const t = await call('POST', '/oauth/token', { form: { grant_type: 'authorization_code', client_id: clientId, code: l.json.code, code_verifier: verifier, redirect_uri: redirect }, base });
  if (t.status !== 200) throw new Error(`token gagal ${t.status}: ${t.text}`);
  return { token: t.json.access_token, refresh: t.json.refresh_token, ...t.json };
}

async function registerUser(prefix = 'uji', base = BASE) {
  const email = `${prefix}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@rangkai.test`;
  const password = 'UjiCoba12345';
  const r = await call('POST', '/api/auth/register', { body: { name: `Pengguna ${prefix}`, email, password }, base });
  if (r.status !== 201) throw new Error(`register gagal ${r.status}: ${r.text}`);
  return { email, password, ...(await login(email, password, 'rangkai-postman', base)) };
}

const wibDate = (daysAhead) => new Date(Date.now() + daysAhead * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
const idem = () => crypto.randomUUID();

/** Perjalanan Arunika (Surabaya Gubeng sampai Yogyakarta Tugu). Tiap pemanggilan dengan hari berbeda memberi kursi bersih. */
async function arunikaTrip(daysAhead = 3, base = BASE) {
  const r = await call('GET', `/api/schedules?from=SGU&to=YK&date=${wibDate(daysAhead)}`, { base });
  if (r.status !== 200) throw new Error(`jadwal gagal ${r.status}: ${r.text}`);
  const t = r.json.trips.find((x) => x.tripId.startsWith('ARN-'));
  if (!t) throw new Error('perjalanan Arunika tidak ditemukan');
  return t.tripId;
}

const lockSeat = (token, tripId, from, to, seats, extra = {}, base = BASE) => call('POST', '/api/locks', { token, base, headers: { 'idempotency-key': idem() }, body: { tripId, from, to, seats, ...extra } });

const passengersFor = (seats) => seats.map((seatId, i) => ({ seatId, name: `Penumpang ${i + 1}`, age: 30, nik: i === 0 ? NIK : `357801520399${String(1000 + i)}`, phone: '081234567890' }));
const createBooking = (token, lockId, seats, base = BASE) => call('POST', '/api/bookings', { token, base, headers: { 'idempotency-key': idem() }, body: { lockId, passengers: passengersFor(seats) } });

async function waitUntil(fn, { timeoutMs = 8000, everyMs = 150 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return last;
}

/** Alur bayar penuh: buat pembayaran, gateway simulasi, webhook, event, tiket terbit. */
async function payBooking(token, bookingId, base = BASE) {
  const p = await call('POST', '/api/payments', { token, base, headers: { 'idempotency-key': idem() }, body: { bookingId, method: 'QRIS' } });
  if (p.status !== 201) throw new Error(`payment gagal ${p.status}: ${p.text}`);
  const go = await call('POST', `/api/mock-gateway/checkout/${p.json.checkoutToken}/pay`, { token, base, body: { outcome: 'success' } });
  if (go.status !== 202) throw new Error(`gateway simulasi gagal ${go.status}: ${go.text}`);
  const done = await waitUntil(async () => {
    const b = await call('GET', `/api/bookings/${bookingId}`, { token, base });
    return b.json?.status === 'CONFIRMED' ? b.json : null;
  });
  if (!done) throw new Error('booking tidak terkonfirmasi dalam batas waktu');
  return { booking: done, payment: p.json.payment };
}

/* ---------- Pelapor sederhana ---------- */
function reporter(title, file) {
  const rows = [];
  const started = Date.now();
  const report = {
    check(id, name, ok, detail = '') {
      rows.push({ id, name, ok: Boolean(ok), detail: String(detail) });
      console.log(`  ${ok ? '[LULUS]' : '[GAGAL]'} ${id.padEnd(9)} ${name}${!ok && detail ? `\n          ${detail}` : ''}`);
      return Boolean(ok);
    },
    section(name) { console.log(`\n${name}`); },
    info(text) { console.log(`  ${text}`); },
    finish(extra = {}) {
      const failed = rows.filter((r) => !r.ok).length;
      const dir = path.join(ROOT, 'reports');
      fs.mkdirSync(dir, { recursive: true });
      const out = { title, at: new Date().toISOString(), durationMs: Date.now() - started, total: rows.length, passed: rows.length - failed, failed, rows, ...extra };
      fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(out, null, 2));
      const md = [`# ${title}`, '', `Waktu: ${out.at}`, '', `Hasil: **${out.passed}/${out.total} lulus**`, '', '| ID | Skenario | Hasil | Catatan |', '|---|---|---|---|',
        ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? 'LULUS' : 'GAGAL'} | ${r.detail.replace(/\|/g, '/').slice(0, 160)} |`)];
      if (extra.markdown) md.push('', extra.markdown);
      fs.writeFileSync(path.join(dir, `${file}.md`), md.join('\n'));
      console.log(`\n${title}: ${out.passed}/${out.total} lulus. Laporan: reports/${file}.md`);
      process.exitCode = failed ? 1 : 0;
      return out;
    },
  };
  console.log(`\n=== ${title} ===`);
  return report;
}

module.exports = { ROOT, BASE, PASSWORD, NIK, REDIRECT, call, login, pkcePair, registerUser, wibDate, idem, arunikaTrip, lockSeat, passengersFor, createBooking, waitUntil, payBooking, reporter };
