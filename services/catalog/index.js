'use strict';
/**
 * Catalog service: stasiun, armada kereta, rute, jam operasional, tarif, dan perjalanan harian. Menyediakan REST dan GraphQL.
 * Peta kursi menggabungkan formasi gerbong milik service ini dengan klaim per segmen dari booking-service (mTLS).
 * Perjalanan tidak pernah dihapus setelah lewat, sehingga riwayat tiap armada tersimpan untuk semua tanggal.
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildSchema, parse, validate, specifiedRules, execute, GraphQLError } = require('graphql');
const config = require('../shared/config');
const { createApp, finish, ApiError, unavailable } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const dbm = require('../shared/db');
const S = require('./seed');
const { depthLimitRule, fieldLimitRule } = require('./graphql-guard');

const { log, http, registry, bus, verifier } = kit('catalog');
const db = dbm.open('catalog');
db.exec(`
CREATE TABLE IF NOT EXISTS stations(code TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS trains(id TEXT PRIMARY KEY, number TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, composition TEXT NOT NULL,
  masinis_id TEXT, masinis_name TEXT, masinis_slot INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS route_stops(train_id TEXT NOT NULL, seq INTEGER NOT NULL, station_code TEXT NOT NULL, minute_offset INTEGER NOT NULL, km INTEGER NOT NULL, PRIMARY KEY(train_id, seq));
CREATE TABLE IF NOT EXISTS train_fares(train_id TEXT NOT NULL, seat_class TEXT NOT NULL, base INTEGER NOT NULL, per_km INTEGER NOT NULL, PRIMARY KEY(train_id, seat_class));
CREATE TABLE IF NOT EXISTS train_services(id TEXT PRIMARY KEY, train_id TEXT NOT NULL, direction TEXT NOT NULL, departure_time TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, train_id TEXT NOT NULL, direction TEXT NOT NULL, service_date TEXT NOT NULL, departure_at INTEGER NOT NULL,
  status TEXT NOT NULL, delay_minutes INTEGER NOT NULL DEFAULT 0, masinis_id TEXT, masinis_name TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(service_date);
CREATE INDEX IF NOT EXISTS idx_trips_train ON trips(train_id, departure_at);
CREATE INDEX IF NOT EXISTS idx_trips_masinis ON trips(masinis_id, departure_at);
CREATE TABLE IF NOT EXISTS trip_stops(trip_id TEXT NOT NULL, seq INTEGER NOT NULL, station_code TEXT NOT NULL, arrive_at INTEGER NOT NULL, depart_at INTEGER NOT NULL, km INTEGER NOT NULL, PRIMARY KEY(trip_id, seq));
CREATE INDEX IF NOT EXISTS idx_stops_station ON trip_stops(station_code, trip_id);
`);

const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 60);
const AHEAD_DAYS = 30;
const DAY = 86400000;
const CLASSES = ['EKONOMI', 'EKSEKUTIF', 'LUXURY'];

const st = {
  stations: db.prepare('SELECT * FROM stations WHERE active=1 ORDER BY name'),
  allStations: db.prepare('SELECT * FROM stations ORDER BY name'),
  station: db.prepare('SELECT * FROM stations WHERE code=?'),
  trains: db.prepare('SELECT * FROM trains ORDER BY name'),
  train: db.prepare('SELECT * FROM trains WHERE id=?'),
  route: db.prepare('SELECT * FROM route_stops WHERE train_id=? ORDER BY seq'),
  fares: db.prepare('SELECT * FROM train_fares WHERE train_id=?'),
  services: db.prepare('SELECT * FROM train_services WHERE train_id=? ORDER BY direction, departure_time'),
  setting: db.prepare('SELECT value FROM settings WHERE key=?'),
  putSetting: db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
  trip: db.prepare('SELECT * FROM trips WHERE id=?'),
  stops: db.prepare('SELECT * FROM trip_stops WHERE trip_id=? ORDER BY seq'),
  insertTrip: db.prepare(`INSERT OR IGNORE INTO trips(id,train_id,direction,service_date,departure_at,status,masinis_id,masinis_name,created_at) VALUES(?,?,?,?,?,'SCHEDULED',?,?,?)`),
  insertStop: db.prepare('INSERT OR IGNORE INTO trip_stops(trip_id,seq,station_code,arrive_at,depart_at,km) VALUES(?,?,?,?,?,?)'),
  search: db.prepare(`SELECT DISTINCT t.id FROM trips t
    JOIN trains k ON k.id=t.train_id AND k.enabled=1
    JOIN trip_stops a ON a.trip_id=t.id AND a.station_code=?
    JOIN trip_stops b ON b.trip_id=t.id AND b.station_code=? AND b.seq>a.seq
    WHERE t.service_date=? AND t.status<>'CANCELLED' AND (? IS NULL OR t.train_id=?) ORDER BY t.departure_at`),
  upcoming: db.prepare(`SELECT t.* FROM trips t JOIN trains k ON k.id=t.train_id AND k.enabled=1 WHERE t.departure_at>? ORDER BY t.departure_at LIMIT ?`),
  setStatus: db.prepare('UPDATE trips SET status=?, delay_minutes=? WHERE id=?'),
};

const setting = (key, d) => { const r = st.setting.get(key); return r ? r.value : d; };
const seniorDiscount = () => Number(setting('senior_discount_percent', '10'));

/* ---------- Pembentukan perjalanan dari templat armada ---------- */
function routeOf(trainId) { return st.route.all(trainId).map((r) => ({ code: r.station_code, minuteOffset: r.minute_offset, km: r.km })); }

