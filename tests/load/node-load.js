'use strict';
/** Load test cadangan tanpa k6: skenario baca dan rebutan kursi, lalu melaporkan throughput dan persentil latensi. */
const fs = require('node:fs');
const path = require('node:path');
const c = require('../lib/client');

const DURATION_MS = Number(process.env.LOAD_SECONDS || 30) * 1000;
const READERS = Number(process.env.LOAD_READERS || 30);
const WRITERS = Number(process.env.LOAD_WRITERS || 20);
const STOPS = ['SGU', 'MR', 'JG', 'KTS', 'NJ', 'MN', 'NGW', 'SLO', 'YK'];

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const rand = (n) => Math.floor(Math.random() * n);

async function main() {
  const r = c.reporter('Uji Beban (penggerak Node)', 'load-node');
  const tokens = await Promise.all(Array.from({ length: 60 }, (_, i) => c.login(`load${i + 1}@rangkai.test`).then((l) => l.token)));
  const tripId = await c.arunikaTrip(14);
  const stop = Date.now() + DURATION_MS;
  const m = { seatmap: [], lock: [], statuses: {} };
  const note = (bucket, t0, status) => { m[bucket].push(Date.now() - t0); m.statuses[status] = (m.statuses[status] || 0) + 1; };

  const reader = async () => {
    while (Date.now() < stop) {
      const a = rand(STOPS.length - 1);
      const b = a + 1 + rand(STOPS.length - 1 - a);
      const t0 = Date.now();
      const x = await c.call('POST', '/graphql', { body: { query: 'query($i:ID!,$f:String!,$t:String!){seatMap(tripId:$i,from:$f,to:$t){available}}', variables: { i: tripId, f: STOPS[a], t: STOPS[b] } } });
      note('seatmap', t0, x.status);
    }
  };
  const writer = async (i) => {
    while (Date.now() < stop) {
      const a = rand(STOPS.length - 1);
      const b = a + 1 + rand(STOPS.length - 1 - a);
      const t0 = Date.now();
      const x = await c.lockSeat(tokens[(i + rand(60)) % 60], tripId, STOPS[a], STOPS[b], [`EKS2-${1 + rand(12)}A`], { ttlSeconds: 3 });
      note('lock', t0, x.status);
    }
  };
  const started = Date.now();
  await Promise.all([...Array.from({ length: READERS }, reader), ...Array.from({ length: WRITERS }, (_, i) => writer(i))]);
  const sec = (Date.now() - started) / 1000;
  const total = m.seatmap.length + m.lock.length;
  const fives = Object.entries(m.statuses).filter(([k]) => Number(k) >= 500).reduce((n, [, v]) => n + v, 0);
  const summary = {
    durationSeconds: sec, totalRequests: total, rps: total / sec,
    seatmap: { count: m.seatmap.length, p50: pct(m.seatmap, 50), p95: pct(m.seatmap, 95), p99: pct(m.seatmap, 99) },
    lock: { count: m.lock.length, p50: pct(m.lock, 50), p95: pct(m.lock, 95), p99: pct(m.lock, 99) },
    statuses: m.statuses,
  };
  r.info(JSON.stringify(summary, null, 2));
  r.check('L-01', 'Tidak ada error 5xx', fives === 0, `${fives} error`);
  r.check('L-02', 'p95 peta kursi di bawah 1500 ms', summary.seatmap.p95 < 1500, `${summary.seatmap.p95} ms`);
  r.check('L-03', 'p95 lock kursi di bawah 1500 ms', summary.lock.p95 < 1500, `${summary.lock.p95} ms`);
  fs.writeFileSync(path.join(c.ROOT, 'reports', 'load-node-summary.json'), JSON.stringify(summary, null, 2));
  r.finish({ summary });
}
main().catch((e) => { console.error(e); process.exit(1); });
