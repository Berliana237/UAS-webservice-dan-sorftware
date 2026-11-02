/**
 * Load test k6. Jalankan lewat bat\test-load.bat, atau:
 *   k6 run -e BASE_URL=http://localhost:8080 tests/load/k6-booking.js
 *
 * Tiga skenario berjalan bersamaan:
 *  - browse   : pengguna melihat jadwal dan peta kursi (baca, paling banyak)
 *  - contention: banyak pengguna merebut kursi yang sama (uji locking)
 *  - journey  : alur lengkap lock, pesan, bayar
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { uuidv4, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import exec from 'k6/execution';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const PASSWORD = __ENV.SEED_PASSWORD || 'Rangkai2026!';
const USERS = Number(__ENV.LOAD_USERS || 60);
const DURATION = __ENV.DURATION || '45s';

const lockLatency = new Trend('lock_latency', true);
const seatMapLatency = new Trend('seatmap_latency', true);
const lockWon = new Counter('lock_won');
const lockConflict = new Counter('lock_conflict');
const serverErrors = new Rate('server_errors');
const journeyOk = new Counter('journey_completed');

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 30, duration: DURATION, exec: 'browse' },
    contention: { executor: 'constant-arrival-rate', rate: 25, timeUnit: '1s', duration: DURATION, preAllocatedVUs: 40, maxVUs: 80, exec: 'contention' },
    journey: { executor: 'constant-vus', vus: 8, duration: DURATION, exec: 'journey' },
  },
  thresholds: {
    server_errors: ['rate<0.01'],
    seatmap_latency: ['p(95)<800'],
    lock_latency: ['p(95)<1000'],
    http_req_failed: [{ threshold: 'rate<0.5', abortOnFail: false }],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const wibDate = (daysAhead) => new Date(Date.now() + daysAhead * 86400000 + 7 * 3600000).toISOString().slice(0, 10);

function b64url(bytes) {
  return encoding.b64encode(bytes, 'rawurl');
}
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';

function login(email) {
  const verifier = `verifier-${uuidv4()}-${uuidv4()}`;
  const challenge = b64url(crypto.sha256(verifier, 'binary'));
  const redirect = `${BASE}/auth/callback`;
  const q = `response_type=code&client_id=rangkai-postman&redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=S256&state=beban-${uuidv4()}`;
  const a = http.get(`${BASE}/oauth/authorize?${q}`, { headers: { accept: 'application/json' } });
  const l = http.post(`${BASE}/oauth/login`, JSON.stringify({ auth_request: a.json('auth_request'), email, password: PASSWORD }), { headers: { 'content-type': 'application/json' } });
  const t = http.post(`${BASE}/oauth/token`, { grant_type: 'authorization_code', client_id: 'rangkai-postman', code: l.json('code'), code_verifier: verifier, redirect_uri: redirect });
  return t.json('access_token');
}

export function setup() {
  const tokens = [];
  for (let i = 1; i <= USERS; i++) tokens.push(login(`load${i}@rangkai.test`));
  const trips = [];
  for (let d = 10; d < 16; d++) {
    const r = http.get(`${BASE}/api/schedules?from=SGU&to=YK&date=${wibDate(d)}`);
    trips.push(...r.json('trips').filter((t) => t.tripId.startsWith('ARN-')).map((t) => t.tripId));
  }
  return { tokens, trips };
}

const SEG = ['SGU', 'MR', 'JG', 'KTS', 'NJ', 'MN', 'NGW', 'SLO', 'YK'];
const QUERY = `query($id:ID!,$f:String!,$t:String!){seatMap(tripId:$id,from:$f,to:$t){available coaches{available seats{id status}}}}`;

export function browse(data) {
  const trip = data.trips[randomIntBetween(0, data.trips.length - 1)];
  const a = randomIntBetween(0, SEG.length - 2);
  const b = randomIntBetween(a + 1, SEG.length - 1);
  const s = http.get(`${BASE}/api/schedules?from=${SEG[a]}&to=${SEG[b]}&date=${wibDate(12)}`, { tags: { name: 'schedules' } });
  serverErrors.add(s.status >= 500);
  const g = http.post(`${BASE}/graphql`, JSON.stringify({ query: QUERY, variables: { id: trip, f: SEG[a], t: SEG[b] } }), { headers: { 'content-type': 'application/json' }, tags: { name: 'graphql_seatmap' } });
  seatMapLatency.add(g.timings.duration);
  serverErrors.add(g.status >= 500);
  check(g, { 'seatMap 200': (r) => r.status === 200 && r.json('data.seatMap.available') >= 0 });
  sleep(0.3);
}

/** Banyak pengguna merebut ruas kursi yang sama. 201 atau 409 sama-sama benar; 5xx yang dianggap gagal. */
export function contention(data) {
  const token = data.tokens[exec.scenario.iterationInTest % data.tokens.length];
  const trip = data.trips[exec.scenario.iterationInTest % data.trips.length];
  const row = 1 + (exec.scenario.iterationInTest % 12);
  const a = randomIntBetween(0, SEG.length - 2);
  const b = randomIntBetween(a + 1, SEG.length - 1);
  const r = http.post(`${BASE}/api/locks`, JSON.stringify({ tripId: trip, from: SEG[a], to: SEG[b], seats: [`EKS2-${row}A`], ttlSeconds: 4 }), {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': uuidv4() }, tags: { name: 'lock' }, responseCallback: http.expectedStatuses(201, 409, 429),
  });
  lockLatency.add(r.timings.duration);
  serverErrors.add(r.status >= 500);
  if (r.status === 201) lockWon.add(1);
  if (r.status === 409) lockConflict.add(1);
  check(r, { 'lock 201/409/429': (x) => [201, 409, 429].includes(x.status) });
}