function generateTrip(train, service, date) {
  const dep = Date.parse(`${date}T${service.departure_time}:00+07:00`);
  const id = `${train.id}-${date.replaceAll('-', '')}-${service.direction}${service.departure_time.replace(':', '')}`;
  const stops = S.directedStops(routeOf(train.id), service.direction);
  if (stops.length < 2) return false;
  if (st.insertTrip.run(id, train.id, service.direction, date, dep, train.masinis_id, train.masinis_name, Date.now()).changes === 0) return false;
  stops.forEach((s, seq) => {
    const at = dep + s.minuteOffset * 60000;
    const last = seq === stops.length - 1;
    st.insertStop.run(id, seq, s.code, at, seq === 0 || last ? at : at + 120000, s.km);
  });
  return true;
}

function ensureTrips(fromDay, toDay, onlyTrain) {
  let created = 0;
  db.tx(() => {
    for (const train of st.trains.all()) {
      if (onlyTrain && train.id !== onlyTrain) continue;
      for (const svc of st.services.all(train.id).filter((s) => s.active)) {
        for (let d = fromDay; d <= toDay; d++) if (generateTrip(train, svc, S.wibDate(Date.now() + d * DAY))) created += 1;
      }
    }
  });
  return created;
}

const fresh = S.seed(db);
ensureTrips(fresh ? -HISTORY_DAYS : 0, AHEAD_DAYS);
setInterval(() => { try { ensureTrips(0, AHEAD_DAYS); } catch (e) { log.warn('pembuatan jadwal gagal', { err: e.message }); } }, 3600000).unref();

/* Pengingat dinas: masinis diberi tahu sekali, 60 menit sebelum perjalanan yang ditugaskan kepadanya berangkat. */
try { db.exec('ALTER TABLE trips ADD COLUMN masinis_reminded INTEGER NOT NULL DEFAULT 0'); } catch { /* kolom sudah ada */ }
const DUTY_NOTICE_MS = 60 * 60000;
function remindDuty() {
  const now = Date.now();
  const due = db.prepare(`SELECT id FROM trips WHERE masinis_id IS NOT NULL AND masinis_reminded=0 AND status!='CANCELLED'
    AND departure_at + delay_minutes*60000 > ? AND departure_at + delay_minutes*60000 <= ?`).all(now, now + DUTY_NOTICE_MS);
  for (const { id } of due) {
    const t = loadTrip(id);
    db.prepare('UPDATE trips SET masinis_reminded=1 WHERE id=?').run(id);
    bus.publishSafe('trip.duty_soon', { tripId: id, userId: t.masinisId, trainName: t.trainName, fromName: t.stops[0].station.name, departureAt: t.departureMs, delayMinutes: t.delayMinutes, at: now }, { key: id, id: `duty-${id}` });
  }
}
setInterval(() => { try { remindDuty(); } catch (e) { log.warn('pengingat dinas gagal', { err: e.message }); } }, 60000).unref();
setTimeout(() => { try { remindDuty(); } catch { /* dicoba lagi tiap menit */ } }, 15000).unref();

/* Masinis demo dibagikan otomatis ke armada yang belum punya masinis, setelah auth-service siap. */
async function assignDefaultMasinis() {
  const pending = st.trains.all().filter((t) => !t.masinis_id && t.masinis_slot !== null);
  if (!pending.length) return;
  try {
    const r = await http.request(`${config.urls.auth}/internal/users?role=masinis`, { timeout: 4000 });
    const list = r.json?.users || [];
    if (!list.length) throw new Error('belum ada masinis');
    db.tx(() => {
      for (const t of pending) {
        const m = list[t.masinis_slot % list.length];
        db.prepare('UPDATE trains SET masinis_id=?, masinis_name=? WHERE id=?').run(m.id, m.name, t.id);
        db.prepare('UPDATE trips SET masinis_id=?, masinis_name=? WHERE train_id=? AND masinis_id IS NULL').run(m.id, m.name, t.id);
      }
    });
    log.info('masinis demo dibagikan ke armada', { trains: pending.length });
  } catch (e) {
    setTimeout(assignDefaultMasinis, 3000).unref();
  }
}
setTimeout(assignDefaultMasinis, 1500).unref();

/* ---------- Model baca ---------- */
const iso = (ms) => new Date(ms).toISOString();
const stationOf = (code) => st.station.get(code) || { code, name: code, city: '' };

function trainView(t, { includeDisabledInfo = false } = {}) {
  const route = st.route.all(t.id).map((r) => ({ seq: r.seq, station: stationOf(r.station_code), minuteOffset: r.minute_offset, km: r.km }));
  const coaches = JSON.parse(t.composition).map(S.coachOf);
  const fares = Object.fromEntries(st.fares.all(t.id).map((f) => [f.seat_class, { base: f.base, perKm: f.per_km }]));
  const services = st.services.all(t.id).map((s) => ({ id: s.id, direction: s.direction, departureTime: s.departure_time, active: Boolean(s.active) }));
  const v = {
    id: t.id, number: t.number, name: t.name, coaches, route, fares, services,
    classes: CLASSES.filter((c) => coaches.some((x) => x.seatClass === c)),
    origin: route[0]?.station, destination: route[route.length - 1]?.station,
    departures: services.filter((s) => s.active && s.direction === 'A').map((s) => s.departureTime),
    stationCodes: [...new Set(route.map((r) => r.station.code))],
  };
  if (includeDisabledInfo) Object.assign(v, { enabled: Boolean(t.enabled), masinisId: t.masinis_id, masinisName: t.masinis_name });
  return v;
}

