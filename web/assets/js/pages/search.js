/**
 * Cari Tiket. Formulir di atas (Dari, Ke, Kereta, Tanggal) dan hasil di bawahnya.
 * Pilihan kereta menyaring stasiun, dan pilihan stasiun menyaring kereta, agar kombinasi yang mustahil tidak bisa dipilih.
 */
import { $, $$, api, gql, esc, rupiah, timeOf, duration, dateLong, dateShort, wibToday, go } from '../core.js';
import { Kiko } from '../kiko.js';
import { combobox, icon } from '../ui.js';
import { Sound } from '../sound.js';

const Q = `query($from:String!,$to:String!,$date:String!,$train:ID){searchTrips(from:$from,to:$to,date:$date,train:$train){
  trip{id trainName trainNumber status delayMinutes} from{departAt station{code name}} to{arriveAt station{code name}}
  durationMinutes km stopsBetween availableSeats totalSeats fares{seatClass adult}}}`;
const CLASS = { EKONOMI: 'Ekonomi', EKSEKUTIF: 'Eksekutif', LUXURY: 'Luxury' };

/** Kereta melayani ruas bila kedua stasiun ada di rutenya (arah mana pun, kereta melingkar juga). */
const serves = (t, a, b) => (!a || t.stationCodes.includes(a)) && (!b || t.stationCodes.includes(b));

function row(o, i, q) {
  const cheapest = Math.min(...o.fares.map((f) => f.adult));
  const low = o.availableSeats < 20;
  const delayed = o.trip.status === 'DELAYED';
  const full = o.availableSeats === 0;
  return `<article class="trip reveal" style="--i:${i}">
    <div class="trip-time">
      <div><b class="mono">${timeOf(o.from.departAt)}</b><span>${esc(o.from.station.name)}</span></div>
      <div class="trip-line" aria-hidden="true"><i></i><small>${duration(o.durationMinutes)}${o.stopsBetween ? ` · ${o.stopsBetween} henti` : ' · langsung'}</small></div>
      <div class="end"><b class="mono">${timeOf(o.to.arriveAt)}</b><span>${esc(o.to.station.name)}</span></div>
    </div>
    <div class="trip-train">
      <h3>${esc(o.trip.trainName)} <small class="mono muted">${esc(o.trip.trainNumber)}</small></h3>
      <p class="muted">${o.km} km${delayed ? ` · <span class="late">terlambat ${o.trip.delayMinutes} menit</span>` : ''}</p>
      <ul class="fares">${o.fares.map((f) => `<li><span>${CLASS[f.seatClass]}</span><b class="mono">${rupiah(f.adult)}</b></li>`).join('')}</ul>
    </div>
    <div class="trip-go">
      <p class="from">mulai <b class="mono">${rupiah(cheapest)}</b></p>
      <p class="seats ${low ? 'low' : ''}">${full ? 'Penuh di ruas ini' : `${o.availableSeats} kursi kosong`}</p>
      <a class="btn gold ${full ? 'off' : ''}" ${full ? 'aria-disabled="true" tabindex="-1"' : ''} data-link href="/kursi/${encodeURIComponent(o.trip.id)}?from=${q.from}&to=${q.to}">Pilih kursi</a>
    </div>
  </article>`;
}

