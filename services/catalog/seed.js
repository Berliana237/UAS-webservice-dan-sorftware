'use strict';
/** Data awal jadwal: lima kereta fiktif antarkota Pulau Jawa, dua keberangkatan per hari selama 30 hari ke depan. */

const STATIONS = [
  ['GMR', 'Jakarta Gambir', 'Jakarta'], ['CN', 'Cirebon', 'Cirebon'], ['PWT', 'Purwokerto', 'Purwokerto'], ['KM', 'Kebumen', 'Kebumen'],
  ['BD', 'Bandung', 'Bandung'], ['TSM', 'Tasikmalaya', 'Tasikmalaya'], ['BJR', 'Banjar', 'Banjar'], ['KYA', 'Kroya', 'Cilacap'],
  ['SMT', 'Semarang Tawang', 'Semarang'], ['YK', 'Yogyakarta Tugu', 'Yogyakarta'], ['SLO', 'Solo Balapan', 'Surakarta'], ['NGW', 'Ngawi', 'Ngawi'],
  ['MN', 'Madiun', 'Madiun'], ['NJ', 'Nganjuk', 'Nganjuk'], ['KTS', 'Kertosono', 'Nganjuk'], ['JG', 'Jombang', 'Jombang'],
  ['MR', 'Mojokerto', 'Mojokerto'], ['SGU', 'Surabaya Gubeng', 'Surabaya'], ['SBI', 'Surabaya Pasar Turi', 'Surabaya'],
  ['ML', 'Malang', 'Malang'], ['BL', 'Blitar', 'Blitar'], ['KD', 'Kediri', 'Kediri'],
];

/** stops: [kode, menit dari keberangkatan awal, km kumulatif] */
const LINES = [
  {
    code: 'ARN', name: 'Arunika', departures: ['07:15', '19:30'],
    stops: [['SGU', 0, 0], ['MR', 48, 47], ['JG', 86, 80], ['KTS', 112, 104], ['NJ', 134, 122], ['MN', 170, 160], ['NGW', 198, 193], ['SLO', 250, 256], ['YK', 305, 315]],
  },
  {
    code: 'SND', name: 'Senandika', departures: ['08:00', '20:15'],
    stops: [['GMR', 0, 0], ['CN', 165, 218], ['PWT', 275, 352], ['KM', 335, 415], ['YK', 425, 510], ['SLO', 480, 569]],
  },
  {
    code: 'SWM', name: 'Swastamita', departures: ['09:20', '21:00'],
    stops: [['GMR', 0, 0], ['CN', 160, 218], ['SMT', 320, 445], ['SBI', 520, 730]],
  },
  {
    code: 'NWS', name: 'Nawasena', departures: ['06:40', '18:45'],
    stops: [['BD', 0, 0], ['TSM', 130, 112], ['BJR', 190, 155], ['KYA', 270, 240], ['YK', 380, 360], ['SLO', 435, 419], ['MN', 530, 516], ['SGU', 650, 676]],
  },
  {
    code: 'BSK', name: 'Baskara', departures: ['05:50', '16:30'],
    stops: [['ML', 0, 0], ['BL', 85, 75], ['KD', 150, 130], ['KTS', 190, 158], ['MN', 245, 214], ['SLO', 325, 310], ['YK', 380, 369]],
  },
];

/** Formasi gerbong: kelas, jumlah baris, dan tata letak kursi. */
const COACHES = [
  { code: 'SUI1', name: 'Suite 1', seatClass: 'SUITE', rows: 8, letters: ['A', 'D'] },
  { code: 'EKS1', name: 'Eksekutif 1', seatClass: 'EKSEKUTIF', rows: 12, letters: ['A', 'B', 'C', 'D'] },
  { code: 'EKS2', name: 'Eksekutif 2', seatClass: 'EKSEKUTIF', rows: 12, letters: ['A', 'B', 'C', 'D'] },
  { code: 'PRM1', name: 'Premium 1', seatClass: 'PREMIUM', rows: 16, letters: ['A', 'B', 'C', 'D'] },
  { code: 'PRM2', name: 'Premium 2', seatClass: 'PREMIUM', rows: 16, letters: ['A', 'B', 'C', 'D'] },
];

const FARES = {
  SUITE: { base: 75000, perKm: 2100 },
  EKSEKUTIF: { base: 45000, perKm: 900 },
  PREMIUM: { base: 30000, perKm: 520 },
};

const seatIds = (coach) => {
  const out = [];
  for (let r = 1; r <= coach.rows; r++) for (const l of coach.letters) out.push(`${coach.code}-${r}${l}`);
  return out;
};

/** Harga dewasa per kelas untuk ruas km, dibulatkan ke atas per Rp1.000. Rumus yang sama dipakai FareCalculator di booking-service. */
const adultFare = (seatClass, km) => {
  const f = FARES[seatClass];
  return Math.ceil((f.base + f.perKm * km) / 1000) * 1000;
};

/** Tanggal lokal WIB (UTC+7) sebagai yyyy-mm-dd. */
function wibDate(ms) {
  return new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
}

function seed(db, days = 30) {
  const hasStations = db.prepare('SELECT COUNT(*) c FROM stations').get().c > 0;
  if (!hasStations) {
    const ins = db.prepare('INSERT INTO stations(code,name,city) VALUES(?,?,?)');
    db.tx(() => STATIONS.forEach((s) => ins.run(...s)));
  }
  const insertTrip = db.prepare(`INSERT OR IGNORE INTO trips(id,line_code,train_name,service_date,departure_at,status) VALUES(?,?,?,?,?,'SCHEDULED')`);
  const insertStop = db.prepare('INSERT OR IGNORE INTO trip_stops(trip_id,seq,station_code,arrive_at,depart_at,km) VALUES(?,?,?,?,?,?)');
  const today = Date.now();
  db.tx(() => {
    for (let d = 0; d < days; d++) {
      const date = wibDate(today + d * 86400000);
      for (const line of LINES) {
        line.departures.forEach((time, i) => {
          const id = `${line.code}-${date.replaceAll('-', '')}-${i + 1}`;
          const dep = Date.parse(`${date}T${time}:00+07:00`);
          if (insertTrip.run(id, line.code, line.name, date, dep).changes === 0) return;
          line.stops.forEach(([code, min, km], seq) => {
            const at = dep + min * 60000;
            insertStop.run(id, seq, code, at, seq === 0 || seq === line.stops.length - 1 ? at : at + 120000, km);
          });
        });
      }
    }
  });
}

module.exports = { STATIONS, LINES, COACHES, FARES, seatIds, adultFare, wibDate, seed };