function phaseOf(departMs, lastArriveMs, now = Date.now()) {
  if (now < departMs) return 'UPCOMING';
  if (now <= lastArriveMs) return 'ON_TRIP';
  return 'COMPLETED';
}

function loadTrip(id) {
  const t = st.trip.get(id);
  if (!t) return null;
  const train = st.train.get(t.train_id);
  const stops = st.stops.all(id).map((s) => ({ seq: s.seq, station: stationOf(s.station_code), arriveAt: iso(s.arrive_at), departAt: iso(s.depart_at), km: s.km, departMs: s.depart_at, arriveMs: s.arrive_at }));
  const segments = stops.slice(0, -1).map((s, i) => ({ index: i, from: s.station, to: stops[i + 1].station, km: stops[i + 1].km - s.km }));
  const coaches = JSON.parse(train.composition).map(S.coachOf);
  return {
    id: t.id, trainId: t.train_id, trainNumber: train.number, trainName: train.name, trainEnabled: Boolean(train.enabled), direction: t.direction,
    serviceDate: t.service_date, departureAt: iso(t.departure_at), departureMs: t.departure_at, status: t.status, delayMinutes: t.delay_minutes,
    phase: phaseOf(t.departure_at, stops[stops.length - 1].arriveMs), masinisId: t.masinis_id, masinisName: t.masinis_name,
    stops, segments, coaches, fares: Object.fromEntries(st.fares.all(t.train_id).map((f) => [f.seat_class, { base: f.base, perKm: f.per_km }])),
  };
}

/** Ruas from-to. Untuk rute melingkar (stasiun muncul dua kali), tujuan dicari setelah stasiun asal. */
function tripRange(trip, from, to) {
  if (from === to) throw new ApiError(422, 'INVALID_SEGMENT', 'Stasiun asal dan tujuan tidak boleh sama.');
  const a = trip.stops.find((s) => s.station.code === from);
  const b = a && trip.stops.find((s) => s.station.code === to && s.seq > a.seq);
  if (!a || !b) throw new ApiError(422, 'INVALID_SEGMENT', 'Stasiun asal harus berada sebelum stasiun tujuan pada rute ini.');
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

const totalSeats = (coaches) => coaches.reduce((n, c) => n + c.rows * c.letters.length, 0);

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
  const km = b.km - a.km;
  let available = 0;
  const coaches = trip.coaches.map((coach) => {
    let free = 0;
    const seats = [];
    for (let row = 1; row <= coach.rows; row++) {
      for (const letter of coach.letters) {
        const id = `${coach.code}-${row}${letter}`;
        const segs = bySeat.get(id) || [];
        const overlap = segs.filter((s) => s.index >= a.seq && s.index < b.seq);
        const status = overlap.some((s) => s.status === 'BOOKED') ? 'BOOKED' : overlap.length ? 'LOCKED' : 'AVAILABLE';
        if (status === 'AVAILABLE') free += 1;
        seats.push({ id, coach: coach.code, row, letter, seatClass: coach.seatClass, facing: coach.rowFacing[row - 1], status, segments: segs });
      }
    }
    available += free;
    const fare = trip.fares[coach.seatClass];
    return { coach, adultFare: fare ? S.adultFare(fare, km) : 0, available: free, seats };
  });
  return { tripId, fromIndex: a.seq, toIndex: b.seq, km, available, total: totalSeats(trip.coaches), seniorDiscountPercent: seniorDiscount(), coaches, segments: trip.segments };
}

function searchTrips(from, to, date, train) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new ApiError(422, 'INVALID_DATE', 'Format tanggal harus yyyy-mm-dd.');
  if (from === to) throw new ApiError(422, 'INVALID_SEGMENT', 'Stasiun asal dan tujuan tidak boleh sama.');
  const now = Date.now();
  const filter = train || null;
  return st.search.all(from, to, date, filter, filter).map((r) => loadTrip(r.id)).map((trip) => {
    const { a, b } = tripRange(trip, from, to);
    const classes = CLASSES.filter((c) => trip.coaches.some((x) => x.seatClass === c) && trip.fares[c]);
    return {
      trip, from: a, to: b, durationMinutes: Math.round((b.arriveMs - a.departMs) / 60000), km: b.km - a.km, stopsBetween: b.seq - a.seq - 1,
      fares: classes.map((seatClass) => ({ seatClass, adult: S.adultFare(trip.fares[seatClass], b.km - a.km) })),
      totalSeats: totalSeats(trip.coaches), departed: a.departMs <= now,
    };
  }).filter((o) => !o.departed);
}

async function withAvailability(options) {
  const claims = await Promise.all(options.map((o) => fetchClaims(o.trip.id)));
  return options.map((o, i) => {
    const taken = new Set(claims[i].filter((c) => c.segmentIdx >= o.from.seq && c.segmentIdx < o.to.seq).map((c) => c.seatId));
    return { ...o, availableSeats: o.totalSeats - taken.size };
  });
}

