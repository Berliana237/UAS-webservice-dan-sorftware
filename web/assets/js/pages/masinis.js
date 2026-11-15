/**
 * Panel masinis: dasbor (dinas berikutnya, perjalanan hari ini, periksa karcis, lapor keterlambatan)
 * dan jadwal dinas (hari, tanggal, jam, kereta, rute) dengan manifest penumpang per perjalanan.
 * Masinis hanya melihat perjalanan yang ditugaskan kepadanya.
 */
import { $, $$, api, esc, timeOf, dateNum, dayName, dateLong, toast, confirmDialog, go, currentUser, wibToday, duration } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { icon } from '../ui.js';
import { pill } from './pay-kit.js';
import { periodFilter } from '../period.js';

const PHASE = { UPCOMING: ['Akan berangkat', 'info'], ON_TRIP: ['Dalam perjalanan', 'wait'], COMPLETED: ['Selesai', 'mute'] };
const STATUS = { SCHEDULED: ['Tepat waktu', 'ok'], DELAYED: ['Terlambat', 'wait'], CANCELLED: ['Dibatalkan', 'bad'] };
const NAV = [['', 'Dasbor', icon.grid], ['jadwal', 'Jadwal Dinas', icon.cal]];
const route = (t) => `${t.stops[0].station.name} &rarr; ${t.stops[t.stops.length - 1].station.name}`;
const arrive = (t) => t.stops[t.stops.length - 1].arriveAt;
const mins = (t) => Math.round((Date.parse(arrive(t)) - Date.parse(t.departureAt)) / 60000);
const plusDays = (n) => new Date(Date.now() + 7 * 3600000 + n * 86400000).toISOString().slice(0, 10);

function sheet(title, html) {
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div class="sheet-in wide" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Tutup">${icon.x}</button></div><div class="sheet-body">${html}</div></div>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  setTimeout(() => $('[data-close]', el)?.focus(), 50);
  return { el, body: $('.sheet-body', el), close };
}

/** Manifest kini halaman penuh berbentuk denah kursi. Tombol Manifest di mana pun membuka halaman itu. */
function manifest(t) { go(`/masinis/perjalanan/${encodeURIComponent(t.id)}`); }

const PAX_TYPE = { INFANT: 'Bayi', CHILD: 'Anak', ADULT: 'Dewasa', SENIOR: 'Lansia' };
const SHORT = (c) => `${c.coach.seatClass === 'LUXURY' ? (c.coach.code.startsWith('PAN') ? 'P' : 'L') : c.coach.code.startsWith('EKP') ? 'EP' : c.coach.seatClass === 'EKONOMI' ? 'K' : 'E'}${c.coach.code.slice(3)}`;

/**
 * Manifest per perjalanan: denah gerbong dan kursi. Kursi berpenumpang bisa ditekan untuk melihat siapa yang duduk,
 * dan kursi lain yang dipesan oleh akun yang sama ikut disorot. Daftar penumpang memakai nama penumpang.
 */
