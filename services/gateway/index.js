'use strict';
/**
 * API Gateway dan reverse proxy: satu pintu masuk untuk klien.
 *  - validasi token dan scope, API key partner, rate limit per user/IP/key, validasi skema, CORS terbatas, header keamanan
 *  - routing berbasis service discovery dengan load balancing round robin dan failover
 *  - melayani SPA, dokumentasi Swagger UI, dan ringkasan kesehatan sistem
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const config = require('../shared/config');
const { logger, maskString } = require('../shared/log');
const mtls = require('../shared/mtls');
const { createRegistryClient } = require('../shared/registry-client');
const { createBus } = require('../shared/bus');
const { createVerifier } = require('../shared/jwt');
const { TokenBucketLimiter } = require('./rate-limit');
const { match, isSpecific } = require('./routes');
const schemas = require('./schemas');
const { serveStatic } = require('./static');

const log = logger('gateway');
const internal = mtls.client('gateway');
const registry = createRegistryClient(internal, log);
const bus = createBus(internal, log, 'gateway');
const verifier = createVerifier(internal);
const limiter = new TokenBucketLimiter();
setInterval(() => limiter.sweep(), 60000).unref();
process.on('uncaughtException', (e) => log.error('uncaught', { err: e.message, stack: e.stack }));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', { err: e?.message }));

const MAX_BODY = 64 * 1024;
/** Origin diizinkan bila ada di daftar CORS, atau sama persis dengan host yang sedang dibuka (halaman QRIS di ponsel lewat IP LAN). */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const LIMITS = {
  global: config.rate.global, public: config.rate.publicRead, login: config.rate.login, register: config.rate.register,
  token: config.rate.token, lock: config.rate.lock, payment: config.rate.payment, graphql: config.rate.graphql,
  support: config.rate.support,
};

/* ---------- Pemantau pola mencurigakan ---------- */
const suspicious = new Map();
function noteSuspicious(ip, kind) {
  const now = Date.now();
  const s = suspicious.get(ip) || { count: 0, since: now, alerted: 0 };
  if (now - s.since > 60000) { s.count = 0; s.since = now; }
  s.count += 1;
  suspicious.set(ip, s);
  if (s.count >= 20 && now - s.alerted > 60000) {
    s.alerted = now;
    bus.publishSafe('security.suspicious_traffic', { service: 'gateway', severity: 'medium', ip, kind, count: s.count, at: now });
  }
}

/* ---------- Utilitas respons ---------- */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const SWAGGER_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'";

function applyHeaders(req, res, secure, csp) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (csp) res.setHeader('Content-Security-Policy', csp);
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Vary', 'Origin');
    if (originAllowed(req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, X-Upstream-Instance, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After, Idempotent-Replay');
    }
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) return res.end();
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
const sendError = (req, res, status, code, message, details) => sendJson(res, status, { error: { code, message, details }, requestId: req.id });

