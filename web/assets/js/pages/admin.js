/**
 * Panel admin. Satu modul, beberapa bagian dengan navigasi samping:
 * Dasbor, Data Operasional (kereta, rute, tarif, jam operasi, masinis, stasiun, diskon lansia), Pengguna,
 * Armada dan riwayat perjalanan, Verifikasi Transfer, dan Sistem (registry, antrian, audit, API key).
 */
import { $, $$, api, esc, rupiah, timeOf, dateNum, dayName, dateTime, ago, toast, confirmDialog, go, currentUser, wibToday, showFieldErrors, clearFieldErrors, protectedBlobUrl, openProof, debounce, initials } from '../core.js';
import { Kiko } from '../kiko.js';
import { icon } from '../ui.js';
import { pill, PAYMENT_STATUS, METHOD } from './pay-kit.js';
import { periodFilter } from '../period.js';

const CLASS = { EKONOMI: 'Ekonomi', EKSEKUTIF: 'Eksekutif', LUXURY: 'Luxury' };
const ROLE = { customer: 'Pelanggan', masinis: 'Masinis', admin: 'Admin' };
const TRIP_STATUS = { SCHEDULED: ['Sesuai jadwal', 'ok'], DELAYED: ['Terlambat', 'wait'], CANCELLED: ['Dibatalkan', 'bad'] };
const PHASE = { UPCOMING: ['Akan berangkat', 'info'], ON_TRIP: ['Dalam perjalanan', 'wait'], COMPLETED: ['Selesai', 'mute'] };
const NAV = [
  ['', 'Dasbor', icon.grid], ['data', 'Data Operasional', icon.db], ['pengguna', 'Pengguna', icon.users],
  ['armada', 'Armada & Riwayat', icon.train], ['transfer', 'Verifikasi Transfer', icon.bank], ['sistem', 'Sistem', icon.pulse],
];