/* ---------- Perubahan status perjalanan ---------- */
function updateStatus(id, status, delayMinutes = 0, actor) {
  const trip = st.trip.get(id);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  if (!['SCHEDULED', 'DELAYED', 'CANCELLED'].includes(status)) throw new ApiError(422, 'INVALID_STATUS', 'Status harus SCHEDULED, DELAYED, atau CANCELLED.');
  if (trip.status === 'CANCELLED') throw new ApiError(409, 'TRIP_CANCELLED', 'Perjalanan yang sudah dibatalkan tidak bisa diubah.');
  const delay = status === 'DELAYED' ? Math.max(1, Math.min(720, Number(delayMinutes) || 0)) : 0;
  st.setStatus.run(status, delay, id);
  const train = st.train.get(trip.train_id);
  const topic = status === 'CANCELLED' ? 'trip.cancelled' : status === 'DELAYED' ? 'trip.delayed' : 'trip.updated';
  bus.publishSafe(topic, { tripId: id, trainName: train.name, status, delayMinutes: delay, departureAt: trip.departure_at, at: Date.now() }, { key: id });
  bus.publishSafe('audit.trip.status', { action: 'trip.status', service: 'catalog', actor, target: id, status, at: Date.now() });
  return loadTrip(id);
}

function createExtraTrip({ trainId, direction = 'A', serviceDate, departureTime }, actor) {
  const train = st.train.get(trainId);
  if (!train) throw new ApiError(422, 'UNKNOWN_TRAIN', 'Kereta tidak dikenal.');
  if (!['A', 'B'].includes(direction)) throw new ApiError(422, 'VALIDATION_FAILED', 'Arah harus A atau B.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime || '')) throw new ApiError(422, 'INVALID_DATE', 'Tanggal yyyy-mm-dd dan jam hh:mm.');
  const dep = Date.parse(`${serviceDate}T${departureTime}:00+07:00`);
  if (Number.isNaN(dep) || dep <= Date.now()) throw new ApiError(422, 'INVALID_DATE', 'Waktu keberangkatan harus di masa depan.');
  const id = `${train.id}-${serviceDate.replaceAll('-', '')}-${direction}${departureTime.replace(':', '')}`;
  if (st.trip.get(id)) throw new ApiError(409, 'TRIP_EXISTS', 'Perjalanan pada jam itu sudah ada.');
  db.tx(() => generateTrip(train, { direction, departure_time: departureTime }, serviceDate));
  bus.publishSafe('audit.trip.created', { action: 'trip.created', service: 'catalog', actor, target: id, at: Date.now() });
  return loadTrip(id);
}

/* ---------- GraphQL ---------- */
const schemaText = fs.readFileSync(path.join(__dirname, 'schema.graphql'), 'utf8');
const schema = buildSchema(schemaText);
const hasScope = (ctx, s) => String(ctx.user?.scope || '').split(' ').includes(s);
const toGraphQL = (e) => (e instanceof ApiError ? new GraphQLError(e.message, { extensions: { code: e.code, details: e.details, status: e.status } }) : e);
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw toGraphQL(e); } };
const publicTrains = () => st.trains.all().filter((t) => t.enabled).map((t) => trainView(t));
const pricingPolicy = () => ({ seniorDiscountPercent: seniorDiscount(), infantMaxAge: 3, childMaxAge: 16, seniorMinAge: 60 });