async function tripManifest(box, tripId) {
  const { trip } = await api(`/api/trips/${encodeURIComponent(tripId)}`);
  const first = trip.stops[0].station.code;
  const last = trip.stops[trip.stops.length - 1].station.code;
  const [map, man] = await Promise.all([
    api(`/api/trips/${encodeURIComponent(tripId)}/seats?from=${first}&to=${last}`),
    api(`/api/trips/${encodeURIComponent(tripId)}/manifest`),
  ]);
  let passengers = man.passengers;
  const st = { coach: 0, seat: null, account: null, q: '' };
  const bySeat = () => { const m = new Map(); passengers.forEach((p) => { if (!m.has(p.seatId)) m.set(p.seatId, []); m.get(p.seatId).push(p); }); return m; };
  let seats = bySeat();
  const coachOf = (seatId) => Math.max(0, map.coaches.findIndex((c) => seatId.startsWith(`${c.coach.code}-`)));
  if (passengers.length) st.coach = coachOf(passengers[0].seatId);
  const stopName = (i) => trip.stops[i]?.station.name || '';
  const inCoach = (c) => passengers.filter((p) => p.seatId.startsWith(`${c.coach.code}-`));

  box.innerHTML = `<div class="mf">
    <div class="shell-head"><div><a class="btn link" href="/masinis/jadwal" data-link>&larr; Jadwal dinas</a>
      <h1>${esc(trip.trainName)} <em>${esc(trip.trainNumber)}</em></h1>
      <p>${esc(stopName(0))} &rarr; ${esc(stopName(trip.stops.length - 1))} · ${dayName(trip.departureAt)}, ${dateNum(trip.departureAt)} · ${timeOf(trip.departureAt)}${trip.status === 'DELAYED' ? ` <span class="pill wait">Terlambat ${trip.delayMinutes} menit</span>` : ''}</p></div></div>
    <div id="mf-meter"></div>
    <div class="mf-layout">
      <section class="card flat mf-map"><div class="consist-wrap"><div id="mf-consist"></div><span class="dir-tag">Arah laju &rarr;</span></div>
        <h2 class="coach-name" id="mf-coach"></h2><div class="plan-wrap"><div id="mf-plan"></div></div>
        <ul class="mf-legend" aria-label="Keterangan warna"><li><i class="k free"></i>Kosong</li><li><i class="k pax"></i>Berpenumpang</li><li><i class="k in"></i>Sudah naik</li><li><i class="k grp"></i>Akun pemesan yang sama</li><li><i class="k foc"></i>Dipilih</li></ul></section>
      <aside class="card flat mf-side" id="mf-side" aria-live="polite"></aside>
    </div>
    <section class="mf-list"><div class="mf-list-head"><h2 class="h-xs">Daftar penumpang</h2><input class="in" id="mf-q" type="search" placeholder="Cari nama, kursi, atau kode pesanan" aria-label="Cari penumpang"></div><div id="mf-rows"></div></section>
  </div>`;

  const seatCls = (s) => {
    const list = seats.get(s.id);
    if (!list) return 'm-free';
    const cls = [list.every((p) => p.checkedIn) ? 'm-in' : 'm-pax'];
    if (st.account && list.some((p) => p.accountKey === st.account)) cls.push('m-grp');
    if (st.seat === s.id) cls.push('m-foc');
    return cls.join(' ');
  };
  const seatBtn = (s) => {
    const list = seats.get(s.id);
    const who = list ? list.map((p) => p.name).join(', ') : 'kosong';
    return `<button type="button" class="seat ${seatCls(s)} face-${s.facing}" data-seat="${s.id}" ${list ? '' : 'disabled'} aria-label="Kursi ${s.row}${s.letter}, ${esc(who)}"><span>${s.row}${s.letter}</span></button>`;
  };
  const plan = (c) => {
    const { rows, letters, aisleAfter, rowFacing } = c.coach;
    const at = (r, l) => c.seats.find((x) => x.row === r && x.letter === l);
    const col = (r) => `<div class="col">${letters.map((l, i) => `${i === aisleAfter ? `<span class="row-no mono" aria-hidden="true">${r}</span>` : ''}${seatBtn(at(r, l))}`).join('')}</div>`;
    let html = '';
    for (let r = 1; r <= rows; r++) {
      if (rowFacing[r - 1] === 'F' && rowFacing[r] === 'B') { html += `<div class="pair">${col(r)}<i class="pair-table" aria-hidden="true"></i>${col(r + 1)}<span class="pair-tag">berhadapan</span></div>`; r += 1; } else html += col(r);
    }
    return `<div class="car ${c.coach.seatClass.toLowerCase()}"><div class="car-end l"><i>Pintu</i></div><div class="car-seats">${html}</div><div class="car-end r"><i>Pintu</i></div></div>`;
  };
  const side = () => {
    const el = $('#mf-side');
    if (!st.seat) {
      el.innerHTML = '<h2 class="h-xs">Detail kursi</h2><p class="muted">Tekan kursi berpenumpang pada denah, atau pilih nama di daftar penumpang. Kursi lain yang dipesan oleh akun yang sama ikut disorot.</p>';
      return;
    }
    const list = seats.get(st.seat) || [];
    const group = st.account ? passengers.filter((p) => p.accountKey === st.account && p.seatId !== st.seat) : [];
    el.innerHTML = `<p class="eyebrow">Kursi ${esc(st.seat.split('-')[1])} · ${esc(map.coaches[coachOf(st.seat)].coach.label)}</p>
      ${list.map((p) => `<div class="mf-pax"><b class="mf-name">${esc(p.name)}</b>
        <dl class="mf-kv"><div><dt>Golongan</dt><dd>${esc(PAX_TYPE[p.passengerType] || '-')}${p.age != null ? `, ${p.age} th` : ''}</dd></div><div><dt>NIK</dt><dd class="mono">${esc(p.nikMasked || '-')}</dd></div>
        <div><dt>Ruas</dt><dd>${esc(p.from)} &rarr; ${esc(p.to)}</dd></div><div><dt>Kode pesanan</dt><dd class="mono">${esc(p.bookingCode)}</dd></div><div><dt>Dipesan oleh</dt><dd>${esc(p.bookedBy || '-')}</dd></div></dl>
        ${p.checkedIn ? '<span class="pill ok">Sudah naik</span>' : `<button class="btn gold sm" data-ci="${esc(p.ticketCode)}">${icon.check} Naikkan penumpang</button>`}</div>`).join('')}
      <div class="mf-group"><b>Kursi lain dari akun pemesan ini</b>${group.length ? `<ul>${group.map((p) => `<li><button type="button" class="chip-btn" data-go="${esc(p.seatId)}"><span class="mono">${esc(p.seatId)}</span> ${esc(p.name)}</button></li>`).join('')}</ul>` : '<p class="muted">Tidak ada kursi lain dari akun ini.</p>'}</div>`;
  };
  const rows = () => {
    const q = st.q.toLowerCase();
    const list = passengers.filter((p) => !q || `${p.name} ${p.seatId} ${p.bookingCode}`.toLowerCase().includes(q));
    $('#mf-rows').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl mf-tbl"><thead><tr><th>Penumpang</th><th>Kursi</th><th>Ruas</th><th>Kode</th><th>Status</th></tr></thead><tbody>
      ${list.map((p) => `<tr class="click ${p.seatId === st.seat ? 'on' : ''} ${st.account && p.accountKey === st.account ? 'grp' : ''}" data-go="${esc(p.seatId)}" tabindex="0"><td><b>${esc(p.name)}</b><span class="sub">${esc(PAX_TYPE[p.passengerType] || '')}</span></td>
        <td class="mono">${esc(p.seatId)}</td><td>${esc(p.from)} &rarr; ${esc(p.to)}</td><td class="mono">${esc(p.bookingCode)}</td><td>${p.checkedIn ? '<span class="pill ok">Sudah naik</span>' : '<span class="pill wait">Belum naik</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty"><p>${passengers.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada penumpang terkonfirmasi di perjalanan ini.'}</p></div>`;
  };
  const paint = () => {
    const done = passengers.filter((p) => p.checkedIn).length;
    $('#mf-meter').innerHTML = `<div class="board-meter"><div><b>${done}</b> dari <b>${passengers.length}</b> penumpang sudah naik</div><span class="meter"><i style="width:${passengers.length ? (done / passengers.length) * 100 : 0}%"></i></span></div>`;
    $('#mf-consist').innerHTML = `<div class="consist" role="tablist" aria-label="Pilih gerbong">${map.coaches.map((c, i) => {
      const g = st.account ? inCoach(c).filter((p) => p.accountKey === st.account).length : 0;
      return `<button class="car-tab ${c.coach.seatClass.toLowerCase()} ${i === st.coach ? 'on' : ''}" role="tab" type="button" data-c="${i}" aria-selected="${i === st.coach}"><b>${SHORT(c)}</b><small>${inCoach(c).length} pnp</small>${g ? `<em>${g}</em>` : ''}</button>`;
    }).join('')}<span class="loco" aria-hidden="true"></span></div>`;
    const c = map.coaches[st.coach];
    $('#mf-coach').innerHTML = `${esc(c.coach.label)} <small class="muted">· ${inCoach(c).length} penumpang</small>`;
    $('#mf-plan').innerHTML = plan(c);
    side();
    rows();
  };
  const focus = (seatId, { scroll = false } = {}) => {
    st.seat = seatId;
    st.coach = coachOf(seatId);
    st.account = (seats.get(seatId) || [])[0]?.accountKey || null;
    paint();
    if (scroll) $('.mf-map', box).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  box.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-c]');
    if (tab) { st.coach = Number(tab.dataset.c); paint(); return; }
    const seat = e.target.closest('[data-seat]');
    if (seat) { focus(seat.dataset.seat); return; }
    const target = e.target.closest('[data-go]');
    if (target) { focus(target.dataset.go, { scroll: Boolean(target.closest('#mf-rows')) }); return; }
    const ci = e.target.closest('[data-ci]');
    if (ci) {
      ci.disabled = true;
      try {
        const r = await api('/api/tickets/checkin', { method: 'POST', body: { ticketCode: ci.dataset.ci } });
        toast(`${r.passenger} sudah naik di kursi ${r.seatId}.`, 'ok');
        Sound.play('punch');
        passengers = (await api(`/api/trips/${encodeURIComponent(tripId)}/manifest`)).passengers;
        seats = bySeat();
        paint();
      } catch (ex) { ci.disabled = false; toast(ex.message, 'err'); }
    }
  });
  box.addEventListener('keydown', (e) => { const r = e.target.closest('tr[data-go]'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); focus(r.dataset.go, { scroll: true }); } });
  $('#mf-q', box).addEventListener('input', (e) => { st.q = e.target.value; rows(); });
  paint();
  return null;
}

