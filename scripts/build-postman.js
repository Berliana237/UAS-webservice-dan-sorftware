'use strict';
/**
 * Membangun koleksi Postman v2.1 (postman/Rangkai.postman_collection.json).
 * Koleksi disusun per minggu agar mudah dipakai saat presentasi progres. Tiap request punya skrip pm.test,
 * dan variabel hasil satu request dipakai request berikutnya, sehingga seluruh folder bisa dijalankan dengan Collection Runner.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const J = (o) => JSON.stringify(o, null, 2);
const lines = (s) => s.trim().split('\n').map((l) => l.replace(/^ {4}/, ''));
const test = (s) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines(s) } });
const pre = (s) => ({ listen: 'prerequest', script: { type: 'text/javascript', exec: lines(s) } });
const expectStatus = (code, extra = '') => `
    pm.test('Status ${code}', () => pm.response.to.have.status(${code}));
    ${extra}`;

function req(name, method, url, { body, form, graphql, headers = {}, auth, tests, prereq, desc, disableRedirect } = {}) {
  const header = Object.entries(headers).map(([key, value]) => ({ key, value }));
  if (auth && auth !== 'none') header.push({ key: 'Authorization', value: `Bearer {{${auth}}}` });
  const item = {
    name,
    request: {
      method, header, description: desc,
      url: { raw: `{{baseUrl}}${url}`, host: ['{{baseUrl}}'], path: url.split('?')[0].split('/').filter(Boolean), query: (url.split('?')[1] || '').split('&').filter(Boolean).map((p) => { const [key, ...v] = p.split('='); return { key, value: v.join('=') }; }) },
    },
    event: [],
  };
  if (disableRedirect) item.protocolProfileBehavior = { followRedirects: false };
  if (body !== undefined) {
    header.push({ key: 'Content-Type', value: 'application/json' });
    item.request.body = { mode: 'raw', raw: typeof body === 'string' ? body : J(body), options: { raw: { language: 'json' } } };
  }
  if (form) item.request.body = { mode: 'urlencoded', urlencoded: Object.entries(form).map(([key, value]) => ({ key, value, type: 'text' })) };
  if (graphql) item.request.body = { mode: 'graphql', graphql: { query: graphql.query, variables: J(graphql.variables || {}) } };
  if (prereq) item.event.push(pre(prereq));
  if (tests) item.event.push(test(tests));
  return item;
}
const folder = (name, description, item) => ({ name, description, item });
const idem = { 'Idempotency-Key': '{{$guid}}' };

/* ---------- Potongan skrip alur PKCE: dipakai ulang untuk tiap peran ---------- */
const PKCE_PRE = (prefix) => `
    const verifier = CryptoJS.lib.WordArray.random(48).toString(CryptoJS.enc.Base64).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    const challenge = CryptoJS.SHA256(verifier).toString(CryptoJS.enc.Base64).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    pm.collectionVariables.set('${prefix}Verifier', verifier);
    pm.collectionVariables.set('${prefix}Challenge', challenge);
    pm.collectionVariables.set('${prefix}State', 'state' + Date.now());`;
const pkceFlow = (label, prefix, emailVar, tokenVar, extra = '') => [
  req(`${label}: 1 Authorize (PKCE)`, 'GET', `/oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri={{baseUrl}}/auth/callback&code_challenge={{${prefix}Challenge}}&code_challenge_method=S256&state={{${prefix}State}}`, {
    headers: { Accept: 'application/json' }, prereq: PKCE_PRE(prefix),
    tests: `${expectStatus(200)}
    pm.collectionVariables.set('${prefix}AuthRequest', pm.response.json().auth_request);`,
  }),
  req(`${label}: 2 Login`, 'POST', '/oauth/login', {
    body: { auth_request: `{{${prefix}AuthRequest}}`, email: `{{${emailVar}}}`, password: '{{seedPassword}}' },
    tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('State sama dengan yang dikirim', () => pm.expect(j.state).to.eql(pm.collectionVariables.get('${prefix}State')));
    pm.collectionVariables.set('${prefix}Code', j.code);`,
  }),
  req(`${label}: 3 Tukar kode dengan token`, 'POST', '/oauth/token', {
    form: { grant_type: 'authorization_code', client_id: 'rangkai-postman', code: `{{${prefix}Code}}`, code_verifier: `{{${prefix}Verifier}}`, redirect_uri: '{{baseUrl}}/auth/callback' },
    tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('Dapat access token dan refresh token', () => { pm.expect(j.access_token).to.be.a('string'); pm.expect(j.refresh_token).to.be.a('string'); });
    pm.test('Token berumur 15 menit', () => pm.expect(j.expires_in).to.eql(900));
    pm.collectionVariables.set('${tokenVar}', j.access_token);
    pm.collectionVariables.set('${tokenVar}Refresh', j.refresh_token);
    ${extra}`,
  }),
];

/* ---------- Isi koleksi ---------- */
const setup = folder('00 Persiapan', 'Wajib dijalankan pertama. Memeriksa sistem dan menyiapkan token semua peran serta variabel perjalanan.', [
  req('Kesehatan gateway', 'GET', '/healthz', { tests: `${expectStatus(200)}
    pm.test('Gateway UP', () => pm.expect(pm.response.json().status).to.eql('UP'));` }),
  // Pelanggan tidak dibuat otomatis di stack biasa, jadi koleksi mendaftarkan dua akun pelanggan sendiri setiap kali dijalankan.
  req('Daftarkan pelanggan uji 1', 'POST', '/api/auth/register', {
    prereq: `
    const id = String(Date.now());
    pm.collectionVariables.set('runId', id);
    pm.collectionVariables.set('customerEmail', 'pelanggan.' + id + '@uji.rangkai');
    pm.collectionVariables.set('customer2Email', 'pelanggan2.' + id + '@uji.rangkai');`,
    body: { name: 'Sinta Maharani', email: '{{customerEmail}}', password: '{{seedPassword}}' }, tests: expectStatus(201),
  }),
  req('Daftarkan pelanggan uji 2', 'POST', '/api/auth/register', { body: { name: 'Bima Pelanggan', email: '{{customer2Email}}', password: '{{seedPassword}}' }, tests: expectStatus(201) }),
  ...pkceFlow('Pelanggan', 'cust', 'customerEmail', 'customerToken'),
  ...pkceFlow('Pelanggan 2', 'cust2', 'customer2Email', 'customer2Token'),
  ...pkceFlow('Masinis', 'mas', 'masinisEmail', 'masinisToken'),
  ...pkceFlow('Admin', 'admin', 'adminEmail', 'adminToken'),
  req('Pilih perjalanan Gajayana', 'GET', '/api/schedules?from=GMR&to=ML&date={{tripDate}}', {
    prereq: `
    const day = 6 + Math.floor(Math.random() * 18);
    const d = new Date(Date.now() + day * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    pm.collectionVariables.set('tripDate', d);
    const rnd = (n) => 1 + Math.floor(Math.random() * n);
    // Gajayana: LUX1 lalu EKS1 sampai EKS8, tiap gerbong eksekutif 13 baris (A-D). Gerbong dipisah agar kursi tidak bentrok.
    pm.collectionVariables.set('seatA', 'EKS' + rnd(2) + '-' + rnd(13) + 'A');
    pm.collectionVariables.set('seatB', 'EKS' + (2 + rnd(2)) + '-' + rnd(13) + 'B');
    pm.collectionVariables.set('seatC', 'EKS' + (4 + rnd(2)) + '-' + rnd(13) + 'C');
    pm.collectionVariables.set('seatD', 'EKS' + (6 + rnd(1)) + '-' + rnd(13) + 'D');
    pm.collectionVariables.set('seatE', 'EKS' + (6 + rnd(2)) + '-' + rnd(13) + 'A');
    pm.collectionVariables.set('runId', String(Date.now()));`,
    tests: `${expectStatus(200)}
    const t = pm.response.json().trips.find((x) => x.tripId.startsWith('GJY-'));
    pm.test('Perjalanan Gajayana ditemukan', () => pm.expect(t).to.be.an('object'));
    pm.collectionVariables.set('tripId', t.tripId);`,
  }),
]);

