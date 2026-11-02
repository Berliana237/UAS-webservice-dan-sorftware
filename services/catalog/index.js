'use strict';
/**
 * Catalog service: jadwal, stasiun, formasi gerbong. Menyediakan REST dan GraphQL.
 * Peta kursi menggabungkan formasi milik service ini dengan klaim per segmen dari booking-service (mTLS).
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, parse, validate, specifiedRules, execute, GraphQLError } = require('graphql');
const config = require('../shared/config');
const { createApp, finish, ApiError, unavailable } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const dbm = require('../shared/db');
const seedData = require('./seed');
const { depthLimitRule, fieldLimitRule } = require('./graphql-guard');

const { COACHES, FARES, LINES, seatIds, adultFare } = seedData;
const { log, registry, bus, verifier } = kit('catalog');
const db = dbm.open('catalog');
db.exec(`
CREATE TABLE IF NOT EXISTS stations(code TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, line_code TEXT NOT NULL, train_name TEXT NOT NULL, service_date TEXT NOT NULL, departure_at INTEGER NOT NULL, status TEXT NOT NULL, delay_minutes INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(service_date);
CREATE TABLE IF NOT EXISTS trip_stops(trip_id TEXT NOT NULL, seq INTEGER NOT NULL, station_code TEXT NOT NULL, arrive_at INTEGER NOT NULL, depart_at INTEGER NOT NULL, km INTEGER NOT NULL, PRIMARY KEY(trip_id, seq));
CREATE INDEX IF NOT EXISTS idx_stops_station ON trip_stops(station_code, trip_id);
`);
seedData.seed(db);

const st = {
  stations: db.prepare('SELECT * FROM stations ORDER BY name'),
  station: db.prepare('SELECT * FROM stations WHERE code=?'),
  trip: db.prepare('SELECT * FROM trips WHERE id=?'),
  stops: db.prepare('SELECT * FROM trip_stops WHERE trip_id=? ORDER BY seq'),
  search: db.prepare(`SELECT t.id FROM trips t
    JOIN trip_stops a ON a.trip_id=t.id AND a.station_code=?
    JOIN trip_stops b ON b.trip_id=t.id AND b.station_code=? AND b.seq>a.seq
    WHERE t.service_date=? AND t.status<>'CANCELLED' ORDER BY a.depart_at`),
  upcoming: db.prepare(`SELECT * FROM trips WHERE departure_at>? ORDER BY departure_at LIMIT ?`),
  setStatus: db.prepare('UPDATE trips SET status=?, delay_minutes=? WHERE id=?'),
};

/* ---------- Model baca ---------- */
const iso = (ms) => new Date(ms).toISOString();
const stationOf = (code) => st.station.get(code);

function loadTrip(id) {
  const t = st.trip.get(id);
  if (!t) return null;
  const stops = st.stops.all(id).map((s) => ({ seq: s.seq, station: stationOf(s.station_code), arriveAt: iso(s.arrive_at), departAt: iso(s.depart_at), km: s.km, departMs: s.depart_at, arriveMs: s.arrive_at }));
  const segments = stops.slice(0, -1).map((s, i) => ({ index: i, from: s.station, to: stops[i + 1].station, km: stops[i + 1].km - s.km }));
  return {
    id: t.id, trainName: t.train_name, serviceDate: t.service_date, departureAt: iso(t.departure_at), departureMs: t.departure_at, status: t.status,
    delayMinutes: t.delay_minutes, stops, segments, coaches: COACHES,
  };
}

function tripRange(trip, from, to) {
  const a = trip.stops.find((s) => s.station.code === from);
  const b = trip.stops.find((s) => s.station.code === to);
  if (!a || !b || a.seq >= b.seq) throw new ApiError(422, 'INVALID_SEGMENT', 'Stasiun asal harus berada sebelum stasiun tujuan pada rute ini.');
  return { a, b };
}

