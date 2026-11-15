'use strict';
/** Penyimpanan auth-service. Email dan nama dienkripsi, kata sandi, kode, token, dan API key hanya disimpan sebagai hash. */
const crypto = require('node:crypto');
const util = require('node:util');
const config = require('../shared/config');
const dbm = require('../shared/db');
const pii = require('../shared/pii');

const scrypt = util.promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const db = dbm.open('auth');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email_idx TEXT UNIQUE NOT NULL, email_enc TEXT NOT NULL, name_enc TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer', failed_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS clients(client_id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, secret_hash TEXT, redirect_uris TEXT NOT NULL, scopes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_requests(id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, scope TEXT, state TEXT NOT NULL, code_challenge TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_codes(code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS refresh_tokens(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, family_id TEXT NOT NULL, user_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rt_family ON refresh_tokens(family_id);
CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY, prefix TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL, scopes TEXT NOT NULL, rate_per_min INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER, last_used_at INTEGER, created_at INTEGER NOT NULL);
`);
// Migrasi kolom profil. SQLite tidak punya ADD COLUMN IF NOT EXISTS, jadi kolom yang sudah ada dilewati.
for (const col of ['phone_enc TEXT', 'nik_enc TEXT', 'birth_date TEXT', 'active INTEGER NOT NULL DEFAULT 1', 'updated_at INTEGER']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* kolom sudah ada */ }
}
// Peran operator lama digabung ke masinis.
db.exec(`UPDATE users SET role='masinis' WHERE role='operator'`);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = await scrypt(String(password), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [, s, h] = String(stored).split('$');
  const dk = await scrypt(String(password || ''), Buffer.from(s, 'base64'), 32, SCRYPT);
  return crypto.timingSafeEqual(dk, Buffer.from(h, 'base64'));
}
/** Menyamakan waktu respons saat email tidak ada, agar email tidak bisa ditebak dari lamanya respons. */
const dummyHash = (password) => scrypt(String(password || ''), 'rangkai-timing-pad', 32, SCRYPT);

const st = {
  userByIdx: db.prepare('SELECT * FROM users WHERE email_idx=?'),
  userById: db.prepare('SELECT * FROM users WHERE id=?'),
  insertUser: db.prepare('INSERT INTO users(id,email_idx,email_enc,name_enc,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)'),
  listUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 500'),
  usersByRole: db.prepare('SELECT * FROM users WHERE role=? AND active=1 ORDER BY created_at'),
  updateProfile: db.prepare('UPDATE users SET name_enc=?, phone_enc=?, nik_enc=?, birth_date=?, updated_at=? WHERE id=?'),
  updateAdmin: db.prepare('UPDATE users SET name_enc=?, email_idx=?, email_enc=?, phone_enc=?, nik_enc=?, birth_date=?, role=?, active=?, updated_at=? WHERE id=?'),
  setPassword: db.prepare('UPDATE users SET password_hash=?, failed_count=0, locked_until=0, updated_at=? WHERE id=?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id=?'),
  revokeUser: db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?'),
  setFailed: db.prepare('UPDATE users SET failed_count=?, locked_until=? WHERE id=?'),
  setRole: db.prepare('UPDATE users SET role=? WHERE id=?'),
  client: db.prepare('SELECT * FROM clients WHERE client_id=?'),
  upsertClient: db.prepare(`INSERT INTO clients(client_id,name,type,secret_hash,redirect_uris,scopes) VALUES(?,?,?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET name=excluded.name,type=excluded.type,secret_hash=excluded.secret_hash,redirect_uris=excluded.redirect_uris,scopes=excluded.scopes`),
  saveReq: db.prepare('INSERT INTO auth_requests(id,client_id,redirect_uri,scope,state,code_challenge,expires_at) VALUES(?,?,?,?,?,?,?)'),
  getReq: db.prepare('SELECT * FROM auth_requests WHERE id=?'),
  delReq: db.prepare('DELETE FROM auth_requests WHERE id=?'),
  saveCode: db.prepare('INSERT INTO auth_codes(code_hash,client_id,user_id,redirect_uri,code_challenge,scope,expires_at) VALUES(?,?,?,?,?,?,?)'),
  getCode: db.prepare('SELECT * FROM auth_codes WHERE code_hash=?'),
  delCode: db.prepare('DELETE FROM auth_codes WHERE code_hash=?'),
  insertRt: db.prepare('INSERT INTO refresh_tokens(id,token_hash,family_id,user_id,client_id,scope,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)'),
  getRt: db.prepare('SELECT * FROM refresh_tokens WHERE token_hash=?'),
  revokeRt: db.prepare('UPDATE refresh_tokens SET revoked_at=? WHERE id=?'),
  revokeFam: db.prepare('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE family_id=?'),
  insertKey: db.prepare('INSERT INTO api_keys(id,prefix,key_hash,name,owner,scopes,rate_per_min,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)'),
  listKeys: db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC'),
  keyById: db.prepare('SELECT * FROM api_keys WHERE id=?'),
  keyByHash: db.prepare('SELECT * FROM api_keys WHERE key_hash=?'),
  updateKey: db.prepare('UPDATE api_keys SET prefix=?, key_hash=? WHERE id=? AND revoked_at IS NULL'),
  revokeKey: db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL'),
  touchKey: db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?'),
  cleanup: db.prepare('DELETE FROM auth_requests WHERE expires_at<?'),
  cleanupCodes: db.prepare('DELETE FROM auth_codes WHERE expires_at<?'),
};
setInterval(() => { const n = Date.now(); st.cleanup.run(n); st.cleanupCodes.run(n); }, 60000).unref();

const { ageFrom } = require('./rules');
const dec = (v) => (v ? pii.decrypt(v) : null);
const enc = (v) => (v ? pii.encrypt(String(v)) : null);
const publicUser = (u) => ({
  id: u.id, name: pii.decrypt(u.name_enc), email: pii.decrypt(u.email_enc), role: u.role, phone: dec(u.phone_enc), nik: dec(u.nik_enc),
  birthDate: u.birth_date || null, age: ageFrom(u.birth_date), active: u.active !== 0, createdAt: u.created_at, updatedAt: u.updated_at || null,
});
const findUserByEmail = (email) => (email ? st.userByIdx.get(pii.blindIndex(email)) : undefined);
const findUserById = (id) => st.userById.get(id);

async function createUser({ name, email, password, role, phone, nik, birthDate }) {
  const id = `usr_${crypto.randomBytes(9).toString('hex')}`;
  st.insertUser.run(id, pii.blindIndex(email), pii.encrypt(String(email).trim().toLowerCase()), pii.encrypt(name), await hashPassword(password), role, Date.now());
  if (phone || nik || birthDate) st.updateProfile.run(pii.encrypt(name), enc(phone), enc(nik), birthDate || null, Date.now(), id);
  return st.userById.get(id);
}

function updateProfile(id, { name, phone, nik, birthDate }) {
  st.updateProfile.run(pii.encrypt(name), enc(phone), enc(nik), birthDate || null, Date.now(), id);
  return st.userById.get(id);
}

function updateByAdmin(id, u) {
  const email = String(u.email).trim().toLowerCase();
  st.updateAdmin.run(pii.encrypt(u.name), pii.blindIndex(email), pii.encrypt(email), enc(u.phone), enc(u.nik), u.birthDate || null, u.role, u.active ? 1 : 0, Date.now(), id);
  if (!u.active) st.revokeUser.run(Date.now(), id);
  return st.userById.get(id);
}

async function setPassword(id, password) {
  st.setPassword.run(await hashPassword(password), Date.now(), id);
  st.revokeUser.run(Date.now(), id); // semua sesi lama dicabut setelah kata sandi diganti
}

function deleteUser(id) {
  st.revokeUser.run(Date.now(), id);
  return st.deleteUser.run(id).changes > 0;
}

function issueRefresh({ userId, clientId, scope, family }) {
  const token = pii.randomToken(48);
  st.insertRt.run(crypto.randomUUID(), pii.sha256(token), family, userId, clientId, scope, Date.now() + config.refreshTtl * 1000, Date.now());
  return token;
}

/* ---- API key: hash saja, key penuh tampil sekali ---- */
function newKeyMaterial() {
  const key = `rk_live_${pii.randomToken(32)}`;
  return { key, prefix: key.slice(0, 14), hash: pii.sha256(key) };
}
function createApiKey({ name, owner, scopes, ratePerMin, expiresInDays }) {
  const id = `key_${crypto.randomBytes(6).toString('hex')}`;
  const m = newKeyMaterial();
  const expiresAt = Date.now() + expiresInDays * 86400000;
  st.insertKey.run(id, m.prefix, m.hash, name, owner, JSON.stringify(scopes), ratePerMin, expiresAt, Date.now());
  return { id, name, key: m.key, prefix: m.prefix, scopes, ratePerMin, expiresAt };
}
function rotateApiKey(id) {
  const row = st.keyById.get(id);
  if (!row || row.revoked_at) return null;
  const m = newKeyMaterial();
  st.updateKey.run(m.prefix, m.hash, id);
  return { id, name: row.name, key: m.key, prefix: m.prefix, scopes: JSON.parse(row.scopes), ratePerMin: row.rate_per_min, expiresAt: row.expires_at };
}
const revokeApiKey = (id) => st.revokeKey.run(Date.now(), id).changes > 0;
const publicKey = (k) => ({
  id: k.id, name: k.name, prefix: k.prefix, scopes: JSON.parse(k.scopes), ratePerMin: k.rate_per_min, expiresAt: k.expires_at,
  revokedAt: k.revoked_at, lastUsedAt: k.last_used_at, createdAt: k.created_at,
});
const listApiKeys = () => st.listKeys.all().map(publicKey);
function verifyApiKey(key) {
  if (typeof key !== 'string' || !key.startsWith('rk_')) return { valid: false, reason: 'format' };
  const row = st.keyByHash.get(pii.sha256(key));
  if (!row) return { valid: false, reason: 'unknown' };
  if (row.revoked_at) return { valid: false, reason: 'revoked' };
  if (row.expires_at < Date.now()) return { valid: false, reason: 'expired' };
  st.touchKey.run(Date.now(), row.id);
  return { valid: true, id: row.id, name: row.name, scopes: JSON.parse(row.scopes), ratePerMin: row.rate_per_min };
}

/* ---- Seed klien OAuth2 dan akun demo ---- */
function seedClients() {
  const web = [`${config.publicUrl}/auth/callback`, `http://localhost:${config.ports.gateway}/auth/callback`, `https://localhost:${config.ports.gatewayTls}/auth/callback`];
  const conf = (s) => pii.sha256(s || crypto.randomBytes(32).toString('hex'));
  st.upsertClient.run('rangkai-web', 'Rangkai Web', 'public', null, JSON.stringify(web), JSON.stringify([]));
  st.upsertClient.run('rangkai-postman', 'Postman', 'public', null, JSON.stringify(['https://oauth.pstmn.io/v1/callback', `${config.publicUrl}/auth/callback`, `http://localhost:${config.ports.gateway}/auth/callback`,
    `${config.publicUrl}/docs/swagger/oauth2-redirect.html`, `http://localhost:${config.ports.gateway}/docs/swagger/oauth2-redirect.html`]), JSON.stringify([]));
  st.upsertClient.run('svc-payment', 'Payment Service', 'confidential', conf(process.env.SVC_PAYMENT_CLIENT_SECRET), '[]', JSON.stringify(['internal:booking.read', 'internal:booking.write']));
  st.upsertClient.run('svc-booking', 'Booking Service', 'confidential', conf(process.env.SVC_BOOKING_CLIENT_SECRET), '[]', JSON.stringify(['internal:catalog.read']));
  st.upsertClient.run('partner-demo', 'Partner Demo', 'confidential', conf(process.env.PARTNER_DEMO_CLIENT_SECRET), '[]', JSON.stringify(['partner:read']));
}