const root = {
  stations: () => st.stations.all(),
  trains: publicTrains,
  searchTrips: wrap(async ({ from, to, date, train }) => withAvailability(searchTrips(from, to, date, train))),
  trip: ({ id }) => loadTrip(id),
  seatMap: wrap(({ tripId, from, to }) => buildSeatMap(tripId, from, to)),
  pricingPolicy,
  upcomingDepartures: ({ limit }) => st.upcoming.all(Date.now(), Math.min(Math.max(limit ?? 8, 1), 30)).map((t) => {
    const stops = st.stops.all(t.id);
    const train = st.train.get(t.train_id);
    return { tripId: t.id, trainName: train.name, fromName: stationOf(stops[0].station_code).name, toName: stationOf(stops[stops.length - 1].station_code).name, departureAt: iso(t.departure_at), status: t.status, delayMinutes: t.delay_minutes };
  }),
  createTrip: wrap(({ input }, ctx) => {
    if (!hasScope(ctx, 'schedule:write')) throw new ApiError(403, 'INSUFFICIENT_SCOPE', 'Butuh scope schedule:write.');
    return createExtraTrip(input, ctx.user.sub);
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
app.get('/graphql/schema', (_req, res) => res.type('text/plain').send(schemaText));

/* ---------- REST publik ---------- */
const publicTrip = (t) => {
  const { departureMs, stops, masinisId, ...rest } = t;
  return { ...rest, stops: stops.map(({ departMs, arriveMs, ...s }) => s) };
};
app.get('/api/stations', (_req, res) => res.json({ stations: st.stations.all() }));
app.get('/api/trains', (_req, res) => res.json({ trains: publicTrains() }));
app.get('/api/pricing', (_req, res) => res.json(pricingPolicy()));
app.get('/api/schedules', async (req, res) => {
  const { from, to, date, train } = req.query;
  if (!from || !to || !date) throw new ApiError(422, 'VALIDATION_FAILED', 'Parameter from, to, dan date wajib diisi.');
  const options = await withAvailability(searchTrips(String(from), String(to), String(date), train ? String(train) : null));
  res.json({ count: options.length, trips: options.map((o) => ({
    tripId: o.trip.id, trainId: o.trip.trainId, trainNumber: o.trip.trainNumber, trainName: o.trip.trainName, status: o.trip.status, delayMinutes: o.trip.delayMinutes,
    departAt: o.from.departAt, arriveAt: o.to.arriveAt, from: o.from.station, to: o.to.station,
    durationMinutes: o.durationMinutes, km: o.km, stopsBetween: o.stopsBetween, fares: o.fares, availableSeats: o.availableSeats, totalSeats: o.totalSeats,
  })) });
});
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

/* ---------- Operasional: tambah perjalanan dan ubah status (admin) ---------- */
const scheduler = verifier.requireAuth(['schedule:write']);
app.post('/api/trips', scheduler, (req, res) => res.status(201).json({ trip: publicTrip(createExtraTrip(req.body || {}, req.user.sub)) }));
app.patch('/api/trips/:id', scheduler, (req, res) => {
  const { status, delayMinutes } = req.body || {};
  res.json({ trip: publicTrip(updateStatus(req.params.id, status, delayMinutes, req.user.sub)) });
});

/* ---------- Admin: data operasional ---------- */
const adminOnly = verifier.requireAuth(['schedule:write']);
const audit = (action, actor, target, extra = {}) => bus.publishSafe(`audit.${action}`, { action, service: 'catalog', actor, target, at: Date.now(), ...extra });
const STATION_CODE = /^[A-Z]{2,4}$/;
const TRAIN_ID = /^[A-Z]{2,4}$/;
const fields = (f) => new ApiError(422, 'VALIDATION_FAILED', 'Periksa kembali isian Anda.', { fields: f });

app.get('/api/admin/stations', adminOnly, (_req, res) => {
  const used = new Set(db.prepare('SELECT DISTINCT station_code c FROM route_stops').all().map((r) => r.c));
  res.json({ stations: st.allStations.all().map((s) => ({ ...s, active: Boolean(s.active), usedByRoute: used.has(s.code) })) });
});
app.post('/api/admin/stations', adminOnly, (req, res) => {
  const { code, name, city } = req.body || {};
  const f = {};
  if (!STATION_CODE.test(code || '')) f.code = 'Kode 2 sampai 4 huruf kapital, misalnya GMR.';
  if (!name || String(name).trim().length < 3) f.name = 'Nama minimal 3 karakter.';
  if (!city || String(city).trim().length < 2) f.city = 'Kota wajib diisi.';
  if (Object.keys(f).length) throw fields(f);
  if (st.station.get(code)) throw new ApiError(409, 'STATION_EXISTS', 'Kode stasiun sudah dipakai.');
  db.prepare('INSERT INTO stations(code,name,city,active) VALUES(?,?,?,1)').run(code, String(name).trim(), String(city).trim());
  audit('station.created', req.user.sub, code);
  res.status(201).json({ station: st.station.get(code) });
});
app.patch('/api/admin/stations/:code', adminOnly, (req, res) => {
  const s = st.station.get(req.params.code);
  if (!s) throw new ApiError(404, 'STATION_NOT_FOUND', 'Stasiun tidak ditemukan.');
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : s.name;
  const city = req.body?.city !== undefined ? String(req.body.city).trim() : s.city;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : s.active;
  if (name.length < 3 || city.length < 2) throw fields({ name: 'Nama minimal 3 karakter dan kota wajib diisi.' });
  db.prepare('UPDATE stations SET name=?, city=?, active=? WHERE code=?').run(name, city, active, s.code);
  audit('station.updated', req.user.sub, s.code);
  res.json({ station: { ...st.station.get(s.code), active: Boolean(active) } });
});
app.delete('/api/admin/stations/:code', adminOnly, (req, res) => {
  if (!st.station.get(req.params.code)) throw new ApiError(404, 'STATION_NOT_FOUND', 'Stasiun tidak ditemukan.');
  if (db.prepare('SELECT 1 FROM route_stops WHERE station_code=? LIMIT 1').get(req.params.code)) throw new ApiError(409, 'STATION_IN_USE', 'Stasiun masih dipakai dalam rute kereta. Hapus dari rute dulu, atau nonaktifkan saja.');
  db.prepare('DELETE FROM stations WHERE code=?').run(req.params.code);
  audit('station.deleted', req.user.sub, req.params.code);
  res.json({ deleted: true });
});

app.get('/api/admin/trains', adminOnly, (_req, res) => res.json({ trains: st.trains.all().map((t) => trainView(t, { includeDisabledInfo: true })) }));
app.get('/api/admin/trains/:id', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  res.json({ train: trainView(t, { includeDisabledInfo: true }) });
});

const COMPOSITIONS = { 'EKONOMI': 'EKO9', 'EKSEKUTIF': 'EKS9', 'LUXURY': 'LUX9', 'EKONOMI,EKSEKUTIF': 'EKO5+EKS4', 'EKSEKUTIF,LUXURY': 'LUX1+EKS8', 'EKONOMI,LUXURY': 'EKO8+LUX1', 'EKONOMI,EKSEKUTIF,LUXURY': 'EKO4+EKS4+LUX1' };

app.post('/api/admin/trains', adminOnly, (req, res) => {
  const { id, number, name, classes = [] } = req.body || {};
  const f = {};
  if (!TRAIN_ID.test(id || '')) f.id = 'Kode 2 sampai 4 huruf kapital, misalnya ABA.';
  if (!number || !/^KA \d{1,4}[A-Z]?$/.test(String(number).trim())) f.number = 'Nomor seperti "KA 12".';
  if (!name || String(name).trim().length < 3) f.name = 'Nama minimal 3 karakter.';
  const key = CLASSES.filter((c) => classes.includes(c)).join(',');
  if (!COMPOSITIONS[key]) f.classes = 'Pilih minimal satu kelas: EKONOMI, EKSEKUTIF, LUXURY.';
  if (Object.keys(f).length) throw fields(f);
  if (st.train.get(id)) throw new ApiError(409, 'TRAIN_EXISTS', 'Kode kereta sudah dipakai.');
  db.tx(() => {
    db.prepare('INSERT INTO trains(id,number,name,enabled,composition,created_at) VALUES(?,?,?,0,?,?)').run(id, String(number).trim(), String(name).trim(), JSON.stringify(S.compose(COMPOSITIONS[key])), Date.now());
    const defaults = { EKONOMI: [25000, 330], EKSEKUTIF: [50000, 850], LUXURY: [150000, 2500] };
    for (const c of CLASSES.filter((x) => classes.includes(x))) db.prepare('INSERT INTO train_fares(train_id,seat_class,base,per_km) VALUES(?,?,?,?)').run(id, c, ...defaults[c]);
  });
  audit('train.created', req.user.sub, id);
  res.status(201).json({ train: trainView(st.train.get(id), { includeDisabledInfo: true }), notice: 'Kereta dibuat dalam keadaan nonaktif. Lengkapi rute dan jam operasional, lalu aktifkan.' });
});

app.patch('/api/admin/trains/:id', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : t.name;
  const number = b.number !== undefined ? String(b.number).trim() : t.number;
  if (name.length < 3) throw fields({ name: 'Nama minimal 3 karakter.' });
  if (!/^KA \d{1,4}[A-Z]?$/.test(number)) throw fields({ number: 'Nomor seperti "KA 12".' });
  let enabled = t.enabled;
  if (b.enabled !== undefined) {
    enabled = b.enabled ? 1 : 0;
    if (enabled && (st.route.all(t.id).length < 2 || !st.services.all(t.id).some((s) => s.active))) throw new ApiError(409, 'TRAIN_INCOMPLETE', 'Lengkapi rute (minimal 2 stasiun) dan jam operasional sebelum mengaktifkan kereta.');
  }
  let masinisId = t.masinis_id;
  let masinisName = t.masinis_name;
  if (b.masinisId !== undefined) {
    masinisId = b.masinisId || null;
    masinisName = masinisId ? String(b.masinisName || '').trim() || null : null;
    if (masinisId && !masinisName) throw fields({ masinisName: 'Nama masinis wajib dikirim bersama masinisId.' });
  }
  db.tx(() => {
    db.prepare('UPDATE trains SET name=?, number=?, enabled=?, masinis_id=?, masinis_name=? WHERE id=?').run(name, number, enabled, masinisId, masinisName, t.id);
    // Penugasan masinis berlaku untuk perjalanan yang belum berangkat. Riwayat tetap mencatat masinis saat itu.
    if (b.masinisId !== undefined) db.prepare('UPDATE trips SET masinis_id=?, masinis_name=? WHERE train_id=? AND departure_at>?').run(masinisId, masinisName, t.id, Date.now());
  });
  if (b.enabled !== undefined && enabled) ensureTrips(0, AHEAD_DAYS, t.id);
  audit('train.updated', req.user.sub, t.id, { enabled: Boolean(enabled) });
  res.json({ train: trainView(st.train.get(t.id), { includeDisabledInfo: true }) });
});

app.put('/api/admin/trains/:id/route', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const stops = req.body?.stops;
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 20) throw fields({ stops: 'Rute berisi 2 sampai 20 stasiun.' });
  for (const [i, s] of stops.entries()) {
    if (!st.station.get(s.code)) throw fields({ stops: `Stasiun ke-${i + 1} (${s.code}) tidak dikenal.` });
    if (!Number.isInteger(s.minuteOffset) || !Number.isInteger(s.km) || s.minuteOffset < 0 || s.km < 0) throw fields({ stops: `Menit dan km stasiun ke-${i + 1} harus bilangan bulat positif.` });
    if (i === 0 && (s.minuteOffset !== 0 || s.km !== 0)) throw fields({ stops: 'Stasiun pertama harus 0 menit dan 0 km.' });
    if (i > 0 && (s.minuteOffset <= stops[i - 1].minuteOffset || s.km <= stops[i - 1].km)) throw fields({ stops: `Menit dan km stasiun ke-${i + 1} harus lebih besar dari stasiun sebelumnya.` });
    if (i > 0 && s.code === stops[i - 1].code) throw fields({ stops: 'Stasiun yang sama tidak boleh berurutan.' });
  }
  db.tx(() => {
    db.prepare('DELETE FROM route_stops WHERE train_id=?').run(t.id);
    stops.forEach((s, seq) => db.prepare('INSERT INTO route_stops(train_id,seq,station_code,minute_offset,km) VALUES(?,?,?,?,?)').run(t.id, seq, s.code, s.minuteOffset, s.km));
  });
  audit('train.route_updated', req.user.sub, t.id);
  res.json({ train: trainView(st.train.get(t.id), { includeDisabledInfo: true }), notice: 'Rute baru berlaku untuk jadwal yang dibuat berikutnya. Tekan "Terapkan ke jadwal mendatang" untuk memperbarui jadwal yang belum ada pemesan.' });
});

