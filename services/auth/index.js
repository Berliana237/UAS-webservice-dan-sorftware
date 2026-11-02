'use strict';
/**
 * Auth service: Authorization Server OAuth2.
 *  - Authorization Code + PKCE (pengguna lewat browser/Postman)
 *  - Client Credentials (antar service dan partner)
 *  - JWT RS256 berumur pendek, refresh token berotasi dengan deteksi pemakaian ulang
 *  - Manajemen API key: hash, tampil sekali, scope, kuota, masa berlaku, rotasi, pencabutan
 */
const crypto = require('node:crypto');
const config = require('../shared/config');
const { createApp, finish, ApiError } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const pii = require('../shared/pii');
const store = require('./store');
const { issueAccessToken, jwks } = require('./tokens');
const { scopesForRole, pkceS256, validatePassword, validateEmail, narrowScope } = require('./rules');

const { log, registry, bus, verifier } = kit('auth');
const app = createApp('auth', log);
const audit = (action, data) => bus.publishSafe(`audit.${action}`, { action, service: 'auth', at: Date.now(), ...data });

const CODE_TTL_MS = 60000;
const REQUEST_TTL_MS = 600000;
const MAX_FAILED = 5;
const LOCK_MS = 60000;

store.seed();

/* ---------- Metadata ---------- */
app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks()));
app.get('/.well-known/openid-configuration', (_req, res) => res.json({
  issuer: config.iss,
  authorization_endpoint: `${config.publicUrl}/oauth/authorize`,
  token_endpoint: `${config.publicUrl}/oauth/token`,
  revocation_endpoint: `${config.publicUrl}/oauth/revoke`,
  userinfo_endpoint: `${config.publicUrl}/oauth/userinfo`,
  jwks_uri: `${config.publicUrl}/.well-known/jwks.json`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
}));
app.get('/internal/jwks', (_req, res) => res.json(jwks()));

/* ---------- Registrasi ---------- */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  const fields = {};
  if (!name || String(name).trim().length < 2 || String(name).length > 80) fields.name = 'Nama 2 sampai 80 karakter.';
  const eErr = validateEmail(email); if (eErr) fields.email = eErr;
  const pErr = validatePassword(password); if (pErr) fields.password = pErr;
  if (Object.keys(fields).length) throw new ApiError(422, 'VALIDATION_FAILED', 'Periksa kembali isian Anda.', { fields });
  if (store.findUserByEmail(email)) throw new ApiError(409, 'EMAIL_TAKEN', 'Email ini sudah terdaftar. Silakan masuk.', { fields: { email: 'Email sudah terdaftar.' } });
  const user = await store.createUser({ name: String(name).trim(), email, password, role: 'customer' });
  audit('user.registered', { actor: user.id, target: user.id, ip: req.headers['x-forwarded-for'] });
  res.status(201).json({ user: store.publicUser(user) });
});

/* ---------- Authorization Code + PKCE ---------- */
function validateAuthorizeParams(q) {
  const client = store.findClient(q.client_id);
  if (!client) throw new ApiError(400, 'invalid_client', 'client_id tidak dikenal.');
  const uris = JSON.parse(client.redirect_uris);
  if (!uris.includes(q.redirect_uri)) throw new ApiError(400, 'invalid_redirect_uri', 'redirect_uri tidak terdaftar.');
  if (q.response_type !== 'code') throw new ApiError(400, 'unsupported_response_type', 'Hanya response_type=code yang didukung.');
  if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) throw new ApiError(400, 'invalid_request', 'PKCE wajib: code_challenge dengan metode S256.');
  if (!q.state || String(q.state).length < 8) throw new ApiError(400, 'invalid_request', 'state wajib diisi (minimal 8 karakter).');
  return client;
}