async function reportDelay(t, after) {
  const s = sheet('Lapor keterlambatan', `<form class="stack" id="dl" novalidate><p class="muted">${esc(t.trainName)} · ${route(t)} · ${timeOf(t.departureAt)}. Semua penumpang terkonfirmasi langsung mendapat notifikasi.</p>
    <div class="row reason-chips">${[0, 10, 15, 30, 45, 60].map((m) => `<button type="button" class="chip-btn" data-m="${m}">${m === 0 ? 'Tepat waktu' : `${m} menit`}</button>`).join('')}</div>
    <div class="f" data-name="delayMinutes"><label for="dm">Perkiraan keterlambatan (menit)</label><input class="in mono" id="dm" inputmode="numeric" maxlength="3" value="${t.delayMinutes || ''}"><small class="hint">0 untuk kembali tepat waktu, maksimal 720.</small></div>
    <div class="row end"><button class="btn ghost" type="button" data-close>Batal</button><button class="btn gold" type="submit">Kirim laporan</button></div></form>`);
  $$('[data-m]', s.el).forEach((b) => b.addEventListener('click', () => { $('#dm', s.el).value = b.dataset.m; }));
  $('#dm', s.el).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
  $('#dl', s.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Number($('#dm', s.el).value);
    if (!Number.isInteger(v) || v < 0 || v > 720 || $('#dm', s.el).value === '') { const f = $('[data-name=delayMinutes]', s.el); f.classList.add('bad'); $('.hint', f).textContent = 'Isi 0 sampai 720 menit.'; return; }
    try {
      await api(`/api/masinis/trips/${encodeURIComponent(t.id)}/delay`, { method: 'PATCH', body: { delayMinutes: v } });
      s.close();
      toast(v ? `Keterlambatan ${v} menit dilaporkan. Penumpang diberi tahu.` : 'Status kembali tepat waktu.', 'ok');
      after?.();
    } catch (ex) { toast(ex.details?.fields ? Object.values(ex.details.fields)[0] : ex.message, 'err'); }
  });
}