async function seedUsers() {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) return;
  // Akun pelanggan demo hanya untuk stack pengujian (SEED_DEMO_CUSTOMERS=1). Di stack biasa pelanggan mendaftar sendiri,
  // sehingga data pelanggan tidak tercampur akun rekaan. Admin dan masinis selalu dibuat karena tidak bisa mendaftar sendiri.
  const customers = process.env.SEED_DEMO_CUSTOMERS === '1' ? [
    { name: 'Sinta Maharani', email: 'customer@rangkai.test', role: 'customer', phone: '081234567890', nik: '3578015203990001', birthDate: '1999-03-12' },
    { name: 'Bima Pelanggan', email: 'customer2@rangkai.test', role: 'customer' },
  ] : [];
  const demo = [
    ...customers,
    { name: 'Bagus Pratama', email: 'masinis@rangkai.test', role: 'masinis', phone: '081300001111', birthDate: '1985-07-21' },
    { name: 'Rina Kusuma', email: 'masinis2@rangkai.test', role: 'masinis', phone: '081300002222', birthDate: '1990-11-02' },
    { name: 'Arga Admin', email: 'admin@rangkai.test', role: 'admin' },
  ];
  for (const u of demo) if (!findUserByEmail(u.email)) await createUser({ ...u, password });
  for (let i = 0; i < config.loadUsers; i++) {
    const email = `load${i}@rangkai.test`;
    if (!findUserByEmail(email)) await createUser({ name: `Load ${i}`, email, password, role: 'customer' });
  }
}

