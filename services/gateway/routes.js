'use strict';
/**
 * Tabel rute gateway: satu titik kontrol. Tiap rute menentukan service tujuan, scope minimum,
 * kelas rate limit, skema body, dan penulisan ulang path bila perlu.
 *
 * rl: global | login | register | token | lock | payment | graphql | public | support
 * scopes: null = publik, [] = cukup token sah, ['x'] = wajib scope x
 */
const R = (method, pattern, svc, opts = {}) => ({ method, pattern, svc, rl: 'global', scopes: null, ...opts });

const ROUTES = [
  // OAuth2 dan identitas
  R('GET', /^\/\.well-known\/(jwks\.json|openid-configuration)$/, 'auth', { rl: 'public' }),
  R('GET', /^\/oauth\/authorize$/, 'auth', { rl: 'token' }),
  R('POST', /^\/oauth\/login$/, 'auth', { rl: 'login', schema: 'login', rlKey: 'login' }),
  R('POST', /^\/oauth\/token$/, 'auth', { rl: 'token' }),
  R('POST', /^\/oauth\/revoke$/, 'auth', { rl: 'token' }),
  R('GET', /^\/oauth\/userinfo$/, 'auth', { scopes: [] }),
  R('POST', /^\/api\/auth\/register$/, 'auth', { rl: 'register', schema: 'register' }),
  R('GET', /^\/api\/auth\/me$/, 'auth', { scopes: [] }),
  R('PATCH', /^\/api\/auth\/me$/, 'auth', { scopes: [], schema: 'profile' }),
  R('POST', /^\/api\/auth\/me\/password$/, 'auth', { scopes: [], rl: 'login', schema: 'changePassword' }),

  // Admin: pengguna dan API key
  R('GET', /^\/api\/admin\/users$/, 'auth', { scopes: ['user:manage'] }),
  R('POST', /^\/api\/admin\/users$/, 'auth', { scopes: ['user:manage'], schema: 'adminUserCreate' }),
  R('GET', /^\/api\/admin\/users\/[^/]+$/, 'auth', { scopes: ['user:manage'] }),
  R('PATCH', /^\/api\/admin\/users\/[^/]+$/, 'auth', { scopes: ['user:manage'], schema: 'adminUserUpdate' }),
  R('DELETE', /^\/api\/admin\/users\/[^/]+$/, 'auth', { scopes: ['user:manage'] }),
  R('PATCH', /^\/api\/admin\/users\/[^/]+\/role$/, 'auth', { scopes: ['user:manage'], schema: 'role' }),
  R('POST', /^\/api\/admin\/users\/[^/]+\/password$/, 'auth', { scopes: ['user:manage'], schema: 'adminPassword' }),
  R('GET', /^\/api\/admin\/api-keys$/, 'auth', { scopes: ['apikey:manage'] }),
  R('POST', /^\/api\/admin\/api-keys$/, 'auth', { scopes: ['apikey:manage'], schema: 'apiKey' }),
  R('POST', /^\/api\/admin\/api-keys\/[^/]+\/rotate$/, 'auth', { scopes: ['apikey:manage'] }),
  R('DELETE', /^\/api\/admin\/api-keys\/[^/]+$/, 'auth', { scopes: ['apikey:manage'] }),

  // Admin: sistem, audit, antrian
  R('GET', /^\/api\/admin\/(audit|alerts|queue-consumed)$/, 'notification', { scopes: ['audit:read'] }),
  R('GET', /^\/api\/admin\/queues(\/[^/]+\/dlq)?$/, 'broker', { scopes: ['system:read'] }),
  R('POST', /^\/api\/admin\/queues\/([^/]+\/dlq\/replay|publish-test)$/, 'broker', { scopes: ['system:read'] }),
  R('GET', /^\/api\/admin\/booking-stats$/, 'booking', { scopes: ['system:read'] }),

  // Admin: data operasional (stasiun, kereta, rute, tarif, jam operasi, masinis, diskon lansia)
  R('GET', /^\/api\/admin\/stations$/, 'catalog', { scopes: ['schedule:write'] }),
  R('POST', /^\/api\/admin\/stations$/, 'catalog', { scopes: ['schedule:write'] }),
  R('PATCH', /^\/api\/admin\/stations\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('DELETE', /^\/api\/admin\/stations\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('GET', /^\/api\/admin\/trains$/, 'catalog', { scopes: ['schedule:write'] }),
  R('POST', /^\/api\/admin\/trains$/, 'catalog', { scopes: ['schedule:write'] }),
  R('GET', /^\/api\/admin\/trains\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('PATCH', /^\/api\/admin\/trains\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('DELETE', /^\/api\/admin\/trains\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('PUT', /^\/api\/admin\/trains\/[^/]+\/(route|fares|services)$/, 'catalog', { scopes: ['schedule:write'] }),
  R('POST', /^\/api\/admin\/trains\/[^/]+\/regenerate$/, 'catalog', { scopes: ['schedule:write'] }),
  R('GET', /^\/api\/admin\/trains\/[^/]+\/trips$/, 'catalog', { scopes: ['system:read'] }),
  R('GET', /^\/api\/admin\/catalog-stats$/, 'catalog', { scopes: ['system:read'] }),
  R('GET', /^\/api\/admin\/settings$/, 'catalog', { scopes: ['schedule:write'] }),
  R('PUT', /^\/api\/admin\/settings$/, 'catalog', { scopes: ['schedule:write'], schema: 'settings' }),
  // Admin: armada dan penumpang per perjalanan
  R('GET', /^\/api\/admin\/trips\/[^/]+\/passengers$/, 'booking', { scopes: ['system:read'] }),
  R('POST', /^\/api\/admin\/trip-stats$/, 'booking', { scopes: ['system:read'], schema: 'tripStats' }),
  // Admin: verifikasi transfer manual
  R('GET', /^\/api\/admin\/transfers$/, 'payment', { scopes: ['payment:review'] }),
  R('POST', /^\/api\/admin\/transfers\/[^/]+\/decision$/, 'payment', { scopes: ['payment:review'], schema: 'transferDecision' }),

  // Masinis
  R('GET', /^\/api\/masinis\/trips$/, 'catalog', { scopes: ['masinis'] }),
  R('PATCH', /^\/api\/masinis\/trips\/[^/]+\/delay$/, 'catalog', { scopes: ['masinis'] }),

  // Jadwal: REST
  R('GET', /^\/api\/stations$/, 'catalog', { rl: 'public' }),
  R('GET', /^\/api\/trains$/, 'catalog', { rl: 'public' }),
  R('GET', /^\/api\/pricing$/, 'catalog', { rl: 'public' }),
  R('GET', /^\/api\/schedules$/, 'catalog', { rl: 'public' }),
  R('POST', /^\/api\/trips$/, 'catalog', { scopes: ['schedule:write'] }),
  R('PATCH', /^\/api\/trips\/[^/]+$/, 'catalog', { scopes: ['schedule:write'] }),
  R('GET', /^\/api\/trips\/[^/]+$/, 'catalog', { rl: 'public' }),
  R('GET', /^\/api\/trips\/[^/]+\/seats$/, 'catalog', { rl: 'public' }),
  // Jadwal: GraphQL
  R('POST', /^\/graphql$/, 'catalog', { rl: 'graphql', schema: 'graphql' }),
  R('GET', /^\/graphql\/schema$/, 'catalog', { rl: 'public' }),

  // Kursi dan pemesanan
  R('GET', /^\/api\/trips\/[^/]+\/availability$/, 'booking', { rl: 'public' }),
  R('GET', /^\/api\/trips\/[^/]+\/seats\/stream$/, 'booking', { rl: 'public', stream: true }),
  R('GET', /^\/api\/trips\/[^/]+\/manifest$/, 'booking', { scopes: ['manifest:read'] }),
  R('POST', /^\/api\/locks$/, 'booking', { scopes: ['booking:write'], rl: 'lock', schema: 'lock', maxBody: 256 * 1024 }),
  R('GET', /^\/api\/locks\/[^/]+$/, 'booking', { scopes: ['booking:read'] }),
  R('DELETE', /^\/api\/locks\/[^/]+$/, 'booking', { scopes: ['booking:write'] }),
  R('POST', /^\/api\/bookings$/, 'booking', { scopes: ['booking:write'], rl: 'lock', schema: 'booking', maxBody: 256 * 1024 }),
  R('GET', /^\/api\/bookings$/, 'booking', { scopes: ['booking:read'] }),
  R('GET', /^\/api\/bookings\/instance$/, 'booking', { rl: 'public' }),
  R('GET', /^\/api\/bookings\/[^/]+$/, 'booking', { scopes: ['booking:read'] }),
  R('GET', /^\/api\/bookings\/[^/]+\/refund-preview$/, 'booking', { scopes: ['booking:read'] }),
  R('POST', /^\/api\/bookings\/[^/]+\/cancel$/, 'booking', { scopes: ['booking:write'] }),
  R('POST', /^\/api\/tickets\/checkin$/, 'booking', { scopes: ['checkin:write'], schema: 'checkin' }),

  // Pembayaran. Webhook publik tetapi wajib bertanda tangan, body diteruskan apa adanya.
  R('POST', /^\/api\/payments$/, 'payment', { scopes: ['payment:write'], rl: 'payment', schema: 'payment' }),
  R('GET', /^\/api\/payments$/, 'payment', { scopes: [] }),
  R('POST', /^\/api\/payments\/webhook$/, 'payment', { rl: 'payment', rawBody: true }),
  R('GET', /^\/api\/payments\/proofs\/[^/]+\/file$/, 'payment', { scopes: [] }),
  R('GET', /^\/api\/payments\/[^/]+$/, 'payment', { scopes: [] }),
  R('POST', /^\/api\/payments\/[^/]+\/proof$/, 'payment', { scopes: ['payment:write'], rl: 'payment', schema: 'proof', maxBody: 5 * 1024 * 1024 }),
  R('POST', /^\/api\/mock-gateway\/checkout\/[^/]+\/pay$/, 'payment', { rl: 'payment', scopes: ['payment:write'] }),
  // Halaman QRIS di ponsel: token checkout acak sekali pakai menjadi bukti, tanpa login.
  R('GET', /^\/api\/qris\/[A-Za-z0-9_-]+$/, 'payment', { rl: 'payment' }),
  R('POST', /^\/api\/qris\/[A-Za-z0-9_-]+\/pay$/, 'payment', { rl: 'payment' }),

  // Notifikasi
  R('GET', /^\/api\/notifications$/, 'notification', { scopes: [] }),
  R('GET', /^\/api\/notifications\/unread-count$/, 'notification', { scopes: [] }),
  R('POST', /^\/api\/notifications\/read-all$/, 'notification', { scopes: [] }),
  R('POST', /^\/api\/notifications\/[^/]+\/read$/, 'notification', { scopes: [] }),

  // Pusat Bantuan: FAQ publik, asisten AI dibatasi ketat karena memanggil penyedia AI berbayar.
  R('GET', /^\/api\/support\/faq$/, 'support', { rl: 'public' }),
  R('POST', /^\/api\/support\/chat$/, 'support', { rl: 'support', schema: 'supportChat', timeoutMs: 20000 }),

  // Partner: API key atau token Client Credentials dengan scope partner:read
  R('GET', /^\/api\/partner\/v1\/stations$/, 'catalog', { partner: true, rewrite: () => '/api/stations' }),
  R('GET', /^\/api\/partner\/v1\/schedules$/, 'catalog', { partner: true, rewrite: () => '/api/schedules' }),
  R('GET', /^\/api\/partner\/v1\/trips\/[^/]+\/availability$/, 'booking', { partner: true, rewrite: (p) => p.replace('/api/partner/v1', '/api') }),
];

function match(method, path) {
  let pathMatched = false;
  for (const r of ROUTES) {
    if (!r.pattern.test(path)) continue;
    pathMatched = true;
    if (r.method === method) return { route: r };
  }
  return { route: null, methodNotAllowed: pathMatched };
}

const isSpecific = (path) => path.startsWith('/api/') || path.startsWith('/oauth/') || path.startsWith('/.well-known/') || path === '/graphql' || path.startsWith('/graphql/');

module.exports = { ROUTES, match, isSpecific };