app.get('/oauth/authorize', (req, res) => {
  const client = validateAuthorizeParams(req.query);
  const id = pii.randomToken(24);
  store.saveAuthRequest({
    id, clientId: client.client_id, redirectUri: req.query.redirect_uri, scope: req.query.scope || '', state: req.query.state,
    challenge: req.query.code_challenge, expiresAt: Date.now() + REQUEST_TTL_MS,
  });
  if ((req.headers.accept || '').includes('application/json')) return res.json({ auth_request: id, client: client.name, expires_in: REQUEST_TTL_MS / 1000 });
  res.redirect(302, `${config.publicUrl}/masuk?auth_request=${encodeURIComponent(id)}`);
});

app.post('/oauth/login', async (req, res) => {
  const { auth_request: requestId, email, password } = req.body || {};
  const ar = store.findAuthRequest(requestId);
  if (!ar || ar.expires_at < Date.now()) throw new ApiError(400, 'AUTH_REQUEST_EXPIRED', 'Sesi masuk sudah habis. Muat ulang halaman lalu coba lagi.');
  const user = store.findUserByEmail(email);
  const fail = () => {
    audit('login.failed', { target: pii.blindIndex(email || '').slice(0, 12), ip: req.headers['x-forwarded-for'] });
    return new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
  };
  if (!user) { await store.dummyHash(password); throw fail(); }
  if (user.locked_until > Date.now()) {
    throw new ApiError(423, 'ACCOUNT_LOCKED', 'Terlalu banyak percobaan gagal. Akun dikunci sementara, coba lagi 1 menit lagi.', { retryAfterSeconds: Math.ceil((user.locked_until - Date.now()) / 1000) });
  }
  if (!(await store.verifyPassword(password, user.password_hash))) {
    const count = user.failed_count + 1;
    store.setFailed(user.id, count >= MAX_FAILED ? 0 : count, count >= MAX_FAILED ? Date.now() + LOCK_MS : 0);
    if (count >= MAX_FAILED) bus.publishSafe('security.account_locked', { service: 'auth', severity: 'high', target: user.id, at: Date.now() });
    throw fail();
  }
  store.setFailed(user.id, 0, 0);
  const code = pii.randomToken(32);
  const client = store.findClient(ar.client_id);
  store.saveCode({
    hash: pii.sha256(code), clientId: ar.client_id, userId: user.id, redirectUri: ar.redirect_uri,
    challenge: ar.code_challenge, scope: narrowScope(ar.scope, scopesForRole(user.role).concat(JSON.parse(client.scopes))), expiresAt: Date.now() + CODE_TTL_MS,
  });
  store.deleteAuthRequest(ar.id);
  audit('login.success', { actor: user.id, ip: req.headers['x-forwarded-for'] });
  const url = new URL(ar.redirect_uri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', ar.state);
  res.json({ redirect_to: url.toString(), code, state: ar.state });
});

/* ---------- Token endpoint ---------- */
function clientFromRequest(req) {
  let id = req.body?.client_id; let secret = req.body?.client_secret;
  const basic = req.headers.authorization || '';
  if (basic.startsWith('Basic ')) {
    const [a, b] = Buffer.from(basic.slice(6), 'base64').toString().split(':');
    id = decodeURIComponent(a || ''); secret = decodeURIComponent(b || '');
  }
  const client = store.findClient(id);
  if (!client) throw new ApiError(401, 'invalid_client', 'Klien tidak dikenal.');
  if (client.type === 'confidential' && !(secret && pii.safeEqual(pii.sha256(secret), client.secret_hash))) throw new ApiError(401, 'invalid_client', 'Rahasia klien salah.');
  return client;
}

const WEB_CLIENT = 'rangkai-web';
function setRefreshCookie(req, res, token, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const parts = [`rangkai_rt=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/oauth', `Max-Age=${maxAge}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
const cookieRefresh = (req) => (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('rangkai_rt='))?.slice(11);

async function tokenResponse(req, res, client, user, scope, family) {
  const access = await issueAccessToken({ sub: user.id, role: user.role, scope, clientId: client.client_id, name: pii.decrypt(user.name_enc) });
  const refresh = store.issueRefresh({ userId: user.id, clientId: client.client_id, scope, family });
  const body = { access_token: access, token_type: 'Bearer', expires_in: config.accessTtl, scope, role: user.role };
  if (client.client_id === WEB_CLIENT) setRefreshCookie(req, res, refresh, config.refreshTtl); else body.refresh_token = refresh;
  res.json(body);
}

app.post('/oauth/token', async (req, res) => {
  const grant = req.body?.grant_type;
  const client = clientFromRequest(req);

  if (grant === 'authorization_code') {
    const { code, code_verifier: verifierStr, redirect_uri: redirectUri } = req.body;
    if (!code || !verifierStr) throw new ApiError(400, 'invalid_request', 'code dan code_verifier wajib diisi.');
    const row = store.consumeCode(pii.sha256(code));
    if (!row) throw new ApiError(400, 'invalid_grant', 'Kode otorisasi tidak valid atau sudah dipakai.');
    if (row.expires_at < Date.now() || row.client_id !== client.client_id || row.redirect_uri !== redirectUri) throw new ApiError(400, 'invalid_grant', 'Kode otorisasi tidak cocok atau sudah kedaluwarsa.');
    if (!pii.safeEqual(pkceS256(verifierStr), row.code_challenge)) {
      bus.publishSafe('security.pkce_failed', { service: 'auth', severity: 'high', target: client.client_id, at: Date.now() });
      throw new ApiError(400, 'invalid_grant', 'Verifikasi PKCE gagal.');
    }
    const user = store.findUserById(row.user_id);
    return tokenResponse(req, res, client, user, row.scope, crypto.randomUUID());
  }

  if (grant === 'refresh_token') {
    const presented = req.body.refresh_token || (client.client_id === WEB_CLIENT ? cookieRefresh(req) : null);
    if (!presented) throw new ApiError(400, 'invalid_request', 'refresh_token wajib diisi.');
    const row = store.findRefresh(pii.sha256(presented));
    if (!row || row.client_id !== client.client_id) throw new ApiError(400, 'invalid_grant', 'Refresh token tidak valid.');
    if (row.revoked_at) {
      // Token lama dipakai lagi: kemungkinan dicuri. Seluruh keluarga token dicabut.
      store.revokeFamily(row.family_id);
      bus.publishSafe('security.refresh_reuse', { service: 'auth', severity: 'high', target: row.user_id, at: Date.now() });
      throw new ApiError(400, 'invalid_grant', 'Refresh token sudah pernah dipakai. Sesi dicabut demi keamanan.');
    }
    if (row.expires_at < Date.now()) throw new ApiError(400, 'invalid_grant', 'Refresh token kedaluwarsa.');
    store.revokeRefresh(row.id);
    const user = store.findUserById(row.user_id);
    return tokenResponse(req, res, client, user, row.scope, row.family_id);
  }

  if (grant === 'client_credentials') {
    if (client.type !== 'confidential') throw new ApiError(400, 'unauthorized_client', 'Grant ini hanya untuk klien rahasia.');
    const allowed = JSON.parse(client.scopes);
    const scope = req.body.scope ? narrowScope(req.body.scope, allowed) : allowed.join(' ');
    if (req.body.scope && !scope) throw new ApiError(400, 'invalid_scope', 'Scope tidak diizinkan untuk klien ini.');
    const access = await issueAccessToken({ sub: client.client_id, role: 'service', scope, clientId: client.client_id });
    return res.json({ access_token: access, token_type: 'Bearer', expires_in: config.accessTtl, scope });
  }

  throw new ApiError(400, 'unsupported_grant_type', 'grant_type tidak didukung.');
});

app.post('/oauth/revoke', (req, res) => {
  const client = clientFromRequest(req);
  const token = req.body?.token || (client.client_id === WEB_CLIENT ? cookieRefresh(req) : null);
  if (token) {
    const row = store.findRefresh(pii.sha256(token));
    if (row && row.client_id === client.client_id) { store.revokeFamily(row.family_id); audit('logout', { actor: row.user_id }); }
  }
  if (client.client_id === WEB_CLIENT) setRefreshCookie(req, res, '', 0);
  res.status(200).json({ revoked: true }); // RFC 7009: selalu 200, tidak membocorkan keberadaan token
});

/* ---------- Profil ---------- */
const me = (req, res) => {
  const user = store.findUserById(req.user.sub);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
  res.json({ user: store.publicUser(user), scope: req.user.scope });
};
app.get('/oauth/userinfo', verifier.requireAuth(), me);
app.get('/api/auth/me', verifier.requireAuth(), me);

/* ---------- Admin: pengguna ---------- */
const admin = verifier.requireAuth(['admin']);
app.get('/api/admin/users', admin, (_req, res) => res.json({ users: store.listUsers().map(store.publicUser) }));
app.patch('/api/admin/users/:id/role', admin, (req, res) => {
  const { role } = req.body || {};
  if (!['customer', 'operator', 'admin'].includes(role)) throw new ApiError(422, 'VALIDATION_FAILED', 'Peran harus customer, operator, atau admin.');
  if (req.params.id === req.user.sub) throw new ApiError(409, 'CANNOT_CHANGE_SELF', 'Tidak bisa mengubah peran akun sendiri.');
  const user = store.findUserById(req.params.id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Pengguna tidak ditemukan.');
  store.setRole(user.id, role);
  audit('user.role_changed', { actor: req.user.sub, target: user.id, role });
  res.json({ user: store.publicUser(store.findUserById(user.id)) });
});

/* ---------- Admin: API key ---------- */
const PARTNER_SCOPES = ['partner:read'];
function parseKeyInput(body) {
  const { name, scopes = ['partner:read'], ratePerMin = 60, expiresInDays = 30 } = body || {};
  const fields = {};
  if (!name || String(name).trim().length < 3 || String(name).length > 60) fields.name = 'Nama 3 sampai 60 karakter.';
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !PARTNER_SCOPES.includes(s))) fields.scopes = `Scope yang diizinkan: ${PARTNER_SCOPES.join(', ')}.`;
  if (!Number.isInteger(ratePerMin) || ratePerMin < 1 || ratePerMin > 6000) fields.ratePerMin = 'Kuota 1 sampai 6000 per menit.';
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) fields.expiresInDays = 'Masa berlaku 1 sampai 365 hari.';
  if (Object.keys(fields).length) throw new ApiError(422, 'VALIDATION_FAILED', 'Periksa kembali isian Anda.', { fields });
  return { name: String(name).trim(), scopes, ratePerMin, expiresInDays };
}
app.get('/api/admin/api-keys', admin, (_req, res) => res.json({ keys: store.listApiKeys() }));
app.post('/api/admin/api-keys', admin, (req, res) => {
  const created = store.createApiKey({ ...parseKeyInput(req.body), owner: req.user.sub });
  audit('apikey.created', { actor: req.user.sub, target: created.id });
  res.status(201).json({ ...created, notice: 'Simpan key ini sekarang. Key penuh hanya ditampilkan sekali.' });
});
app.post('/api/admin/api-keys/:id/rotate', admin, (req, res) => {
  const rotated = store.rotateApiKey(req.params.id);
  if (!rotated) throw new ApiError(404, 'KEY_NOT_FOUND', 'API key tidak ditemukan atau sudah dicabut.');
  audit('apikey.rotated', { actor: req.user.sub, target: req.params.id });
  res.status(201).json({ ...rotated, notice: 'Key lama langsung dimatikan. Key baru hanya ditampilkan sekali.' });
});
app.delete('/api/admin/api-keys/:id', admin, (req, res) => {
  if (!store.revokeApiKey(req.params.id)) throw new ApiError(404, 'KEY_NOT_FOUND', 'API key tidak ditemukan atau sudah dicabut.');
  audit('apikey.revoked', { actor: req.user.sub, target: req.params.id });
  res.json({ revoked: true });
});

// Hanya gateway yang boleh memeriksa API key.
app.post('/internal/api-keys/verify', mtls.requireCN('gateway'), (req, res) => {
  res.json(store.verifyApiKey(req.body?.key));
});

finish(app, log);
mtls.createServer('auth', app, config.ports.auth, log);
registry.register('auth', config.urls.auth, { role: 'authorization-server' });