app.put('/api/admin/trains/:id/fares', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const classes = trainView(t).classes;
  const list = req.body?.fares;
  if (!Array.isArray(list) || !list.length) throw fields({ fares: 'Kirim daftar tarif per kelas.' });
  for (const f of list) {
    if (!classes.includes(f.seatClass)) throw fields({ fares: `Kereta ini tidak punya kelas ${f.seatClass}.` });
    if (!Number.isInteger(f.base) || !Number.isInteger(f.perKm) || f.base < 0 || f.perKm < 0 || f.base > 10000000 || f.perKm > 100000) throw fields({ fares: 'Tarif dasar dan per km harus bilangan bulat positif yang wajar.' });
  }
  db.tx(() => list.forEach((f) => db.prepare('INSERT INTO train_fares(train_id,seat_class,base,per_km) VALUES(?,?,?,?) ON CONFLICT(train_id,seat_class) DO UPDATE SET base=excluded.base, per_km=excluded.per_km').run(t.id, f.seatClass, f.base, f.perKm)));
  audit('train.fares_updated', req.user.sub, t.id);
  res.json({ train: trainView(st.train.get(t.id), { includeDisabledInfo: true }) });
});

app.put('/api/admin/trains/:id/services', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const list = req.body?.services;
  if (!Array.isArray(list) || list.length > 12) throw fields({ services: 'Kirim 0 sampai 12 jam keberangkatan.' });
  const seen = new Set();
  for (const s of list) {
    if (!['A', 'B'].includes(s.direction) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.departureTime || '')) throw fields({ services: 'Arah A atau B, jam dalam format hh:mm.' });
    const k = `${s.direction}${s.departureTime}`;
    if (seen.has(k)) throw fields({ services: `Jam ${s.departureTime} arah ${s.direction} tercatat dua kali.` });
    seen.add(k);
  }
  db.tx(() => {
    db.prepare('DELETE FROM train_services WHERE train_id=?').run(t.id);
    list.forEach((s) => db.prepare('INSERT INTO train_services(id,train_id,direction,departure_time,active) VALUES(?,?,?,?,?)').run(`${t.id}-${s.direction}${s.departureTime.replace(':', '')}`, t.id, s.direction, s.departureTime, s.active === false ? 0 : 1));
  });
  audit('train.services_updated', req.user.sub, t.id);
  res.json({ train: trainView(st.train.get(t.id), { includeDisabledInfo: true }) });
});

