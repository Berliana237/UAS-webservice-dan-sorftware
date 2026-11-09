'use strict';
/**
 * Data awal: kereta, stasiun, dan rute mengikuti layanan KAI sungguhan (nama dan urutan stasiun).
 * Jam keberangkatan dan tarif adalah perkiraan untuk keperluan tugas, bukan jadwal resmi.
 */

const STATIONS = [
  ['GMR', 'Gambir', 'Jakarta Pusat'], ['PSE', 'Pasar Senen', 'Jakarta Pusat'], ['BKS', 'Bekasi', 'Bekasi'], ['KW', 'Karawang', 'Karawang'],
  ['PWK', 'Purwakarta', 'Purwakarta'], ['CMI', 'Cimahi', 'Cimahi'], ['BD', 'Bandung', 'Bandung'], ['CN', 'Cirebon', 'Cirebon'],
  ['CNP', 'Cirebon Prujakan', 'Cirebon'], ['TG', 'Tegal', 'Tegal'], ['PK', 'Pekalongan', 'Pekalongan'], ['SMT', 'Semarang Tawang', 'Semarang'],
  ['SMC', 'Semarang Poncol', 'Semarang'], ['GBN', 'Gambringan', 'Grobogan'], ['CU', 'Cepu', 'Blora'], ['BJ', 'Bojonegoro', 'Bojonegoro'],
  ['BBT', 'Babat', 'Lamongan'], ['LMG', 'Lamongan', 'Lamongan'], ['SBI', 'Surabaya Pasar Turi', 'Surabaya'], ['SGU', 'Surabaya Gubeng', 'Surabaya'],
  ['PWT', 'Purwokerto', 'Banyumas'], ['KYA', 'Kroya', 'Cilacap'], ['KTA', 'Kutoarjo', 'Purworejo'], ['YK', 'Yogyakarta', 'Yogyakarta'],
  ['SLO', 'Solo Balapan', 'Surakarta'], ['SK', 'Solo Jebres', 'Surakarta'], ['MN', 'Madiun', 'Madiun'], ['KD', 'Kediri', 'Kediri'],
  ['BL', 'Blitar', 'Blitar'], ['ML', 'Malang', 'Malang'], ['TSM', 'Tasikmalaya', 'Tasikmalaya'], ['BJR', 'Banjar', 'Banjar'],
  ['JG', 'Jombang', 'Jombang'],
];

/** Jenis gerbong. facingStart: baris k dan k+1, serta k+2 dan k+3, saling berhadapan di tengah gerbong. Luxury dan Panoramic satu arah. */
const COACH_TYPES = {
  EKO: { label: 'Ekonomi', seatClass: 'EKONOMI', letters: ['A', 'B', 'C', 'D'], rows: 18, facingStart: 8 },
  EKP: { label: 'Ekonomi Premium', seatClass: 'EKONOMI', letters: ['A', 'B', 'C', 'D'], rows: 20, facingStart: 9 },
  EKS: { label: 'Eksekutif', seatClass: 'EKSEKUTIF', letters: ['A', 'B', 'C', 'D'], rows: 13, facingStart: 5 },
  LUX: { label: 'Luxury', seatClass: 'LUXURY', letters: ['A', 'D'], rows: 9, facingStart: null },
  PAN: { label: 'Panoramic', seatClass: 'LUXURY', letters: ['A', 'B', 'D'], rows: 12, facingStart: null },
};

/** Arah tiap baris: F menghadap ke depan kereta, B membelakangi. Pola tengah: F, B, F, B membentuk dua pasang kursi berhadapan. */
function rowFacing(type) {
  const t = COACH_TYPES[type];
  return Array.from({ length: t.rows }, (_, i) => {
    const r = i + 1;
    if (!t.facingStart || r <= t.facingStart) return 'F';
    if (r === t.facingStart + 1 || r === t.facingStart + 3) return 'B';
    if (r === t.facingStart + 2) return 'F';
    return 'B';
  });
}