/* ---------- Identitas pemanggil ---------- */
function clientIp(req) {
  if (config.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * API key selalu diverifikasi ke auth-service pada setiap request (tanpa cache), sehingga key yang dirotasi
 * atau dicabut langsung ditolak. Biaya: satu panggilan mTLS internal yang ringan per request partner.
 */
async function verifyApiKey(key) {
  const r = await internal.request(`${config.urls.auth}/internal/api-keys/verify`, { method: 'POST', body: { key } });
  return r.json || { valid: false };
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Sisa body dibuang tanpa memutus koneksi, supaya klien tetap menerima respons 413.
      if (size > max) { chunks.length = 0; reject(Object.assign(new Error('terlalu besar'), { tooLarge: true })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- Proxy dengan load balancing ---------- */
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host']);
const CLIENT_SPOOFABLE = new Set(['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'x-partner-id', 'x-partner-name']);
const SAFE = new Set(['GET', 'HEAD']);

function forwardHeaders(req, extra, secure, body) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !CLIENT_SPOOFABLE.has(k)) h[k] = v;
  h['x-request-id'] = req.id;
  h['x-forwarded-for'] = clientIp(req);
  h['x-forwarded-proto'] = secure ? 'https' : (config.trustProxy && req.headers['x-forwarded-proto']) || 'http';
  if (body) h['content-length'] = body.length;
  return { ...h, ...extra };
}

/** Meneruskan request ke satu instance. Resolve setelah respons mulai dialirkan ke klien. */
function proxyOnce(inst, req, res, target, headers, body, route) {
  return new Promise((resolve, reject) => {
    const upstream = https.request(inst.url + target, {
      method: req.method, headers, agent: internal.agent, timeout: route.stream ? 0 : (route.timeoutMs || 15000),
    }, (up) => {
      res.statusCode = up.statusCode;
      for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k)) res.setHeader(k, v);
      res.setHeader('X-Upstream-Instance', inst.instanceId);
      if (route.stream) { res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders(); }
      up.pipe(res);
      up.on('end', resolve);
      up.on('error', () => { res.destroy(); resolve(); });
      res.on('close', () => { up.destroy(); resolve(); });
    });
    upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    upstream.on('error', reject);
    if (body && body.length) upstream.write(body);
    if (body) upstream.end();
    else req.pipe(upstream);
  });
}

async function proxy(req, res, route, target, extraHeaders, secure, body) {
  // GET dicoba ulang ke instance lain bila koneksi gagal; POST juga aman karena koneksi belum tersambung (ECONNREFUSED).
  const attempts = 3;
  const headers = forwardHeaders(req, extraHeaders, secure, body);
  for (let i = 0; i < attempts; i++) {
    let inst;
    try { inst = await registry.pick(route.svc); } catch { inst = null; }
    if (!inst) return sendError(req, res, 503, 'SERVICE_UNAVAILABLE', `Layanan ${route.svc} sedang tidak tersedia.`);
    try {
      await proxyOnce(inst, req, res, target, headers, body, route);
      return undefined;
    } catch (e) {
      registry.markDown(inst);
      log.warn('instance gagal, failover', { svc: route.svc, inst: inst.instanceId, err: e.code || e.message });
      const retryable = SAFE.has(req.method) || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET';
      if (!retryable || res.headersSent) break;
    }
  }
  return sendError(req, res, 502, 'BAD_GATEWAY', `Layanan ${route.svc} tidak merespons.`);
}

/* ---------- Rute milik gateway sendiri ---------- */
const SYSTEM_SERVICES = ['registry', 'broker', 'auth', 'catalog', 'booking', 'payment', 'notification', 'support'];

async function systemStatus() {
  const r = await internal.request(`${config.urls.registry}/services`);
  const services = r.json?.services || {};
  return SYSTEM_SERVICES.map((name) => ({
    name,
    instances: name === 'registry' ? [{ instanceId: 'registry', url: config.urls.registry, status: 'UP' }]
      : (services[name] || []).map((i) => ({ instanceId: i.instanceId, url: i.url, lastBeat: i.lastBeat, meta: i.meta, status: 'UP' })),
  }));
}

/** Memeriksa langsung setiap instance (bukan hanya data registry) dan merangkum jumlah proses yang berbeda. */
async function servicesHealth() {
  const list = await systemStatus();
  const checks = list.flatMap((s) => s.instances.map(async (i) => {
    const t0 = Date.now();
    const port = Number(new URL(i.url).port) || null;
    try {
      const r = await internal.request(`${i.url}/health`, { timeout: 4000 });
      const h = r.json || {};
      return { service: s.name, instanceId: i.instanceId, port, protocol: 'HTTPS + mTLS', status: r.status === 200 ? 'UP' : 'DOWN',
        pid: h.pid ?? null, runtime: h.runtime ?? null, uptimeSec: h.uptime ?? null, memoryMB: h.memoryMB ?? null, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { service: s.name, instanceId: i.instanceId, port, protocol: 'HTTPS + mTLS', status: 'DOWN', error: e.code || e.message, latencyMs: Date.now() - t0 };
    }
  }));
  const own = { service: 'gateway', instanceId: 'gateway', port: config.ports.gateway, protocol: 'pintu masuk publik (HTTPS)', status: 'UP',
    pid: process.pid, runtime: `Node.js ${process.version}`, uptimeSec: Math.round(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576), latencyMs: 0 };
  const processes = [own, ...(await Promise.all(checks))];
  const up = processes.filter((p) => p.status === 'UP');
  const pids = new Set(up.map((p) => p.pid).filter((p) => p != null));
  return {
    summary: {
      services: new Set(processes.map((p) => p.service)).size,
      processes: processes.length,
      up: up.length,
      distinctPids: pids.size,
      distinctPorts: new Set(processes.map((p) => p.port).filter(Boolean)).size,
      runtimes: [...new Set(up.map((p) => p.runtime).filter(Boolean))],
      monolith: pids.size <= 1,
      note: 'Setiap baris dicek langsung saat ini lewat mTLS. PID dan port berbeda berarti proses terpisah; booking berjalan dua instance (booking-a, booking-b) dengan Java, service lain Node.js.',
    },
    processes,
  };
}

async function gatewayRoutes(req, res, pathname, user) {
  if (req.method === 'GET' && pathname === '/healthz') { sendJson(res, 200, { status: 'UP', service: 'gateway', uptime: Math.round(process.uptime()) }); return true; }
  if (pathname === '/api/admin/registry' && req.method === 'GET') {
    if (!user) { sendError(req, res, 401, 'UNAUTHENTICATED', 'Token akses diperlukan.'); return true; }
    if (!hasScopes(user, ['system:read'])) { sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: ['system:read'] }); return true; }
    sendJson(res, 200, { gateway: { instanceId: 'gateway', status: 'UP' }, services: await systemStatus() });
    return true;
  }
  // Bukti microservices: gateway memanggil /health setiap instance lewat mTLS dan menampilkan PID, port, runtime.
  if (pathname === '/api/admin/services/health' && req.method === 'GET') {
    if (!user) { sendError(req, res, 401, 'UNAUTHENTICATED', 'Token akses diperlukan.'); return true; }
    if (!hasScopes(user, ['system:read'])) { sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: ['system:read'] }); return true; }
    sendJson(res, 200, await servicesHealth());
    return true;
  }
  // Reset data uji kelompok penguji (lihat scripts/reset-test-data.js). Hanya aktif di lingkungan uji (TEST_RESET_ENABLED=1)
  // dan hanya untuk admin. Dijalankan di container yang sama dengan semua database (deployment satu container).
  if (pathname === '/api/admin/test-data/reset' && req.method === 'POST') {
    if (!user) { sendError(req, res, 401, 'UNAUTHENTICATED', 'Token akses diperlukan.'); return true; }
    if (!hasScopes(user, ['user:manage'])) { sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: ['user:manage'] }); return true; }
    if (process.env.TEST_RESET_ENABLED !== '1') { sendError(req, res, 404, 'FEATURE_DISABLED', 'Reset data uji tidak aktif di lingkungan ini.'); return true; }
    const dry = new URL(req.url, 'http://x').searchParams.get('dryRun') === 'true';
    const args = [path.join(config.ROOT, 'scripts', 'reset-test-data.js'), '--live', '--json', ...(dry ? ['--dry-run'] : [])];
    execFile(process.execPath, args, { timeout: 60000, env: process.env }, (err, stdout, stderr) => {
      if (err) { log.error('reset data uji gagal', { err: String(stderr || err.message).slice(0, 300) }); return sendError(req, res, 500, 'RESET_FAILED', 'Reset data uji gagal. Hubungi penanggung jawab teknis.'); }
      let out = {};
      try { out = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { /* keluaran tidak terbaca */ }
      log.info('reset data uji', { by: user.sub, dry, ...out });
      sendJson(res, 200, { reset: !dry, ...out });
    });
    return true;
  }
  return false;
}

