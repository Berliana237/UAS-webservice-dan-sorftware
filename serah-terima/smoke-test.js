#!/usr/bin/env node
'use strict';
/**
 * SMOKE TEST SERAH-TERIMA (Kelompok A -> Kelompok B)
 * Memeriksa bahwa sistem cukup siap untuk diuji. Bukan pengujian mendalam. Waktu: sekitar 1 menit.
 *
 * Butuh Node.js 18 ke atas. Tidak perlu npm install.
 *   node serah-terima/smoke-test.js
 *   node serah-terima/smoke-test.js --base https://rangkai-production.up.railway.app --password "<kata sandi penguji>"
 *   (opsional) --apikey rk_live_xxx   untuk ikut menguji API key partner
 * Kata sandi juga bisa lewat variabel lingkungan TESTER_PASSWORD, API key lewat TESTER_API_KEY.
 */
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', process.env.BASE_URL || 'https://rangkai-production.up.railway.app').replace(/\/$/, '');
const PASSWORD = arg('password', process.env.TESTER_PASSWORD || '');
const API_KEY = arg('apikey', process.env.TESTER_API_KEY || '');

function req(method, path, { token, body, form, headers = {} } = {}) {
  return new Promise((resolve) => {
    const u = new URL(BASE + path);
    const h = { accept: 'application/json', ...headers };
    let data;
    if (form) { data = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (body !== undefined) { data = JSON.stringify(body); h['content-type'] = 'application/json'; }
    if (token) h.authorization = `Bearer ${token}`;
    if (data) h['content-length'] = Buffer.byteLength(data);
    const t0 = Date.now();
    const r = (u.protocol === 'https:' ? https : http).request(u, { method, headers: h, timeout: 60000 }, (res) => {
      let b = ''; res.on('data', (c) => { if (b.length < 2e6) b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* bukan JSON */ } resolve({ status: res.statusCode, json: j, text: b, ms: Date.now() - t0 }); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', (e) => resolve({ status: 0, text: e.message, ms: Date.now() - t0 }));
    if (data) r.write(data);
    r.end();
  });
}
const b64 = (b) => b.toString('base64url');
/** Login OAuth2 Authorization Code + PKCE, sama seperti aplikasi web dan Postman. */
async function login(email) {
  const verifier = b64(crypto.randomBytes(32));
  const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const redirect = `${BASE}/auth/callback`;
  const a = await req('GET', `/oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=smoke${Date.now()}`);
  if (!a.json?.auth_request) return null;
  const l = await req('POST', '/oauth/login', { body: { auth_request: a.json.auth_request, email, password: PASSWORD } });
  if (!l.json?.code) return null;
  const t = await req('POST', '/oauth/token', { form: { grant_type: 'authorization_code', client_id: 'rangkai-postman', code: l.json.code, code_verifier: verifier, redirect_uri: redirect } });
  return t.json?.access_token || null;
}

const results = [];
const check = (no, name, ok, info = '') => { results.push({ no, name, ok, info }); console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${no}. ${name}${info ? `  (${info})` : ''}`); };

(async () => {
  console.log(`Smoke test Rangkai -> ${BASE}\n`);
  // 1. URL deployment menjawab (request pertama boleh lambat)
  const h = await req('GET', '/healthz');
  check(1, 'URL deployment menjawab /healthz', h.status === 200 && h.json?.status === 'UP', `${h.status}, ${h.ms} ms`);
  // 2. Dokumentasi inti terbaca
  const docs = await req('GET', '/docs');
  const spec = await req('GET', '/docs/openapi.yaml');
  const gqlSchema = await req('GET', '/graphql/schema');
  check(2, 'Swagger UI, OpenAPI, dan skema GraphQL terbaca', docs.status === 200 && spec.status === 200 && /openapi:/.test(spec.text) && gqlSchema.status === 200 && /type /.test(gqlSchema.text));
  // 3. Contoh endpoint publik di README
  const st = await req('GET', '/api/stations');
  const date = new Date(Date.now() + 3 * 864e5 + 7 * 36e5).toISOString().slice(0, 10);
  const sc = await req('GET', `/api/schedules?from=GMR&to=ML&date=${date}`);
  const trip = sc.json?.trips?.[0]?.tripId;
  check(3, 'Contoh endpoint README: GET /api/stations dan /api/schedules', st.status === 200 && st.json?.stations?.length > 0 && !!trip, `${st.json?.stations?.length || 0} stasiun, trip ${trip || '-'}`);
  // 4. GraphQL
  const g = await req('POST', '/graphql', { body: { query: '{ stations { code name } }' } });
  check(4, 'GraphQL POST /graphql', g.status === 200 && Array.isArray(g.json?.data?.stations));
  // 5. Autentikasi dengan kredensial uji
  if (!PASSWORD) { console.log('\n[!] Kata sandi penguji belum diisi. Pakai --password "..." atau TESTER_PASSWORD. Langkah 5-9 dilewati.'); }
  const cust = PASSWORD ? await login('pelanggan1@penguji.rangkai') : null;
  const me = cust ? await req('GET', '/api/auth/me', { token: cust }) : { status: 0 };
  check(5, 'Login OAuth2 + PKCE akun pelanggan1@penguji.rangkai dan GET /api/auth/me', me.status === 200, `status ${me.status}`);
  const noTok = await req('GET', '/api/auth/me');
  check(6, 'Tanpa token ditolak 401', noTok.status === 401, `status ${noTok.status}`);
  // 7. Alur inti: tahan kursi lalu lepas
  let lockOk = false;
  if (cust && trip) {
    const seat = `EKS1-${1 + Math.floor(Math.random() * 12)}C`;
    const lk = await req('POST', '/api/locks', { token: cust, headers: { 'idempotency-key': crypto.randomUUID() }, body: { tripId: trip, from: 'GMR', to: 'ML', seats: [seat] } });
    if (lk.status === 201) { const del = await req('DELETE', `/api/locks/${lk.json.id}`, { token: cust }); lockOk = del.status === 200; }
    check(7, 'Tahan kursi (POST /api/locks) lalu lepas (DELETE)', lockOk, `lock ${lk.status}`);
  } else check(7, 'Tahan kursi (POST /api/locks) lalu lepas (DELETE)', false, 'butuh login dan jadwal');
  // 8. Peran admin penguji + RBAC
  const admin = PASSWORD ? await login('admin@penguji.rangkai') : null;
  const users = admin ? await req('GET', '/api/admin/users', { token: admin }) : { status: 0 };
  const forbidden = cust ? await req('GET', '/api/admin/users', { token: cust }) : { status: 0 };
  check(8, 'Admin penguji bisa GET /api/admin/users, pelanggan ditolak 403', users.status === 200 && forbidden.status === 403, `admin ${users.status}, pelanggan ${forbidden.status}`);
  // 9. Data uji bisa direset (mode lihat dulu, tidak menghapus)
  const reset = admin ? await req('POST', '/api/admin/test-data/reset?dryRun=true', { token: admin }) : { status: 0 };
  check(9, 'Reset data uji tersedia (POST /api/admin/test-data/reset?dryRun=true)', reset.status === 200, `status ${reset.status}`);
  // 10. API key partner (opsional)
  if (API_KEY) {
    const p = await req('GET', '/api/partner/v1/stations', { headers: { 'x-api-key': API_KEY } });
    check(10, 'API key penguji: GET /api/partner/v1/stations', p.status === 200, `status ${p.status}`);
  }
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\nHasil: ${results.length - fail} lulus, ${fail} gagal. ${fail ? 'Catat yang gagal di formulir serah-terima.' : 'Sistem siap diuji.'}`);
  process.exit(fail ? 1 : 0);
})();