/** "LUX1+EKS8" menjadi daftar 9 kode gerbong: LUX1, EKS1 ... EKS8. */
function compose(spec) {
  const out = [];
  for (const part of spec.split('+')) {
    const [, type, n] = /^([A-Z]{3})(\d+)$/.exec(part);
    for (let i = 1; i <= Number(n); i++) out.push(`${type}${i}`);
  }
  return out;
}

const coachType = (code) => code.slice(0, 3);
const coachOf = (code) => {
  const type = coachType(code);
  const t = COACH_TYPES[type];
  const n = code.slice(3);
  return { code, type, label: `${t.label} ${n}`, seatClass: t.seatClass, rows: t.rows, letters: t.letters, aisleAfter: t.letters.length === 2 ? 1 : 2, rowFacing: rowFacing(type) };
};
const seatIds = (code) => {
  const c = coachOf(code);
  const out = [];
  for (let r = 1; r <= c.rows; r++) for (const l of c.letters) out.push(`${code}-${r}${l}`);
  return out;
};

/** stops: [kode, menit dari keberangkatan, km kumulatif]. Arah B adalah kebalikan rute A. */
const TRAINS = [
  {
    id: 'ABA', number: 'KA 1', name: 'Argo Bromo Anggrek', composition: 'LUX1+EKS8', masinisSlot: 0,
    fares: { EKSEKUTIF: [60000, 850], LUXURY: [150000, 2600] },
    stops: [['GMR', 0, 0], ['CN', 170, 213], ['SMT', 325, 443], ['BJ', 425, 563], ['SBI', 500, 725]],
    services: [['A', '08:20'], ['A', '20:30'], ['B', '08:00'], ['B', '20:00']],
  },
  {
    id: 'TKS', number: 'KA 58', name: 'Taksaka', composition: 'LUX1+EKS8', masinisSlot: 1,
    fares: { EKSEKUTIF: [55000, 900], LUXURY: [150000, 2700] },
    stops: [['GMR', 0, 0], ['CN', 160, 213], ['PWT', 285, 347], ['KYA', 315, 377], ['KTA', 370, 447], ['YK', 420, 514]],
    services: [['A', '09:20'], ['A', '21:00'], ['B', '10:00'], ['B', '20:45']],
  },
  {
    id: 'GJY', number: 'KA 41', name: 'Gajayana', composition: 'LUX1+EKS8', masinisSlot: 0,
    fares: { EKSEKUTIF: [60000, 880], LUXURY: [150000, 2600] },
    stops: [['GMR', 0, 0], ['CN', 160, 213], ['PWT', 285, 347], ['YK', 420, 514], ['SLO', 470, 573], ['MN', 570, 670], ['KD', 660, 770], ['BL', 725, 825], ['ML', 820, 893]],
    services: [['A', '07:40'], ['A', '18:40'], ['B', '06:30'], ['B', '15:30']],
  },
  {
    id: 'MTJ', number: 'KA 109', name: 'Matarmaja', composition: 'EKO9', masinisSlot: 1,
    fares: { EKONOMI: [25000, 300] },
    stops: [['PSE', 0, 0], ['CNP', 185, 218], ['TG', 260, 292], ['SMC', 420, 439], ['SK', 560, 546], ['MN', 650, 644], ['KD', 745, 744], ['BL', 810, 799], ['ML', 905, 867]],
    services: [['A', '10:45'], ['B', '16:15']],
  },
  {
    id: 'APH', number: 'KA 30', name: 'Argo Parahyangan', composition: 'EKP4+EKS4+PAN1', masinisSlot: 0,
    fares: { EKONOMI: [30000, 600], EKSEKUTIF: [40000, 800], LUXURY: [80000, 1500] },
    stops: [['GMR', 0, 0], ['BKS', 30, 27], ['KW', 60, 56], ['PWK', 110, 105], ['CMI', 165, 164], ['BD', 180, 173]],
    services: [['A', '05:00'], ['A', '09:15'], ['A', '15:30'], ['B', '05:05'], ['B', '10:00'], ['B', '18:00']],
  },
  {
    id: 'AWL', number: 'KA 5', name: 'Argo Wilis', composition: 'EKS8+PAN1', masinisSlot: 1,
    fares: { EKSEKUTIF: [50000, 820], LUXURY: [100000, 1500] },
    stops: [['BD', 0, 0], ['TSM', 120, 101], ['BJR', 175, 150], ['KYA', 260, 235], ['KTA', 315, 305], ['YK', 365, 372], ['SLO', 420, 431], ['MN', 520, 528], ['JG', 610, 620], ['SGU', 690, 688]],
    services: [['A', '07:00'], ['B', '07:30']],
  },
  {
    id: 'JGM', number: 'KA 189', name: 'Joglosemarkerto', composition: 'EKO5+EKS4', masinisSlot: 0,
    fares: { EKONOMI: [20000, 330], EKSEKUTIF: [35000, 600] },
    stops: [['SLO', 0, 0], ['YK', 60, 59], ['KTA', 115, 123], ['PWT', 210, 196], ['TG', 300, 301], ['PK', 360, 366], ['SMT', 440, 451], ['SLO', 580, 559]],
    services: [['A', '06:20'], ['A', '14:30'], ['B', '06:00'], ['B', '13:30']],
  },
  {
    id: 'AMX', number: 'KA 183', name: 'Ambarawa Ekspres', composition: 'EKO9', masinisSlot: 1,
    fares: { EKONOMI: [20000, 350] },
    stops: [['SMC', 0, 0], ['GBN', 40, 40], ['CU', 120, 137], ['BJ', 160, 171], ['BBT', 200, 208], ['LMG', 225, 227], ['SBI', 260, 260]],
    services: [['A', '15:00'], ['B', '06:00']],
  },
];

