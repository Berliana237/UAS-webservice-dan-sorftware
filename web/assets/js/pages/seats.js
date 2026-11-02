/**
 * Pilih kursi. Peta kursi datang dari GraphQL, perubahan didorong lewat Server-Sent Events.
 * Bila kursi yang sedang dipilih diambil orang lain, pilihan dilepas dan pengguna langsung diberi tahu.
 */
import { $, $$, api, gql, esc, rupiah, timeOf, go, uuid, currentUser, hasScope, flow, toast, restoreSession } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { routeStrip, steps } from '../ui.js';

const Q = `query($id:ID!,$from:String!,$to:String!){
  trip(id:$id){id trainName status departureAt stops{seq departAt arriveAt km station{code name}}}
  seatMap(tripId:$id,from:$from,to:$to){fromIndex toIndex km available total
    coaches{adultFare available coach{code name seatClass rows letters} seats{id row letter status segments{index status}}}}}`;
const REFRESH = `query($id:ID!,$from:String!,$to:String!){seatMap(tripId:$id,from:$from,to:$to){available coaches{code:adultFare available coach{code} seats{id status segments{index status}}}}}`;
const CLASS = { SUITE: 'Suite', EKSEKUTIF: 'Eksekutif', PREMIUM: 'Premium' };
const STATUS = { AVAILABLE: 'kosong', LOCKED: 'sedang ditahan', BOOKED: 'terisi' };

