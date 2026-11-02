'use strict';
/**
 * Tabel rute gateway: satu titik kontrol. Tiap rute menentukan service tujuan, scope minimum,
 * kelas rate limit, skema body, dan penulisan ulang path bila perlu.
 *
 * rl: global | login | register | token | lock | payment | graphql | public
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

  // Admin
  R('GET', /^\/api\/admin\/users$/, 'auth', { scopes: ['admin'] }),
  R('PATCH', /^\/api\/admin\/users\/[^/]+\/role$/, 'auth', { scopes: ['admin'] }),
  R('GET', /^\/api\/admin\/api-keys$/, 'auth', { scopes: ['admin'] }),
  R('POST', /^\/api\/admin\/api-keys$/, 'auth', { scopes: ['admin'], schema: 'apiKey' }),
  R('POST', /^\/api\/admin\/api-keys\/[^/]+\/rotate$/, 'auth', { scopes: ['admin'] }),
  R('DELETE', /^\/api\/admin\/api-keys\/[^/]+$/, 'auth', { scopes: ['admin'] }),
  R('GET', /^\/api\/admin\/(audit|alerts|queue-consumed)$/, 'notification', { scopes: ['audit:read'] }),
  R('GET', /^\/api\/admin\/queues(\/[^/]+\/dlq)?$/, 'broker', { scopes: ['system:read'] }),
  R('POST', /^\/api\/admin\/queues\/([^/]+\/dlq\/replay|publish-test)$/, 'broker', { scopes: ['system:read'] }),
  R('GET', /^\/api\/admin\/booking-stats$/, 'booking', { scopes: ['system:read'] }),

  // Jadwal: REST
  R('GET', /^\/api\/stations$/, 'catalog', { rl: 'public' }),
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
  R('POST', /^\/api\/locks$/, 'booking', { scopes: ['booking:write'], rl: 'lock', schema: 'lock' }),
  R('GET', /^\/api\/locks\/[^/]+$/, 'booking', { scopes: ['booking:read'] }),
  R('DELETE', /^\/api\/locks\/[^/]+$/, 'booking', { scopes: ['booking:write'] }),
  R('POST', /^\/api\/bookings$/, 'booking', { scopes: ['booking:write'], rl: 'lock', schema: 'booking' }),
  R('GET', /^\/api\/bookings$/, 'booking', { scopes: ['booking:read'] }),
  R('GET', /^\/api\/bookings\/instance$/, 'booking', { rl: 'public' }),
  R('GET', /^\/api\/bookings\/[^/]+$/, 'booking', { scopes: ['booking:read'] }),
  R('GET', /^\/api\/bookings\/[^/]+\/refund-preview$/, 'booking', { scopes: ['booking:read'] }),
  R('POST', /^\/api\/bookings\/[^/]+\/cancel$/, 'booking', { scopes: ['booking:write'] }),
  R('POST', /^\/api\/tickets\/checkin$/, 'booking', { scopes: ['checkin:write'], schema: 'checkin' }),

  // Pembayaran. Webhook publik tetapi wajib bertanda tangan, body diteruskan apa adanya.
  R('POST', /^\/api\/payments$/, 'payment', { scopes: ['payment:write'], rl: 'payment', schema: 'payment' }),
  R('POST', /^\/api\/payments\/webhook$/, 'payment', { rl: 'payment', rawBody: true }),
  R('GET', /^\/api\/payments\/[^/]+$/, 'payment', { scopes: [] }),
  R('POST', /^\/api\/mock-gateway\/checkout\/[^/]+\/pay$/, 'payment', { rl: 'payment', scopes: ['payment:write'] }),

  // Notifikasi
  R('GET', /^\/api\/notifications$/, 'notification', { scopes: [] }),
  R('POST', /^\/api\/notifications\/[^/]+\/read$/, 'notification', { scopes: [] }),

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