/** Membuat ulang perjalanan mendatang yang belum ada klaim kursi, agar perubahan rute dan jam berlaku. */
app.post('/api/admin/trains/:id/regenerate', adminOnly, async (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const future = db.prepare('SELECT id FROM trips WHERE train_id=? AND departure_at>?').all(t.id, Date.now() + 3600000).map((r) => r.id);
  let counts = {};
  if (future.length) {
    try {
      const r = await registry.call('booking', '/internal/trips/claim-counts', { method: 'POST', body: { tripIds: future }, timeout: 8000 });
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      counts = r.json.counts;
    } catch { throw unavailable('pemesanan'); }
  }
  const removable = future.filter((id) => !counts[id]);
  db.tx(() => removable.forEach((id) => { db.prepare('DELETE FROM trip_stops WHERE trip_id=?').run(id); db.prepare('DELETE FROM trips WHERE id=?').run(id); }));
  const created = ensureTrips(0, AHEAD_DAYS, t.id);
  audit('train.regenerated', req.user.sub, t.id, { removed: removable.length, created });
  res.json({ removed: removable.length, kept: future.length - removable.length, created });
});

app.delete('/api/admin/trains/:id', adminOnly, (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  if (db.prepare('SELECT 1 FROM trips WHERE train_id=? AND departure_at<? LIMIT 1').get(t.id, Date.now())) throw new ApiError(409, 'TRAIN_HAS_HISTORY', 'Kereta ini punya riwayat perjalanan yang harus disimpan. Nonaktifkan saja.');
  db.tx(() => {
    for (const r of db.prepare('SELECT id FROM trips WHERE train_id=?').all(t.id)) db.prepare('DELETE FROM trip_stops WHERE trip_id=?').run(r.id);
    for (const table of ['trips', 'route_stops', 'train_fares', 'train_services']) db.prepare(`DELETE FROM ${table} WHERE train_id=?`).run(t.id);
    db.prepare('DELETE FROM trains WHERE id=?').run(t.id);
  });
  audit('train.deleted', req.user.sub, t.id);
  res.json({ deleted: true });
});

app.get('/api/admin/settings', adminOnly, (_req, res) => res.json({ seniorDiscountPercent: seniorDiscount() }));
app.put('/api/admin/settings', adminOnly, (req, res) => {
  const v = req.body?.seniorDiscountPercent;
  if (!Number.isInteger(v) || v < 0 || v > 100) throw fields({ seniorDiscountPercent: 'Diskon lansia 0 sampai 100 persen.' });
  st.putSetting.run('senior_discount_percent', String(v));
  audit('settings.updated', req.user.sub, 'senior_discount_percent', { value: v });
  res.json({ seniorDiscountPercent: v });
});