const hasScopes = (user, scopes) => { const have = String(user?.scope || '').split(' '); return scopes.every((s) => have.includes(s)); };

/* ---------- Penanganan satu request ---------- */
async function handle(req, res, secure) {
  req.id = crypto.randomUUID();
  const t0 = Date.now();
  res.setHeader('X-Request-Id', req.id);
  const url = new URL(req.url, 'http://gateway.local');
  const pathname = url.pathname;
  const ip = clientIp(req);
  const docsPage = pathname.startsWith('/docs');
  applyHeaders(req, res, secure, docsPage ? SWAGGER_CSP : null);
  res.on('finish', () => {
    if (pathname !== '/healthz' && !pathname.startsWith('/assets/')) log.info('req', { id: req.id, m: req.method, p: pathname, s: res.statusCode, ms: Date.now() - t0, ip: maskString(ip) });
  });

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    if (!originAllowed(req)) return sendError(req, res, 403, 'CORS_REJECTED', 'Origin ini tidak diizinkan.');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-API-Key');
    res.setHeader('Access-Control-Max-Age', '600');
    res.statusCode = 204;
    return res.end();
  }
  // Permintaan lintas origin yang tidak diizinkan ditolak sebelum menyentuh service.
  if (!originAllowed(req) && isSpecific(pathname)) {
    return sendError(req, res, 403, 'CORS_REJECTED', 'Origin ini tidak diizinkan.');
  }

  if (!isSpecific(pathname) && pathname !== '/healthz') return serveStatic(req, res, pathname);

  // Token diperiksa di depan agar kuota bisa dihitung per pengguna.
  let user = null; let tokenInvalid = false;
  const authz = req.headers.authorization || '';
  if (authz.startsWith('Bearer ')) {
    try { user = await verifier.verify(authz.slice(7)); } catch { tokenInvalid = true; }
  }

  // Lapisan rate limit global per IP
  const g = limiter.take(`g:${ip}`, LIMITS.global);
  if (!g.allowed) return tooMany(req, res, g, ip);

  if (await gatewayRoutes(req, res, pathname, user)) return undefined;

  const { route, methodNotAllowed } = match(req.method, pathname);
  if (!route) {
    if (methodNotAllowed) return sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Metode HTTP tidak didukung untuk rute ini.');
    return sendError(req, res, 404, 'NOT_FOUND', `Rute ${req.method} ${pathname} tidak ditemukan.`);
  }

  const extra = {};
  // Autentikasi partner
  let quotaKey = user ? `u:${user.sub}` : `ip:${ip}`;
  let quotaLimit = LIMITS[route.rl] ?? LIMITS.global;
  if (route.partner) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      let info;
      try { info = await verifyApiKey(String(apiKey)); } catch { return sendError(req, res, 503, 'SERVICE_UNAVAILABLE', 'Layanan autentikasi tidak tersedia.'); }
      if (!info.valid) { noteSuspicious(ip, 'api_key'); return sendError(req, res, 401, 'INVALID_API_KEY', 'API key tidak valid, kedaluwarsa, atau sudah dicabut.', { reason: info.reason }); }
      if (!info.scopes.includes('partner:read')) return sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'API key tidak memiliki scope partner:read.');
      quotaKey = `k:${info.id}`; quotaLimit = info.ratePerMin;
      extra['x-partner-id'] = info.id; extra['x-partner-name'] = info.name;
    } else if (user) {
      if (!hasScopes(user, ['partner:read'])) return sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: ['partner:read'] });
      extra['x-partner-id'] = user.sub;
    } else {
      return sendError(req, res, 401, 'API_KEY_REQUIRED', 'Kirim header X-API-Key, atau token Client Credentials dengan scope partner:read.');
    }
  } else if (route.scopes) {
    if (!authz.startsWith('Bearer ') || tokenInvalid || !user) {
      noteSuspicious(ip, 'auth');
      return sendError(req, res, 401, tokenInvalid ? 'INVALID_TOKEN' : 'UNAUTHENTICATED', tokenInvalid ? 'Token tidak valid atau sudah kedaluwarsa.' : 'Token akses diperlukan.');
    }
    if (!hasScopes(user, route.scopes)) {
      noteSuspicious(ip, 'scope');
      return sendError(req, res, 403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: route.scopes });
    }
  }

  // Baca dan validasi body untuk rute yang punya skema.
  let body = null;
  if (route.schema || route.rawBody || route.rlKey || !['GET', 'HEAD', 'DELETE'].includes(req.method)) {
    try { body = await readBody(req, route.maxBody || MAX_BODY); } catch (e) {
      if (e.tooLarge) {
        res.setHeader('Connection', 'close');
        return sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', `Body terlalu besar (batas ${Math.round((route.maxBody || MAX_BODY) / 1024)} KB).`);
      }
      return undefined;
    }
  }
  let parsed = null;
  if (route.schema) {
    try { parsed = JSON.parse(body.toString('utf8') || 'null'); } catch { return sendError(req, res, 400, 'INVALID_JSON', 'Body bukan JSON yang valid.'); }
    const errors = schemas.check(route.schema, parsed);
    if (errors) return sendError(req, res, 422, 'SCHEMA_VALIDATION_FAILED', 'Bentuk permintaan tidak sesuai skema.', { errors });
  }

  // Kuota kelas rute. Login dihitung per IP + akun agar satu akun tidak bisa ditebak terus-menerus.
  if (route.rlKey === 'login') quotaKey = `login:${ip}:${String(parsed?.email || '').toLowerCase()}`;
  const q = limiter.take(`${route.rl}:${quotaKey}`, quotaLimit);
  res.setHeader('X-RateLimit-Limit', q.limit);
  res.setHeader('X-RateLimit-Remaining', q.remaining);
  if (!q.allowed) return tooMany(req, res, q, ip);

  const target = (route.rewrite ? route.rewrite(pathname) : pathname) + url.search;
  return proxy(req, res, route, target, extra, secure, body);
}