export function journey(data) {
  const token = data.tokens[(exec.vu.idInTest + 7) % data.tokens.length];
  const trip = data.trips[randomIntBetween(0, data.trips.length - 1)];
  const seat = `PRM${randomIntBetween(1, 2)}-${randomIntBetween(1, 16)}${'ABCD'[randomIntBetween(0, 3)]}`;
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const l = http.post(`${BASE}/api/locks`, JSON.stringify({ tripId: trip, from: 'SGU', to: 'MN', seats: [seat] }), { headers: { ...auth, 'idempotency-key': uuidv4() }, tags: { name: 'lock' }, responseCallback: http.expectedStatuses(201, 409, 429) });
  serverErrors.add(l.status >= 500);
  if (l.status !== 201) { sleep(0.2); return; }
  const b = http.post(`${BASE}/api/bookings`, JSON.stringify({ lockId: l.json('id'), passengers: [{ seatId: seat, name: 'Penumpang Beban', age: 30, nik: '3578015203990001' }] }), { headers: { ...auth, 'idempotency-key': uuidv4() }, tags: { name: 'booking' } });
  serverErrors.add(b.status >= 500);
  if (b.status !== 201) return;
  const p = http.post(`${BASE}/api/payments`, JSON.stringify({ bookingId: b.json('id'), method: 'QRIS' }), { headers: { ...auth, 'idempotency-key': uuidv4() }, tags: { name: 'payment' } });
  serverErrors.add(p.status >= 500);
  if (p.status !== 201) return;
  const go = http.post(`${BASE}/api/mock-gateway/checkout/${p.json('checkoutToken')}/pay`, JSON.stringify({ outcome: 'success' }), { headers: auth, tags: { name: 'checkout' } });
  serverErrors.add(go.status >= 500);
  if (check(go, { 'gateway 202': (x) => x.status === 202 })) journeyOk.add(1);
  sleep(0.5);
}

export function handleSummary(data) {
  const out = __ENV.SUMMARY_FILE || 'reports/load-k6-summary.json';
  return { [out]: JSON.stringify(data, null, 2), stdout: textSummary(data) };
}

function textSummary(data) {
  const m = data.metrics;
  const fmt = (k, f = 'p(95)') => (m[k] ? `${Math.round(m[k].values[f])} ms` : '-');
  return `
=== Ringkasan Load Test (k6) ===
Permintaan total    : ${m.http_reqs.values.count} (${m.http_reqs.values.rate.toFixed(1)} req/s)
HTTP p95            : ${fmt('http_req_duration')}
Peta kursi p95      : ${fmt('seatmap_latency')}
Lock kursi p95      : ${fmt('lock_latency')}
Lock menang/konflik : ${m.lock_won?.values.count ?? 0} / ${m.lock_conflict?.values.count ?? 0}
Alur selesai        : ${m.journey_completed?.values.count ?? 0}
Error server (5xx)  : ${((m.server_errors?.values.rate ?? 0) * 100).toFixed(2)}%
`;
}