async function fetchClaims(tripId) {
  try {
    const r = await registry.call('booking', `/internal/trips/${encodeURIComponent(tripId)}/claims`, { timeout: 5000 });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    return r.json.claims;
  } catch (e) {
    log.warn('klaim kursi tidak bisa diambil', { err: e.message });
    throw unavailable('kursi');
  }
}

const TOTAL_SEATS = COACHES.reduce((n, c) => n + c.rows * c.letters.length, 0);

async function buildSeatMap(tripId, from, to) {
  const trip = loadTrip(tripId);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  const { a, b } = tripRange(trip, from, to);
  const claims = await fetchClaims(tripId);
  const bySeat = new Map();
  for (const c of claims) {
    if (!bySeat.has(c.seatId)) bySeat.set(c.seatId, []);
    bySeat.get(c.seatId).push({ index: c.segmentIdx, status: c.ownerType === 'BOOKING' ? 'BOOKED' : 'LOCKED' });
  }
  let available = 0;
  const km = b.km - a.km;
  const coaches = COACHES.map((coach) => {
    let coachAvailable = 0;
    const seats = [];
    for (let row = 1; row <= coach.rows; row++) {
      for (const letter of coach.letters) {
        const id = `${coach.code}-${row}${letter}`;
        const segs = bySeat.get(id) || [];
        const overlap = segs.filter((s) => s.index >= a.seq && s.index < b.seq);
        const status = overlap.some((s) => s.status === 'BOOKED') ? 'BOOKED' : overlap.length ? 'LOCKED' : 'AVAILABLE';
        if (status === 'AVAILABLE') coachAvailable += 1;
        seats.push({ id, coach: coach.code, row, letter, seatClass: coach.seatClass, status, segments: segs });
      }
    }
    available += coachAvailable;
    return { coach, adultFare: adultFare(coach.seatClass, km), available: coachAvailable, seats };
  });
  return { tripId, fromIndex: a.seq, toIndex: b.seq, km, available, total: TOTAL_SEATS, coaches, segments: trip.segments };
}

function searchTrips(from, to, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new ApiError(422, 'INVALID_DATE', 'Format tanggal harus yyyy-mm-dd.');
  if (from === to) throw new ApiError(422, 'INVALID_SEGMENT', 'Stasiun asal dan tujuan tidak boleh sama.');
  const now = Date.now();
  return st.search.all(from, to, date).map((r) => loadTrip(r.id)).map((trip) => {
    const { a, b } = tripRange(trip, from, to);
    return {
      trip, from: a, to: b, durationMinutes: Math.round((b.arriveMs - a.departMs) / 60000), km: b.km - a.km, stopsBetween: b.seq - a.seq - 1,
      fares: Object.keys(FARES).map((seatClass) => ({ seatClass, adult: adultFare(seatClass, b.km - a.km) })),
      totalSeats: TOTAL_SEATS, departed: a.departMs <= now,
    };
  }).filter((o) => !o.departed);
}

async function withAvailability(options) {
  const claims = await Promise.all(options.map((o) => fetchClaims(o.trip.id)));
  return options.map((o, i) => {
    const taken = new Set(claims[i].filter((c) => c.segmentIdx >= o.from.seq && c.segmentIdx < o.to.seq).map((c) => c.seatId));
    return { ...o, availableSeats: TOTAL_SEATS - taken.size };
  });
}