const week8 = folder('Minggu 8 - Keamanan Lanjutan', 'OAuth2 Authorization Code + PKCE, Client Credentials, JWT, refresh token berotasi, RBAC, dan manajemen API key. Uji mTLS ada di bat/test-security.bat karena Postman perlu sertifikat klien (Settings > Certificates, memakai folder certs).', [
  folder('OAuth2 dan JWT', '', [
    req('Metadata OAuth2', 'GET', '/.well-known/openid-configuration', { tests: `${expectStatus(200)}
    pm.test('Mendukung PKCE S256', () => pm.expect(pm.response.json().code_challenge_methods_supported).to.include('S256'));
    pm.test('Grant yang dianjurkan saja', () => pm.expect(pm.response.json().grant_types_supported).to.not.include('password'));` }),
    req('JWKS publik', 'GET', '/.well-known/jwks.json', { tests: `${expectStatus(200)}
    const k = pm.response.json().keys[0];
    pm.test('Kunci RS256', () => pm.expect(k.alg).to.eql('RS256'));
    pm.test('Kunci privat tidak bocor', () => pm.expect(k.d).to.be.undefined);` }),
    req('Daftar: akun baru', 'POST', '/api/auth/register', {
      body: { name: 'Penguji Postman', email: 'postman.{{runId}}@rangkai.test', password: 'Postman12345' },
      tests: `${expectStatus(201)}
    pm.test('Kata sandi tidak dikembalikan', () => pm.expect(pm.response.text()).to.not.include('Postman12345'));`,
    }),
    req('Daftar: email sudah dipakai', 'POST', '/api/auth/register', { body: { name: 'Penguji Postman', email: 'postman.{{runId}}@rangkai.test', password: 'Postman12345' }, tests: expectStatus(409) }),
    req('Daftar: kata sandi lemah (BVA 7 karakter)', 'POST', '/api/auth/register', { body: { name: 'Penguji', email: 'lemah.{{runId}}@rangkai.test', password: 'abc1234' }, tests: expectStatus(422) }),
    req('Daftar: mass assignment role', 'POST', '/api/auth/register', { body: { name: 'Penguji', email: 'mass.{{runId}}@rangkai.test', password: 'Postman12345', role: 'admin' }, tests: expectStatus(422) }),
    req('PKCE tanpa code_challenge ditolak', 'GET', '/oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri={{baseUrl}}/auth/callback&state=stateuji12', { headers: { Accept: 'application/json' }, tests: expectStatus(400) }),
    req('redirect_uri asing ditolak', 'GET', '/oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri=https://jahat.example/cb&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=stateuji12', { headers: { Accept: 'application/json' }, tests: expectStatus(400) }),
    req('Authorize untuk uji verifier salah', 'GET', '/oauth/authorize?response_type=code&client_id=rangkai-postman&redirect_uri={{baseUrl}}/auth/callback&code_challenge={{badChallenge}}&code_challenge_method=S256&state={{badState}}', {
      headers: { Accept: 'application/json' }, prereq: PKCE_PRE('bad'),
      tests: `${expectStatus(200)}
    pm.collectionVariables.set('badAuthRequest', pm.response.json().auth_request);`,
    }),
    req('Login salah sandi', 'POST', '/oauth/login', { body: { auth_request: '{{badAuthRequest}}', email: '{{customer2Email}}', password: 'SandiSalah999' }, tests: `${expectStatus(401)}
    pm.test('Pesan tidak membedakan email dan sandi', () => pm.expect(pm.response.json().error.code).to.eql('INVALID_CREDENTIALS'));` }),
    req('Login untuk uji verifier salah', 'POST', '/oauth/login', { body: { auth_request: '{{badAuthRequest}}', email: '{{customer2Email}}', password: '{{seedPassword}}' }, tests: `${expectStatus(200)}
    pm.collectionVariables.set('badCode', pm.response.json().code);` }),
    req('Token dengan code_verifier salah ditolak', 'POST', '/oauth/token', { form: { grant_type: 'authorization_code', client_id: 'rangkai-postman', code: '{{badCode}}', code_verifier: 'verifier-yang-salah-sama-sekali-dan-cukup-panjang', redirect_uri: '{{baseUrl}}/auth/callback' }, tests: `${expectStatus(400)}
    pm.test('invalid_grant', () => pm.expect(pm.response.json().error.code).to.eql('invalid_grant'));` }),
    req('Kode otorisasi bekas ditolak', 'POST', '/oauth/token', { form: { grant_type: 'authorization_code', client_id: 'rangkai-postman', code: '{{badCode}}', code_verifier: '{{badVerifier}}', redirect_uri: '{{baseUrl}}/auth/callback' }, tests: expectStatus(400) }),
    req('Profil dengan token', 'GET', '/api/auth/me', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Peran pelanggan', () => pm.expect(pm.response.json().user.role).to.eql('customer'));` }),
    req('Userinfo OAuth2', 'GET', '/oauth/userinfo', { auth: 'customerToken', tests: expectStatus(200) }),
    req('Tanpa token', 'GET', '/api/auth/me', { tests: expectStatus(401) }),
    req('Token dirusak', 'GET', '/api/auth/me', { headers: { Authorization: 'Bearer {{customerToken}}x' }, tests: expectStatus(401) }),
    req('Token alg none', 'GET', '/api/admin/users', { headers: { Authorization: 'Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ4Iiwic2NvcGUiOiJhZG1pbiIsImlzcyI6InJhbmdrYWktYXV0aCIsImF1ZCI6InJhbmdrYWktYXBpIiwiZXhwIjo0MTAyNDQ0ODAwfQ.' }, tests: expectStatus(401) }),
    req('Refresh token berotasi', 'POST', '/oauth/token', {
      form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: '{{customer2TokenRefresh}}' },
      prereq: `pm.collectionVariables.set('oldRefresh', pm.collectionVariables.get('customer2TokenRefresh'));`,
      tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('Refresh token baru berbeda', () => pm.expect(j.refresh_token).to.not.eql(pm.collectionVariables.get('oldRefresh')));
    pm.collectionVariables.set('customer2Token', j.access_token);
    pm.collectionVariables.set('newRefresh', j.refresh_token);`,
    }),
    req('Refresh token lama dipakai ulang', 'POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: '{{oldRefresh}}' }, tests: expectStatus(400) }),
    req('Seluruh keluarga token dicabut', 'POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: '{{newRefresh}}' }, tests: expectStatus(400) }),
  ]),
  folder('Client Credentials', '', [
    req('Partner meminta token', 'POST', '/oauth/token', { form: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: '{{partnerClientSecret}}' }, tests: `${expectStatus(200)}
    pm.test('Scope sempit', () => pm.expect(pm.response.json().scope).to.eql('partner:read'));
    pm.collectionVariables.set('partnerToken', pm.response.json().access_token);` }),
    req('Rahasia klien salah', 'POST', '/oauth/token', { form: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: 'salah' }, tests: expectStatus(401) }),
    req('Meminta scope di luar izin', 'POST', '/oauth/token', { form: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: '{{partnerClientSecret}}', scope: 'admin' }, tests: expectStatus(400) }),
    req('Klien publik tidak boleh Client Credentials', 'POST', '/oauth/token', { form: { grant_type: 'client_credentials', client_id: 'rangkai-web' }, tests: expectStatus(400) }),
    req('Token partner di rute partner', 'GET', '/api/partner/v1/stations', { auth: 'partnerToken', tests: expectStatus(200) }),
    req('Token partner di rute admin', 'GET', '/api/admin/users', { auth: 'partnerToken', tests: expectStatus(403) }),
  ]),
  folder('RBAC', '', [
    req('Pelanggan ke rute admin', 'GET', '/api/admin/users', { auth: 'customerToken', tests: expectStatus(403) }),
    req('Masinis ke audit', 'GET', '/api/admin/audit', { auth: 'masinisToken', tests: expectStatus(403) }),
    req('Admin ke rute admin', 'GET', '/api/admin/users', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Hash kata sandi tidak bocor', () => pm.expect(pm.response.text()).to.not.include('scrypt'));` }),
    req('Admin tidak bisa mengubah perannya sendiri', 'PATCH', '/api/admin/users/{{adminId}}/role', {
      auth: 'adminToken', body: { role: 'customer' },
      prereq: `pm.collectionVariables.set('adminId', JSON.parse(atob(pm.collectionVariables.get('adminToken').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub);`,
      tests: expectStatus(409),
    }),
  ]),
  folder('API key', '', [
    req('Buat API key (kuota 3 per menit)', 'POST', '/api/admin/api-keys', { auth: 'adminToken', body: { name: 'Postman {{runId}}', ratePerMin: 3, expiresInDays: 7, scopes: ['partner:read'] }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Key penuh tampil sekali', () => pm.expect(j.key).to.match(/^rk_live_/));
    pm.collectionVariables.set('apiKey', j.key);
    pm.collectionVariables.set('apiKeyId', j.id);` }),
    req('Daftar key tanpa nilai penuh', 'GET', '/api/admin/api-keys', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Key penuh tidak muncul', () => pm.expect(pm.response.text()).to.not.include(pm.collectionVariables.get('apiKey')));
    pm.test('Hash tidak muncul', () => pm.expect(pm.response.text()).to.not.include('key_hash'));` }),
    req('Pakai key lewat header', 'GET', '/api/partner/v1/stations', { headers: { 'X-API-Key': '{{apiKey}}' }, tests: expectStatus(200) }),
    req('Tanpa key', 'GET', '/api/partner/v1/stations', { tests: expectStatus(401) }),
    req('Key palsu', 'GET', '/api/partner/v1/stations', { headers: { 'X-API-Key': 'rk_live_palsu' }, tests: expectStatus(401) }),
    req('Kuota key habis', 'GET', '/api/partner/v1/stations', {
      headers: { 'X-API-Key': '{{apiKey}}' },
      tests: `
    const base = pm.collectionVariables.get('baseUrl') || pm.environment.get('baseUrl');
    const key = pm.collectionVariables.get('apiKey');
    pm.test('Permintaan ke-3 masih lolos', () => pm.response.to.have.status(200));
    let seen = 0;
    const fire = (n) => pm.sendRequest({ url: base + '/api/partner/v1/stations', header: { 'X-API-Key': key } }, (e, r) => {
      if (r && r.code === 429) seen += 1;
      if (n > 1) fire(n - 1);
      else pm.test('Kuota habis menghasilkan 429', () => pm.expect(seen).to.be.above(0));
    });
    fire(3);`,
    }),
    req('Rotasi key', 'POST', '/api/admin/api-keys/{{apiKeyId}}/rotate', { auth: 'adminToken', body: {}, tests: `${expectStatus(201)}
    pm.collectionVariables.set('apiKeyOld', pm.collectionVariables.get('apiKey'));
    pm.collectionVariables.set('apiKey', pm.response.json().key);
    pm.test('Key baru berbeda', () => pm.expect(pm.response.json().key).to.not.eql(pm.collectionVariables.get('apiKeyOld')));` }),
    req('Cabut key', 'DELETE', '/api/admin/api-keys/{{apiKeyId}}', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Dicabut', () => pm.expect(pm.response.json().revoked).to.eql(true));` }),
    req('Cabut key yang sudah dicabut', 'DELETE', '/api/admin/api-keys/{{apiKeyId}}', { auth: 'adminToken', tests: expectStatus(404) }),
  ]),
]);

const week9 = folder('Minggu 9 - API Gateway dan Reverse Proxy', 'Routing, validasi token di depan, validasi skema, CORS terbatas, rate limiting, dan header keamanan.', [
  req('Reverse proxy ke catalog', 'GET', '/api/stations', { tests: `${expectStatus(200)}
    pm.test('Ada penanda instance upstream', () => pm.response.to.have.header('X-Upstream-Instance'));
    pm.test('Ada X-Request-Id', () => pm.response.to.have.header('X-Request-Id'));
    pm.test('Ada info kuota', () => pm.response.to.have.header('X-RateLimit-Remaining'));` }),
  req('Reverse proxy ke booking', 'GET', '/api/bookings/instance', { tests: expectStatus(200) }),
  req('Halaman web dilayani gateway', 'GET', '/', { tests: `${expectStatus(200)}
    pm.test('Content-Security-Policy', () => pm.response.to.have.header('Content-Security-Policy'));
    pm.test('X-Frame-Options', () => pm.response.to.have.header('X-Frame-Options'));
    pm.test('X-Content-Type-Options', () => pm.response.to.have.header('X-Content-Type-Options'));` }),
  req('Dokumen API', 'GET', '/docs/openapi.yaml', { tests: expectStatus(200) }),
  req('Rute API tidak dikenal', 'GET', '/api/tidak-ada', { tests: `${expectStatus(404)}
    pm.test('Berupa JSON NOT_FOUND', () => pm.expect(pm.response.json().error.code).to.eql('NOT_FOUND'));` }),
  req('Alamat non-API (bukan halaman web)', 'GET', '/jadwal/', { tests: `${expectStatus(404)}
    pm.test('JSON NOT_FOUND dengan petunjuk, bukan HTML', () => { pm.expect(pm.response.headers.get('Content-Type')).to.include('json'); pm.expect(pm.response.json().error.code).to.eql('NOT_FOUND'); });` }),
  req('POST ke alamat non-API', 'POST', '/booking', { body: {}, tests: `${expectStatus(404)}
    pm.test('JSON NOT_FOUND', () => pm.expect(pm.response.json().error.code).to.eql('NOT_FOUND'));` }),
  req('Metode salah', 'PUT', '/api/stations', { tests: expectStatus(405) }),
  req('Skema: field wajib kurang', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: 'X' }, tests: `${expectStatus(422)}
    pm.test('Kode SCHEMA_VALIDATION_FAILED', () => pm.expect(pm.response.json().error.code).to.eql('SCHEMA_VALIDATION_FAILED'));` }),
  req('Skema: field asing', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: 'X', from: 'A', to: 'B', seats: ['EKS1-1A'], jahat: true }, tests: expectStatus(422) }),
  req('Skema: format kursi injeksi', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: 'X', from: 'A', to: 'B', seats: ["1' OR '1'='1"] }, tests: expectStatus(422) }),
  req('JSON rusak', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: '{rusak', tests: expectStatus(400) }),
  req('Body terlalu besar', 'POST', '/api/auth/register', {
    body: '{{bigBody}}', prereq: `pm.collectionVariables.set('bigBody', JSON.stringify({ name: 'x'.repeat(70000), email: 'a@b.co', password: 'x' }));`, tests: expectStatus(413),
  }),
  req('CORS: origin terdaftar', 'GET', '/api/stations', { headers: { Origin: '{{baseUrl}}' }, tests: `${expectStatus(200)}
    pm.test('Allow-Origin dikembalikan', () => pm.response.to.have.header('Access-Control-Allow-Origin'));` }),
  req('CORS: origin asing', 'GET', '/api/stations', { headers: { Origin: 'https://jahat.example' }, tests: expectStatus(403) }),
  req('Rate limit login', 'GET', '/healthz', {
    tests: `
    const base = pm.environment.get('baseUrl');
    let hits = 0;
    const email = 'burst.' + Date.now() + '@rangkai.test';
    const fire = (n) => pm.sendRequest({ url: base + '/oauth/login', method: 'POST', header: { 'Content-Type': 'application/json' }, body: { mode: 'raw', raw: JSON.stringify({ auth_request: 'x', email, password: 'x' }) } }, (e, r) => {
      if (r && r.code === 429) { hits += 1; pm.test('Retry-After dikirim', () => pm.expect(r.headers.has('Retry-After')).to.be.true); }
      if (n > 1) fire(n - 1);
      else pm.test('Percobaan ke-11 dan seterusnya 429', () => pm.expect(hits).to.be.above(0));
    });
    fire(13);`,
    desc: 'Mengirim 13 percobaan login dengan email yang sama. Batas 10 per menit per IP dan akun.',
  }),
]);

