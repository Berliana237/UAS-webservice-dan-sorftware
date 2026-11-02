'use strict';
/** Demo Minggu 8: keamanan lanjutan. OAuth2 PKCE, Client Credentials, API key, RBAC, dan mTLS. */
const c = require('../lib/client');

async function run() {
  const r = c.reporter('Demo Minggu 8: Keamanan Lanjutan', 'week-08');

  r.section('OAuth2 Authorization Code + PKCE');
  const disc = await c.call('GET', '/.well-known/openid-configuration');
  r.check('W8-01', 'Metadata OAuth2 menyebut PKCE S256', disc.json?.code_challenge_methods_supported?.includes('S256'));
  const user = await c.login('customer@rangkai.test');
  const parts = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url'));
  r.check('W8-02', 'Login PKCE menghasilkan access token JWT', parts.iss === 'rangkai-auth' && parts.sub.startsWith('usr_'));
  r.check('W8-03', 'Token berumur pendek (15 menit)', parts.exp - parts.iat === 900, `${parts.exp - parts.iat} detik`);
  r.check('W8-04', 'Token membawa scope peran', parts.scope.includes('booking:write') && parts.role === 'customer', parts.scope);
  const rot = await c.call('POST', '/oauth/token', { form: { grant_type: 'refresh_token', client_id: 'rangkai-postman', refresh_token: user.refresh } });
  r.check('W8-05', 'Refresh token berotasi', rot.status === 200 && rot.json.refresh_token !== user.refresh);

  r.section('OAuth2 Client Credentials');
  const cc = await c.call('POST', '/oauth/token', { form: { grant_type: 'client_credentials', client_id: 'partner-demo', client_secret: process.env.PARTNER_DEMO_CLIENT_SECRET } });
  r.check('W8-06', 'Partner mendapat token tanpa pengguna', cc.status === 200 && cc.json.scope === 'partner:read', cc.json?.scope);
  const ccUse = await c.call('GET', '/api/partner/v1/stations', { token: cc.json.access_token });
  r.check('W8-07', 'Token partner bisa membaca rute partner', ccUse.status === 200);
  const ccDeny = await c.call('GET', '/api/admin/users', { token: cc.json.access_token });
  r.check('W8-08', 'Token partner ditolak di rute admin (least privilege)', ccDeny.status === 403);

  r.section('Manajemen API key');
  const admin = await c.login('admin@rangkai.test');
  const created = await c.call('POST', '/api/admin/api-keys', { token: admin.token, body: { name: `Demo Minggu 8 ${Date.now()}`, ratePerMin: 3, expiresInDays: 7, scopes: ['partner:read'] } });
  r.check('W8-09', 'API key dibuat dan ditampilkan sekali', created.status === 201 && created.json.key.startsWith('rk_live_'));
  const list = await c.call('GET', '/api/admin/api-keys', { token: admin.token });
  r.check('W8-10', 'Daftar key hanya menampilkan awalan, hash tidak bocor', !list.text.includes(created.json.key) && !list.text.includes('key_hash'));
  const use = await c.call('GET', '/api/partner/v1/stations', { headers: { 'x-api-key': created.json.key } });
  r.check('W8-11', 'Key dikirim lewat header X-API-Key', use.status === 200);
  const hits = [];
  for (let i = 0; i < 4; i++) hits.push((await c.call('GET', '/api/partner/v1/stations', { headers: { 'x-api-key': created.json.key } })).status);
  r.check('W8-12', 'Kuota per key berlaku (429)', hits.includes(429), hits.join(','));
  const rotated = await c.call('POST', `/api/admin/api-keys/${created.json.id}/rotate`, { token: admin.token, body: {} });
  await new Promise((res) => setTimeout(res, 3200));
  const oldKey = await c.call('GET', '/api/partner/v1/stations', { headers: { 'x-api-key': created.json.key } });
  r.check('W8-13', 'Rotasi: key lama mati', oldKey.status === 401, `status ${oldKey.status}`);
  await c.call('DELETE', `/api/admin/api-keys/${created.json.id}`, { token: admin.token });
  await new Promise((res) => setTimeout(res, 3200));
  const revoked = await c.call('GET', '/api/partner/v1/stations', { headers: { 'x-api-key': rotated.json.key } });
  r.check('W8-14', 'Pencabutan: key baru pun mati', revoked.status === 401, `status ${revoked.status}`);

  r.section('RBAC dan kepemilikan');
  r.check('W8-15', 'Pelanggan ditolak di rute admin', (await c.call('GET', '/api/admin/users', { token: user.token })).status === 403);
  r.check('W8-16', 'Admin diterima di rute admin', (await c.call('GET', '/api/admin/users', { token: admin.token })).status === 200);
  r.info('mTLS antar service diuji lengkap di bat\\test-security.bat (S-43 sampai S-49).');
  r.finish();
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