/* ---------- Dasbor ---------- */
async function dashboard(box) {
  const first = (currentUser()?.name || '').split(' ')[0];
  box.innerHTML = `<div class="shell-head"><div><h1>Selamat bertugas, <em>${esc(first)}</em></h1><p>Jadwal dinas Anda, pemeriksaan karcis, dan laporan keterlambatan dalam satu tempat.</p></div><a class="btn ghost" href="/masinis/jadwal" data-link>${icon.cal} Jadwal lengkap</a></div>
    <div id="md"><span class="skel" style="height:320px"></span></div>`;
  let tick = 0;
  let kk = null;
  const paint = async () => {
    const { trips } = await api(`/api/masinis/trips?from=${plusDays(-1)}&to=${plusDays(14)}`);
    if (!$('#md')) return;
    const now = Date.now();
    const live = trips.filter((t) => t.phase === 'ON_TRIP');
    const next = trips.filter((t) => t.phase === 'UPCOMING' && t.status !== 'CANCELLED').sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt));
    const focus = live[0] || next[0];
    const today = trips.filter((t) => t.serviceDate === wibToday());
    const week = trips.filter((t) => Date.parse(t.departureAt) < now + 7 * 86400000 && t.phase !== 'COMPLETED');
    $('#md').innerHTML = `
      <div class="duty ${focus?.phase === 'ON_TRIP' ? 'live' : ''}">
        ${focus ? `<div class="duty-main"><p class="eyebrow">${focus.phase === 'ON_TRIP' ? 'Sedang berjalan' : 'Dinas berikutnya'}</p><h2>${esc(focus.trainName)} <small class="mono muted">${esc(focus.trainNumber)}</small></h2>
          <p class="duty-route">${route(focus)}</p>
          <div class="duty-times"><div><span>Berangkat</span><b class="mono">${timeOf(focus.departureAt)}</b><small>${dayName(focus.departureAt)}, ${dateNum(focus.departureAt)}</small></div><div><span>Tiba</span><b class="mono">${timeOf(arrive(focus))}</b><small>${duration(mins(focus))}</small></div><div><span>${focus.phase === 'ON_TRIP' ? 'Status' : 'Mulai dalam'}</span><b class="mono" id="cd">${focus.phase === 'ON_TRIP' ? 'Berjalan' : '-'}</b><small>${focus.status === 'DELAYED' ? `terlambat ${focus.delayMinutes} menit` : 'tepat waktu'}</small></div></div>
          <ol class="duty-stops">${focus.stops.map((s) => `<li class="${Date.parse(s.departAt) < now ? 'past' : ''}"><i></i><span>${esc(s.station.name)}</span><small class="mono">${timeOf(s.departAt)}</small></li>`).join('')}</ol>
          <div class="row"><button class="btn gold sm" id="d-man">${icon.list} Manifest penumpang</button><button class="btn ghost sm" id="d-delay">${icon.clock} Lapor keterlambatan</button></div></div>`
    : '<div class="duty-main"><p class="eyebrow">Dinas berikutnya</p><h2>Belum ada jadwal</h2><p class="muted">Admin belum menugaskan Anda ke kereta mana pun dalam 14 hari ke depan.</p></div>'}
        <div class="duty-kiko"><div id="m-kiko"></div></div>
      </div>
      <div class="stats"><div class="stat"><span>Dinas hari ini</span><b>${today.length}</b></div><div class="stat"><span>Dinas 7 hari ke depan</span><b>${week.length}</b></div><div class="stat"><span>Terlambat (14 hari)</span><b>${trips.filter((t) => t.status === 'DELAYED').length}</b></div></div>
      <div class="grid-2">
        <section class="card flat"><div class="card-head"><div><h2>Periksa karcis</h2><p>Pindai QR tiket dengan pemindai, atau tempel kode tiket.</p></div></div>
          <form class="ci-form" id="ci"><label class="sr" for="code">Kode tiket</label><div class="search-in">${icon.scan}<input class="in mono" id="code" placeholder="TKT-..." autocomplete="off"></div><button class="btn gold">Periksa</button></form><div id="ci-out" aria-live="polite"></div></section>
        <section class="card flat"><div class="card-head"><div><h2>Perjalanan hari ini</h2><p>${dateLong(Date.now())}</p></div></div>
          ${today.length ? `<ul class="day-list">${today.map((t) => `<li><span class="mono">${timeOf(t.departureAt)}</span><span><b>${esc(t.trainName)}</b><small class="muted">${route(t)}</small></span>${pill(PHASE, t.phase)}<button class="btn link" data-man="${esc(t.id)}">Manifest</button></li>`).join('')}</ul>` : '<p class="muted">Tidak ada dinas hari ini. Selamat beristirahat.</p>'}</section>
      </div>`;
    kk?.destroy();
    kk = Kiko.mount($('#m-kiko'), { pat: true });
    setTimeout(() => kk.say(focus ? `Siap berangkat pukul ${timeOf(focus.departureAt)}!` : 'Hari ini santai dulu.', 2800), 800);
    $('#d-man')?.addEventListener('click', () => manifest(focus));
    $('#d-delay')?.addEventListener('click', () => reportDelay(focus, paint));
    $$('[data-man]').forEach((b) => b.addEventListener('click', () => manifest(trips.find((t) => t.id === b.dataset.man))));
    $('#ci').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ticketCode = $('#code').value.trim();
      if (ticketCode.length < 8) { $('#ci-out').innerHTML = '<div class="ci-bad">Kode tiket terlalu pendek.</div>'; return; }
      try {
        const r = await api('/api/tickets/checkin', { method: 'POST', body: { ticketCode } });
        $('#ci-out').innerHTML = `<div class="ci-ok"><b>${esc(r.passenger)}</b><span class="mono">${esc(r.seatId)} · ${esc(r.trainName)} · ${esc(r.bookingCode)}</span></div>`;
        Sound.play('punch');
        kk.mood('cheer', 1600);
        kk.say('Karcis sah. Silakan naik!', 1800);
        $('#code').value = '';
      } catch (ex) { $('#ci-out').innerHTML = `<div class="ci-bad">${esc(ex.message)}</div>`; kk.mood('sad', 1800); }
      $('#code').focus();
    });
    clearInterval(tick);
    if (focus && focus.phase === 'UPCOMING') {
      const upd = () => { const ms = Date.parse(focus.departureAt) - Date.now(); const el = $('#cd'); if (!el) { clearInterval(tick); return; } el.textContent = ms <= 0 ? 'Sekarang' : ms > 86400000 ? `${Math.floor(ms / 86400000)} hari` : `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`; };
      upd();
      tick = setInterval(upd, 1000);
    }
  };
  await paint();
  return () => { clearInterval(tick); kk?.destroy(); };
}