export function render(main, { params, query }) {
  const tripId = params.tripId;
  const from = query.get('from');
  const to = query.get('to');
  const pax = Math.min(4, Math.max(1, Number(query.get('pax')) || 1));
  const intentKey = `seats:${tripId}:${from}:${to}`;
  let map = null;
  let trip = null;
  let coachIdx = 0;
  let es = null;
  let debounce = 0;
  let pollTimer = 0;
  let idemKey = uuid();
  const selected = new Map((flow.get(intentKey) || []).map((s) => [s, null]));

  main.innerHTML = `<div class="page wrap seats-page">
    <div class="page-head no-pad">${steps(0)}<a class="btn link" href="javascript:history.back()" id="back">Kembali</a></div>
    <div id="body"><span class="skel" style="height:420px"></span></div>
  </div>`;
  $('#back').addEventListener('click', (e) => { e.preventDefault(); history.back(); });
  Kiko.react('mikir');

  const seatById = (id) => { for (const c of map.coaches) { const s = c.seats.find((x) => x.id === id); if (s) return { seat: s, coach: c }; } return null; };
  const total = () => [...selected.keys()].reduce((n, id) => n + (seatById(id)?.coach.adultFare || 0), 0);

  function seatBtn(s, coach) {
    const sel = selected.has(s.id);
    const partial = s.status === 'AVAILABLE' && s.segments.length > 0;
    const state = sel ? 'sel' : s.status.toLowerCase();
    return `<button type="button" class="seat ${state} ${partial ? 'part' : ''}" data-id="${s.id}" ${s.status !== 'AVAILABLE' ? 'aria-disabled="true"' : ''} aria-pressed="${sel}"
      aria-label="Kursi ${s.row}${s.letter} ${CLASS[coach.coach.seatClass]}, ${sel ? 'dipilih' : STATUS[s.status]}${partial ? ', terpakai di ruas lain' : ''}"><span>${s.row}${s.letter}</span></button>`;
  }

  function coachPlan(c) {
    const { rows, letters } = c.coach;
    const half = letters.length / 2;
    const col = (l) => c.seats.filter((s) => s.letter === l);
    const lane = (l) => `<div class="lane">${col(l).map((s) => seatBtn(s, c)).join('')}</div>`;
    return `<div class="car" role="group" aria-label="${esc(c.coach.name)}, ${rows} baris" style="--rows:${rows}">
      <div class="car-end l"><i>Pintu</i></div>
      <div class="car-seats">${letters.slice(0, half).map(lane).join('')}<div class="aisle"><span>Lorong</span></div>${letters.slice(half).map(lane).join('')}</div>
      <div class="car-end r"><i>Pintu</i></div>
    </div>`;
  }

  function summary() {
    const n = selected.size;
    const list = [...selected.keys()].map((id) => {
      const hit = seatById(id);
      return `<li><b class="mono">${esc(id.split('-')[1])}</b><span>${esc(hit?.coach.coach.name || '')}</span><span class="mono r">${rupiah(hit?.coach.adultFare)}</span><button type="button" class="x" data-un="${id}" aria-label="Lepas kursi ${esc(id)}">&times;</button></li>`;
    }).join('');
    const a = trip.stops[map.fromIndex];
    const b = trip.stops[map.toIndex];
    $('#summary').innerHTML = `
      <div class="sum-head"><p class="eyebrow">${esc(trip.trainName)}</p>
        <h2 class="sum-route">${esc(a.station.name)} <em>ke</em> ${esc(b.station.name)}</h2>
        <p class="muted mono">${timeOf(a.departAt)} &rarr; ${timeOf(b.arriveAt)} · ${map.km} km</p></div>
      <div class="perf"></div>
      <div class="sum-body">
        ${n ? `<ul class="sum-list">${list}</ul>` : `<p class="muted sum-empty">Pilih ${pax} kursi pada denah. Tekan sekali lagi untuk melepas.</p>`}
        <div class="sum-total"><span>Perkiraan total</span><b class="mono">${rupiah(total())}</b></div>
        <p class="sum-note muted">Harga dewasa. Harga akhir dihitung dari usia penumpang.</p>
        <p class="alert" id="sum-err" role="alert" hidden></p>
        <button class="btn pri block" id="hold" ${n === 0 ? 'disabled' : ''}>${n === 0 ? 'Pilih kursi dulu' : n < pax ? `Tahan ${n} dari ${pax} kursi` : `Tahan ${n} kursi`}</button>
        <p class="sum-foot muted">Kursi aman selama 10 menit selagi Anda mengisi data dan membayar.</p>
      </div>`;
    $('#hold').addEventListener('click', hold);
  }

  function paintSeats() {
    const c = map.coaches[coachIdx];
    $('#plan').innerHTML = coachPlan(c);
    $$('.tab', main).forEach((t, i) => {
      t.classList.toggle('on', i === coachIdx);
      t.setAttribute('aria-selected', String(i === coachIdx));
      t.querySelector('small').textContent = `${map.coaches[i].available} kosong`;
    });
    summary();
  }

  function layout() {
    $('#body').innerHTML = `
      <div class="seat-layout">
        <div class="seat-main">
          <div class="seat-route">${routeStrip(trip.stops, map.fromIndex, map.toIndex, { compact: true })}</div>
          <div class="seat-tools">
            <div class="tabs" role="tablist" aria-label="Pilih gerbong">${map.coaches.map((c, i) => `<button class="tab" role="tab" type="button" data-c="${i}"><b>${esc(c.coach.name)}</b><small></small><em class="mono">${rupiah(c.adultFare)}</em></button>`).join('')}</div>
          </div>
          <div class="plan-wrap"><div id="plan"></div></div>
          <div class="seat-info" id="seat-info" aria-live="polite"></div>
          <ul class="legend" aria-label="Keterangan warna kursi">
            <li><i class="seat-k available"></i>Kosong</li><li><i class="seat-k sel"></i>Pilihan Anda</li><li><i class="seat-k locked"></i>Sedang ditahan</li><li><i class="seat-k booked"></i>Terisi</li>
            <li><i class="seat-k available part"></i>Kosong di ruas Anda, terpakai di ruas lain</li>
            <li class="live" id="live"><i></i><span>Menghubungkan...</span></li>
          </ul>
        </div>
        <aside class="ticket-wrap seat-side"><div class="ticket" id="summary" style="--n:148px"></div></aside>
      </div>`;
    $$('.tab', main).forEach((t) => t.addEventListener('click', () => {
      coachIdx = Number(t.dataset.c);
      const plan = $('#plan');
      plan.classList.remove('shunt');
      void plan.offsetWidth;
      plan.classList.add('shunt');
      paintSeats();
      Sound.play('flap');
    }));
    $('#plan').addEventListener('click', onSeat);
    $('#plan').addEventListener('pointerover', (e) => { const b = e.target.closest('.seat'); if (b) showInfo(b.dataset.id); });
    $('#plan').addEventListener('focusin', (e) => { const b = e.target.closest('.seat'); if (b) showInfo(b.dataset.id); });
    $('#plan').addEventListener('keydown', arrowKeys);
    $('#summary').addEventListener('click', (e) => { const u = e.target.closest('[data-un]'); if (u) unpick(u.dataset.un); });
    paintSeats();
  }

  /* Status kursi per ruas pada keterangan bawah denah */
  function showInfo(id) {
    const hit = seatById(id);
    if (!hit) return;
    const n = trip.stops.length - 1;
    const bars = Array.from({ length: n }, (_, i) => {
      const seg = hit.seat.segments.find((s) => s.index === i);
      const mine = i >= map.fromIndex && i < map.toIndex;
      return `<i class="${seg ? seg.status.toLowerCase() : 'free'} ${mine ? 'mine' : ''}" title="${esc(trip.stops[i].station.name)} ke ${esc(trip.stops[i + 1].station.name)}"></i>`;
    }).join('');
    $('#seat-info').innerHTML = `<b class="mono">${esc(hit.seat.row)}${esc(hit.seat.letter)}</b><span class="seg-bar" aria-hidden="true">${bars}</span><span class="muted">${selected.has(id) ? 'Pilihan Anda' : hit.seat.status === 'AVAILABLE' ? (hit.seat.segments.length ? 'Kosong di ruas Anda' : 'Kosong di seluruh rute') : hit.seat.status === 'LOCKED' ? 'Sedang ditahan penumpang lain' : 'Terisi pada ruas ini'}</span>`;
  }

  function pick(id, btn) {
    if (selected.size >= pax) {
      const oldest = selected.keys().next().value;
      selected.delete(oldest);
      toast(`Kursi ${oldest.split('-')[1]} diganti, karena Anda memesan ${pax} kursi.`);
    }
    selected.set(id, null);
    flow.set(intentKey, [...selected.keys()]);
    idemKey = uuid();
    Sound.play('pick');
    Kiko.react('pilih', selected.size === pax ? 'Pas! Tekan Tahan supaya kursinya aman.' : null, 1400);
    btn?.classList.add('pop');
    paintSeats();
  }
  function unpick(id) {
    selected.delete(id);
    flow.set(intentKey, [...selected.keys()]);
    idemKey = uuid();
    Sound.play('unpick');
    paintSeats();
  }
  function onSeat(e) {
    const b = e.target.closest('.seat');
    if (!b) return;
    const hit = seatById(b.dataset.id);
    if (!hit) return;
    if (selected.has(b.dataset.id)) return unpick(b.dataset.id);
    if (hit.seat.status !== 'AVAILABLE') {
      Kiko.react('cemas', hit.seat.status === 'LOCKED' ? 'Kursi ini sedang ditahan. Bisa kosong lagi kalau tidak dibayar.' : 'Kursi ini sudah terisi di ruas Anda.', 2600);
      Sound.play('unpick');
      return undefined;
    }
    return pick(b.dataset.id, b);
  }
  function arrowKeys(e) {
    const k = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    const b = e.target.closest('.seat');
    if (!k || !b) return;
    e.preventDefault();
    const lanes = $$('.lane', main);
    const li = lanes.findIndex((l) => l.contains(b));
    const si = $$('.seat', lanes[li]).indexOf(b);
    const target = $$('.seat', lanes[li + k[1]] || lanes[li])[si + k[0]];
    target?.focus();
  }

  /* Tahan kursi */
  async function hold() {
    const btn = $('#hold');
    const err = $('#sum-err');
    err.hidden = true;
    await restoreSession();
    if (!currentUser()) {
      flow.set(intentKey, [...selected.keys()]);
      Kiko.react('pilih', 'Masuk dulu, ya. Pilihan kursi Anda saya simpan.', 2400);
      go(`/masuk?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!hasScope('booking:write')) { err.textContent = 'Akun ini tidak bisa memesan. Gunakan akun pelanggan.'; err.hidden = false; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Menahan kursi';
    Kiko.react('mikir');
    try {
      const lock = await api('/api/locks', { method: 'POST', idem: idemKey, body: { tripId, from, to, seats: [...selected.keys()] } });
      flow.del(intentKey);
      Sound.play('lock');
      Kiko.react('bangga', 'Kursi terkunci! Isi data penumpang, ya.', 2200);
      go(`/pesanan/${lock.id}`);
    } catch (e) {
      idemKey = uuid();
      if (e.code === 'SEAT_CONFLICT') {
        const lost = [...new Set((e.details?.conflicts || []).map((c) => c.seatId))];
        lost.forEach((s) => selected.delete(s));
        flow.set(intentKey, [...selected.keys()]);
        await refreshMap();
        err.textContent = `Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} baru saja diambil penumpang lain. Silakan pilih kursi lain.`;
        $('#sum-err').textContent = err.textContent;
        $('#sum-err').hidden = false;
        Kiko.react('gagal', 'Yah, keduluan! Kursi lain masih banyak, kok.', 3200);
      } else {
        summary();
        const box = $('#sum-err');
        box.textContent = e.code === 'RATE_LIMITED' ? 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.' : e.message;
        box.hidden = false;
        Kiko.react('gagal');
      }
    }
  }

  /* Pembaruan langsung */
  async function refreshMap() {
    const { seatMap } = await gql(REFRESH, { id: tripId, from, to });
    const lost = [];
    seatMap.coaches.forEach((c, i) => {
      map.coaches[i].available = c.available;
      c.seats.forEach((s, j) => {
        const cur = map.coaches[i].seats[j];
        cur.status = s.status;
        cur.segments = s.segments;
        if (selected.has(s.id) && s.status !== 'AVAILABLE') lost.push(s.id);
      });
    });
    map.available = seatMap.available;
    lost.forEach((id) => selected.delete(id));
    if (lost.length) {
      flow.set(intentKey, [...selected.keys()]);
      Kiko.react('awas', `Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} baru diambil orang lain.`, 3000);
      toast(`Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} diambil penumpang lain, pilihan dilepas.`, 'warn');
    }
    paintSeats();
  }
  function setLive(on) {
    const l = $('#live');
    if (!l) return;
    l.classList.toggle('on', on);
    l.querySelector('span').textContent = on ? 'Langsung' : 'Memperbarui berkala';
  }
  function connect() {
    es = new EventSource(`/api/trips/${encodeURIComponent(tripId)}/seats/stream`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('seat', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => refreshMap().catch(() => {}), 180);
    });
    pollTimer = setInterval(() => { if (!document.hidden && es.readyState !== 1) refreshMap().catch(() => {}); }, 8000);
  }

  gql(Q, { id: tripId, from, to }).then((d) => {
    if (!main.contains($('#body'))) return;
    if (!d.trip) throw new Error('Perjalanan tidak ditemukan.');
    trip = d.trip;
    map = d.seatMap;
    for (const id of [...selected.keys()]) if (seatById(id)?.seat.status !== 'AVAILABLE') selected.delete(id);
    coachIdx = Math.max(0, map.coaches.findIndex((c) => c.coach.seatClass === 'EKSEKUTIF'));
    layout();
    connect();
    Kiko.react('halo', selected.size ? 'Pilihan kursi Anda masih saya simpan.' : `Pilih ${pax} kursi, ya. Dekat jendela huruf A dan D.`, 3600);
  }).catch((e) => {
    if (!main.contains($('#body'))) return;
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/" data-link>Kembali ke pencarian</a></div>`;
    Kiko.react('gagal');
  });

  return () => { es?.close(); clearTimeout(debounce); clearInterval(pollTimer); };
}