const week10 = folder('Minggu 10 - Service Discovery dan Load Balancing', 'Registry berbasis heartbeat, dua instance booking-service, dan pembagian beban round robin. Demo failover ada di bat/week-10.bat.', [
  req('Daftar service di registry', 'GET', '/api/admin/registry', { auth: 'adminToken', tests: `${expectStatus(200)}
    const s = pm.response.json().services;
    const find = (n) => s.find((x) => x.name === n);
    ['auth', 'catalog', 'booking', 'payment', 'notification', 'broker'].forEach((n) => pm.test(n + ' terdaftar', () => pm.expect(find(n).instances.length).to.be.above(0)));
    pm.test('Booking punya 2 instance', () => pm.expect(find('booking').instances.length).to.eql(2));` }),
  req('Pelanggan tidak boleh melihat registry', 'GET', '/api/admin/registry', { auth: 'customerToken', tests: expectStatus(403) }),
  req('Load balancing merata', 'GET', '/api/bookings/instance', {
    tests: `
    pm.test('Status 200', () => pm.response.to.have.status(200));
    const base = pm.environment.get('baseUrl');
    const seen = {};
    const fire = (n) => pm.sendRequest(base + '/api/bookings/instance', (e, r) => {
      const name = r.json().instance;
      seen[name] = (seen[name] || 0) + 1;
      if (n > 1) fire(n - 1);
      else {
        console.log('Pembagian beban', seen);
        pm.test('Dua instance melayani permintaan', () => pm.expect(Object.keys(seen)).to.have.length(2));
        pm.test('Terbagi cukup rata', () => Object.values(seen).forEach((c) => pm.expect(c).to.be.above(3)));
      }
    });
    fire(12);`,
  }),
  req('Statistik booking-service', 'GET', '/api/admin/booking-stats', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Menyebut instance yang melayani', () => pm.expect(pm.response.json().instance).to.match(/^booking-/));` }),
]);

const week11 = folder('Minggu 11 - Message Queue', 'Event asinkron: routing topik ke antrian, retry, dead letter queue, dan pengiriman ulang. Demo konsumen dan broker mati ada di bat/week-11.bat.', [
  req('Statistik antrian', 'GET', '/api/admin/queues', { auth: 'adminToken', tests: `${expectStatus(200)}
    const q = pm.response.json().queues.map((x) => x.queue);
    ['booking.events', 'payment.events', 'notification.events', 'audit.events'].forEach((n) => pm.test('Antrian ' + n, () => pm.expect(q).to.include(n)));` }),
  req('Pelanggan tidak boleh melihat antrian', 'GET', '/api/admin/queues', { auth: 'customerToken', tests: expectStatus(403) }),
  req('Kirim pesan uji', 'POST', '/api/admin/queues/publish-test', { auth: 'adminToken', body: { note: 'uji postman {{runId}}' }, tests: `${expectStatus(202)}
    pm.collectionVariables.set('pingId', pm.response.json().id);` }),
  req('Pesan uji dikonsumsi', 'GET', '/api/admin/queue-consumed', {
    auth: 'adminToken', prereq: 'setTimeout(() => {}, 1500);',
    tests: `${expectStatus(200)}
    pm.test('Pesan sudah dikonsumsi', () => pm.expect(pm.response.json().consumed.map((m) => m.msg_id)).to.include(pm.collectionVariables.get('pingId')));`,
  }),
  req('Kirim pesan beracun', 'POST', '/api/admin/queues/publish-test', { auth: 'adminToken', body: { poison: true, note: 'beracun {{runId}}' }, tests: expectStatus(202) }),
  req('Pesan beracun masuk DLQ', 'GET', '/api/admin/queues/notification.events/dlq', {
    auth: 'adminToken', prereq: 'setTimeout(() => {}, 7000);',
    tests: `${expectStatus(200)}
    pm.test('DLQ berisi pesan dan alasan', () => { const m = pm.response.json().messages; pm.expect(m.length).to.be.above(0); pm.expect(m[0].lastError).to.include('beracun'); });`,
  }),
  req('Kirim ulang isi DLQ', 'POST', '/api/admin/queues/notification.events/dlq/replay', { auth: 'adminToken', body: {}, tests: `${expectStatus(200)}
    pm.test('Ada pesan dikirim ulang', () => pm.expect(pm.response.json().replayed).to.be.above(0));` }),
]);

const graph = (name, query, variables, tests, auth) => req(name, 'POST', '/graphql', { auth, graphql: { query, variables }, tests });
const graphqlFolder = folder('GraphQL', 'Protokol non-REST. Justifikasi ada di docs/02-justifikasi-protokol.md.', [
  graph('Query: stasiun', '{ stations { code name city } }', {}, `${expectStatus(200)}
    pm.test('Ada stasiun', () => pm.expect(pm.response.json().data.stations.length).to.be.above(20));`),
  graph('Query: cari perjalanan', 'query Cari($from: String!, $to: String!, $date: String!) {\n  searchTrips(from: $from, to: $to, date: $date) {\n    trip { id trainName status }\n    from { departAt station { name } }\n    to { arriveAt station { name } }\n    durationMinutes km availableSeats\n    fares { seatClass adult }\n  }\n}', { from: 'GMR', to: 'MN', date: '{{tripDate}}' }, `${expectStatus(200)}
    pm.test('Menemukan perjalanan', () => pm.expect(pm.response.json().data.searchTrips.length).to.be.above(0));`),
  graph('Query: peta kursi per segmen', 'query Peta($id: ID!) {\n  seatMap(tripId: $id, from: "GMR", to: "MN") {\n    fromIndex toIndex km available total\n    segments { index from { name } to { name } km }\n    coaches { coach { code seatClass } adultFare available seats { id status segments { index status } } }\n  }\n}', { id: '{{tripId}}' }, `${expectStatus(200)}
    const m = pm.response.json().data.seatMap;
    pm.test('Ruas Gambir-Madiun adalah segmen 0 sampai 5', () => { pm.expect(m.fromIndex).to.eql(0); pm.expect(m.toIndex).to.eql(5); });
    pm.test('Sembilan gerbong', () => pm.expect(m.coaches.length).to.eql(9));`),
  graph('Query: klien hanya meminta field yang perlu', 'query Ringkas($id: ID!) { seatMap(tripId: $id, from: "GMR", to: "YK") { available total } }', { id: '{{tripId}}' }, `${expectStatus(200)}
    pm.test('Respons hanya berisi field yang diminta', () => pm.expect(Object.keys(pm.response.json().data.seatMap)).to.have.members(['available', 'total']));`),
  graph('Query: papan keberangkatan', '{ upcomingDepartures(limit: 5) { trainName fromName toName departureAt status } }', {}, expectStatus(200)),
  graph('Validasi: field tidak ada', '{ stations { tidakAda } }', {}, `${expectStatus(400)}
    pm.test('Kode validasi', () => pm.expect(pm.response.json().errors[0].extensions.code).to.eql('GRAPHQL_VALIDATION_FAILED'));`),
  graph('Validasi: query terlalu besar', `{ ${Array.from({ length: 205 }, (_, i) => `a${i}: stations { code }`).join(' ')} }`, {}, `${expectStatus(400)}
    pm.test('Ditolak batas ukuran', () => pm.expect(pm.response.json().errors[0].extensions.code).to.eql('QUERY_TOO_LARGE'));`),
  graph('Validasi: ruas terbalik', 'query($id: ID!) { seatMap(tripId: $id, from: "MN", to: "GMR") { available } }', { id: '{{tripId}}' }, `pm.test('Error INVALID_SEGMENT', () => pm.expect(pm.response.json().errors[0].extensions.code).to.eql('INVALID_SEGMENT'));`),
  graph('Mutation tanpa hak', 'mutation($id: ID!) { updateTripStatus(id: $id, status: DELAYED, delayMinutes: 10) { id } }', { id: '{{tripId}}' }, `pm.test('Ditolak', () => pm.expect(pm.response.json().errors[0].extensions.code).to.eql('INSUFFICIENT_SCOPE'));`, 'customerToken'),
  graph('Mutation: admin menandai terlambat', 'mutation($id: ID!) { updateTripStatus(id: $id, status: DELAYED, delayMinutes: 10) { id status delayMinutes } }', { id: '{{tripId}}' }, `${expectStatus(200)}
    pm.test('Status DELAYED', () => pm.expect(pm.response.json().data.updateTripStatus.status).to.eql('DELAYED'));`, 'adminToken'),
  graph('Mutation: kembalikan status', 'mutation($id: ID!) { updateTripStatus(id: $id, status: SCHEDULED) { status } }', { id: '{{tripId}}' }, expectStatus(200), 'adminToken'),
]);

const SIGN_WEBHOOK = `
    const secret = pm.environment.get('webhookSecret');
    const ts = Date.now();
    const raw = pm.variables.replaceIn(pm.request.body.raw);
    pm.request.headers.upsert({ key: 'X-Rangkai-Signature', value: 't=' + ts + ',v1=' + CryptoJS.HmacSHA256(ts + '.' + raw, secret).toString() });`;

const flow = folder('Alur Reservasi per Segmen', 'Inti sistem: satu kursi dipakai beberapa ruas, seat lock dengan TTL, idempotency, pesanan, pembayaran lewat webhook, tiket, dan pembatalan.', [
  folder('Jadwal REST', '', [
    req('Daftar stasiun', 'GET', '/api/stations', { tests: expectStatus(200) }),
    req('Cari jadwal', 'GET', '/api/schedules?from=GMR&to=MN&date={{tripDate}}', { tests: `${expectStatus(200)}
    const t = pm.response.json().trips.find((x) => x.tripId === pm.collectionVariables.get('tripId'));
    pm.test('Tarif eksekutif sesuai rumus', () => pm.expect(t.fares.find((f) => f.seatClass === 'EKSEKUTIF').adult).to.eql(650000));` }),
    req('Tanggal salah format', 'GET', '/api/schedules?from=GMR&to=MN&date=besok', { tests: expectStatus(422) }),
    req('Asal sama dengan tujuan', 'GET', '/api/schedules?from=GMR&to=GMR&date={{tripDate}}', { tests: expectStatus(422) }),
    req('Detail perjalanan', 'GET', '/api/trips/{{tripId}}', { tests: `${expectStatus(200)}
    pm.test('Sembilan stasiun', () => pm.expect(pm.response.json().trip.stops.length).to.eql(9));` }),
    req('Perjalanan tidak ada', 'GET', '/api/trips/TIDAK-ADA', { tests: expectStatus(404) }),
    req('Peta kursi REST', 'GET', '/api/trips/{{tripId}}/seats?from=GMR&to=MN', { tests: expectStatus(200) }),
    req('Admin membuat perjalanan tambahan', 'POST', '/api/trips', {
      auth: 'adminToken', prereq: `
    const dep = new Date(Date.now() + 29 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const minute = String(Date.now() % 60).padStart(2, '0');
    const hour = String(10 + (Date.now() % 12)).padStart(2, '0');
    pm.collectionVariables.set('newDate', dep);
    pm.collectionVariables.set('newTime', hour + ':' + minute);`,
      body: { trainId: 'GJY', direction: 'A', serviceDate: '{{newDate}}', departureTime: '{{newTime}}' },
      tests: `${expectStatus(201)}
    pm.collectionVariables.set('newTripId', pm.response.json().trip.id);`,
    }),
    req('Pelanggan tidak boleh membuat perjalanan', 'POST', '/api/trips', { auth: 'customerToken', body: { trainId: 'GJY', direction: 'A', serviceDate: '{{newDate}}', departureTime: '23:59' }, tests: expectStatus(403) }),
  ]),
  folder('Seat locking per segmen', '', [
    req('Tahan kursi: Gambir ke Madiun', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'MN', seats: ['{{seatA}}'] }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Segmen 0 sampai 5', () => { pm.expect(j.fromIndex).to.eql(0); pm.expect(j.toIndex).to.eql(5); });
    pm.test('TTL sekitar 10 menit', () => pm.expect(j.expiresAt - j.serverTime).to.be.within(590000, 601000));
    pm.collectionVariables.set('lockA', j.id);` }),
    req('Ruas tumpang tindih ditolak', 'POST', '/api/locks', { auth: 'customer2Token', headers: idem, body: { tripId: '{{tripId}}', from: 'PWT', to: 'KD', seats: ['{{seatA}}'] },
      tests: `${expectStatus(409)}
    const e = pm.response.json().error;
    pm.test('Kode SEAT_CONFLICT', () => pm.expect(e.code).to.eql('SEAT_CONFLICT'));
    pm.test('Menyebut segmen yang bentrok', () => pm.expect(e.details.conflicts.length).to.be.above(0));` }),
    req('Kursi sama, Madiun ke Malang: berhasil', 'POST', '/api/locks', { auth: 'customer2Token', headers: idem, body: { tripId: '{{tripId}}', from: 'MN', to: 'ML', seats: ['{{seatA}}'] }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('lockB', pm.response.json().id);` }),
    req('Ketersediaan per ruas', 'GET', '/api/trips/{{tripId}}/availability?from=GMR&to=MN', { tests: `${expectStatus(200)}
    pm.test('Kursi tampil LOCKED', () => pm.expect(pm.response.json().taken.find((t) => t.seatId === pm.collectionVariables.get('seatA')).status).to.eql('LOCKED'));` }),
    req('Lepas lock kedua', 'DELETE', '/api/locks/{{lockB}}', { auth: 'customer2Token', tests: expectStatus(200) }),
    req('Lepas lock yang sudah dilepas', 'DELETE', '/api/locks/{{lockB}}', { auth: 'customer2Token', tests: `${expectStatus(409)}
    pm.test('LOCK_NOT_ACTIVE', () => pm.expect(pm.response.json().error.code).to.eql('LOCK_NOT_ACTIVE'));` }),
    req('Lock orang lain tidak terlihat', 'GET', '/api/locks/{{lockA}}', { auth: 'customer2Token', tests: expectStatus(404) }),
    req('Tanpa Idempotency-Key', 'POST', '/api/locks', { auth: 'customerToken', body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['{{seatB}}'] }, tests: expectStatus(400) }),
    req('Idempotency: kiriman pertama', 'POST', '/api/locks', { auth: 'customerToken', headers: { 'Idempotency-Key': 'postman-{{runId}}-a' }, body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['{{seatB}}'] }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('lockIdem', pm.response.json().id);` }),
    req('Idempotency: kirim ulang', 'POST', '/api/locks', { auth: 'customerToken', headers: { 'Idempotency-Key': 'postman-{{runId}}-a' }, body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['{{seatB}}'] }, tests: `${expectStatus(201)}
    pm.test('Lock yang sama', () => pm.expect(pm.response.json().id).to.eql(pm.collectionVariables.get('lockIdem')));
    pm.test('Ditandai replay', () => pm.response.to.have.header('Idempotent-Replay'));` }),
    req('Idempotency: isi berbeda', 'POST', '/api/locks', { auth: 'customerToken', headers: { 'Idempotency-Key': 'postman-{{runId}}-a' }, body: { tripId: '{{tripId}}', from: 'GMR', to: 'PWT', seats: ['{{seatB}}'] }, tests: `${expectStatus(409)}
    pm.test('IDEMPOTENCY_KEY_REUSED', () => pm.expect(pm.response.json().error.code).to.eql('IDEMPOTENCY_KEY_REUSED'));` }),
    req('Lepas lock idempotency', 'DELETE', '/api/locks/{{lockIdem}}', { auth: 'customerToken', tests: expectStatus(200) }),
    req('Ruas terbalik', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'MN', to: 'GMR', seats: ['{{seatB}}'] }, tests: `${expectStatus(422)}
    pm.test('INVALID_SEGMENT', () => pm.expect(pm.response.json().error.code).to.eql('INVALID_SEGMENT'));` }),
    req('Kursi tidak ada', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['ZZZ1-1A'] }, tests: expectStatus(422) }),
    req('Kursi kembar ditolak', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['EKS1-1A', 'EKS1-1A'] }, tests: expectStatus(422) }),
    req('Delapan kursi sekaligus diterima (tanpa batas jumlah)', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'CN', seats: ['LUX1-1A', 'LUX1-1D', 'LUX1-2A', 'LUX1-2D', 'LUX1-3A', 'LUX1-3D', 'LUX1-4A', 'LUX1-4D'], ttlSeconds: 3 }, tests: `${expectStatus(201)}
    pm.test('Delapan kursi ditahan', () => pm.expect(pm.response.json().seats.length).to.eql(8));` }),
    req('Lock singkat 3 detik untuk uji TTL', 'POST', '/api/locks', { auth: 'customer2Token', headers: idem, body: { tripId: '{{tripId}}', from: 'YK', to: 'SLO', seats: ['{{seatC}}'], ttlSeconds: 3 }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('lockTtl', pm.response.json().id);` }),
    req('Setelah 5 detik lock kedaluwarsa', 'GET', '/api/locks/{{lockTtl}}', { auth: 'customer2Token', prereq: 'setTimeout(() => {}, 5000);', tests: `${expectStatus(200)}
    pm.test('Status EXPIRED', () => pm.expect(pm.response.json().status).to.eql('EXPIRED'));` }),
    req('Kursi bisa ditahan lagi setelah TTL', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'YK', to: 'SLO', seats: ['{{seatC}}'], ttlSeconds: 3 }, tests: expectStatus(201) }),
  ]),
  folder('Pesanan dan pembayaran', '', [
    req('NIK salah format', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: '{{seatA}}', name: 'Sinta', age: 30, nik: '123' }] }, tests: `${expectStatus(422)}
    pm.test('INVALID_NIK', () => pm.expect(pm.response.json().error.code).to.eql('INVALID_NIK'));` }),
    req('Dewasa tanpa NIK', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: '{{seatA}}', name: 'Sinta', age: 17 }] }, tests: `${expectStatus(422)}
    pm.test('NIK_REQUIRED', () => pm.expect(pm.response.json().error.code).to.eql('NIK_REQUIRED'));` }),
    req('Usia 121 ditolak (BVA)', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: '{{seatA}}', name: 'Kakek Uji', age: 121, nik: '3578015203990001' }] }, tests: expectStatus(422) }),
    req('Penumpang tidak cocok dengan kursi', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: 'EKS1-1A', name: 'Sinta', age: 30, nik: '3578015203990001' }] }, tests: expectStatus(422) }),
    req('Buat pesanan', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: '{{seatA}}', name: 'Sinta Maharani', age: 30, nik: '3578015203990001', phone: '081234567890' }] }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Status menunggu bayar', () => pm.expect(j.status).to.eql('PENDING_PAYMENT'));
    pm.test('NIK dimasker', () => { pm.expect(pm.response.text()).to.not.include('3578015203990001'); pm.expect(j.passengers[0].nikMasked).to.eql('************0001'); });
    pm.test('Tiket belum terbit', () => pm.expect(j.passengers[0].ticketCode).to.eql(null));
    pm.collectionVariables.set('bookingId', j.id);
    pm.collectionVariables.set('bookingAmount', j.amount);` }),
    req('Lock yang sama tidak bisa dipakai lagi', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockA}}', passengers: [{ seatId: '{{seatA}}', name: 'Sinta Maharani', age: 30, nik: '3578015203990001' }] }, tests: expectStatus(409) }),
    req('IDOR: baca pesanan orang lain', 'GET', '/api/bookings/{{bookingId}}', { auth: 'customer2Token', tests: expectStatus(404) }),
    req('IDOR: bayar pesanan orang lain', 'POST', '/api/payments', { auth: 'customer2Token', headers: idem, body: { bookingId: '{{bookingId}}' }, tests: expectStatus(404) }),
    req('Pembayaran tanpa Idempotency-Key', 'POST', '/api/payments', { auth: 'customerToken', body: { bookingId: '{{bookingId}}' }, tests: expectStatus(400) }),
    req('Metode tidak dikenal', 'POST', '/api/payments', { auth: 'customerToken', headers: idem, body: { bookingId: '{{bookingId}}', method: 'BITCOIN' }, tests: expectStatus(422) }),
    req('Buat pembayaran', 'POST', '/api/payments', { auth: 'customerToken', headers: idem, body: { bookingId: '{{bookingId}}', method: 'QRIS' }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Nominal dari server, sama dengan pesanan', () => pm.expect(j.payment.amount).to.eql(Number(pm.collectionVariables.get('bookingAmount'))));
    pm.collectionVariables.set('paymentId', j.payment.id);
    pm.collectionVariables.set('checkoutToken', j.checkoutToken);` }),
    req('Nomor kartu mentah ditolak', 'POST', '/api/mock-gateway/checkout/{{checkoutToken}}/pay', { auth: 'customerToken', body: { cardNumber: '4111111111111111' }, tests: `${expectStatus(422)}
    pm.test('RAW_CARD_REJECTED', () => pm.expect(pm.response.json().error.code).to.eql('RAW_CARD_REJECTED'));` }),
    req('Webhook tanpa tanda tangan', 'POST', '/api/payments/webhook', { body: { eventId: 'evt_palsu', type: 'payment.succeeded', providerRef: 'X', amount: 1 }, tests: expectStatus(401) }),
    req('Webhook tanda tangan palsu', 'POST', '/api/payments/webhook', { headers: { 'X-Rangkai-Signature': 't=1700000000000,v1=0000000000000000000000000000000000000000000000000000000000000000' }, body: { eventId: 'evt_palsu', type: 'payment.succeeded', providerRef: 'X', amount: 1 }, tests: expectStatus(401) }),
    req('Webhook bertanda tangan sah, referensi tak dikenal', 'POST', '/api/payments/webhook', { prereq: SIGN_WEBHOOK, body: { eventId: 'evt_{{runId}}', type: 'payment.succeeded', providerRef: 'MOCK-TIDAKADA', amount: 1 }, tests: `${expectStatus(404)}
    pm.test('Tanda tangan lolos, lalu referensi dicek', () => pm.expect(pm.response.json().error.code).to.eql('PAYMENT_NOT_FOUND'));` }),
    req('Pesanan masih menunggu setelah webhook palsu', 'GET', '/api/bookings/{{bookingId}}', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Belum terkonfirmasi', () => pm.expect(pm.response.json().status).to.eql('PENDING_PAYMENT'));` }),
    req('Gateway simulasi: bayar berhasil', 'POST', '/api/mock-gateway/checkout/{{checkoutToken}}/pay', { auth: 'customerToken', body: { outcome: 'success' }, tests: expectStatus(202) }),
    req('Tiket terbit lewat webhook dan event', 'GET', '/api/bookings/{{bookingId}}', {
      auth: 'customerToken', prereq: 'setTimeout(() => {}, 2500);',
      tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('CONFIRMED', () => pm.expect(j.status).to.eql('CONFIRMED'));
    pm.test('Kode tiket ada', () => pm.expect(j.passengers[0].ticketCode).to.match(/^TKT-/));
    pm.collectionVariables.set('ticketCode', j.passengers[0].ticketCode);`,
    }),
    req('Status pembayaran', 'GET', '/api/payments/{{paymentId}}', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('SUCCEEDED', () => pm.expect(pm.response.json().payment.status).to.eql('SUCCEEDED'));` }),
    req('Checkout tidak bisa dipakai lagi', 'POST', '/api/mock-gateway/checkout/{{checkoutToken}}/pay', { auth: 'customerToken', body: { outcome: 'success' }, tests: expectStatus(409) }),
    req('Kursi kini BOOKED', 'GET', '/api/trips/{{tripId}}/availability?from=GMR&to=MN', { tests: `${expectStatus(200)}
    pm.test('BOOKED', () => pm.expect(pm.response.json().taken.find((t) => t.seatId === pm.collectionVariables.get('seatA')).status).to.eql('BOOKED'));` }),
    req('Riwayat pesanan saya', 'GET', '/api/bookings', { auth: 'customerToken', tests: expectStatus(200) }),
    req('Notifikasi lewat antrian', 'GET', '/api/notifications', { auth: 'customerToken', prereq: 'setTimeout(() => {}, 1200);', tests: `${expectStatus(200)}
    pm.test('Ada notifikasi tiket terbit', () => pm.expect(pm.response.json().notifications.map((n) => n.title)).to.include('Tiket terbit'));` }),
  ]),
  folder('Check-in dan manifest', '', [
    req('Pelanggan tidak boleh check-in', 'POST', '/api/tickets/checkin', { auth: 'customerToken', body: { ticketCode: '{{ticketCode}}' }, tests: expectStatus(403) }),
    req('Manifest untuk admin', 'GET', '/api/trips/{{tripId}}/manifest', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('NIK dimasker', () => pm.expect(pm.response.text()).to.not.include('3578015203990001'));` }),
    req('Pelanggan tidak boleh melihat manifest', 'GET', '/api/trips/{{tripId}}/manifest', { auth: 'customerToken', tests: expectStatus(403) }),
    req('Tiket tidak dikenal', 'POST', '/api/tickets/checkin', { auth: 'masinisToken', body: { ticketCode: 'TKT-TIDAKADA' }, tests: expectStatus(404) }),
  ]),
  folder('Pembatalan dan refund', '', [
    req('Pratinjau refund', 'GET', '/api/bookings/{{bookingId}}/refund-preview', { auth: 'customerToken', tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('Bisa dibatalkan', () => pm.expect(j.cancellable).to.eql(true));
    pm.test('90 persen untuk keberangkatan jauh', () => pm.expect(j.percent).to.eql(90));
    pm.collectionVariables.set('refundAmount', j.refundAmount);` }),
    req('Batalkan pesanan', 'POST', '/api/bookings/{{bookingId}}/cancel', { auth: 'customerToken', tests: `${expectStatus(200)}
    const j = pm.response.json();
    pm.test('CANCELLED', () => pm.expect(j.status).to.eql('CANCELLED'));
    pm.test('Nominal sama dengan pratinjau', () => pm.expect(j.refundAmount).to.eql(Number(pm.collectionVariables.get('refundAmount'))));` }),
    req('Batalkan dua kali', 'POST', '/api/bookings/{{bookingId}}/cancel', { auth: 'customerToken', tests: `${expectStatus(409)}
    pm.test('INVALID_STATE_TRANSITION', () => pm.expect(pm.response.json().error.code).to.eql('INVALID_STATE_TRANSITION'));` }),
    req('Check-in tiket yang dibatalkan', 'POST', '/api/tickets/checkin', { auth: 'adminToken', body: { ticketCode: '{{ticketCode}}' }, tests: expectStatus(409) }),
    req('Pembayaran menjadi REFUNDED', 'GET', '/api/payments/{{paymentId}}', { auth: 'customerToken', prereq: 'setTimeout(() => {}, 1800);', tests: `${expectStatus(200)}
    pm.test('REFUNDED', () => pm.expect(pm.response.json().payment.status).to.eql('REFUNDED'));` }),
    req('Kursi kosong lagi, bisa ditahan penumpang lain', 'POST', '/api/locks', { auth: 'customer2Token', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'MN', seats: ['{{seatA}}'], ttlSeconds: 3 }, tests: expectStatus(201) }),
    req('Admin membatalkan perjalanan', 'PATCH', '/api/trips/{{newTripId}}', { auth: 'adminToken', body: { status: 'CANCELLED' }, tests: `${expectStatus(200)}
    pm.test('CANCELLED', () => pm.expect(pm.response.json().trip.status).to.eql('CANCELLED'));` }),
    req('Perjalanan batal tidak bisa dipesan', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, prereq: 'setTimeout(() => {}, 2200);', body: { tripId: '{{newTripId}}', from: 'GMR', to: 'MN', seats: ['EKS1-1A'] }, tests: `${expectStatus(409)}
    pm.test('TRIP_CANCELLED', () => pm.expect(pm.response.json().error.code).to.eql('TRIP_CANCELLED'));` }),
  ]),
  folder('Audit', '', [
    req('Audit log', 'GET', '/api/admin/audit?limit=100', { auth: 'adminToken', tests: `${expectStatus(200)}
    const actions = pm.response.json().entries.map((e) => e.action);
    pm.test('Mencatat login', () => pm.expect(actions).to.include('login.success'));
    pm.test('Mencatat pesanan', () => pm.expect(actions).to.include('booking.created'));
    pm.test('Tanpa token atau sandi', () => pm.expect(pm.response.text()).to.not.match(/eyJ[A-Za-z0-9_-]{20,}/));` }),
    req('Peringatan keamanan', 'GET', '/api/admin/alerts', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Webhook palsu tercatat', () => pm.expect(pm.response.json().alerts.map((a) => a.kind)).to.include('webhook_rejected'));` }),
  ]),
]);