/* ---------- Jadwal dinas ---------- */
async function schedule(box) {
  const state = { from: plusDays(-1), to: plusDays(14) };
  box.innerHTML = `<div class="shell-head"><div><h1>Jadwal <em>dinas</em></h1><p>Hari, tanggal, jam, kereta, dan rute yang menjadi tugas Anda.</p></div></div>
    <div id="speriod"></div>
    <div id="sl"><span class="skel" style="height:300px"></span></div>`;
  const load = async () => {
    const r = await api(`/api/masinis/trips?from=${state.from}&to=${state.to}`);
    if (!$('#sl')) return;
    const byDay = new Map();
    r.trips.forEach((t) => { const k = t.serviceDate; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); });
    $('#sl').innerHTML = r.trips.length ? `<p class="muted" style="margin-bottom:10px">${r.trips.length} perjalanan · ${dateNum(`${r.from}T12:00:00+07:00`)} sampai ${dateNum(`${r.to}T12:00:00+07:00`)}</p>
      <div class="tbl-wrap"><table class="tbl sched-tbl"><thead><tr><th>Hari</th><th>Tanggal</th><th>Jam</th><th>Kereta</th><th>Rute</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...byDay].map(([d, list]) => list.map((t, i) => `<tr class="${d === wibToday() ? 'today' : ''} ${i === 0 ? 'day-start' : ''}">
        <td>${i === 0 ? `<b>${dayName(t.departureAt)}</b>${d === wibToday() ? ' <span class="chip gold">Hari ini</span>' : ''}` : ''}</td><td>${i === 0 ? dateNum(t.departureAt) : ''}</td>
        <td class="mono">${timeOf(t.departureAt)}<span class="sub">tiba ${timeOf(arrive(t))}</span></td><td><b>${esc(t.trainName)}</b><span class="sub mono">${esc(t.trainNumber)}</span></td>
        <td>${route(t)}<span class="sub">${t.stops.length - 2} pemberhentian · ${duration(mins(t))}</span></td><td>${pill(PHASE, t.phase)} ${t.status !== 'SCHEDULED' ? pill(STATUS, t.status) : ''}${t.status === 'DELAYED' ? `<span class="sub">+${t.delayMinutes} menit</span>` : ''}</td>
        <td class="acts"><button class="btn ghost sm" data-man="${esc(t.id)}">Manifest</button>${t.phase !== 'COMPLETED' && t.status !== 'CANCELLED' ? `<button class="btn ghost sm" data-dl="${esc(t.id)}">Terlambat?</button>` : ''}</td></tr>`).join('')).join('')}
      </tbody></table></div>` : '<div class="empty"><p>Tidak ada dinas pada rentang ini.</p></div>';
    $$('[data-man]', box).forEach((b) => b.addEventListener('click', () => manifest(r.trips.find((t) => t.id === b.dataset.man))));
    $$('[data-dl]', box).forEach((b) => b.addEventListener('click', () => reportDelay(r.trips.find((t) => t.id === b.dataset.dl), load)));
  };
  const first = periodFilter($('#speriod'), { id: 'sp', presets: ['today', 'next7', 'next14', 'next30'], initial: 'next14', onChange: (r) => { state.from = r.from; state.to = r.to; load(); } });
  state.from = first.from;
  state.to = first.to;
  await load();
  return null;
}

const VIEWS = { '': dashboard, jadwal: schedule, perjalanan: (box, id) => (id ? tripManifest(box, id) : (go('/masinis/jadwal', { replace: true }), null)) };

export function render(main, { params }) {
  const section = params.section || '';
  if (!VIEWS[section]) { go('/masinis', { replace: true }); return undefined; }
  main.innerHTML = `<div class="wrap shell solo">
    <div class="shell-main" id="view"><span class="skel" style="height:360px"></span></div>
  </div>`;
  let off = null;
  let alive = true;
  Promise.resolve(VIEWS[section]($('#view'), params.id)).then((fn) => { if (alive) off = fn; else fn?.(); }).catch((e) => { const v = $('#view'); if (v) v.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; });
  return () => { alive = false; off?.(); $$('.sheet').forEach((s) => s.remove()); };
}
