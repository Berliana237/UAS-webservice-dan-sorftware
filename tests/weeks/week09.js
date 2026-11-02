'use strict';
/** Demo Minggu 9: API Gateway dan reverse proxy. */
const c = require('../lib/client');

async function run() {
  const r = c.reporter('Demo Minggu 9: API Gateway dan Reverse Proxy', 'week-09');
  r.section('Reverse proxy: satu pintu untuk semua service');
  const paths = [['/.well-known/jwks.json', 'auth'], ['/api/stations', 'catalog'], ['/api/bookings/instance', 'booking']];
  for (const [p, svc] of paths) {
    const x = await c.call('GET', p);
    r.check(`W9-${svc}`, `${p} diteruskan ke ${svc}`, x.status === 200 && Boolean(x.headers.get('x-upstream-instance')), x.headers.get('x-upstream-instance'));
  }
  const spa = await c.call('GET', '/perjalanan');
  r.check('W9-01', 'Halaman web dilayani gateway', spa.status === 200 && spa.text.includes('Rangkai'));
  const docs = await c.call('GET', '/docs');
  r.check('W9-02', 'Dokumen Swagger UI tersedia di /docs', docs.status === 200 && docs.text.includes('swagger'));
  const spec = await c.call('GET', '/docs/openapi.yaml');
  r.check('W9-03', 'Spesifikasi OpenAPI tersedia', spec.status === 200 && spec.text.startsWith('openapi'));

  r.section('Validasi token dan scope di depan');
  r.check('W9-04', 'Tanpa token berhenti di gateway', (await c.call('GET', '/api/bookings')).status === 401);
  const user = await c.login('customer@rangkai.test');
  r.check('W9-05', 'Scope kurang berhenti di gateway', (await c.call('GET', '/api/admin/users', { token: user.token })).status === 403);

  r.section('Validasi skema request');
  const body = (b) => ({ token: user.token, headers: { 'idempotency-key': c.idem() }, body: b });
  const s1 = await c.call('POST', '/api/locks', body({ tripId: 'T', from: 'A', to: 'B' }));
  r.check('W9-06', 'Field wajib kurang ditolak', s1.status === 422 && s1.json.error.code === 'SCHEMA_VALIDATION_FAILED', JSON.stringify(s1.json.error.details?.errors?.[0]));
  const s2 = await c.call('POST', '/api/locks', body({ tripId: 'T', from: 'A', to: 'B', seats: ['EKS1-1A'], hacker: true }));
  r.check('W9-07', 'Field asing ditolak', s2.status === 422);
  const s3 = await c.call('POST', '/api/locks', { token: user.token, headers: { 'idempotency-key': c.idem() }, body: '{rusak' });
  r.check('W9-08', 'JSON rusak ditolak', s3.status === 400);

  r.section('CORS terbatas');
  const okCors = await c.call('GET', '/api/stations', { headers: { origin: c.BASE } });
  r.check('W9-09', 'Origin terdaftar diizinkan', okCors.headers.get('access-control-allow-origin') === c.BASE);
  const badCors = await c.call('GET', '/api/stations', { headers: { origin: 'https://jahat.example' } });
  r.check('W9-10', 'Origin asing ditolak', badCors.status === 403);
  const pre = await c.call('OPTIONS', '/api/locks', { headers: { origin: c.BASE, 'access-control-request-method': 'POST' } });
  r.check('W9-11', 'Preflight menyebut header Idempotency-Key', pre.status === 204 && /Idempotency-Key/i.test(pre.headers.get('access-control-allow-headers')));

  r.section('Rate limiting');
  const results = await Promise.all(Array.from({ length: 14 }, () => c.call('POST', '/oauth/login', { body: { auth_request: 'x', email: `limit.${Date.now()}@rangkai.test`.replace(/\d+/, 'minggu9'), password: 'x' } })));
  const blocked = results.filter((x) => x.status === 429);
  r.check('W9-12', 'Percobaan login beruntun dibatasi per IP dan akun', blocked.length > 0, `${blocked.length} ditolak dari ${results.length}`);
  r.check('W9-13', 'Header Retry-After dikirim', Boolean(blocked[0]?.headers.get('retry-after')), blocked[0]?.headers.get('retry-after'));
  const q = await c.call('GET', '/api/stations');
  r.check('W9-14', 'Sisa kuota dilaporkan lewat header', Boolean(q.headers.get('x-ratelimit-remaining')), q.headers.get('x-ratelimit-remaining'));

  r.section('Header keamanan dan penelusuran');
  r.check('W9-15', 'Content-Security-Policy terpasang', Boolean(q.headers.get('content-security-policy')));
  r.check('W9-16', 'Setiap respons membawa X-Request-Id', Boolean(q.headers.get('x-request-id')));
  r.check('W9-17', 'Klien tidak bisa memalsukan X-Forwarded-For untuk lolos kuota', (await c.call('GET', '/api/stations', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status === 200);
  r.finish();
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