function tooMany(req, res, q, ip) {
  noteSuspicious(ip, 'rate_limit');
  res.setHeader('Retry-After', q.retryAfterSeconds);
  res.setHeader('X-RateLimit-Limit', q.limit);
  res.setHeader('X-RateLimit-Remaining', 0);
  return sendError(req, res, 429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar.', { retryAfterSeconds: q.retryAfterSeconds });
}

const wrap = (secure) => (req, res) => handle(req, res, secure).catch((e) => {
  log.error('gateway error', { err: e.message, stack: e.stack });
  if (!res.headersSent) sendError(req, res, 500, 'INTERNAL_ERROR', 'Terjadi kesalahan pada gateway.');
  else res.destroy();
});

const httpServer = http.createServer(wrap(false));
const LISTEN_HOST = process.env.GATEWAY_HOST || '127.0.0.1';
httpServer.listen(config.ports.gateway, LISTEN_HOST, () => log.info(`gateway HTTP di ${config.ports.gateway}`));
const tlsDir = config.certDir;
const tlsOptions = {
  key: fs.readFileSync(path.join(tlsDir, 'gateway.key')),
  cert: fs.readFileSync(path.join(tlsDir, 'gateway.crt')),
  minVersion: 'TLSv1.2',
};
const httpsServer = https.createServer(tlsOptions, wrap(true));
httpsServer.listen(config.ports.gatewayTls, LISTEN_HOST, () => log.info(`gateway HTTPS (TLS 1.2+) di ${config.ports.gatewayTls}`));

// Browser, Postman, dan Newman membuka http://localhost:8080. Di Windows "localhost" dicoba lewat ::1 dulu,
// jadi gateway ikut mendengar di loopback IPv6 agar koneksi itu langsung diterima, bukan ditolak lalu diulang lewat IPv4.
if (LISTEN_HOST === '127.0.0.1' || LISTEN_HOST === '0.0.0.0') {
  for (const [server, port] of [[http.createServer(wrap(false)), config.ports.gateway], [https.createServer(tlsOptions, wrap(true)), config.ports.gatewayTls]]) {
    server.on('error', (e) => log.warn('loopback IPv6 tidak tersedia', { port, err: e.code }));
    server.listen(port, '::1');
  }
}
