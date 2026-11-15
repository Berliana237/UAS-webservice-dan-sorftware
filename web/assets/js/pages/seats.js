/**
 * Pilih kursi. Peta kursi dari GraphQL, perubahan didorong lewat Server-Sent Events.
 * Rangkaian 9 gerbong tampil sebagai kereta mini; denah menunjukkan arah duduk tiap baris dan pasangan kursi berhadapan.
 * Kursi yang ditahan atau terisi penumpang lain tidak bisa ditekan. Jumlah kursi per pesanan tidak dibatasi.
 */
import { $, $$, api, gql, esc, rupiah, timeOf, dateLong, go, uuid, currentUser, hasScope, flow, toast, restoreSession } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { routeStrip, steps } from '../ui.js';

const Q = `query($id:ID!,$from:String!,$to:String!){
  trip(id:$id){id trainName trainNumber status delayMinutes departureAt stops{seq departAt arriveAt km station{code name}}}
  seatMap(tripId:$id,from:$from,to:$to){fromIndex toIndex km available total seniorDiscountPercent
    coaches{adultFare available coach{code label seatClass rows letters aisleAfter rowFacing} seats{id row letter facing status segments{index status}}}}}`;
const REFRESH = `query($id:ID!,$from:String!,$to:String!){seatMap(tripId:$id,from:$from,to:$to){available coaches{available seats{id status segments{index status}}}}}`;
const CLASS = { EKONOMI: 'Ekonomi', EKSEKUTIF: 'Eksekutif', LUXURY: 'Luxury' };
const STATUS = { AVAILABLE: 'kosong', LOCKED: 'sedang ditahan penumpang lain', BOOKED: 'sudah terisi' };
const FACING = { F: 'menghadap arah laju', B: 'membelakangi arah laju' };

