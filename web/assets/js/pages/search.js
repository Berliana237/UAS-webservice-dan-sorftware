/** Hasil pencarian: daftar singkat, satu tombol per baris, dan perpindahan tanggal cepat. */
import { $, $$, gql, esc, rupiah, timeOf, duration, dateLong, dateShort, wibToday, go } from '../core.js';
import { Kiko } from '../kiko.js';

const Q = `query($from:String!,$to:String!,$date:String!){searchTrips(from:$from,to:$to,date:$date){
  trip{id trainName status delayMinutes} from{departAt station{code name}} to{arriveAt station{code name}}
  durationMinutes km stopsBetween availableSeats totalSeats fares{seatClass adult}}}`;
const CLASS = { SUITE: 'Suite', EKSEKUTIF: 'Eksekutif', PREMIUM: 'Premium' };

function row(o, i, pax, query) {
  const cheapest = Math.min(...o.fares.map((f) => f.adult));
  const low = o.availableSeats < 12;
  const sold = o.availableSeats < pax;
  const delayed = o.trip.status === 'DELAYED';
  return `<article class="trip reveal" style="--i:${i}">
    <div class="trip-time">
      <div><b class="mono">${timeOf(o.from.departAt)}</b><span>${esc(o.from.station.name)}</span></div>
      <div class="trip-line" aria-hidden="true"><i></i><small>${duration(o.durationMinutes)}${o.stopsBetween ? ` · ${o.stopsBetween} henti` : ' · langsung'}</small></div>
      <div class="end"><b class="mono">${timeOf(o.to.arriveAt)}</b><span>${esc(o.to.station.name)}</span></div>
    </div>
    <div class="trip-train">
      <h3>${esc(o.trip.trainName)}</h3>
      <p class="muted">${o.km} km${delayed ? ` · <span class="late">terlambat ${o.trip.delayMinutes} menit</span>` : ''}</p>
      <ul class="fares">${o.fares.map((f) => `<li><span>${CLASS[f.seatClass]}</span><b class="mono">${rupiah(f.adult)}</b></li>`).join('')}</ul>
    </div>
    <div class="trip-go">
      <p class="from">mulai <b class="mono">${rupiah(cheapest)}</b></p>
      <p class="seats ${low ? 'low' : ''}">${sold ? 'Kursi tidak cukup' : `${o.availableSeats} kursi kosong`}</p>
      <a class="btn gold ${sold ? 'off' : ''}" ${sold ? 'aria-disabled="true"' : ''} data-link href="/kursi/${encodeURIComponent(o.trip.id)}?from=${query.get('from')}&to=${query.get('to')}&pax=${pax}">Pilih kursi</a>
    </div>
  </article>`;
}

export function render(main, { query }) {
  const from = query.get('from');
  const to = query.get('to');
  const date = query.get('date') || wibToday(1);
  const pax = Math.min(4, Math.max(1, Number(query.get('pax')) || 1));
  if (!from || !to) { go('/', { replace: true }); return undefined; }

  const today = wibToday();
  const days = [-1, 0, 1, 2, 3].map((d) => new Date(Date.parse(`${date}T12:00:00+07:00`) + d * 86400000).toISOString().slice(0, 10)).filter((d) => d >= today);

  main.innerHTML = `<div class="page wrap">
    <div class="page-head">
      <div><h1 class="h-sm" id="title">Mencari kereta...</h1><p class="sub">${dateLong(`${date}T12:00:00+07:00`)} · ${pax} penumpang</p></div>
      <a class="btn ghost" href="/" data-link>Ubah pencarian</a>
    </div>
    <nav class="days" aria-label="Pilih tanggal">${days.map((d) => `<a data-link class="${d === date ? 'on' : ''}" ${d === date ? 'aria-current="date"' : ''} href="/cari?from=${from}&to=${to}&date=${d}&pax=${pax}">${dateShort(`${d}T12:00:00+07:00`)}</a>`).join('')}</nav>
    <div id="list" aria-live="polite">${Array.from({ length: 3 }, () => '<span class="skel" style="height:148px;margin-bottom:14px"></span>').join('')}</div>
  </div>`;
  Kiko.react('mikir');

  gql(Q, { from, to, date }).then(({ searchTrips: list }) => {
    if (!main.contains($('#list'))) return;
    if (!list.length) {
      $('#title').textContent = 'Belum ada kereta di tanggal ini';
      $('#list').innerHTML = `<div class="empty"><p>Tidak ada perjalanan yang melewati rute ini pada tanggal tersebut. Coba tanggal lain, atau balik arah stasiun asal dan tujuan.</p><a class="btn ghost" href="/cari?from=${to}&to=${from}&date=${date}&pax=${pax}" data-link>Coba arah sebaliknya</a></div>`;
      Kiko.react('bingung', 'Hmm, belum ada kereta. Coba tanggal lain, ya.', 3400);
      return;
    }
    $('#title').innerHTML = `${esc(list[0].from.station.name)} <em>ke</em> ${esc(list[0].to.station.name)}`;
    $('#list').innerHTML = list.map((o, i) => row(o, i, pax, query)).join('');
    $$('.btn.off', main).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); Kiko.react('cemas', 'Kursi di kereta ini tidak cukup untuk rombongan Anda.'); }, true));
    Kiko.react('bangga', `Ada ${list.length} kereta. Silakan pilih.`, 2600);
  }).catch((e) => {
    if (!main.contains($('#list'))) return;
    $('#title').textContent = 'Pencarian belum berhasil';
    $('#list').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" data-link href="${location.pathname}${location.search}">Coba lagi</a></div>`;
    Kiko.react('gagal');
  });
}