/* ---------- Utilitas tampilan ---------- */
const empty = (msg) => `<div class="empty"><p>${esc(msg)}</p></div>`;
function sheet(title, html, { wide = false } = {}) {
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div class="sheet-in ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Tutup">${icon.x}</button></div><div class="sheet-body">${html}</div></div>`;
  document.body.append(el);
  const close = () => el.remove();
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  setTimeout(() => (el.querySelector('input,select,textarea,button:not([data-close])') || el.querySelector('[data-close]'))?.focus(), 50);
  return { el, body: $('.sheet-body', el), close };
}
const field = (name, label, input, hint = '') => `<div class="f" data-name="${name}"><label for="f-${name}">${label}</label>${input}<small class="hint">${hint}</small></div>`;
const errMsg = (e) => (e.details?.fields ? Object.values(e.details.fields)[0] : e.message);

/* =========================================================
 * Dasbor
 * ========================================================= */
async function dashboard(box) {
  box.innerHTML = `<div class="shell-head"><div><h1>Selamat datang, <em>${esc((currentUser()?.name || '').split(' ')[0])}</em></h1><p>Ringkasan operasional hari ini. Angka diperbarui setiap 15 detik.</p></div><a class="btn gold" href="/admin/transfer" data-link>Periksa transfer</a></div>
    <div id="dash"><span class="skel" style="height:360px"></span></div>`;
  const paint = async () => {
    const [b, c, t] = await Promise.all([api('/api/admin/booking-stats'), api('/api/admin/catalog-stats'), api('/api/admin/transfers?status=SUBMITTED').catch(() => ({ total: 0, transfers: [] }))]);
    if (!$('#dash')) return;
    const max = Math.max(1, ...b.last7Days.map((d) => d.revenue));
    // day dari booking-service berupa epoch ms awal hari WIB, atau teks yyyy-mm-dd pada data lama.
    const dayLabel = (v, long = false) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'long' } : {}) }).format(new Date(typeof v === 'number' ? v : `${v}T00:00:00+07:00`));
    $('#dash').innerHTML = `
      ${t.total ? `<div class="callout warn">${icon.bank}<div><b>${t.total} bukti transfer menunggu verifikasi</b><p>Pelanggan menunggu keputusan Anda. Kursi mereka ditahan sampai 24 jam selama pemeriksaan.</p></div></div>` : ''}
      <div class="stats">
        <div class="stat gold"><span>Pendapatan hari ini</span><b>${rupiah(b.revenueToday)}</b><small>pesanan lunas</small></div>
        <div class="stat"><span>Pesanan hari ini</span><b>${b.bookingsToday}</b><small>${b.pendingPayment} menunggu bayar</small></div>
        <div class="stat"><span>Penumpang berangkat hari ini</span><b>${b.departingToday}</b><small>terkonfirmasi</small></div>
        <div class="stat"><span>Perjalanan hari ini</span><b>${c.tripsToday}</b><small>${c.delayedToday} terlambat · ${c.cancelledToday} batal</small></div>
        <div class="stat"><span>Kereta aktif</span><b>${c.enabledTrains}<small> / ${c.trains}</small></b><small>${c.stations} stasiun</small></div>
        <div class="stat"><span>Kursi sedang ditahan</span><b>${b.activeLocks ?? 0}</b><small>diskon lansia ${c.seniorDiscountPercent}%</small></div>
      </div>
      <div class="grid-2">
        <section class="card flat"><div class="card-head"><div><h2>Pendapatan 7 hari</h2><p>Total pesanan lunas per hari.</p></div></div>
          <div class="spark">${b.last7Days.map((d, i) => `<div title="${esc(dayLabel(d.day, true))}: ${rupiah(d.revenue)}, ${d.bookings} pesanan"><b class="sp-gap" style="flex-grow:${100 - Math.max(3, (d.revenue / max) * 100)}"></b><i style="flex-grow:${Math.max(3, (d.revenue / max) * 100)};animation-delay:${i * 60}ms"></i><small>${esc(dayLabel(d.day))}</small></div>`).join('')}</div></section>
        <section class="card flat"><div class="card-head"><div><h2>Keberangkatan berikutnya</h2><p>Enam perjalanan terdekat.</p></div><a class="btn link" href="/admin/armada" data-link>Semua armada</a></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jam</th><th>Kereta</th><th>Relasi</th><th>Masinis</th></tr></thead><tbody>
          ${c.nextDepartures.map((d) => `<tr><td class="mono">${timeOf(d.departureAt)}<span class="sub">${dateNum(d.departureAt)}</span></td><td>${esc(d.trainName)}</td><td>${esc(d.origin)} &rarr; ${esc(d.destination)}</td><td>${esc(d.masinisName || '-')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Tidak ada.</td></tr>'}
          </tbody></table></div></section>
      </div>
      ${t.transfers.length ? `<section class="card flat"><div class="card-head"><div><h2>Transfer terbaru</h2></div><a class="btn link" href="/admin/transfer" data-link>Buka verifikasi</a></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dikirim</th><th>Pemesan</th><th>Kereta</th><th class="num">Nominal</th></tr></thead><tbody>
        ${t.transfers.slice(0, 5).map((x) => `<tr><td>${ago(x.proof.createdAt)}</td><td>${esc(x.user.name || '-')}<span class="sub">${esc(x.user.email || '')}</span></td><td>${esc(x.booking.trainName || '-')}</td><td class="num">${rupiah(x.payment.amount)}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}`;
  };
  await paint();
  const h = setInterval(() => { if (!document.hidden) paint().catch(() => {}); }, 15000);
  return () => clearInterval(h);
}

/* =========================================================
 * Data Operasional
 * ========================================================= */
async function dataOps(box) {
  box.innerHTML = `<div class="shell-head"><div><h1>Data <em>operasional</em></h1><p>Kelola kereta, rute, tarif per kelas, jam operasional, penugasan masinis, stasiun, dan diskon lansia. Kereta nonaktif tidak tampil untuk pelanggan.</p></div></div>
    <div class="tabs-line" role="tablist"><button role="tab" aria-selected="true" data-t="trains">Kereta</button><button role="tab" aria-selected="false" data-t="stations">Stasiun</button><button role="tab" aria-selected="false" data-t="settings">Pengaturan tarif</button></div>
    <div id="ops"></div>`;
  let stations = [];
  let masinis = [];
  const loadRefs = async () => {
    [stations, masinis] = await Promise.all([api('/api/admin/stations').then((r) => r.stations), api('/api/admin/users?role=masinis').then((r) => r.users)]);
  };
  await loadRefs();

  /* ----- Kereta ----- */
  async function trains() {
    const ops = $('#ops');
    ops.innerHTML = '<span class="skel" style="height:300px"></span>';
    const { trains: list } = await api('/api/admin/trains');
    ops.innerHTML = `<div class="row between" style="margin-bottom:14px"><p class="muted">${list.length} kereta · ${list.filter((t) => t.enabled).length} aktif</p><button class="btn gold sm" id="add-train">${icon.plus} Tambah kereta</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kereta</th><th>Relasi</th><th>Kelas</th><th>Jam berangkat</th><th>Masinis</th><th>Tampil</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr class="${t.enabled ? '' : 'dim-soft'}"><td><b>${esc(t.name)}</b><span class="sub mono">${esc(t.id)} · ${esc(t.number)}</span></td>
        <td>${t.route.length ? `${esc(t.origin.name)} &rarr; ${esc(t.destination.name)}<span class="sub">${t.route.length} stasiun · ${t.route[t.route.length - 1].km} km</span>` : '<span class="muted">Rute belum diatur</span>'}</td>
        <td>${t.classes.map((c) => `<span class="chip">${CLASS[c]}</span>`).join(' ')}</td>
        <td class="mono">${t.services.filter((s) => s.active).map((s) => `${s.direction}·${s.departureTime}`).join(' ') || '-'}</td>
        <td>${esc(t.masinisName || 'Belum ditugaskan')}</td>
        <td><label class="switch"><input type="checkbox" data-toggle="${esc(t.id)}" ${t.enabled ? 'checked' : ''} aria-label="Tampilkan ${esc(t.name)} untuk pelanggan"><i></i></label></td>
        <td class="acts"><button class="btn ghost sm" data-edit="${esc(t.id)}">${icon.edit} Kelola</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-toggle]', ops).forEach((c) => c.addEventListener('change', async () => {
      try {
        await api(`/api/admin/trains/${c.dataset.toggle}`, { method: 'PATCH', body: { enabled: c.checked } });
        toast(c.checked ? 'Kereta ditampilkan untuk pelanggan.' : 'Kereta disembunyikan dari pelanggan.', 'ok');
        c.closest('tr').classList.toggle('dim-soft', !c.checked);
      } catch (e) { c.checked = !c.checked; toast(errMsg(e), 'err'); }
    }));
    $$('[data-edit]', ops).forEach((b) => b.addEventListener('click', () => editTrain(b.dataset.edit)));
    $('#add-train').addEventListener('click', addTrain);
  }

  function addTrain() {
    const s = sheet('Tambah kereta', `<form class="stack" id="tf" novalidate>
      <div class="grid-2">${field('id', 'Kode kereta', '<input class="in mono" id="f-id" maxlength="4" placeholder="ABA">', '2 sampai 4 huruf kapital.')}${field('number', 'Nomor KA', '<input class="in mono" id="f-number" placeholder="KA 12">')}</div>
      ${field('name', 'Nama kereta', '<input class="in" id="f-name" maxlength="60" placeholder="Argo ...">')}
      <div class="f" data-name="classes"><span class="lbl">Kelas yang tersedia</span><div class="row">${Object.entries(CLASS).map(([k, v]) => `<label class="check"><input type="checkbox" value="${k}" name="cls">${v}</label>`).join('')}</div><small class="hint">Susunan 9 gerbong dibuat otomatis dari kelas yang dipilih.</small></div>
      <div class="callout">${icon.info}<div><p>Kereta baru dibuat nonaktif. Atur rute dan jam operasional, lalu aktifkan.</p></div></div>
      <div class="row end"><button class="btn gold" type="submit">Buat kereta</button></div></form>`);
    $('#f-id', s.el).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('#tf', s.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(e.currentTarget);
      try {
        const r = await api('/api/admin/trains', { method: 'POST', body: { id: $('#f-id', s.el).value, number: $('#f-number', s.el).value.trim(), name: $('#f-name', s.el).value.trim(), classes: $$('[name=cls]:checked', s.el).map((c) => c.value) } });
        s.close();
        toast(r.notice, 'ok');
        await trains();
        editTrain(r.train.id);
      } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(ex.message, 'err'); }
    });
  }

  async function editTrain(id) {
    const { train: t } = await api(`/api/admin/trains/${id}`);
    const s = sheet(`${esc(t.name)} <small class="muted mono">${esc(t.number)}</small>`, `
      <div class="tabs-line small" role="tablist"><button role="tab" aria-selected="true" data-p="info">Info & masinis</button><button role="tab" aria-selected="false" data-p="route">Rute</button><button role="tab" aria-selected="false" data-p="coaches">Gerbong</button><button role="tab" aria-selected="false" data-p="fares">Tarif kelas</button><button role="tab" aria-selected="false" data-p="svc">Jam operasional</button></div>
      <div id="tp"></div>`, { wide: true });
    const tp = $('#tp', s.el);
    const reload = async () => { Object.assign(t, (await api(`/api/admin/trains/${id}`)).train); };
    const panels = {
      // Atur gerbong: jumlah gerbong Ekonomi, Eksekutif, Luxury (total 1-12). Perjalanan yang sudah ada pesanannya tetap memakai susunan lama.
      coaches() {
        const cnt = (cls) => t.coaches.filter((c) => c.seatClass === cls).length;
        const KEYS = [['EKONOMI', 'Ekonomi', 'ekonomi'], ['EKSEKUTIF', 'Eksekutif', 'eksekutif'], ['LUXURY', 'Luxury', 'luxury']];
        tp.innerHTML = `<form class="stack" id="pc" novalidate>
          <p class="muted">Atur jumlah gerbong tiap kelas (total 1 sampai 12). Gerbong Luxury ditaruh paling depan, lalu Eksekutif, lalu Ekonomi. Perjalanan yang sudah punya pemesan tetap memakai susunan lama agar nomor kursi penumpang tidak berubah.</p>
          <div class="grid-3">${KEYS.map(([k, label, cls]) => field(k, `<span class="cls-dot ${cls}"></span>${label}`, `<input class="in mono" id="f-${k}" type="number" min="0" max="12" step="1" value="${cnt(k)}">`)).join('')}</div>
          <div class="f"><span class="lbl">Pratinjau rangkaian (<b id="c-total"></b> gerbong)</span><div class="consist mini" id="c-prev"></div></div>
          <div class="row between"><span class="muted" id="c-msg"></span><button class="btn gold" type="submit">Simpan susunan gerbong</button></div></form>`;
        const vals = () => Object.fromEntries(KEYS.map(([k]) => [k, Number($(`#f-${k}`, tp).value || 0)]));
        const preview = () => {
          const v = vals();
          const list = [['LUXURY', 'LUX', 'luxury'], ['EKSEKUTIF', 'EKS', 'eksekutif'], ['EKONOMI', 'EKO', 'ekonomi']].flatMap(([k, code, cls]) => Array.from({ length: Math.max(0, Math.min(12, v[k] || 0)) }, (_, i) => `<span class="car-tab ${cls}"><b>${code}${i + 1}</b></span>`));
          $('#c-total', tp).textContent = Object.values(v).reduce((a, b) => a + (b || 0), 0);
          $('#c-prev', tp).innerHTML = list.join('') + '<span class="loco"></span>';
        };
        $$('input', tp).forEach((i) => i.addEventListener('input', preview));
        preview();
        $('#pc', tp).addEventListener('submit', async (e) => {
          e.preventDefault();
          clearFieldErrors(e.currentTarget);
          const v = vals();
          const total = Object.values(v).reduce((a, b) => a + b, 0);
          if (total < 1 || total > 12) { $('#c-msg', tp).textContent = 'Total gerbong harus 1 sampai 12.'; return; }
          if (!await confirmDialog({ title: 'Simpan susunan gerbong?', body: '<p>Perjalanan mendatang yang belum punya pemesan dibuat ulang dengan susunan baru. Perjalanan yang sudah ada pemesannya tetap memakai susunan lama.</p>', confirm: 'Simpan' })) return;
          try {
            const r = await api(`/api/admin/trains/${id}/coaches`, { method: 'PUT', body: { coaches: v } });
            await reload();
            toast(r.notice, 'ok');
            panels.coaches();
          } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
        });
      },
      info() {
        tp.innerHTML = `<form class="stack" id="pi" novalidate>
          <div class="grid-2">${field('name', 'Nama kereta', `<input class="in" id="f-name" value="${esc(t.name)}" maxlength="60">`)}${field('number', 'Nomor KA', `<input class="in mono" id="f-number" value="${esc(t.number)}">`)}</div>
          ${field('masinisId', 'Masinis yang bertugas', `<select class="sel" id="f-mas"><option value="">Belum ditugaskan</option>${masinis.map((m) => `<option value="${esc(m.id)}" ${m.id === t.masinisId ? 'selected' : ''}>${esc(m.name)} (${esc(m.email)})</option>`).join('')}</select>`, 'Berlaku untuk semua perjalanan yang belum berangkat.')}
          <div class="f"><span class="lbl">Rangkaian (${t.coaches.length} gerbong)</span><div class="consist mini">${t.coaches.map((c) => `<span class="car-tab ${c.seatClass.toLowerCase()}"><b>${esc(c.code)}</b></span>`).join('')}<span class="loco"></span></div></div>
          <label class="switch"><input type="checkbox" id="f-en" ${t.enabled ? 'checked' : ''}><i></i>Tampilkan untuk pelanggan</label>
          <div class="row between"><button class="btn ghost sm danger-text" type="button" id="del">${icon.trash} Hapus kereta</button><button class="btn gold" type="submit">Simpan</button></div></form>`;
        $('#pi', tp).addEventListener('submit', async (e) => {
          e.preventDefault();
          clearFieldErrors(e.currentTarget);
          const m = masinis.find((x) => x.id === $('#f-mas', tp).value);
          try {
            await api(`/api/admin/trains/${id}`, { method: 'PATCH', body: { name: $('#f-name', tp).value.trim(), number: $('#f-number', tp).value.trim(), enabled: $('#f-en', tp).checked, masinisId: m?.id || null, masinisName: m?.name || null } });
            await reload();
            toast('Data kereta tersimpan.', 'ok');
            trains();
          } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
        });
        $('#del', tp).addEventListener('click', async () => {
          if (!await confirmDialog({ title: `Hapus ${t.name}?`, body: '<p>Kereta yang sudah punya riwayat perjalanan tidak bisa dihapus. Untuk menghentikan sementara, matikan saja "Tampilkan untuk pelanggan".</p>', confirm: 'Hapus', danger: true })) return;
          try { await api(`/api/admin/trains/${id}`, { method: 'DELETE' }); s.close(); toast('Kereta dihapus.', 'ok'); trains(); } catch (ex) { toast(errMsg(ex), 'err'); }
        });
      },
      route() {
        let stops = t.route.map((r) => ({ code: r.station.code, minuteOffset: r.minuteOffset, km: r.km }));
        const opt = (code) => stations.map((x) => `<option value="${x.code}" ${x.code === code ? 'selected' : ''}>${esc(x.name)} (${x.code})</option>`).join('');
        const paint = () => {
          tp.innerHTML = `<p class="muted">Urutan stasiun arah berangkat (A). Arah pulang (B) otomatis kebalikannya. Menit dan km dihitung dari stasiun pertama.</p>
            <div class="tbl-wrap"><table class="tbl route-edit"><thead><tr><th>#</th><th>Stasiun</th><th>Menit ke-</th><th>Km</th><th></th></tr></thead><tbody>
            ${stops.map((x, i) => `<tr><td class="mono">${i + 1}</td><td><select class="sel" data-i="${i}" data-k="code">${opt(x.code)}</select></td><td><input class="in mono" data-i="${i}" data-k="minuteOffset" value="${x.minuteOffset}" inputmode="numeric" ${i === 0 ? 'readonly' : ''}></td><td><input class="in mono" data-i="${i}" data-k="km" value="${x.km}" inputmode="numeric" ${i === 0 ? 'readonly' : ''}></td>
              <td class="acts"><button class="icon-btn" type="button" data-up="${i}" aria-label="Naikkan" ${i === 0 ? 'disabled' : ''}>&uarr;</button><button class="icon-btn" type="button" data-rm="${i}" aria-label="Hapus stasiun">${icon.x}</button></td></tr>`).join('')}
            </tbody></table></div>
            <p class="alert on-dark" id="rerr" hidden></p>
            <div class="row between"><button class="btn ghost sm" type="button" id="add">${icon.plus} Tambah stasiun</button><div class="row"><button class="btn ghost sm" type="button" id="regen">Terapkan ke jadwal mendatang</button><button class="btn gold" type="button" id="save">Simpan rute</button></div></div>`;
          $$('[data-k]', tp).forEach((inp) => inp.addEventListener('change', () => { const v = inp.dataset.k === 'code' ? inp.value : Number(inp.value.replace(/\D/g, '')); stops[Number(inp.dataset.i)][inp.dataset.k] = v; }));
          $$('[data-rm]', tp).forEach((b) => b.addEventListener('click', () => { stops.splice(Number(b.dataset.rm), 1); if (stops[0]) { stops[0].minuteOffset = 0; stops[0].km = 0; } paint(); }));
          $$('[data-up]', tp).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.up); [stops[i - 1].code, stops[i].code] = [stops[i].code, stops[i - 1].code]; paint(); }));
          $('#add', tp).addEventListener('click', () => { const last = stops[stops.length - 1] || { minuteOffset: 0, km: 0 }; stops.push({ code: stations[0].code, minuteOffset: stops.length ? last.minuteOffset + 30 : 0, km: stops.length ? last.km + 30 : 0 }); paint(); });
          $('#save', tp).addEventListener('click', async () => {
            $('#rerr', tp).hidden = true;
            try { const r = await api(`/api/admin/trains/${id}/route`, { method: 'PUT', body: { stops } }); await reload(); stops = t.route.map((x) => ({ code: x.station.code, minuteOffset: x.minuteOffset, km: x.km })); toast(r.notice, 'ok'); trains(); } catch (ex) { $('#rerr', tp).textContent = errMsg(ex); $('#rerr', tp).hidden = false; }
          });
          $('#regen', tp).addEventListener('click', regen);
        };
        paint();
      },
      fares() {
        const km = t.route.length ? t.route[t.route.length - 1].km : 0;
        tp.innerHTML = `<p class="muted">Tarif dewasa = tarif dasar + tarif per km x jarak ruas, dibulatkan ke atas per Rp1.000. Bayi, anak, dan dewasa bertarif sama; lansia mendapat diskon dari Pengaturan tarif.</p>
          <div class="stack">${t.classes.map((c) => `<div class="fare-row" data-c="${c}"><b>${CLASS[c]}</b>
            <div class="f"><label>Tarif dasar (Rp)</label><input class="in mono" data-k="base" value="${t.fares[c]?.base ?? 0}" inputmode="numeric"></div>
            <div class="f"><label>Per km (Rp)</label><input class="in mono" data-k="perKm" value="${t.fares[c]?.perKm ?? 0}" inputmode="numeric"></div>
            <div class="fare-ex"><span class="muted">Ujung ke ujung (${km} km)</span><b class="mono" data-ex></b></div></div>`).join('')}</div>
          <p class="alert on-dark" id="ferr" hidden></p><div class="row end"><button class="btn gold" id="save">Simpan tarif</button></div>`;
        const ex = () => $$('.fare-row', tp).forEach((r) => { const b = Number($('[data-k=base]', r).value) || 0; const p = Number($('[data-k=perKm]', r).value) || 0; $('[data-ex]', r).textContent = rupiah(Math.ceil((b + p * km) / 1000) * 1000); });
        ex();
        $$('input', tp).forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, ''); ex(); }));
        $('#save', tp).addEventListener('click', async () => {
          $('#ferr', tp).hidden = true;
          const fares = $$('.fare-row', tp).map((r) => ({ seatClass: r.dataset.c, base: Number($('[data-k=base]', r).value), perKm: Number($('[data-k=perKm]', r).value) }));
          try { await api(`/api/admin/trains/${id}/fares`, { method: 'PUT', body: { fares } }); await reload(); toast('Tarif tersimpan. Berlaku untuk pemesanan baru.', 'ok'); } catch (e2) { $('#ferr', tp).textContent = errMsg(e2); $('#ferr', tp).hidden = false; }
        });
      },
      svc() {
        let svc = t.services.map((x) => ({ direction: x.direction, departureTime: x.departureTime, active: x.active }));
        const paint = () => {
          const a = t.route[0]?.station.name || 'asal'; const b = t.route[t.route.length - 1]?.station.name || 'tujuan';
          tp.innerHTML = `<p class="muted">Arah A: ${esc(a)} ke ${esc(b)}. Arah B: sebaliknya. Jadwal 30 hari ke depan dibuat otomatis dari jam ini.</p>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Arah</th><th>Jam berangkat</th><th>Aktif</th><th></th></tr></thead><tbody>
            ${svc.map((x, i) => `<tr><td><select class="sel" data-i="${i}" data-k="direction"><option value="A" ${x.direction === 'A' ? 'selected' : ''}>A · berangkat</option><option value="B" ${x.direction === 'B' ? 'selected' : ''}>B · pulang</option></select></td>
              <td><input class="in mono" type="time" data-i="${i}" data-k="departureTime" value="${x.departureTime}"></td><td><label class="switch"><input type="checkbox" data-i="${i}" data-k="active" ${x.active ? 'checked' : ''}><i></i></label></td>
              <td class="acts"><button class="icon-btn" data-rm="${i}" aria-label="Hapus jam">${icon.x}</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Belum ada jam operasional.</td></tr>'}
            </tbody></table></div><p class="alert on-dark" id="serr" hidden></p>
            <div class="row between"><button class="btn ghost sm" id="add">${icon.plus} Tambah jam</button><div class="row"><button class="btn ghost sm" id="regen">Terapkan ke jadwal mendatang</button><button class="btn gold" id="save">Simpan jam</button></div></div>`;
          $$('[data-k]', tp).forEach((inp) => inp.addEventListener('change', () => { svc[Number(inp.dataset.i)][inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; }));
          $$('[data-rm]', tp).forEach((b) => b.addEventListener('click', () => { svc.splice(Number(b.dataset.rm), 1); paint(); }));
          $('#add', tp).addEventListener('click', () => { svc.push({ direction: 'A', departureTime: '08:00', active: true }); paint(); });
          $('#save', tp).addEventListener('click', async () => {
            $('#serr', tp).hidden = true;
            try { await api(`/api/admin/trains/${id}/services`, { method: 'PUT', body: { services: svc } }); await reload(); toast('Jam operasional tersimpan. Tekan "Terapkan ke jadwal mendatang" agar jadwal ikut berubah.', 'ok'); trains(); } catch (e2) { $('#serr', tp).textContent = errMsg(e2); $('#serr', tp).hidden = false; }
          });
          $('#regen', tp).addEventListener('click', regen);
        };
        paint();
      },
    };
    async function regen() {
      if (!await confirmDialog({ title: 'Terapkan ke jadwal mendatang?', body: '<p>Perjalanan mendatang yang belum punya pemesan dibuat ulang dengan rute dan jam terbaru. Perjalanan yang sudah ada pemesannya tidak diubah.</p>', confirm: 'Terapkan' })) return;
      try { const r = await api(`/api/admin/trains/${id}/regenerate`, { method: 'POST', body: {} }); toast(`${r.removed} jadwal diperbarui, ${r.kept} dipertahankan karena sudah ada pemesan, ${r.created} jadwal dibuat.`, 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
    }
    $$('[data-p]', s.el).forEach((b) => b.addEventListener('click', () => { $$('[data-p]', s.el).forEach((x) => x.setAttribute('aria-selected', String(x === b))); panels[b.dataset.p](); }));
    panels.info();
  }

  /* ----- Stasiun ----- */
  async function stationsTab() {
    const ops = $('#ops');
    await loadRefs();
    ops.innerHTML = `<div class="row between" style="margin-bottom:14px"><div class="search-in" style="flex:1 1 260px;max-width:360px">${icon.search}<input class="in" id="sq" placeholder="Cari kode, nama, atau kota"></div><button class="btn gold sm" id="add-st">${icon.plus} Tambah stasiun</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kode</th><th>Nama</th><th>Kota</th><th>Dipakai rute</th><th>Aktif</th><th></th></tr></thead><tbody id="st-body"></tbody></table></div>`;
    const paint = () => {
      const q = $('#sq', ops).value.trim().toLowerCase();
      $('#st-body', ops).innerHTML = stations.filter((x) => !q || `${x.code} ${x.name} ${x.city}`.toLowerCase().includes(q)).map((x) => `<tr><td class="mono">${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.city)}</td><td>${x.usedByRoute ? '<span class="chip go">Ya</span>' : '<span class="muted">Tidak</span>'}</td>
        <td><label class="switch"><input type="checkbox" data-act="${x.code}" ${x.active ? 'checked' : ''} aria-label="Aktifkan ${esc(x.name)}"><i></i></label></td>
        <td class="acts"><button class="btn ghost sm" data-ed="${x.code}">${icon.edit} Ubah</button><button class="btn ghost sm danger-text" data-del="${x.code}" ${x.usedByRoute ? 'disabled title="Masih dipakai rute"' : ''} aria-label="Hapus stasiun ${x.code}">${icon.trash} Hapus</button></td></tr>`).join('');
    };
    paint();
    $('#sq', ops).addEventListener('input', debounce(paint, 120));
    const form = (x) => {
      const s = sheet(x ? `Ubah ${esc(x.name)}` : 'Tambah stasiun', `<form class="stack" id="sf" novalidate>
        ${field('code', 'Kode', `<input class="in mono" id="f-code" maxlength="4" value="${esc(x?.code || '')}" ${x ? 'readonly' : ''} placeholder="GMR">`, '2 sampai 4 huruf kapital.')}
        ${field('name', 'Nama stasiun', `<input class="in" id="f-name" value="${esc(x?.name || '')}" maxlength="60">`)}
        ${field('city', 'Kota', `<input class="in" id="f-city" value="${esc(x?.city || '')}" maxlength="40">`)}
        <div class="row end"><button class="btn gold" type="submit">${x ? 'Simpan' : 'Tambah'}</button></div></form>`);
      $('#f-code', s.el).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
      $('#sf', s.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFieldErrors(e.currentTarget);
        const body = { name: $('#f-name', s.el).value.trim(), city: $('#f-city', s.el).value.trim() };
        try {
          if (x) await api(`/api/admin/stations/${x.code}`, { method: 'PATCH', body });
          else await api('/api/admin/stations', { method: 'POST', body: { code: $('#f-code', s.el).value, ...body } });
          s.close();
          toast('Stasiun tersimpan.', 'ok');
          stationsTab();
        } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
      });
    };
    $('#add-st', ops).addEventListener('click', () => form(null));
    ops.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-ed]'); const del = e.target.closest('[data-del]');
      if (ed) form(stations.find((x) => x.code === ed.dataset.ed));
      if (del && await confirmDialog({ title: `Hapus stasiun ${del.dataset.del}?`, body: '<p>Stasiun dihapus permanen. Stasiun yang masih dipakai rute tidak bisa dihapus.</p>', confirm: 'Hapus', danger: true })) {
        try { await api(`/api/admin/stations/${del.dataset.del}`, { method: 'DELETE' }); toast('Stasiun dihapus.', 'ok'); stationsTab(); } catch (ex) { toast(errMsg(ex), 'err'); }
      }
    });
    ops.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-act]');
      if (!c) return;
      try { await api(`/api/admin/stations/${c.dataset.act}`, { method: 'PATCH', body: { active: c.checked } }); toast(c.checked ? 'Stasiun diaktifkan.' : 'Stasiun dinonaktifkan dan tidak tampil di pencarian.', 'ok'); } catch (ex) { c.checked = !c.checked; toast(errMsg(ex), 'err'); }
    });
  }

  /* ----- Pengaturan tarif ----- */
  async function settings() {
    const ops = $('#ops');
    const { seniorDiscountPercent: v } = await api('/api/admin/settings');
    ops.innerHTML = `<form class="card stack narrow-card" id="setf" novalidate>
      <div class="card-head"><div><h2>Diskon lansia</h2><p>Berlaku untuk penumpang 60 tahun ke atas di semua kereta. Bayi, anak, dan dewasa bertarif normal.</p></div></div>
      <div class="f" data-name="seniorDiscountPercent"><label for="f-sd">Persentase diskon</label><div class="range-row"><input type="range" id="f-sdr" min="0" max="100" value="${v}"><div class="in-suffix"><input class="in mono" id="f-sd" value="${v}" inputmode="numeric" maxlength="3"><span>%</span></div></div><small class="hint">0 sampai 100 persen. Bawaan 10 persen.</small></div>
      <div class="fare-ex"><span class="muted">Contoh tarif dewasa Rp500.000 menjadi</span><b class="mono" id="sd-ex"></b></div>
      <div class="row end"><button class="btn gold" type="submit">Simpan diskon</button></div></form>`;
    const sync = (val) => { const n = Math.max(0, Math.min(100, Number(val) || 0)); $('#f-sd', ops).value = n; $('#f-sdr', ops).value = n; $('#sd-ex', ops).textContent = rupiah(Math.ceil(Math.floor((500000 * (100 - n)) / 100) / 1000) * 1000); };
    sync(v);
    $('#f-sdr', ops).addEventListener('input', (e) => sync(e.target.value));
    $('#f-sd', ops).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); if (e.target.value !== '') sync(e.target.value); });
    $('#setf', ops).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/admin/settings', { method: 'PUT', body: { seniorDiscountPercent: Number($('#f-sd', ops).value) } }); toast(`Diskon lansia sekarang ${r.seniorDiscountPercent}%.`, 'ok'); Kiko.react('bangga', 'Diskon lansia diperbarui!', 2000); } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
    });
  }

  const tabs = { trains, stations: stationsTab, settings };
  $$('.tabs-line [data-t]', box).forEach((b) => b.addEventListener('click', () => { $$('.tabs-line [data-t]', box).forEach((x) => x.setAttribute('aria-selected', String(x === b))); tabs[b.dataset.t]().catch((e) => toast(e.message, 'err')); }));
  await trains();
  return null;
}

/* =========================================================
 * Pengguna
 * ========================================================= */
async function users(box) {
  box.innerHTML = `<div class="shell-head"><div><h1>Manajemen <em>pengguna</em></h1><p>Tambah, ubah, nonaktifkan, dan hapus akun. Atur peran pelanggan, masinis, atau admin, serta setel ulang kata sandi.</p></div><button class="btn gold" id="add-u">${icon.plus} Tambah pengguna</button></div>
    <div class="row" style="--gap:10px"><div class="search-in" style="flex:1 1 280px;max-width:420px">${icon.search}<input class="in" id="uq" placeholder="Cari nama, email, atau NIK"></div>
      <div class="seg" id="ur" role="group" aria-label="Filter peran"><button aria-pressed="true" data-r="">Semua</button><button aria-pressed="false" data-r="customer">Pelanggan</button><button aria-pressed="false" data-r="masinis">Masinis</button><button aria-pressed="false" data-r="admin">Admin</button></div></div>
    <div id="ulist"><span class="skel" style="height:300px"></span></div>`;
  let role = '';
  const me = currentUser()?.id;
  const load = async () => {
    const q = $('#uq').value.trim();
    const r = await api(`/api/admin/users?${new URLSearchParams({ q, role })}`);
    if (!$('#ulist')) return;
    $('#ulist').innerHTML = r.users.length ? `<p class="muted" style="margin:4px 0 10px">${r.total} pengguna</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pengguna</th><th>Peran</th><th>Kontak</th><th>NIK</th><th>Status</th><th>Terdaftar</th><th></th></tr></thead><tbody>
      ${r.users.map((u) => `<tr class="${u.active ? '' : 'dim-soft'}"><td><div class="who-cell"><span class="avatar sm">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b>${u.id === me ? ' <span class="chip gold">Anda</span>' : ''}<span class="sub">${esc(u.email)}</span></span></div></td>
        <td><span class="chip ${u.role === 'admin' ? 'gold' : u.role === 'masinis' ? 'go' : ''}">${ROLE[u.role]}</span></td><td class="mono">${esc(u.phone || '-')}</td><td class="mono">${esc(u.nik || '-')}</td>
        <td>${u.active ? '<span class="pill ok">Aktif</span>' : '<span class="pill mute">Nonaktif</span>'}</td><td>${dateNum(u.createdAt)}</td>
        <td class="acts"><button class="btn ghost sm" data-ed="${esc(u.id)}">${icon.edit} Ubah</button><button class="btn ghost sm" data-pw="${esc(u.id)}">${icon.key} Sandi</button><button class="btn ghost sm danger-text" data-del="${esc(u.id)}" ${u.id === me ? 'disabled title="Akun sendiri tidak bisa dihapus"' : ''} aria-label="Hapus ${esc(u.name)}">${icon.trash} Hapus</button></td></tr>`).join('')}
      </tbody></table></div>` : empty('Tidak ada pengguna yang cocok.');
    $$('[data-ed]', box).forEach((b) => b.addEventListener('click', () => form(r.users.find((u) => u.id === b.dataset.ed))));
    $$('[data-pw]', box).forEach((b) => b.addEventListener('click', () => resetPw(r.users.find((u) => u.id === b.dataset.pw))));
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => del(r.users.find((u) => u.id === b.dataset.del))));
  };
  function form(u) {
    const self = u?.id === me;
    const s = sheet(u ? `Ubah ${esc(u.name)}` : 'Tambah pengguna', `<form class="stack" id="uf" novalidate>
      ${field('name', 'Nama lengkap', `<input class="in" id="f-name" value="${esc(u?.name || '')}" maxlength="80">`)}
      ${field('email', 'Email', `<input class="in" id="f-email" type="email" value="${esc(u?.email || '')}" maxlength="120">`)}
      ${u ? '' : field('password', 'Kata sandi awal', '<input class="in" id="f-password" type="text" maxlength="72" autocomplete="off">', 'Minimal 8 karakter, huruf dan angka. Sampaikan ke pengguna lewat jalur aman.')}
      <div class="grid-2">${field('phone', 'Nomor HP <span class="opt">(opsional)</span>', `<input class="in mono" id="f-phone" value="${esc(u?.phone || '')}" maxlength="16">`)}${field('birthDate', 'Tanggal lahir <span class="opt">(opsional)</span>', `<input class="in mono" id="f-birthDate" type="date" value="${esc(u?.birthDate || '')}" max="${wibToday()}">`)}</div>
      ${field('nik', 'NIK <span class="opt">(opsional)</span>', `<input class="in mono" id="f-nik" value="${esc(u?.nik || '')}" maxlength="16" inputmode="numeric">`)}
      ${field('role', 'Peran', `<select class="sel" id="f-role" ${self ? 'disabled' : ''}>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${(u?.role || 'customer') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, self ? 'Peran akun sendiri tidak bisa diubah, agar admin tidak terkunci.' : 'Masinis melihat jadwal dinas dan manifest; admin mengelola seluruh sistem.')}
      ${u ? `<label class="switch"><input type="checkbox" id="f-active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}><i></i>Akun aktif (nonaktif tidak bisa masuk)</label>` : ''}
      <div class="row end"><button class="btn gold" type="submit">${u ? 'Simpan perubahan' : 'Buat akun'}</button></div></form>`);
    $('#f-nik', s.el).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
    $('#uf', s.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(e.currentTarget);
      const v = (k) => $(`#f-${k}`, s.el)?.value.trim();
      const body = { name: v('name'), email: v('email'), phone: v('phone') || null, nik: v('nik') || null, birthDate: v('birthDate') || null, role: $('#f-role', s.el).value };
      try {
        if (u) await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { ...body, ...(self ? {} : { active: $('#f-active', s.el).checked }) } });
        else await api('/api/admin/users', { method: 'POST', body: { ...body, password: $('#f-password', s.el).value } });
        s.close();
        toast(u ? 'Pengguna diperbarui.' : 'Akun dibuat.', 'ok');
        load();
      } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
    });
  }
  function resetPw(u) {
    const s = sheet(`Setel ulang kata sandi`, `<form class="stack" id="pf" novalidate><p class="muted">Untuk <b>${esc(u.name)}</b> (${esc(u.email)}). Semua sesi pengguna ini akan dikeluarkan.</p>
      ${field('password', 'Kata sandi baru', '<input class="in" id="f-password" type="text" maxlength="72" autocomplete="off">', 'Minimal 8 karakter, campuran huruf dan angka.')}
      <div class="row end"><button class="btn gold" type="submit">Ganti kata sandi</button></div></form>`);
    $('#pf', s.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(e.currentTarget);
      try { await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password: $('#f-password', s.el).value } }); s.close(); toast('Kata sandi diganti.', 'ok'); } catch (ex) { if (!showFieldErrors(e.currentTarget, ex)) toast(errMsg(ex), 'err'); }
    });
  }
  async function del(u) {
    if (!await confirmDialog({ title: `Hapus ${u.name}?`, body: `<p>Akun <b>${esc(u.email)}</b> dihapus permanen dan tidak bisa dipulihkan. Untuk menghentikan akses sementara, nonaktifkan saja akunnya.</p>`, confirm: 'Hapus permanen', danger: true })) return;
    try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); toast('Akun dihapus.', 'ok'); load(); } catch (ex) { toast(errMsg(ex), 'err'); }
  }
  $('#add-u').addEventListener('click', () => form(null));
  $('#uq').addEventListener('input', debounce(load, 220));
  $$('#ur [data-r]').forEach((b) => b.addEventListener('click', () => { role = b.dataset.r; $$('#ur [data-r]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  await load();
  return null;
}

/* =========================================================
 * Armada dan riwayat
 * ========================================================= */
async function fleet(box, id) {
  if (!id) {
    const { trains: list } = await api('/api/admin/trains');
    box.innerHTML = `<div class="shell-head"><div><h1>Armada <em>& riwayat</em></h1><p>Pilih kereta untuk melihat riwayat perjalanan di semua tanggal dan tahun, jumlah penumpang, serta daftar penumpangnya.</p></div></div>
      <div class="fleet-grid admin">${list.map((t) => `<a class="tcard" href="/admin/armada/${esc(t.id)}" data-link><header><span class="mono">${esc(t.number)}</span>${t.enabled ? '<span class="pill ok">Aktif</span>' : '<span class="pill mute">Nonaktif</span>'}</header><h3>${esc(t.name)}</h3>
        <p class="tc-route">${t.route.length ? `${esc(t.origin.name)} <i aria-hidden="true"></i> ${esc(t.destination.name)}` : 'Rute belum diatur'}</p><dl class="tc-meta"><div><dt>Masinis</dt><dd>${esc(t.masinisName || '-')}</dd></div><div><dt>Kelas</dt><dd>${t.classes.map((c) => CLASS[c]).join(', ')}</dd></div></dl><span class="btn ghost sm">Lihat riwayat</span></a>`).join('')}</div>`;
    return null;
  }
  const state = { from: '', to: '', offset: 0, limit: 20 };
  box.innerHTML = `<div class="shell-head"><div><a class="btn link" href="/admin/armada" data-link>&larr; Semua armada</a><h1 id="fh">Riwayat <em>perjalanan</em></h1><p id="fsub"></p></div></div>
    <div id="fperiod"></div>
    <div id="fstats" class="stats"></div>
    <div id="flist"><span class="skel" style="height:300px"></span></div>`;
  const load = async () => {
    const p = new URLSearchParams({ limit: state.limit, offset: state.offset, ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}) });
    const r = await api(`/api/admin/trains/${encodeURIComponent(id)}/trips?${p}`);
    const { stats } = r.trips.length ? await api('/api/admin/trip-stats', { method: 'POST', body: { tripIds: r.trips.map((t) => t.id) } }) : { stats: {} };
    if (!$('#flist')) return;
    $('#fh').innerHTML = `${esc(r.train.name)} <em>${esc(r.train.number)}</em>`;
    $('#fsub').textContent = `${r.total} perjalanan tercatat${state.from || state.to ? ' pada rentang ini' : ' di semua tanggal'}.`;
    const pax = Object.values(stats).reduce((n, s) => n + s.passengers, 0);
    const rev = Object.values(stats).reduce((n, s) => n + s.revenue, 0);
    $('#fstats').innerHTML = `<div class="stat"><span>Perjalanan (halaman ini)</span><b>${r.trips.length}</b></div><div class="stat"><span>Penumpang</span><b>${pax}</b></div><div class="stat gold"><span>Pendapatan</span><b>${rupiah(rev)}</b></div><div class="stat"><span>Sudah naik</span><b>${Object.values(stats).reduce((n, s) => n + s.checkedIn, 0)}</b></div>`;
    $('#flist').innerHTML = r.trips.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Relasi</th><th>Berangkat</th><th>Status</th><th>Masinis</th><th class="num">Penumpang</th><th class="num">Pendapatan</th><th></th></tr></thead><tbody>
      ${r.trips.map((t) => { const s = stats[t.id] || { passengers: 0, revenue: 0 }; return `<tr><td><b>${dateNum(t.departureAt)}</b><span class="sub">${dayName(t.departureAt)}</span></td><td>${esc(t.origin.name)} &rarr; ${esc(t.destination.name)}<span class="sub">Arah ${t.direction}</span></td>
        <td class="mono">${timeOf(t.departureAt)}<span class="sub">tiba ${timeOf(t.arriveAt)}</span></td><td>${pill(PHASE, t.phase)} ${t.status !== 'SCHEDULED' ? pill(TRIP_STATUS, t.status) : ''}</td><td>${esc(t.masinisName || '-')}</td>
        <td class="num">${s.passengers}</td><td class="num">${rupiah(s.revenue)}</td><td class="acts"><button class="btn ghost sm" data-trip="${esc(t.id)}">Detail</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="pager"><span>${state.offset + 1}-${state.offset + r.trips.length} dari ${r.total}</span><div class="row"><button class="btn ghost sm" id="prev" ${state.offset === 0 ? 'disabled' : ''}>Sebelumnya</button><button class="btn ghost sm" id="next" ${state.offset + r.trips.length >= r.total ? 'disabled' : ''}>Berikutnya</button></div></div>`
      : empty('Tidak ada perjalanan pada rentang ini.');
    $('#prev')?.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); load(); });
    $('#next')?.addEventListener('click', () => { state.offset += state.limit; load(); });
    $$('[data-trip]', box).forEach((b) => b.addEventListener('click', () => tripDetail(b.dataset.trip, r.trips.find((t) => t.id === b.dataset.trip))));
  };
  periodFilter($('#fperiod'), { id: 'fp', presets: ['all', 'past7', 'past30', 'year'], initial: 'all', onChange: (r) => { state.from = r.from; state.to = r.to; state.offset = 0; load(); } });
  await load();
  return null;
}

async function tripDetail(tripId, t) {
  const s = sheet(`Penumpang <small class="muted mono">${esc(tripId)}</small>`, '<span class="skel" style="height:240px"></span>', { wide: true });
  try {
    const { passengers } = await api(`/api/admin/trips/${encodeURIComponent(tripId)}/passengers`);
    const ok = passengers.filter((p) => ['CONFIRMED', 'CHECKED_IN'].includes(p.status));
    s.body.innerHTML = `${t ? `<p class="muted">${esc(t.origin.name)} ke ${esc(t.destination.name)} · ${dateNum(t.departureAt)}, ${timeOf(t.departureAt)}</p>` : ''}
      <div class="row" style="margin:12px 0"><span class="chip">${passengers.length} tercatat</span><span class="chip go">${ok.length} terkonfirmasi</span><span class="chip">${passengers.filter((p) => p.checkedIn).length} sudah naik</span></div>
      ${passengers.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kursi</th><th>Penumpang</th><th>Pemesan</th><th>NIK</th><th>Ruas</th><th>Status</th></tr></thead><tbody>
      ${passengers.map((p) => `<tr><td class="mono">${esc(p.seatId)}<span class="sub">${CLASS[p.seatClass] || ''}</span></td><td><b>${esc(p.name)}</b><span class="sub">${esc(p.passengerTypeLabel)} · ${p.age} th · ${rupiah(p.fare)}</span></td>
        <td>${esc(p.contactName || '-')}<span class="sub">${esc(p.contactEmail || '-')}</span></td><td class="mono">${esc(p.nik || '-')}</td><td>${esc(p.from)} &rarr; ${esc(p.to)}</td>
        <td>${pill({ CONFIRMED: ['Lunas', 'ok'], CHECKED_IN: ['Sudah naik', 'ok'], PENDING_PAYMENT: ['Belum bayar', 'wait'], CANCELLED: ['Batal', 'bad'], EXPIRED: ['Kedaluwarsa', 'mute'] }, p.status)}<span class="sub mono">${esc(p.bookingCode)}</span></td></tr>`).join('')}
      </tbody></table></div>` : empty('Belum ada penumpang di perjalanan ini.')}`;
  } catch (e) { s.body.innerHTML = empty(e.message); }
}

/* =========================================================
 * Verifikasi transfer
 * ========================================================= */
const REASONS = ['Nominal transfer tidak sesuai tagihan', 'Bukti tidak terbaca atau terpotong', 'Nomor virtual account tujuan berbeda', 'Bukti transfer bukan untuk pesanan ini', 'Transfer belum masuk ke rekening penampung'];

async function transfers(box) {
  box.innerHTML = `<div class="shell-head"><div><h1>Verifikasi <em>transfer</em></h1><p>Periksa bukti transfer virtual account. Keputusan bisa diubah kemudian; pengguna langsung mendapat notifikasi beserta alasannya.</p></div></div>
    <div class="seg" id="tf" role="group" aria-label="Filter status"><button aria-pressed="true" data-s="SUBMITTED">Menunggu</button><button aria-pressed="false" data-s="ACCEPTED">Diterima</button><button aria-pressed="false" data-s="REJECTED">Ditolak</button><button aria-pressed="false" data-s="ALL">Semua</button></div>
    <div id="tlist"><span class="skel" style="height:300px"></span></div>`;
  let status = 'SUBMITTED';
  const load = async () => {
    const r = await api(`/api/admin/transfers?status=${status}`);
    if (!$('#tlist')) return;
    $('#tlist').innerHTML = r.transfers.length ? `<div class="tx-list">${r.transfers.map((x) => {
      const b = x.booking || {};
      const st = { SUBMITTED: ['Menunggu', 'info'], ACCEPTED: ['Diterima', 'ok'], REJECTED: ['Ditolak', 'bad'] }[x.proof.status];
      return `<article class="tx" data-proof="${esc(x.proof.id)}">
        <div class="tx-thumb" data-view="${esc(x.proof.id)}" data-mime="${esc(x.proof.mimeType)}" role="button" tabindex="0" aria-label="Lihat bukti ${esc(x.proof.fileName)}"><span>${x.proof.mimeType === 'application/pdf' ? 'PDF' : 'Memuat'}</span></div>
        <div class="tx-main">
          <div class="row between"><div><b>${esc(x.user.name || b.contactName || '-')}</b> <span class="muted">${esc(x.user.email || b.contactEmail || '')}</span></div><span class="pill ${st[1]}">${st[0]}</span></div>
          <dl class="kv tx-kv"><div><dt>NIK pemesan</dt><dd class="mono">${esc(x.user.nik || b.passengers?.[0]?.nik || '-')}</dd></div><div><dt>Kereta</dt><dd>${esc(b.trainName || '-')}</dd></div><div><dt>Rute</dt><dd>${esc(b.from || '-')} &rarr; ${esc(b.to || '-')}</dd></div>
            <div><dt>Keberangkatan</dt><dd>${b.departureAt ? `${dateNum(b.departureAt)}, ${timeOf(b.departureAt)}` : '-'}</dd></div><div><dt>Nominal</dt><dd class="mono">${rupiah(x.payment.amount)}</dd></div><div><dt>VA</dt><dd class="mono">${esc(x.payment.bank)} ${esc(x.payment.vaNumber)}</dd></div>
            <div><dt>Kode pesanan</dt><dd class="mono">${esc(b.code || '-')}</dd></div><div><dt>Dikirim</dt><dd>${dateTime(x.proof.createdAt)}</dd></div></dl>
          ${x.proof.note ? `<p class="tx-note">"${esc(x.proof.note)}"</p>` : ''}
          ${x.proof.status === 'REJECTED' && x.proof.reason ? `<p class="tx-reason">Alasan ditolak: ${esc(x.proof.reason)}</p>` : ''}
          ${b.passengers?.length ? `<details class="tx-pax"><summary>${b.passengers.length} penumpang</summary><ul>${b.passengers.map((p) => `<li>${esc(p.seatId)} · ${esc(p.name)} · ${esc(p.passengerTypeLabel)} · NIK ${esc(p.nik || '-')}</li>`).join('')}</ul></details>` : ''}
          <div class="row tx-acts">${x.proof.status === 'SUBMITTED' ? `<button class="btn gold sm" data-acc="${esc(x.proof.id)}">${icon.check} Terima</button><button class="btn ghost sm" data-rej="${esc(x.proof.id)}">${icon.x} Tolak</button>`
    : `<span class="muted">Diputuskan ${x.proof.reviewedAt ? ago(x.proof.reviewedAt) : ''}.</span>${x.proof.status === 'ACCEPTED' ? `<button class="btn ghost sm" data-rej="${esc(x.proof.id)}">Ubah jadi ditolak</button>` : `<button class="btn ghost sm" data-acc="${esc(x.proof.id)}">Ubah jadi diterima</button>`}`}
            <button class="btn link" data-view="${esc(x.proof.id)}" data-mime="${esc(x.proof.mimeType)}">Buka bukti</button></div>
        </div></article>`;
    }).join('')}</div>` : empty(status === 'SUBMITTED' ? 'Tidak ada bukti yang menunggu. Semua sudah diperiksa.' : 'Belum ada data.');
    // Muat gambar mini bukti transfer memakai token.
    $$('.tx-thumb', box).forEach(async (t) => {
      try {
        const { url, type } = await protectedBlobUrl(`/api/payments/proofs/${t.dataset.view}/file`);
        // PDF ditampilkan halaman pertamanya (tanpa toolbar), gambar ditampilkan langsung.
        t.innerHTML = type === 'application/pdf' ? `<iframe class="tx-pdf" src="${url}#toolbar=0&navpanes=0&view=FitH" title="Pratinjau bukti PDF" tabindex="-1"></iframe>` : `<img src="${url}" alt="Bukti transfer">`;
      } catch { t.innerHTML = '<span>Gagal memuat</span>'; }
    });
  };
  const view = async (pid, mime) => {
    try {
      await openProof(`/api/payments/proofs/${pid}/file`);
    } catch (e) { toast(e.message, 'err'); }
  };
  const decide = async (pid, decision) => {
    let reason = '';
    if (decision === 'REJECT') {
      reason = await new Promise((resolve) => {
        const s = sheet('Tolak bukti transfer', `<form class="stack" id="rf" novalidate><p class="muted">Alasan dikirim ke pengguna lewat notifikasi dan tampil di Perjalanan saya, agar mereka tahu apa yang harus diperbaiki.</p>
          <div class="row reason-chips">${REASONS.map((r) => `<button type="button" class="chip-btn">${esc(r)}</button>`).join('')}</div>
          ${field('reason', 'Alasan penolakan', '<textarea class="ta" id="f-reason" maxlength="300" placeholder="Tulis alasan yang jelas"></textarea>', 'Minimal 5 karakter.')}
          <div class="row end"><button class="btn ghost" type="button" data-close>Batal</button><button class="btn danger" type="submit">Tolak dan kirim alasan</button></div></form>`);
        $$('.chip-btn', s.el).forEach((c) => c.addEventListener('click', () => { $('#f-reason', s.el).value = c.textContent; $('#f-reason', s.el).focus(); }));
        $('#rf', s.el).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = $('#f-reason', s.el).value.trim();
          if (v.length < 5) { showFieldErrors(e.currentTarget, { details: { fields: { reason: 'Minimal 5 karakter.' } } }); return; }
          s.close();
          resolve(v);
        });
        const obs = new MutationObserver(() => { if (!s.el.isConnected) { obs.disconnect(); resolve(null); } });
        obs.observe(document.body, { childList: true });
      });
      if (reason === null) return;
    } else if (!await confirmDialog({ title: 'Terima transfer ini?', body: '<p>Pembayaran ditandai berhasil dan tiket langsung terbit untuk pelanggan.</p>', confirm: 'Terima dan terbitkan tiket' })) return;
    try {
      await api(`/api/admin/transfers/${pid}/decision`, { method: 'POST', body: { decision, ...(reason ? { reason } : {}) } });
      toast(decision === 'ACCEPT' ? 'Transfer diterima. Tiket diterbitkan.' : 'Transfer ditolak. Pengguna sudah diberi tahu.', 'ok');
      Kiko.react(decision === 'ACCEPT' ? 'sukses' : 'cemas', decision === 'ACCEPT' ? 'Tiket terbit!' : 'Alasan sudah dikirim ke pengguna.', 2200);
      load();
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  box.addEventListener('click', (e) => {
    const v = e.target.closest('[data-view]'); const a = e.target.closest('[data-acc]'); const r = e.target.closest('[data-rej]');
    if (a) decide(a.dataset.acc, 'ACCEPT'); else if (r) decide(r.dataset.rej, 'REJECT'); else if (v) view(v.dataset.view, v.dataset.mime);
  });
  box.addEventListener('keydown', (e) => { const v = e.target.closest('.tx-thumb'); if (v && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); view(v.dataset.view, v.dataset.mime); } });
  $$('#tf [data-s]').forEach((b) => b.addEventListener('click', () => { status = b.dataset.s; $$('#tf [data-s]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  await load();
  const h = setInterval(() => { if (!document.hidden && status === 'SUBMITTED' && !$('.sheet')) load().catch(() => {}); }, 15000);
  return () => clearInterval(h);
}

/* =========================================================
 * Sistem: registry, antrian, audit, API key
 * ========================================================= */
async function system(box) {
  box.innerHTML = `<div class="shell-head"><div><h1>Kesehatan <em>sistem</em></h1><p>Service discovery, load balancing, antrian pesan, audit keamanan, dan API key partner.</p></div></div>
    <div class="tabs-line" role="tablist"><button role="tab" aria-selected="true" data-t="svc">Service & antrian</button><button role="tab" aria-selected="false" data-t="audit">Audit & peringatan</button><button role="tab" aria-selected="false" data-t="keys">API key partner</button></div><div id="sys"></div>`;
  let timer = 0;
  const tabs = {
    async svc() {
      const paint = async () => {
        const [{ services }, { queues, maxAttempts }, stats] = await Promise.all([api('/api/admin/registry'), api('/api/admin/queues'), api('/api/admin/booking-stats')]);
        if (!$('#sys')) return;
        $('#sys').innerHTML = `<div class="svc-grid">${services.map((s) => `<div class="svc ${s.instances.length ? 'up' : 'down'}"><b>${esc(s.name)}</b><span class="mono">${s.instances.length} instance</span><small class="muted mono">${s.instances.map((i) => esc(i.instanceId)).join(', ') || 'tidak ada'}</small></div>`).join('')}</div>
          <div class="c-stat"><span>Lock aktif <b class="mono">${stats.activeLocks}</b></span><span>Klaim segmen <b class="mono">${stats.claims}</b></span><span>Outbox tertunda <b class="mono">${stats.outboxPending}</b></span><span>Dilayani <b class="mono">${esc(stats.instance)}</b></span></div>
          <h2 class="h-xs" style="margin-top:18px">Antrian pesan</h2>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Antrian</th><th class="num">Siap</th><th class="num">Diproses</th><th class="num">DLQ</th><th class="num">Terbit</th><th class="num">Selesai</th><th></th></tr></thead><tbody>
          ${queues.map((q) => `<tr><td class="mono">${esc(q.queue)}</td><td class="num">${q.ready || 0}</td><td class="num">${q.inflight || 0}</td><td class="num ${q.dead ? 'hot' : ''}">${q.dead || 0}</td><td class="num">${q.published || 0}</td><td class="num">${q.acked || 0}</td><td class="acts">${q.dead ? `<button class="btn ghost sm" data-replay="${esc(q.queue)}">Kirim ulang DLQ</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="row" style="margin-top:12px"><button class="btn ghost sm" id="ping">Uji antrian</button><button class="btn ghost sm" id="poison">Kirim pesan beracun</button><small class="muted">Pesan beracun gagal ${maxAttempts} kali lalu masuk DLQ.</small></div>`;
        $('#ping').addEventListener('click', () => api('/api/admin/queues/publish-test', { method: 'POST', body: { note: 'uji dari panel admin' } }).then(() => toast('Pesan uji dikirim.', 'ok')));
        $('#poison').addEventListener('click', () => api('/api/admin/queues/publish-test', { method: 'POST', body: { poison: true, note: 'beracun' } }).then(() => toast('Pesan beracun dikirim. Pantau kolom DLQ.', 'warn')));
        $$('[data-replay]').forEach((b) => b.addEventListener('click', () => api(`/api/admin/queues/${b.dataset.replay}/dlq/replay`, { method: 'POST', body: {} }).then((r) => toast(`${r.replayed} pesan dikirim ulang.`, 'ok'))));
      };
      await paint();
      timer = setInterval(() => { if (!document.hidden) paint().catch(() => {}); }, 4000);
    },
    async audit() {
      const [{ alerts }, { entries }] = await Promise.all([api('/api/admin/alerts'), api('/api/admin/audit?limit=80')]);
      $('#sys').innerHTML = `<h2 class="h-xs">Peringatan keamanan</h2>${alerts.length ? `<div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Waktu</th><th>Jenis</th><th>Tingkat</th><th>Layanan</th></tr></thead><tbody>${alerts.map((a) => `<tr><td>${dateTime(a.at)}</td><td class="mono">${esc(a.kind)}</td><td><span class="pill ${a.severity === 'high' ? 'bad' : 'wait'}">${esc(a.severity)}</span></td><td>${esc(a.service || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Tidak ada peringatan.</p>'}
        <h2 class="h-xs" style="margin-top:22px">Audit log</h2>${entries.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Aksi</th><th>Layanan</th><th>Pelaku</th><th>Sasaran</th></tr></thead><tbody>${entries.map((a) => `<tr><td>${dateTime(a.at)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.service || '')}</td><td class="mono">${esc((a.actor || '-').slice(0, 20))}</td><td class="mono">${esc((a.target || '-').slice(0, 26))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Belum ada catatan.</p>'}`;
    },
    async keys() {
      $('#sys').innerHTML = `<p class="muted">Key penuh hanya tampil sekali, lalu hanya hash yang disimpan.</p>
        <form id="nk" class="row filter-bar"><div class="f" style="flex:1 1 220px"><label for="kn">Nama partner</label><input class="in" id="kn" maxlength="60" required></div><div class="f"><label for="kr">Kuota per menit</label><input class="in mono" id="kr" type="number" min="1" max="6000" value="60"></div><div class="f"><label for="kd">Berlaku (hari)</label><input class="in mono" id="kd" type="number" min="1" max="365" value="30"></div><button class="btn gold sm">Buat key</button></form>
        <div id="fresh" aria-live="polite"></div><div id="keys"></div>`;
      const reveal = (r) => { $('#fresh').innerHTML = `<div class="key-once"><p><b>Salin sekarang.</b> Key ini tidak akan ditampilkan lagi.</p><code class="mono">${esc(r.key)}</code></div>`; Kiko.react('awas', 'Simpan key-nya sekarang, ya. Hanya tampil sekali!', 3200); };
      const load = async () => {
        const { keys } = await api('/api/admin/api-keys');
        $('#keys').innerHTML = keys.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Awalan</th><th>Kuota</th><th>Berlaku sampai</th><th>Terakhir dipakai</th><th></th></tr></thead><tbody>
          ${keys.map((k) => `<tr class="${k.revokedAt ? 'dim' : ''}"><td>${esc(k.name)}</td><td class="mono">${esc(k.prefix)}…</td><td class="mono">${k.ratePerMin}/mnt</td><td>${dateTime(k.expiresAt)}</td><td>${k.lastUsedAt ? dateTime(k.lastUsedAt) : '-'}</td>
          <td class="acts">${k.revokedAt ? 'Dicabut' : `<button class="btn ghost sm" data-rot="${esc(k.id)}">Rotasi</button><button class="btn ghost sm" data-rev="${esc(k.id)}">Cabut</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Belum ada API key.</p>';
        $$('[data-rot]').forEach((b) => b.addEventListener('click', async () => { reveal(await api(`/api/admin/api-keys/${b.dataset.rot}/rotate`, { method: 'POST', body: {} })); load(); }));
        $$('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
          if (!await confirmDialog({ title: 'Cabut key ini?', body: '<p>Partner langsung kehilangan akses. Key lain tidak terpengaruh.</p>', confirm: 'Cabut', danger: true })) return;
          await api(`/api/admin/api-keys/${b.dataset.rev}`, { method: 'DELETE' });
          load();
        }));
      };
      $('#nk').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { reveal(await api('/api/admin/api-keys', { method: 'POST', body: { name: $('#kn').value.trim(), ratePerMin: Number($('#kr').value), expiresInDays: Number($('#kd').value), scopes: ['partner:read'] } })); $('#kn').value = ''; load(); } catch (ex) { toast(errMsg(ex), 'err'); }
      });
      await load();
    },
  };
  const open = (k) => { clearInterval(timer); $('#sys').innerHTML = '<span class="skel" style="height:240px"></span>'; tabs[k]().catch((e) => toast(e.message, 'err')); };
  $$('.tabs-line [data-t]', box).forEach((b) => b.addEventListener('click', () => { $$('.tabs-line [data-t]', box).forEach((x) => x.setAttribute('aria-selected', String(x === b))); open(b.dataset.t); }));
  open('svc');
  return () => clearInterval(timer);
}

/* =========================================================
 * Kerangka halaman
 * ========================================================= */
const VIEWS = { '': dashboard, data: dataOps, pengguna: users, armada: fleet, transfer: transfers };

export function render(main, { params }) {
  const section = params.section || '';
  if (!VIEWS[section]) { go('/admin', { replace: true }); return undefined; }
  main.innerHTML = `<div class="wrap shell solo">
    <div class="shell-main" id="view"><span class="skel" style="height:360px"></span></div>
  </div>`;
  let off = null;
  let alive = true;
  Promise.resolve(VIEWS[section]($('#view'), params.id)).then((fn) => { if (alive) off = fn; else fn?.(); }).catch((e) => { const v = $('#view'); if (v) v.innerHTML = empty(e.message); });
  return () => { alive = false; off?.(); $$('.sheet').forEach((s) => s.remove()); };
}