/** Riwayat perjalanan satu armada. Semua tanggal tersimpan, dibaca per halaman. */
app.get('/api/admin/trains/:id/trips', verifier.requireAuth(['system:read']), (req, res) => {
  const t = st.train.get(req.params.id);
  if (!t) throw new ApiError(404, 'TRAIN_NOT_FOUND', 'Kereta tidak ditemukan.');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '0000-01-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : '9999-12-31';
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = db.prepare('SELECT COUNT(*) c FROM trips WHERE train_id=? AND service_date BETWEEN ? AND ?').get(t.id, from, to).c;
  const rows = db.prepare('SELECT id FROM trips WHERE train_id=? AND service_date BETWEEN ? AND ? ORDER BY departure_at DESC LIMIT ? OFFSET ?').all(t.id, from, to, limit, offset);
  const trips = rows.map((r) => {
    const x = loadTrip(r.id);
    return { id: x.id, serviceDate: x.serviceDate, departureAt: x.departureAt, arriveAt: x.stops[x.stops.length - 1].arriveAt, direction: x.direction, origin: x.stops[0].station, destination: x.stops[x.stops.length - 1].station, status: x.status, phase: x.phase, delayMinutes: x.delayMinutes, masinisName: x.masinisName };
  });
  res.json({ train: { id: t.id, name: t.name, number: t.number }, total, limit, offset, trips });
});

app.get('/api/admin/catalog-stats', verifier.requireAuth(['system:read']), (_req, res) => {
  const today = S.wibDate(Date.now());
  const trains = st.trains.all();
  res.json({
    trains: trains.length, enabledTrains: trains.filter((t) => t.enabled).length, stations: st.allStations.all().length,
    tripsToday: db.prepare('SELECT COUNT(*) c FROM trips WHERE service_date=?').get(today).c,
    delayedToday: db.prepare(`SELECT COUNT(*) c FROM trips WHERE service_date=? AND status='DELAYED'`).get(today).c,
    cancelledToday: db.prepare(`SELECT COUNT(*) c FROM trips WHERE service_date=? AND status='CANCELLED'`).get(today).c,
    seniorDiscountPercent: seniorDiscount(),
    nextDepartures: st.upcoming.all(Date.now(), 6).map((t) => { const x = loadTrip(t.id); return { id: x.id, trainName: x.trainName, departureAt: x.departureAt, origin: x.stops[0].station.name, destination: x.stops[x.stops.length - 1].station.name, status: x.status, masinisName: x.masinisName }; }),
  });
});

/* ---------- Masinis: jadwal dinas sendiri ---------- */
const masinis = verifier.requireAuth(['masinis']);
app.get('/api/masinis/trips', masinis, (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : S.wibDate(Date.now() - DAY);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : S.wibDate(Date.now() + 14 * DAY);
  const rows = db.prepare('SELECT id FROM trips WHERE masinis_id=? AND service_date BETWEEN ? AND ? ORDER BY departure_at').all(req.user.sub, from, to);
  res.json({ from, to, trips: rows.map((r) => publicTrip(loadTrip(r.id))) });
});
app.patch('/api/masinis/trips/:id/delay', masinis, (req, res) => {
  const t = st.trip.get(req.params.id);
  if (!t || t.masinis_id !== req.user.sub) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan di jadwal dinas Anda.');
  const minutes = req.body?.delayMinutes;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 720) throw fields({ delayMinutes: 'Keterlambatan 0 sampai 720 menit.' });
  const trip = updateStatus(t.id, minutes === 0 ? 'SCHEDULED' : 'DELAYED', minutes, req.user.sub);
  res.json({ trip: publicTrip(trip) });
});

/* ---------- Internal untuk booking-service ---------- */
const snapshot = (trip) => ({
  id: trip.id, trainId: trip.trainId, trainName: trip.trainName, trainEnabled: trip.trainEnabled, status: trip.status, departureAt: trip.departureMs, masinisId: trip.masinisId,
  stops: trip.stops.map((s) => ({ seq: s.seq, code: s.station.code, name: s.station.name, km: s.km, departAt: s.departMs })),
  coaches: trip.coaches.map((c) => ({ code: c.code, seatClass: c.seatClass, seats: S.seatIds(c.code) })),
  fares: trip.fares, seniorDiscountPercent: seniorDiscount(),
});
app.get('/internal/trips/:id', mtls.requireCN('booking'), (req, res) => {
  const trip = loadTrip(req.params.id);
  if (!trip) throw new ApiError(404, 'TRIP_NOT_FOUND', 'Perjalanan tidak ditemukan.');
  res.json(snapshot(trip));
});
/** Perjalanan yang sudah lewat, untuk mengisi riwayat demo pertama kali. */
app.get('/internal/trips-past', mtls.requireCN('booking'), (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const rows = db.prepare('SELECT id FROM trips WHERE departure_at<? AND departure_at>=? ORDER BY departure_at').all(Date.now() - 12 * 3600000, Date.now() - days * DAY);
  res.json({ trips: rows.map((r) => snapshot(loadTrip(r.id))) });
});

finish(app, log);
mtls.createServer('catalog', app, config.ports.catalog, log);
registry.register('catalog', config.selfUrl('catalog', config.ports.catalog), { role: 'schedule' });