/* ---------- Fitur revisi: profil, admin, masinis, transfer VA, QRIS, notifikasi, bantuan, partner ---------- */
// PNG 1x1 piksel sebagai bukti transfer uji. Jenis berkas dicek dari isinya (magic bytes), bukan dari nama.
const PNG_PROOF = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const RANDOM_CODES = `
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const pick = () => L[Math.floor(Math.random() * 26)];
    pm.collectionVariables.set('stationCode', 'Q' + pick() + pick() + pick());
    pm.collectionVariables.set('trainCode', 'Z' + pick() + pick());
    pm.collectionVariables.set('trainNumber', 'KA ' + (9000 + Math.floor(Math.random() * 999)));`;
const waitMs = (ms) => `setTimeout(() => {}, ${ms});`;

const revisi = folder('Revisi - Profil, Admin, Masinis, Pembayaran, Bantuan', 'Endpoint yang ditambahkan pada revisi: data KAI, profil, manajemen pengguna dan data operasional oleh admin, jadwal dinas masinis, transfer VA dengan bukti, QRIS, notifikasi, Pusat Bantuan, dan API partner.', [
  folder('Data publik', '', [
    req('Daftar kereta aktif', 'GET', '/api/trains', { tests: `${expectStatus(200)}
    const t = pm.response.json().trains;
    pm.test('Delapan kereta KAI', () => pm.expect(t.length).to.eql(8));
    pm.test('Gajayana ada', () => pm.expect(t.map((x) => x.name)).to.include('Gajayana'));` }),
    req('Kebijakan tarif', 'GET', '/api/pricing', { tests: `${expectStatus(200)}
    pm.test('Diskon lansia 0 sampai 100', () => pm.expect(pm.response.json().seniorDiscountPercent).to.be.within(0, 100));` }),
    req('Skema GraphQL (SDL)', 'GET', '/graphql/schema', { tests: `${expectStatus(200)}
    pm.test('Memuat searchTrips', () => pm.expect(pm.response.text()).to.include('searchTrips'));` }),
  ]),
  folder('Profil pengguna', '', [
    req('Ubah nomor HP sendiri', 'PATCH', '/api/auth/me', { auth: 'customer2Token', body: { phone: '081299990000' }, tests: `${expectStatus(200)}
    pm.test('Nomor tersimpan', () => pm.expect(pm.response.json().user.phone).to.eql('081299990000'));` }),
    req('NIK profil salah format', 'PATCH', '/api/auth/me', { auth: 'customer2Token', body: { nik: '123' }, tests: expectStatus(422) }),
    req('Field asing di profil (mass assignment)', 'PATCH', '/api/auth/me', { auth: 'customer2Token', body: { role: 'admin' }, tests: expectStatus(422) }),
    req('Ganti sandi: sandi lama salah', 'POST', '/api/auth/me/password', { auth: 'customer2Token', body: { currentPassword: 'BukanSandi123', newPassword: 'SandiBaru12345' }, tests: `${expectStatus(422)}
    pm.test('Ditunjuk field currentPassword', () => pm.expect(pm.response.json().error.details.fields).to.have.property('currentPassword'));` }),
  ]),
  folder('Admin: manajemen pengguna', '', [
    req('Pelanggan tidak boleh membuat akun', 'POST', '/api/admin/users', { auth: 'customerToken', body: { name: 'Coba', email: 'coba.{{runId}}@rangkai.test', password: 'Masinis12345', role: 'masinis' }, tests: expectStatus(403) }),
    req('Admin membuat akun masinis', 'POST', '/api/admin/users', { auth: 'adminToken', body: { name: 'Masinis Uji', email: 'masinis.{{runId}}@rangkai.test', password: 'Masinis12345', role: 'masinis' }, tests: `${expectStatus(201)}
    const u = pm.response.json().user;
    pm.test('Peran masinis', () => pm.expect(u.role).to.eql('masinis'));
    pm.test('Hash sandi tidak dikembalikan', () => pm.expect(pm.response.text()).to.not.include('scrypt'));
    pm.collectionVariables.set('newUserId', u.id);` }),
    req('Detail pengguna', 'GET', '/api/admin/users/{{newUserId}}', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Ubah data pengguna', 'PATCH', '/api/admin/users/{{newUserId}}', { auth: 'adminToken', body: { phone: '081300009999' }, tests: expectStatus(200) }),
    req('Ganti peran menjadi customer', 'PATCH', '/api/admin/users/{{newUserId}}/role', { auth: 'adminToken', body: { role: 'customer' }, tests: `${expectStatus(200)}
    pm.test('Peran berubah', () => pm.expect(pm.response.json().user.role).to.eql('customer'));` }),
    req('Peran tidak dikenal ditolak', 'PATCH', '/api/admin/users/{{newUserId}}/role', { auth: 'adminToken', body: { role: 'operator' }, tests: expectStatus(422) }),
    req('Admin mengganti sandi pengguna', 'POST', '/api/admin/users/{{newUserId}}/password', { auth: 'adminToken', body: { password: 'GantiSandi123' }, tests: expectStatus(200) }),
    req('Hapus pengguna', 'DELETE', '/api/admin/users/{{newUserId}}', { auth: 'adminToken', tests: expectStatus(200) }),
  ]),
  folder('Admin: data operasional', '', [
    req('Daftar stasiun (admin)', 'GET', '/api/admin/stations', { auth: 'adminToken', prereq: RANDOM_CODES, tests: `${expectStatus(200)}
    pm.test('33 stasiun atau lebih', () => pm.expect(pm.response.json().stations.length).to.be.at.least(33));` }),
    req('Tambah stasiun', 'POST', '/api/admin/stations', { auth: 'adminToken', body: { code: '{{stationCode}}', name: 'Stasiun Uji Postman', city: 'Kota Uji' }, tests: expectStatus(201) }),
    req('Kode stasiun ganda', 'POST', '/api/admin/stations', { auth: 'adminToken', body: { code: '{{stationCode}}', name: 'Stasiun Uji Postman', city: 'Kota Uji' }, tests: `${expectStatus(409)}
    pm.test('STATION_EXISTS', () => pm.expect(pm.response.json().error.code).to.eql('STATION_EXISTS'));` }),
    req('Nonaktifkan stasiun', 'PATCH', '/api/admin/stations/{{stationCode}}', { auth: 'adminToken', body: { active: false }, tests: `${expectStatus(200)}
    pm.test('Nonaktif', () => pm.expect(pm.response.json().station.active).to.eql(false));` }),
    req('Hapus stasiun yang tidak dipakai', 'DELETE', '/api/admin/stations/{{stationCode}}', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Stasiun yang dipakai rute tidak bisa dihapus', 'DELETE', '/api/admin/stations/GMR', { auth: 'adminToken', tests: `${expectStatus(409)}
    pm.test('STATION_IN_USE', () => pm.expect(pm.response.json().error.code).to.eql('STATION_IN_USE'));` }),
    req('Daftar kereta (admin)', 'GET', '/api/admin/trains', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Detail kereta Gajayana', 'GET', '/api/admin/trains/GJY', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.test('Nama Gajayana', () => pm.expect(pm.response.json().train.name).to.eql('Gajayana'));` }),
    req('Buat kereta uji', 'POST', '/api/admin/trains', { auth: 'adminToken', body: { id: '{{trainCode}}', number: '{{trainNumber}}', name: 'Kereta Uji Postman', classes: ['EKONOMI'] }, tests: `${expectStatus(201)}
    pm.test('Dibuat nonaktif', () => pm.expect(pm.response.json().train.enabled).to.eql(false));` }),
    req('Aktifkan sebelum lengkap ditolak', 'PATCH', '/api/admin/trains/{{trainCode}}', { auth: 'adminToken', body: { enabled: true }, tests: `${expectStatus(409)}
    pm.test('TRAIN_INCOMPLETE', () => pm.expect(pm.response.json().error.code).to.eql('TRAIN_INCOMPLETE'));` }),
    req('Atur rute kereta uji', 'PUT', '/api/admin/trains/{{trainCode}}/route', { auth: 'adminToken', body: { stops: [{ code: 'GMR', minuteOffset: 0, km: 0 }, { code: 'BKS', minuteOffset: 30, km: 28 }] }, tests: expectStatus(200) }),
    req('Rute dengan km mundur ditolak', 'PUT', '/api/admin/trains/{{trainCode}}/route', { auth: 'adminToken', body: { stops: [{ code: 'GMR', minuteOffset: 0, km: 0 }, { code: 'BKS', minuteOffset: 30, km: 0 }] }, tests: expectStatus(422) }),
    req('Atur tarif kereta uji', 'PUT', '/api/admin/trains/{{trainCode}}/fares', { auth: 'adminToken', body: { fares: [{ seatClass: 'EKONOMI', base: 20000, perKm: 300 }] }, tests: expectStatus(200) }),
    req('Atur jam operasional', 'PUT', '/api/admin/trains/{{trainCode}}/services', { auth: 'adminToken', body: { services: [{ direction: 'A', departureTime: '23:55' }] }, tests: expectStatus(200) }),
    req('Aktifkan kereta uji', 'PATCH', '/api/admin/trains/{{trainCode}}', { auth: 'adminToken', body: { enabled: true }, tests: `${expectStatus(200)}
    pm.test('Aktif', () => pm.expect(pm.response.json().train.enabled).to.eql(true));` }),
    req('Terapkan ke jadwal mendatang', 'POST', '/api/admin/trains/{{trainCode}}/regenerate', { auth: 'adminToken', body: {}, tests: expectStatus(200) }),
    req('Riwayat perjalanan kereta', 'GET', '/api/admin/trains/{{trainCode}}/trips', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Nonaktifkan kereta uji', 'PATCH', '/api/admin/trains/{{trainCode}}', { auth: 'adminToken', body: { enabled: false }, tests: expectStatus(200) }),
    req('Hapus kereta uji', 'DELETE', '/api/admin/trains/{{trainCode}}', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Baca diskon lansia', 'GET', '/api/admin/settings', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.collectionVariables.set('seniorPct', pm.response.json().seniorDiscountPercent);` }),
    req('Simpan diskon lansia (nilai sama)', 'PUT', '/api/admin/settings', { auth: 'adminToken', body: '{"seniorDiscountPercent": {{seniorPct}}}', tests: expectStatus(200) }),
    req('Diskon 101 persen ditolak (BVA)', 'PUT', '/api/admin/settings', { auth: 'adminToken', body: { seniorDiscountPercent: 101 }, tests: expectStatus(422) }),
    req('Masinis tidak boleh mengubah data', 'PUT', '/api/admin/settings', { auth: 'masinisToken', body: { seniorDiscountPercent: 10 }, tests: expectStatus(403) }),
    req('Statistik katalog', 'GET', '/api/admin/catalog-stats', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Penumpang satu perjalanan', 'GET', '/api/admin/trips/{{tripId}}/passengers', { auth: 'adminToken', tests: expectStatus(200) }),
    req('Statistik beberapa perjalanan', 'POST', '/api/admin/trip-stats', { auth: 'adminToken', body: { tripIds: ['{{tripId}}'] }, tests: expectStatus(200) }),
  ]),
  folder('Masinis', '', [
    req('Jadwal dinas masinis', 'GET', '/api/masinis/trips', { auth: 'masinisToken', tests: `${expectStatus(200)}
    const t = pm.response.json().trips.filter((x) => new Date(x.departureAt).getTime() > Date.now());
    pm.test('Ada perjalanan mendatang', () => pm.expect(t.length).to.be.above(0));
    if (t.length) pm.collectionVariables.set('dutyTripId', t[0].tripId || t[0].id);` }),
    req('Pelanggan tidak boleh membuka jadwal dinas', 'GET', '/api/masinis/trips', { auth: 'customerToken', tests: expectStatus(403) }),
    req('Masinis melaporkan terlambat 15 menit', 'PATCH', '/api/masinis/trips/{{dutyTripId}}/delay', { auth: 'masinisToken', body: { delayMinutes: 15 }, tests: `${expectStatus(200)}
    pm.test('DELAYED', () => pm.expect(pm.response.json().trip.status).to.eql('DELAYED'));` }),
    req('Keterlambatan 721 menit ditolak (BVA)', 'PATCH', '/api/masinis/trips/{{dutyTripId}}/delay', { auth: 'masinisToken', body: { delayMinutes: 721 }, tests: expectStatus(422) }),
    req('Kembali tepat waktu', 'PATCH', '/api/masinis/trips/{{dutyTripId}}/delay', { auth: 'masinisToken', body: { delayMinutes: 0 }, tests: `${expectStatus(200)}
    pm.test('SCHEDULED', () => pm.expect(pm.response.json().trip.status).to.eql('SCHEDULED'));` }),
    req('Manifest perjalanan dinas sendiri', 'GET', '/api/trips/{{dutyTripId}}/manifest', { auth: 'masinisToken', tests: expectStatus(200) }),
  ]),
  folder('Transfer VA dengan bukti', '', [
    req('Tahan kursi untuk VA', 'POST', '/api/locks', { auth: 'customerToken', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'YK', seats: ['{{seatD}}'] }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('lockVa', pm.response.json().id);` }),
    req('Pesanan dengan penumpang lansia', 'POST', '/api/bookings', { auth: 'customerToken', headers: idem, body: { lockId: '{{lockVa}}', passengers: [{ seatId: '{{seatD}}', name: 'Bapak Lansia', age: 70, nik: '1234567890123456' }] }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Label lansia', () => pm.expect(j.passengers[0].passengerType).to.eql('SENIOR'));
    pm.collectionVariables.set('bookingVa', j.id);` }),
    req('Pilih VA BCA', 'POST', '/api/payments', { auth: 'customerToken', headers: idem, body: { bookingId: '{{bookingVa}}', method: 'VA_BCA' }, tests: `${expectStatus(201)}
    const p = pm.response.json().payment;
    pm.test('Menunggu transfer', () => pm.expect(p.status).to.eql('AWAITING_TRANSFER'));
    pm.test('Ada nomor VA', () => pm.expect(p.vaNumber).to.be.a('string'));
    pm.collectionVariables.set('paymentVa', p.id);` }),
    req('Daftar pembayaran pesanan', 'GET', '/api/payments?bookingId={{bookingVa}}', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Satu pembayaran', () => pm.expect(pm.response.json().payments.length).to.eql(1));` }),
    req('Bukti bukan gambar ditolak', 'POST', '/api/payments/{{paymentVa}}/proof', { auth: 'customerToken', body: { fileName: 'bukti.txt', dataBase64: 'aGFsbw==' }, tests: expectStatus(422) }),
    req('Unggah bukti transfer', 'POST', '/api/payments/{{paymentVa}}/proof', { auth: 'customerToken', body: { fileName: 'bukti.png', dataBase64: PNG_PROOF, note: 'Transfer dari BCA' }, tests: `${expectStatus(201)}
    pm.test('Menunggu verifikasi', () => pm.expect(pm.response.json().payment.status).to.eql('UNDER_REVIEW'));` }),
    req('Pelanggan tidak boleh membuka verifikasi', 'GET', '/api/admin/transfers', { auth: 'customerToken', tests: expectStatus(403) }),
    req('Admin melihat bukti masuk', 'GET', '/api/admin/transfers?status=SUBMITTED', { auth: 'adminToken', tests: `${expectStatus(200)}
    const t = pm.response.json().transfers.find((x) => x.payment.id === pm.collectionVariables.get('paymentVa'));
    pm.test('Bukti pesanan ini ada', () => pm.expect(t).to.be.an('object'));
    pm.test('Data pemesan untuk verifikasi', () => pm.expect(t.user.email).to.be.a('string'));
    pm.collectionVariables.set('proofId', t.proof.id);` }),
    req('Pemilik bisa membuka berkas bukti', 'GET', '/api/payments/proofs/{{proofId}}/file', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Berupa gambar PNG', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('image/png'));` }),
    req('Pengguna lain tidak bisa membuka bukti', 'GET', '/api/payments/proofs/{{proofId}}/file', { auth: 'customer2Token', tests: expectStatus(404) }),
    req('Alasan tolak terlalu pendek', 'POST', '/api/admin/transfers/{{proofId}}/decision', { auth: 'adminToken', body: { decision: 'REJECT', reason: 'abc' }, tests: expectStatus(422) }),
    req('Admin menolak bukti', 'POST', '/api/admin/transfers/{{proofId}}/decision', { auth: 'adminToken', body: { decision: 'REJECT', reason: 'Nominal di bukti tidak terbaca' }, tests: expectStatus(200) }),
    req('Notifikasi penolakan sampai ke pelanggan', 'GET', '/api/notifications', { auth: 'customerToken', prereq: waitMs(1500), tests: `${expectStatus(200)}
    pm.test('Ada notifikasi pembayaran ditolak', () => pm.expect(pm.response.json().notifications.map((n) => n.title)).to.include('Pembayaran ditolak'));` }),
    req('Unggah ulang bukti', 'POST', '/api/payments/{{paymentVa}}/proof', { auth: 'customerToken', body: { fileName: 'bukti2.png', dataBase64: PNG_PROOF, note: 'Bukti lebih jelas' }, tests: expectStatus(201) }),
    req('Ambil bukti baru', 'GET', '/api/admin/transfers?status=SUBMITTED', { auth: 'adminToken', tests: `${expectStatus(200)}
    pm.collectionVariables.set('proofId', pm.response.json().transfers.find((x) => x.payment.id === pm.collectionVariables.get('paymentVa')).proof.id);` }),
    req('Admin menerima bukti', 'POST', '/api/admin/transfers/{{proofId}}/decision', { auth: 'adminToken', body: { decision: 'ACCEPT' }, tests: expectStatus(200) }),
    req('Pesanan VA terkonfirmasi', 'GET', '/api/bookings/{{bookingVa}}', { auth: 'customerToken', prereq: waitMs(2000), tests: `${expectStatus(200)}
    pm.test('CONFIRMED', () => pm.expect(pm.response.json().status).to.eql('CONFIRMED'));
    pm.test('Tiket terbit', () => pm.expect(pm.response.json().passengers[0].ticketCode).to.match(/^TKT-/));` }),
  ]),
  folder('QRIS dari ponsel', '', [
    req('Tahan kursi untuk QRIS', 'POST', '/api/locks', { auth: 'customer2Token', headers: idem, body: { tripId: '{{tripId}}', from: 'GMR', to: 'YK', seats: ['{{seatE}}'] }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('lockQr', pm.response.json().id);` }),
    req('Pesanan untuk QRIS', 'POST', '/api/bookings', { auth: 'customer2Token', headers: idem, body: { lockId: '{{lockQr}}', passengers: [{ seatId: '{{seatE}}', name: 'Bima Pelanggan', age: 25, nik: '3578015203990002' }] }, tests: `${expectStatus(201)}
    pm.collectionVariables.set('bookingQr', pm.response.json().id);` }),
    req('Buat QRIS', 'POST', '/api/payments', { auth: 'customer2Token', headers: idem, body: { bookingId: '{{bookingQr}}', method: 'QRIS' }, tests: `${expectStatus(201)}
    const j = pm.response.json();
    pm.test('Tautan QRIS untuk dipindai', () => pm.expect(j.instructions.qrisUrl).to.include('/qris/'));
    pm.collectionVariables.set('qrisToken', j.checkoutToken);
    pm.collectionVariables.set('paymentQr', j.payment.id);` }),
    req('Halaman QRIS dibuka dari ponsel', 'GET', '/api/qris/{{qrisToken}}', { tests: `${expectStatus(200)}
    pm.test('Masih menunggu', () => pm.expect(pm.response.json().status).to.eql('PENDING'));
    pm.test('Tanpa data pribadi penumpang', () => pm.expect(pm.response.text()).to.not.include('3578015203990002'));` }),
    req('Ponsel membayar QRIS', 'POST', '/api/qris/{{qrisToken}}/pay', { body: {}, tests: `${expectStatus(202)}
    pm.test('Diterima', () => pm.expect(pm.response.json().accepted).to.eql(true));` }),
    req('Pembayaran QRIS berhasil', 'GET', '/api/payments/{{paymentQr}}', { auth: 'customer2Token', prereq: waitMs(2000), tests: `${expectStatus(200)}
    pm.test('SUCCEEDED', () => pm.expect(pm.response.json().payment.status).to.eql('SUCCEEDED'));` }),
    req('QR dipindai ulang tidak membayar dua kali', 'POST', '/api/qris/{{qrisToken}}/pay', { body: {}, tests: `${expectStatus(200)}
    pm.test('Tidak diterima lagi', () => pm.expect(pm.response.json().accepted).to.eql(false));` }),
    req('Token QRIS palsu', 'GET', '/api/qris/token-palsu-sekali', { tests: expectStatus(404) }),
  ]),
  folder('Notifikasi', '', [
    req('Jumlah belum dibaca', 'GET', '/api/notifications/unread-count', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Angka', () => pm.expect(pm.response.json().unread).to.be.a('number'));` }),
    req('Ambil notifikasi', 'GET', '/api/notifications', { auth: 'customerToken', tests: `${expectStatus(200)}
    const n = pm.response.json().notifications;
    pm.test('Ada notifikasi', () => pm.expect(n.length).to.be.above(0));
    pm.test('Setiap notifikasi punya tautan', () => pm.expect(n[0]).to.have.property('link'));
    pm.collectionVariables.set('notifId', n[0].id);` }),
    req('Tandai satu dibaca', 'POST', '/api/notifications/{{notifId}}/read', { auth: 'customerToken', body: {}, tests: expectStatus(200) }),
    req('Notifikasi orang lain tidak bisa ditandai', 'POST', '/api/notifications/{{notifId}}/read', { auth: 'customer2Token', body: {}, tests: expectStatus(404) }),
    req('Tandai semua dibaca', 'POST', '/api/notifications/read-all', { auth: 'customerToken', body: {}, tests: expectStatus(200) }),
    req('Belum dibaca menjadi 0', 'GET', '/api/notifications/unread-count', { auth: 'customerToken', tests: `${expectStatus(200)}
    pm.test('Nol', () => pm.expect(pm.response.json().unread).to.eql(0));` }),
  ]),
  folder('Pusat Bantuan', '', [
    req('FAQ', 'GET', '/api/support/faq', { tests: `${expectStatus(200)}
    pm.test('Ada kategori dan pertanyaan', () => pm.expect(pm.response.json().categories[0].items.length).to.be.above(0));` }),
    req('Tanya Kiko (AI atau FAQ)', 'POST', '/api/support/chat', { body: { messages: [{ role: 'user', content: 'Bagaimana cara membatalkan tiket dan berapa refundnya?' }] }, tests: `${expectStatus(200)}
    pm.test('Ada jawaban', () => pm.expect(pm.response.json().reply).to.be.a('string').and.not.empty);`, desc: 'Memakai Gemini bila GEMINI_API_KEY diisi. Tanpa key, atau bila Gemini gagal, jawaban diambil dari FAQ.' }),
    req('Pesan terakhir harus dari pengguna', 'POST', '/api/support/chat', { body: { messages: [{ role: 'assistant', content: 'Halo' }] }, tests: expectStatus(422) }),
  ]),
  folder('API partner dan logout', '', [
    req('Partner mencari jadwal', 'GET', '/api/partner/v1/schedules?from=GMR&to=YK&date={{tripDate}}', { auth: 'partnerToken', tests: expectStatus(200) }),
    req('Partner melihat ketersediaan', 'GET', '/api/partner/v1/trips/{{tripId}}/availability?from=GMR&to=YK', { auth: 'partnerToken', tests: expectStatus(200) }),
    req('Logout: cabut refresh token', 'POST', '/oauth/revoke', { form: { token: '{{custTokenRefresh}}', client_id: 'rangkai-postman' }, prereq: "pm.collectionVariables.set('custTokenRefresh', pm.collectionVariables.get('customerTokenRefresh'));", tests: `${expectStatus(200)}
    pm.test('revoked', () => pm.expect(pm.response.json().revoked).to.eql(true));` }),
    req('Refresh token yang dicabut tidak bisa dipakai', 'POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: '{{custTokenRefresh}}' }, tests: expectStatus(400) }),
  ]),
]);


const collection = {
  info: {
    _postman_id: crypto.createHash('md5').update('rangkai-collection').digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'),
    name: 'Rangkai API (Web Service x Software Testing)',
    description: 'Koleksi uji seluruh endpoint Rangkai, disusun per minggu progres. Cara pakai: impor koleksi ini dan environment-nya, pilih environment, jalankan folder "00 Persiapan" lebih dulu, lalu folder lain. Seluruh koleksi bisa dijalankan dengan Collection Runner atau bat/test-postman.bat.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'tripDate', value: '' }, { key: 'tripId', value: '' }, { key: 'runId', value: '' },
  ],
  item: [setup, week8, week9, week10, week11, graphqlFolder, flow, revisi],
};

const count = (items) => items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
const out = path.resolve(__dirname, '..', 'postman', 'Rangkai.postman_collection.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(collection, null, 2));

const template = {
  id: crypto.randomUUID(), name: 'Rangkai (template, isi secret dari .env)', _postman_variable_scope: 'environment',
  values: [
    ['baseUrl', 'http://localhost:8080'], ['seedPassword', '<SEED_USER_PASSWORD dari .env>'], ['partnerClientSecret', '<PARTNER_DEMO_CLIENT_SECRET dari .env>'], ['webhookSecret', '<WEBHOOK_SECRET dari .env>'],
    ['masinisEmail', 'masinis@rangkai.test'], ['adminEmail', 'admin@rangkai.test'],
  ].map(([key, value]) => ({ key, value, enabled: true, type: /secret|password/i.test(key) ? 'secret' : 'default' })),
};
fs.writeFileSync(path.resolve(__dirname, '..', 'postman', 'Rangkai.template.postman_environment.json'), JSON.stringify(template, null, 2));
console.log(`Koleksi Postman ditulis: ${path.relative(process.cwd(), out)} (${count(collection.item)} request)`);