export function render(main, { query }) {
  const q = { from: query.get('from') || '', to: query.get('to') || '', train: query.get('train') || '', date: query.get('date') || wibToday(1) };
  if (q.date < wibToday()) q.date = wibToday();
  const today = wibToday();
  const ready = q.from && q.to;

  main.innerHTML = `<div class="page wrap search-page">
    <div class="page-head"><div><p class="eyebrow">Cari tiket</p><h1 class="h-sm" id="title">${ready ? 'Mencari kereta...' : 'Mau ke <em>mana</em> hari ini?'}</h1>
      <p class="sub" id="subtitle">${ready ? dateLong(`${q.date}T12:00:00+07:00`) : 'Pilih stasiun asal, tujuan, dan tanggal. Nama kereta boleh dikosongkan.'}</p></div></div>
    <div class="ticket-wrap"><form class="ticket search-bar" id="search" novalidate>
      <div class="field"><label for="from">Dari</label><input class="input" id="from" placeholder="Stasiun atau kota asal" required></div>
      <button class="swap" id="swap" type="button" aria-label="Tukar asal dan tujuan">${icon.swap}</button>
      <div class="field"><label for="to">Ke</label><input class="input" id="to" placeholder="Stasiun atau kota tujuan" required></div>
      <div class="field"><label for="train">Kereta</label><select class="input sel-light" id="train"><option value="">Semua kereta</option></select></div>
      <div class="field"><label for="date">Tanggal berangkat</label><input class="input" id="date" type="date" required></div>
      <button class="btn pri sr-go" type="submit">${icon.search}<span>Cari</span></button>
      <p class="alert sb-err" id="err" role="alert" hidden></p>
    </form></div>
    <div id="results">${ready ? '' : `<div class="search-empty"><div><h2>Tip dari <em>Kiko</em></h2><ul class="tips"><li>Kursi dijual per ruas, jadi ruas pendek sering masih tersedia walau kereta ramai.</li><li>Satu pesanan bisa berisi banyak kursi sekaligus. Pilih semuanya langsung di denah.</li><li>Lansia 60 tahun ke atas mendapat potongan tarif otomatis.</li></ul></div></div>`}</div>
  </div>`;

  const from = $('#from');
  const to = $('#to');
  const trainSel = $('#train');
  const date = $('#date');
  const err = $('#err');
  date.min = today;
  date.max = wibToday(29);
  date.value = q.date;
  let stations = [];
  let trains = [];
  if (!ready) setTimeout(() => Kiko.say('Mau ke mana kita hari ini?', 2600), 900);

  const stationOptions = () => {
    const t = trains.find((x) => x.id === trainSel.value);
    return t ? stations.filter((s) => t.stationCodes.includes(s.code)) : stations;
  };
  const paintTrains = () => {
    const a = from.dataset.code; const b = to.dataset.code;
    const cur = trainSel.value;
    trainSel.innerHTML = `<option value="">Semua kereta${a && b ? ' di rute ini' : ''}</option>${trains.map((t) => {
      const ok = serves(t, a, b);
      return `<option value="${t.id}" ${ok ? '' : 'disabled'}>${esc(t.name)}${ok ? '' : ' (tidak melewati rute ini)'}</option>`;
    }).join('')}`;
    trainSel.value = trains.some((t) => t.id === cur && serves(t, a, b)) ? cur : '';
  };
  const setStation = (input, code) => {
    const s = stations.find((x) => x.code === code);
    if (s) { input.value = s.name; input.dataset.code = s.code; }
  };

  Promise.all([api('/api/stations', { noAuth: true }), api('/api/trains', { noAuth: true })]).then(([s, t]) => {
    stations = s.stations;
    trains = t.trains;
    setStation(from, q.from);
    setStation(to, q.to);
    paintTrains();
    if (q.train) trainSel.value = trains.some((x) => x.id === q.train) ? q.train : '';
  });
  const pickers = [
    combobox(from, { options: stationOptions, onPick: () => { paintTrains(); to.focus(); } }),
    combobox(to, { options: stationOptions, onPick: () => { paintTrains(); date.focus(); } }),
  ];
  trainSel.addEventListener('change', () => {
    Sound.play('pick');
    const t = trains.find((x) => x.id === trainSel.value);
    if (!t) return;
    // Stasiun yang tidak dilewati kereta terpilih dikosongkan, lalu diisi ujung rute bila masih kosong.
    [from, to].forEach((i) => { if (i.dataset.code && !t.stationCodes.includes(i.dataset.code)) { i.value = ''; delete i.dataset.code; } });
    if (!from.dataset.code) setStation(from, t.route[0].station.code);
    if (!to.dataset.code) setStation(to, t.route[t.route.length - 1].station.code === from.dataset.code ? t.route[Math.floor(t.route.length / 2)].station.code : t.route[t.route.length - 1].station.code);
  });
  $('#swap').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('turned');
    [from.value, to.value] = [to.value, from.value];
    const a = from.dataset.code; const b = to.dataset.code;
    if (b) from.dataset.code = b; else delete from.dataset.code;
    if (a) to.dataset.code = a; else delete to.dataset.code;
    Sound.play('pick');
  });

  const fail = (message, field) => {
    err.textContent = message;
    err.hidden = false;
    Kiko.react('bingung', message);
    field?.focus();
    Sound.play('fail');
  };
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    err.hidden = true;
    for (const i of [from, to]) if (!i.dataset.code) { const m = stations.find((s) => s.name.toLowerCase() === i.value.trim().toLowerCase() || s.code.toLowerCase() === i.value.trim().toLowerCase()); if (m) setStation(i, m.code); }
    if (!from.dataset.code) return fail('Pilih stasiun asal dari daftar.', from);
    if (!to.dataset.code) return fail('Pilih stasiun tujuan dari daftar.', to);
    if (from.dataset.code === to.dataset.code) return fail('Asal dan tujuan tidak boleh sama.', to);
    if (!date.value || date.value < today) return fail('Pilih tanggal berangkat mulai hari ini.', date);
    const p = new URLSearchParams({ from: from.dataset.code, to: to.dataset.code, date: date.value });
    if (trainSel.value) p.set('train', trainSel.value);
    return go(`/cari?${p}`);
  });

  if (ready) {
    const days = [-2, -1, 0, 1, 2, 3].map((d) => new Date(Date.parse(`${q.date}T12:00:00+07:00`) + d * 86400000).toISOString().slice(0, 10)).filter((d) => d >= today).slice(0, 5);
    const link = (d) => `/cari?${new URLSearchParams({ from: q.from, to: q.to, date: d, ...(q.train ? { train: q.train } : {}) })}`;
    $('#results').innerHTML = `<nav class="days" aria-label="Pilih tanggal">${days.map((d) => `<a data-link class="${d === q.date ? 'on' : ''}" ${d === q.date ? 'aria-current="date"' : ''} href="${link(d)}">${dateShort(`${d}T12:00:00+07:00`)}</a>`).join('')}</nav>
      <div id="list" aria-live="polite">${Array.from({ length: 3 }, () => '<span class="skel" style="height:148px;margin-bottom:14px"></span>').join('')}</div>`;
    Kiko.react('mikir');
    gql(Q, { from: q.from, to: q.to, date: q.date, train: q.train || null }).then(({ searchTrips: list }) => {
      if (!main.contains($('#list'))) return;
      if (!list.length) {
        $('#title').textContent = 'Belum ada kereta untuk pencarian ini';
        $('#list').innerHTML = `<div class="empty"><p>Tidak ada perjalanan yang tersisa pada tanggal tersebut${q.train ? ' untuk kereta yang dipilih' : ''}. Coba tanggal lain${q.train ? ', atau pilih Semua kereta' : ''}.</p>
          <div class="row" style="justify-content:center">${q.train ? `<a class="btn ghost" data-link href="/cari?from=${q.from}&to=${q.to}&date=${q.date}">Tampilkan semua kereta</a>` : ''}<a class="btn ghost" data-link href="/cari?from=${q.to}&to=${q.from}&date=${q.date}">Coba arah sebaliknya</a></div></div>`;
        Kiko.react('bingung', 'Hmm, belum ada kereta. Coba tanggal lain, ya.', 3400);
        return;
      }
      $('#title').innerHTML = `${esc(list[0].from.station.name)} <em>ke</em> ${esc(list[0].to.station.name)}`;
      $('#subtitle').textContent = `${dateLong(`${q.date}T12:00:00+07:00`)} · ${list.length} perjalanan`;
      $('#list').innerHTML = list.map((o, i) => row(o, i, q)).join('');
      $$('.btn.off', main).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); Kiko.react('cemas', 'Kereta ini sudah penuh di ruas Anda.'); }, true));
      Kiko.react('bangga', `Ada ${list.length} kereta. Silakan pilih.`, 2600);
    }).catch((e) => {
      if (!main.contains($('#list'))) return;
      $('#title').textContent = 'Pencarian belum berhasil';
      $('#list').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" data-link href="${location.pathname}${location.search}">Coba lagi</a></div>`;
      Kiko.react('gagal');
    });
  }

  return () => pickers.forEach((p) => p.destroy());
}