/** Rute arah tertentu. Arah B dibalik: km dan menit dihitung dari ujung rute A. */
function directedStops(routeA, direction) {
  if (direction === 'A') return routeA.map((s) => ({ code: s.code, minuteOffset: s.minuteOffset, km: s.km }));
  const last = routeA[routeA.length - 1];
  return [...routeA].reverse().map((s) => ({ code: s.code, minuteOffset: last.minuteOffset - s.minuteOffset, km: last.km - s.km }));
}

/** Harga dewasa per kelas untuk ruas km, dibulatkan ke atas per Rp1.000. Rumus yang sama dipakai FareCalculator di booking-service. */
const adultFare = (fare, km) => Math.ceil((fare.base + fare.perKm * km) / 1000) * 1000;

const wibDate = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);

function seed(db) {
  const has = db.prepare('SELECT COUNT(*) c FROM trains').get().c > 0;
  if (has) return false;
  const insStation = db.prepare('INSERT OR IGNORE INTO stations(code,name,city,active) VALUES(?,?,?,1)');
  const insTrain = db.prepare('INSERT INTO trains(id,number,name,enabled,composition,masinis_slot,created_at) VALUES(?,?,?,1,?,?,?)');
  const insStop = db.prepare('INSERT INTO route_stops(train_id,seq,station_code,minute_offset,km) VALUES(?,?,?,?,?)');
  const insFare = db.prepare('INSERT INTO train_fares(train_id,seat_class,base,per_km) VALUES(?,?,?,?)');
  const insService = db.prepare('INSERT INTO train_services(id,train_id,direction,departure_time,active) VALUES(?,?,?,?,1)');
  db.tx(() => {
    STATIONS.forEach((s) => insStation.run(...s));
    for (const t of TRAINS) {
      insTrain.run(t.id, t.number, t.name, JSON.stringify(compose(t.composition)), t.masinisSlot, Date.now());
      t.stops.forEach(([code, min, km], seq) => insStop.run(t.id, seq, code, min, km));
      for (const [cls, [base, perKm]] of Object.entries(t.fares)) insFare.run(t.id, cls, base, perKm);
      t.services.forEach(([dir, time]) => insService.run(`${t.id}-${dir}${time.replace(':', '')}`, t.id, dir, time));
    }
    db.prepare(`INSERT OR IGNORE INTO settings(key,value) VALUES('senior_discount_percent','10')`).run();
  });
  return true;
}

module.exports = { STATIONS, TRAINS, COACH_TYPES, rowFacing, compose, coachOf, coachType, seatIds, directedStops, adultFare, wibDate, seed };