function seed() { seedClients(); seedUsers(); }

module.exports = {
  seed, publicUser, findUserByEmail, findUserById, createUser, verifyPassword, dummyHash, issueRefresh,
  listUsers: () => st.listUsers.all(),
  usersByRole: (role) => st.usersByRole.all(role),
  updateProfile, updateByAdmin, setPassword, deleteUser,
  setFailed: (id, c, u) => st.setFailed.run(c, u, id),
  setRole: (id, r) => st.setRole.run(r, id),
  findClient: (id) => (id ? st.client.get(String(id)) : undefined),
  saveAuthRequest: (a) => st.saveReq.run(a.id, a.clientId, a.redirectUri, a.scope, a.state, a.challenge, a.expiresAt),
  findAuthRequest: (id) => (id ? st.getReq.get(String(id)) : undefined),
  deleteAuthRequest: (id) => st.delReq.run(id),
  saveCode: (c) => st.saveCode.run(c.hash, c.clientId, c.userId, c.redirectUri, c.challenge, c.scope, c.expiresAt),
  /** Kode hanya sekali pakai: dibaca lalu langsung dihapus. */
  consumeCode: (hash) => { const row = st.getCode.get(hash); if (row) st.delCode.run(hash); return row; },
  findRefresh: (hash) => st.getRt.get(hash),
  revokeRefresh: (id) => st.revokeRt.run(Date.now(), id),
  revokeFamily: (family) => st.revokeFam.run(Date.now(), family),
  createApiKey, rotateApiKey, revokeApiKey, listApiKeys, verifyApiKey,
};