export function render(main, { params, query }) {
  const tripId = params.tripId;
  const from = query.get('from');
  const to = query.get('to');
  const intentKey = `seats:${tripId}:${from}:${to}`;
  let map = null;
  let trip = null;
  let coachIdx = 0;
  let es = null;
  let debounce = 0;
  let pollTimer = 0;
  // Selama kursi sedang ditahan (dan setelah halaman ditinggalkan), pembaruan peta diabaikan:
  // kursi yang baru kita kunci sendiri akan tampil "ditahan" dan tidak boleh dianggap diambil orang lain.
  let holding = false;
  let left = false;
  let idemKey = uuid();
  const selected = new Set(flow.get(intentKey) || []);

  main.innerHTML = `<div class="page wrap seats-page">
    <div class="page-head no-pad">${steps(0)}<a class="btn link" href="/cari" id="back">Kembali ke hasil</a></div>
    <div id="body"><span class="skel" style="height:460px"></span></div>
  </div>`;
  $('#back').addEventListener('click', (e) => { e.preventDefault(); history.length > 1 ? history.back() : go('/cari'); });
  Kiko.react('mikir');

  const seatById = (id) => { for (const c of map.coaches) { const s = c.seats.find((x) => x.id === id); if (s) return { seat: s, coach: c }; } return null; };
  const total = () => [...selected].reduce((n, id) => n + (seatById(id)?.coach.adultFare || 0), 0);
  const persist = () => flow.set(intentKey, [...selected]);
  const short = (c) => `${c.coach.seatClass === 'LUXURY' ? (c.coach.code.startsWith('PAN') ? 'P' : 'L') : c.coach.code.startsWith('EKP') ? 'EP' : c.coach.seatClass === 'EKONOMI' ? 'K' : 'E'}${c.coach.code.slice(3)}`;

  function seatBtn(s, c) {
    const sel = selected.has(s.id);
    const partial = s.status === 'AVAILABLE' && s.segments.length > 0;
    const state = sel ? 'sel' : s.status.toLowerCase();
    const off = s.status !== 'AVAILABLE' && !sel;
    return `<button type="button" class="seat ${state} ${partial ? 'part' : ''} face-${s.facing}" data-id="${s.id}" ${off ? 'disabled' : ''} aria-pressed="${sel}"
      aria-label="Kursi ${s.row}${s.letter}, ${CLASS[c.coach.seatClass]}, ${FACING[s.facing]}, ${sel ? 'dipilih' : STATUS[s.status]}${partial ? ', terpakai di ruas lain' : ''}"><span>${s.row}${s.letter}</span></button>`;
  }

  /** Satu kolom = satu baris kursi. Huruf sebelum lorong di atas, sesudahnya di bawah. */
  function coachPlan(c) {
    const { rows, letters, aisleAfter, rowFacing } = c.coach;
    const at = (r, l) => c.seats.find((s) => s.row === r && s.letter === l);
    const col = (r) => `<div class="col">${letters.map((l, i) => `${i === aisleAfter ? `<span class="row-no mono" aria-hidden="true">${r}</span>` : ''}${seatBtn(at(r, l), c)}`).join('')}</div>`;
    let html = '';
    for (let r = 1; r <= rows; r++) {
      if (rowFacing[r - 1] === 'F' && rowFacing[r] === 'B') {
        html += `<div class="pair" title="Baris ${r} dan ${r + 1} saling berhadapan">${col(r)}<i class="pair-table" aria-hidden="true"></i>${col(r + 1)}<span class="pair-tag">berhadapan</span></div>`;
        r += 1;
      } else html += col(r);
    }
    const oneWay = rowFacing.every((f) => f === 'F');
    return `<div class="car ${c.coach.seatClass.toLowerCase()}" role="group" aria-label="${esc(c.coach.label)}, ${rows} baris, ${letters.length} kursi per baris">
      <div class="car-end l"><i>Pintu</i></div>
      <div class="car-seats">${html}</div>
      <div class="car-end r"><i>Pintu</i></div>
    </div>
    <p class="plan-note muted">${oneWay ? 'Semua kursi di gerbong ini menghadap arah laju kereta.' : 'Garis tebal pada kursi adalah sandaran. Kursi di tengah gerbong ditandai bila saling berhadapan, cocok untuk keluarga.'}</p>`;
  }

  function trainStrip() {
    return `<div class="consist" role="tablist" aria-label="Pilih gerbong. Arah laju ke kanan">
      ${map.coaches.map((c, i) => {
    const mine = [...selected].filter((id) => id.startsWith(`${c.coach.code}-`)).length;
    return `<button class="car-tab ${c.coach.seatClass.toLowerCase()} ${i === coachIdx ? 'on' : ''}" role="tab" type="button" data-c="${i}" aria-selected="${i === coachIdx}" aria-label="${esc(c.coach.label)}, ${c.available} kursi kosong${mine ? `, ${mine} dipilih` : ''}">
        <b>${short(c)}</b><small>${c.available}</small>${mine ? `<em>${mine}</em>` : ''}</button>`;
  }).join('')}
      <span class="loco" aria-hidden="true"></span>
    </div>`;
  }

  function summary() {
    const n = selected.size;
    const list = [...selected].map((id) => {
      const hit = seatById(id);
      return `<li><b class="mono">${esc(id.split('-')[1])}</b><span>${esc(hit?.coach.coach.label || '')}<small class="muted">${FACING[hit?.seat.facing] || ''}</small></span><span class="mono r">${rupiah(hit?.coach.adultFare)}</span><button type="button" class="x" data-un="${id}" aria-label="Lepas kursi ${esc(id)}">&times;</button></li>`;
    }).join('');
    const a = trip.stops[map.fromIndex];
    const b = trip.stops[map.toIndex];
    $('#summary').innerHTML = `
      <div class="sum-head"><p class="eyebrow">${esc(trip.trainName)} · ${esc(trip.trainNumber)}</p>
        <h2 class="sum-route">${esc(a.station.name)} <em>ke</em> ${esc(b.station.name)}</h2>
        <p class="muted mono">${timeOf(a.departAt)} &rarr; ${timeOf(b.arriveAt)} · ${map.km} km</p><p class="muted">${dateLong(a.departAt)}</p></div>
      <div class="perf"></div>
      <div class="sum-body">
        ${n ? `<ul class="sum-list">${list}</ul>` : '<p class="muted sum-empty">Tekan kursi kosong pada denah. Anda bisa memilih banyak kursi sekaligus, dari gerbong mana saja.</p>'}
        <div class="sum-meter"><span>${n} kursi dipilih</span></div>
        <div class="sum-total"><span>Perkiraan total</span><b class="mono">${rupiah(total())}</b></div>
        <p class="sum-note muted">Harga dewasa. Lansia otomatis mendapat potongan ${map.seniorDiscountPercent}% saat data penumpang diisi.</p>
        <p class="alert" id="sum-err" role="alert" hidden></p>
        <button class="btn pri block" id="hold" ${n === 0 ? 'disabled' : ''}>${n === 0 ? 'Pilih kursi dulu' : `Tahan ${n} kursi`}</button>
        <p class="sum-foot muted">Kursi aman selama 10 menit selagi Anda mengisi data dan membayar.</p>
      </div>`;
    $('#hold').addEventListener('click', hold);
  }

  function paintSeats() {
    $('#plan').innerHTML = coachPlan(map.coaches[coachIdx]);
    $('#consist').innerHTML = trainStrip();
    $('#coach-name').innerHTML = `${esc(map.coaches[coachIdx].coach.label)} <small class="muted">· ${map.coaches[coachIdx].available} kosong · ${rupiah(map.coaches[coachIdx].adultFare)}</small>`;
    summary();
  }

  function layout() {
    $('#body').innerHTML = `
      <div class="seat-layout">
        <div class="seat-main">
          <div class="seat-route">${routeStrip(trip.stops, map.fromIndex, map.toIndex, { compact: true })}</div>
          <div class="consist-wrap"><div id="consist"></div><span class="dir-tag">Arah laju &rarr;</span></div>
          <h2 class="coach-name" id="coach-name"></h2>
          <div class="plan-wrap"><div id="plan"></div></div>
          <div class="seat-info" id="seat-info" aria-live="polite"><span class="muted">Arahkan atau fokuskan kursi untuk melihat status tiap ruas.</span></div>
          <ul class="legend" aria-label="Keterangan kursi">
            <li><i class="seat-k available"></i>Kosong</li><li><i class="seat-k sel"></i>Pilihan Anda</li><li><i class="seat-k locked"></i>Ditahan orang lain</li><li><i class="seat-k booked"></i>Terisi</li>
            <li><i class="seat-k available part"></i>Terpakai di ruas lain, kosong di ruas Anda</li>
            <li class="live" id="live"><i></i><span>Menghubungkan...</span></li>
          </ul>
        </div>
        <aside class="ticket-wrap seat-side"><div class="ticket" id="summary" style="--n:168px"></div></aside>
      </div>`;
    $('#consist').addEventListener('click', (e) => {
      const t = e.target.closest('.car-tab');
      if (!t) return;
      coachIdx = Number(t.dataset.c);
      const plan = $('#plan');
      plan.classList.remove('shunt');
      void plan.offsetWidth;
      plan.classList.add('shunt');
      paintSeats();
      Sound.play('flap');
      $(`.car-tab[data-c="${coachIdx}"]`)?.focus();
    });
    $('#consist').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      coachIdx = (coachIdx + (e.key === 'ArrowRight' ? 1 : -1) + map.coaches.length) % map.coaches.length;
      paintSeats();
      $(`.car-tab[data-c="${coachIdx}"]`)?.focus();
    });
    $('#plan').addEventListener('click', onSeat);
    $('#plan').addEventListener('pointerover', (e) => { const b = e.target.closest('.seat'); if (b) showInfo(b.dataset.id); });
    $('#plan').addEventListener('focusin', (e) => { const b = e.target.closest('.seat'); if (b) showInfo(b.dataset.id); });
    $('#plan').addEventListener('keydown', arrowKeys);
    $('#summary').addEventListener('click', (e) => { const u = e.target.closest('[data-un]'); if (u) unpick(u.dataset.un); });
    paintSeats();
  }

  function showInfo(id) {
    const hit = seatById(id);
    if (!hit) return;
    const n = trip.stops.length - 1;
    const bars = Array.from({ length: n }, (_, i) => {
      const seg = hit.seat.segments.find((s) => s.index === i);
      const mine = i >= map.fromIndex && i < map.toIndex;
      return `<i class="${seg ? seg.status.toLowerCase() : 'free'} ${mine ? 'mine' : ''}" title="${esc(trip.stops[i].station.name)} ke ${esc(trip.stops[i + 1].station.name)}"></i>`;
    }).join('');
    const st = selected.has(id) ? 'Pilihan Anda' : hit.seat.status === 'AVAILABLE' ? (hit.seat.segments.length ? 'Kosong di ruas Anda' : 'Kosong di seluruh rute') : hit.seat.status === 'LOCKED' ? 'Sedang ditahan penumpang lain' : 'Terisi pada ruas ini';
    $('#seat-info').innerHTML = `<b class="mono">${esc(hit.seat.row)}${esc(hit.seat.letter)}</b><span class="seg-bar" aria-hidden="true">${bars}</span><span>${st}</span><span class="muted">· ${FACING[hit.seat.facing]}</span>`;
  }

  function pick(id, btn) {
    selected.add(id);
    persist();
    idemKey = uuid();
    Sound.play('pick');
    Kiko.react('pilih', null, 1400);
    btn?.classList.add('pop');
    paintSeats();
    $(`.seat[data-id="${id}"]`)?.focus();
  }
  function unpick(id) {
    selected.delete(id);
    persist();
    idemKey = uuid();
    Sound.play('unpick');
    paintSeats();
  }
  function onSeat(e) {
    const b = e.target.closest('.seat');
    if (!b || b.disabled) return;
    if (selected.has(b.dataset.id)) { unpick(b.dataset.id); $(`.seat[data-id="${b.dataset.id}"]`)?.focus(); return; }
    pick(b.dataset.id, b);
  }
  function arrowKeys(e) {
    const k = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'd', ArrowUp: 'u' }[e.key];
    const b = e.target.closest('.seat');
    if (!k || !b) return;
    e.preventDefault();
    const cols = $$('.col', $('#plan'));
    const ci = cols.findIndex((c) => c.contains(b));
    const inCol = $$('.seat', cols[ci]);
    const si = inCol.indexOf(b);
    const target = typeof k === 'number' ? $$('.seat', cols[ci + k] || cols[ci])[si] : inCol[si + (k === 'd' ? 1 : -1)];
    (target && !target.disabled ? target : null)?.focus();
  }

  async function hold() {
    const btn = $('#hold');
    const err = $('#sum-err');
    err.hidden = true;
    await restoreSession();
    if (!currentUser()) {
      persist();
      Kiko.react('pilih', 'Masuk dulu, ya. Pilihan kursi Anda saya simpan.', 2400);
      go(`/masuk?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!hasScope('booking:write')) { err.textContent = 'Akun ini tidak bisa memesan tiket. Gunakan akun pelanggan.'; err.hidden = false; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Menahan kursi';
    Kiko.react('mikir');
    holding = true;
    try {
      const lock = await api('/api/locks', { method: 'POST', idem: idemKey, body: { tripId, from, to, seats: [...selected] } });
      flow.del(intentKey);
      Sound.play('lock');
      Kiko.react('bangga', 'Kursi terkunci! Isi data penumpang, ya.', 2200);
      go(`/pesanan/${lock.id}`);
    } catch (e) {
      holding = false;
      idemKey = uuid();
      if (e.code === 'SEAT_CONFLICT') {
        const lost = [...new Set((e.details?.conflicts || []).map((c) => c.seatId))];
        lost.forEach((s) => selected.delete(s));
        persist();
        await refreshMap();
        const box = $('#sum-err');
        box.textContent = `Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} baru saja diambil penumpang lain. Silakan pilih kursi lain.`;
        box.hidden = false;
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

  async function refreshMap() {
    if (holding || left) return;
    const { seatMap } = await gql(REFRESH, { id: tripId, from, to });
    if (holding || left) return;
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
      persist();
      Kiko.react('awas', `Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} baru diambil orang lain.`, 3000);
      toast(`Kursi ${lost.map((s) => s.split('-')[1]).join(', ')} diambil penumpang lain, pilihan dilepas.`, 'warn');
    }
    const focused = document.activeElement?.dataset?.id;
    paintSeats();
    if (focused) $(`.seat[data-id="${focused}"]`)?.focus();
  }
  function setLive(on) {
    const l = $('#live');
    if (!l) return;
    l.classList.toggle('on', on);
    l.querySelector('span').textContent = on ? 'Diperbarui langsung' : 'Memperbarui berkala';
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
    for (const id of [...selected]) if (seatById(id)?.seat.status !== 'AVAILABLE') selected.delete(id);
    const firstSel = [...selected][0];
    coachIdx = firstSel ? Math.max(0, map.coaches.findIndex((c) => firstSel.startsWith(`${c.coach.code}-`))) : Math.max(0, map.coaches.findIndex((c) => c.available > 0));
    layout();
    connect();
    Kiko.react('halo', selected.size ? 'Pilihan kursi Anda masih saya simpan.' : 'Pilih kursi sebanyak yang Anda perlukan. Huruf A dan D dekat jendela.', 3600);
  }).catch((e) => {
    if (!main.contains($('#body'))) return;
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/cari" data-link>Kembali ke pencarian</a></div>`;
    Kiko.react('gagal');
  });

  return () => { left = true; es?.close(); clearTimeout(debounce); clearInterval(pollTimer); };
}