/* ---------- Perubahan oleh operator ---------- */
function createTrip({ lineCode, serviceDate, departureTime }) {
  const line = LINES.find((l) => l.code === lineCode);
  if (!line) throw new ApiError(422, 'UNKNOWN_LINE', `Kode kereta tidak dikenal. Pilihan: ${LINES.map((l) => l.code).join(', ')}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !/^\d{2}:\d{2}$/.test(departureTime)) throw new ApiError(422, 'INVALID_DATE', 'Tanggal yyyy-mm-dd dan jam hh:mm.');
  const dep = Date.parse(`${serviceDate}T${departureTime}:00+07:00`);
  if (Number.isNaN(dep) || dep <= Date.now()) throw new ApiError(422, 'INVALID_DATE', 'Waktu keberangkatan harus di masa depan.');
  const id = `${line.code}-${serviceDate.replaceAll('-', '')}-X${departureTime.replace(':', '')}`;
  if (st.trip.get(id)) throw new ApiError(409, 'TRIP_EXISTS', 'Perjalanan pada jam itu sudah ada.');
  db.tx(() => {
    db.prepare(`INSERT INTO trips(id,line_code,train_name,service_date,departure_at,status) VALUES(?,?,?,?,?,'SCHEDULED')`).run(id, line.code, line.name, serviceDate, dep);
    const ins = db.prepare('INSERT INTO trip_stops(trip_id,seq,station_code,arrive_at,depart_at,km) VALUES(?,?,?,?,?,?)');
    line.stops.forEach(([code, min, km], seq) => { const at = dep + min * 60000; ins.run(id, seq, code, at, seq === 0 || seq === line.stops.length - 1 ? at : at + 120000, km); });
  });
  return loadTrip(id);
}

function updateStatus(id, status, delayMinutes = 0, actor) {
  const trip = st.trip.get(id);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  if (!['SCHEDULED', 'DELAYED', 'CANCELLED'].includes(status)) throw new ApiError(422, 'INVALID_STATUS', 'Status harus SCHEDULED, DELAYED, atau CANCELLED.');
  if (trip.status === 'CANCELLED') throw new ApiError(409, 'TRIP_CANCELLED', 'Perjalanan yang sudah dibatalkan tidak bisa diubah.');
  const delay = status === 'DELAYED' ? Math.max(1, Math.min(720, Number(delayMinutes) || 0)) : 0;
  st.setStatus.run(status, delay, id);
  const topic = status === 'CANCELLED' ? 'trip.cancelled' : status === 'DELAYED' ? 'trip.delayed' : 'trip.updated';
  bus.publishSafe(topic, { tripId: id, trainName: trip.train_name, status, delayMinutes: delay, at: Date.now() }, { key: id });
  bus.publishSafe('audit.trip.status', { action: 'trip.status', service: 'catalog', actor, target: id, status, at: Date.now() });
  return loadTrip(id);
}

/* ---------- GraphQL ---------- */
const schema = buildSchema(fs.readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8'));
const hasScope = (ctx, s) => String(ctx.user?.scope || '').split(' ').includes(s);
const toGraphQL = (e) => {
  if (e instanceof ApiError) return new GraphQLError(e.message, { extensions: { code: e.code, details: e.details, status: e.status } });
  return e;
};
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw toGraphQL(e); } };

const root = {
  stations: () => st.stations.all(),
  searchTrips: wrap(async ({ from, to, date }) => withAvailability(searchTrips(from, to, date))),
  trip: ({ id }) => loadTrip(id),
  seatMap: wrap(({ tripId, from, to }) => buildSeatMap(tripId, from, to)),
  upcomingDepartures: ({ limit }) => st.upcoming.all(Date.now(), Math.min(Math.max(limit ?? 8, 1), 30)).map((t) => {
    const stops = st.stops.all(t.id);
    return {
      tripId: t.id, trainName: t.train_name, fromName: stationOf(stops[0].station_code).name, toName: stationOf(stops[stops.length - 1].station_code).name,
      departureAt: iso(t.departure_at), status: t.status, delayMinutes: t.delay_minutes,
    };
  }),
  createTrip: wrap(({ input }, ctx) => {
    if (!hasScope(ctx, 'schedule:write')) throw new ApiError(403, 'INSUFFICIENT_SCOPE', 'Butuh scope schedule:write.');
    const t = createTrip(input);
    bus.publishSafe('audit.trip.created', { action: 'trip.created', service: 'catalog', actor: ctx.user.sub, target: t.id, at: Date.now() });
    return t;
  }),
  updateTripStatus: wrap(({ id, status, delayMinutes }, ctx) => {
    if (!hasScope(ctx, 'schedule:write')) throw new ApiError(403, 'INSUFFICIENT_SCOPE', 'Butuh scope schedule:write.');
    return updateStatus(id, status, delayMinutes, ctx.user.sub);
  }),
};

const app = createApp('catalog', log);

app.post('/graphql', verifier.requireAuth([], { optional: true }), async (req, res) => {
  const { query, variables, operationName } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) throw new ApiError(400, 'INVALID_QUERY', 'Field query wajib diisi.');
  let document;
  try { document = parse(query); } catch (e) { return res.status(400).json({ errors: [{ message: e.message, extensions: { code: 'GRAPHQL_PARSE_FAILED' } }] }); }
  const errors = validate(schema, document, [...specifiedRules, depthLimitRule(), fieldLimitRule()]);
  if (errors.length) return res.status(400).json({ errors: errors.map((e) => ({ message: e.message, extensions: { code: e.extensions?.code || 'GRAPHQL_VALIDATION_FAILED' } })) });
  const result = await execute({ schema, document, rootValue: root, contextValue: { user: req.user }, variableValues: variables, operationName });
  res.json(result);
});
app.get('/graphql/schema', (_req, res) => res.type('text/plain').send(fs.readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8')));

/* ---------- REST ---------- */
const operator = verifier.requireAuth(['schedule:write']);
app.get('/api/stations', (_req, res) => res.json({ stations: st.stations.all() }));
app.get('/api/schedules', async (req, res) => {
  const { from, to, date } = req.query;
  if (!from || !to || !date) throw new ApiError(422, 'VALIDATION_FAILED', 'Parameter from, to, dan date wajib diisi.');
  const options = await withAvailability(searchTrips(String(from), String(to), String(date)));
  res.json({ count: options.length, trips: options.map((o) => ({
    tripId: o.trip.id, trainName: o.trip.trainName, status: o.trip.status, departAt: o.from.departAt, arriveAt: o.to.arriveAt, from: o.from.station, to: o.to.station,
    durationMinutes: o.durationMinutes, km: o.km, stopsBetween: o.stopsBetween, fares: o.fares, availableSeats: o.availableSeats, totalSeats: o.totalSeats,
  })) });
});
const publicTrip = (t) => { const { departureMs, stops, ...rest } = t; return { ...rest, stops: stops.map(({ departMs, arriveMs, ...s }) => s) }; };
app.get('/api/trips/:id', (req, res) => {
  const trip = loadTrip(req.params.id);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  res.json({ trip: publicTrip(trip) });
});
app.get('/api/trips/:id/seats', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) throw new ApiError(422, 'VALIDATION_FAILED', 'Parameter from dan to wajib diisi.');
  res.json(await buildSeatMap(req.params.id, String(from), String(to)));
});
app.post('/api/trips', operator, (req, res) => {
  const t = createTrip(req.body || {});
  bus.publishSafe('audit.trip.created', { action: 'trip.created', service: 'catalog', actor: req.user.sub, target: t.id, at: Date.now() });
  res.status(201).json({ trip: publicTrip(t) });
});
app.patch('/api/trips/:id', operator, (req, res) => {
  const { status, delayMinutes } = req.body || {};
  res.json({ trip: publicTrip(updateStatus(req.params.id, status, delayMinutes, req.user.sub)) });
});

/* ---------- Internal: snapshot untuk booking-service ---------- */
app.get('/internal/trips/:id', mtls.requireCN('booking'), (req, res) => {
  const trip = loadTrip(req.params.id);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  res.json({
    id: trip.id, trainName: trip.trainName, status: trip.status, departureAt: trip.departureMs,
    stops: trip.stops.map((s) => ({ seq: s.seq, code: s.station.code, name: s.station.name, km: s.km, departAt: s.departMs })),
    coaches: COACHES.map((c) => ({ code: c.code, seatClass: c.seatClass, seats: seatIds(c) })), fares: FARES,
  });
});

finish(app, log);
mtls.createServer('catalog', app, config.ports.catalog, log);
registry.register('catalog', config.selfUrl('catalog', config.ports.catalog), { role: 'schedule' });
