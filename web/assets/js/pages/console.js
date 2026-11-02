/**
 * Konsol operator dan admin. Tab dibatasi peran, jadi tiap orang hanya melihat yang perlu.
 * Operator: check-in, manifest, status perjalanan. Admin: tambahan kesehatan sistem, antrian, API key, audit.
 */
import { $, $$, api, gql, esc, hasScope, wibToday, timeOf, toast, confirmDialog } from '../core.js';
import { Kiko } from '../kiko.js';

const when = (t) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(t));

async function tripOptions(date) {
  const lines = [['SGU', 'YK'], ['GMR', 'SLO'], ['GMR', 'SBI'], ['BD', 'SGU'], ['ML', 'YK']];
  const results = await Promise.all(lines.map(([from, to]) => gql('query($f:String!,$t:String!,$d:String!){searchTrips(from:$f,to:$t,date:$d){trip{id trainName status delayMinutes departureAt}}}', { f: from, t: to, d: date }).catch(() => ({ searchTrips: [] }))));
  return results.flatMap((r) => r.searchTrips.map((o) => o.trip)).filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).sort((a, b) => a.departureAt.localeCompare(b.departureAt));
}

/* ---------- Check-in ---------- */
function tabCheckin(box) {
  box.innerHTML = `<div class="c-panel narrow">
    <h2>Periksa <em>karcis</em></h2><p class="muted">Pindai QR atau tempel kode tiket.</p>
    <form id="ci" class="c-row"><label class="sr" for="code">Kode tiket</label><input class="c-in mono" id="code" placeholder="TKT-..." autocomplete="off"><button class="btn gold">Periksa</button></form>
    <div id="ci-out" aria-live="polite"></div>
  </div>`;
  $('#code').focus();
  $('#ci').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticketCode = $('#code').value.trim();
    if (ticketCode.length < 8) return;
    try {
      const r = await api('/api/tickets/checkin', { method: 'POST', body: { ticketCode } });
      $('#ci-out').innerHTML = `<div class="ci-ok"><b>${esc(r.passenger)}</b><span class="mono">${esc(r.seatId)} · ${esc(r.trainName)} · ${esc(r.bookingCode)}</span></div>`;
      Kiko.react('sukses', 'Karcis sah. Silakan naik!', 1800);
      $('#code').value = '';
    } catch (ex) {
      $('#ci-out').innerHTML = `<div class="ci-bad">${esc(ex.message)}</div>`;
      Kiko.react('gagal');
    }
    $('#code').focus();
  });
}

/* ---------- Perjalanan: manifest dan status ---------- */
function tabTrips(box) {
  box.innerHTML = `<div class="c-panel">
    <div class="c-row"><label class="c-lab" for="d">Tanggal</label><input class="c-in" id="d" type="date" value="${wibToday()}"><label class="c-lab" for="t">Perjalanan</label><select class="c-in" id="t"></select></div>
    <div id="trip-act" class="c-row"></div><div id="manifest"></div>
  </div>`;
  let trips = [];
  const loadTrips = async () => {
    trips = await tripOptions($('#d').value);
    $('#t').innerHTML = trips.length ? trips.map((t) => `<option value="${esc(t.id)}">${timeOf(t.departureAt)} ${esc(t.trainName)}${t.status !== 'SCHEDULED' ? ` (${t.status})` : ''}</option>`).join('') : '<option value="">Tidak ada perjalanan tersisa</option>';
    await loadManifest();
  };
  const loadManifest = async () => {
    const id = $('#t').value;
    if (!id) { $('#manifest').innerHTML = ''; $('#trip-act').innerHTML = ''; return; }
    const t = trips.find((x) => x.id === id);
    $('#trip-act').innerHTML = t.status === 'CANCELLED' ? '<span class="pill cancelled">Dibatalkan</span>' : `<button class="btn ghost sm" id="delay">Tandai terlambat 15 menit</button><button class="btn ghost sm" id="off">Batalkan perjalanan</button>`;
    $('#delay')?.addEventListener('click', async () => {
      await gql('mutation($i:ID!){updateTripStatus(id:$i,status:DELAYED,delayMinutes:15){id}}', { i: id });
      toast('Penumpang diberi tahu lewat notifikasi.', 'ok');
      loadTrips();
    });
    $('#off')?.addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Batalkan perjalanan ini?', body: '<p>Semua pesanan dibatalkan dan dana dikembalikan penuh. Tindakan ini tidak bisa diurungkan.</p>', confirm: 'Batalkan perjalanan', danger: true });
      if (!yes) return;
      await gql('mutation($i:ID!){updateTripStatus(id:$i,status:CANCELLED){id}}', { i: id });
      toast('Perjalanan dibatalkan. Pengembalian dana diproses lewat antrian.', 'ok');
      loadTrips();
    });
    const { passengers } = await api(`/api/trips/${encodeURIComponent(id)}/manifest`);
    $('#manifest').innerHTML = passengers.length ? `<div class="c-scroll"><table class="c-table"><thead><tr><th>Kursi</th><th>Penumpang</th><th>NIK</th><th>Ruas</th><th>Kode</th><th>Status</th></tr></thead><tbody>
      ${passengers.map((p) => `<tr><td class="mono">${esc(p.seatId)}</td><td>${esc(p.name)}</td><td class="mono">${esc(p.nikMasked || '-')}</td><td>${esc(p.from)} &rarr; ${esc(p.to)}</td><td class="mono">${esc(p.bookingCode)}</td><td>${p.checkedIn ? 'Sudah naik' : 'Belum'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted c-pad">Belum ada penumpang terkonfirmasi di perjalanan ini.</p>';
  };
  $('#d').addEventListener('change', loadTrips);
  $('#t').addEventListener('change', loadManifest);
  loadTrips().catch((e) => toast(e.message, 'err'));
}

/* ---------- Sistem: discovery, load balancing, antrian ---------- */
function tabSystem(box) {
  box.innerHTML = '<div class="c-panel" id="sys"><span class="skel" style="height:220px"></span></div>';
  let stop = false;
  const paint = async () => {
    const [{ services }, { queues, maxAttempts }, stats] = await Promise.all([api('/api/admin/registry'), api('/api/admin/queues'), api('/api/admin/booking-stats')]);
    if (stop) return;
    $('#sys').innerHTML = `
      <h2>Service <em>terdaftar</em></h2>
      <div class="svc-grid">${services.map((s) => `<div class="svc ${s.instances.length ? 'up' : 'down'}"><b>${esc(s.name)}</b><span class="mono">${s.instances.length} instance</span><small class="muted mono">${s.instances.map((i) => esc(i.instanceId)).join(', ') || 'tidak ada'}</small></div>`).join('')}</div>
      <div class="c-stat"><span>Lock aktif <b class="mono">${stats.activeLocks}</b></span><span>Klaim segmen <b class="mono">${stats.claims}</b></span><span>Outbox tertunda <b class="mono">${stats.outboxPending}</b></span><span>Melayani <b class="mono">${esc(stats.instance)}</b></span></div>
      <h2 class="c-sec">Antrian <em>pesan</em></h2>
      <div class="c-scroll"><table class="c-table"><thead><tr><th>Antrian</th><th>Siap</th><th>Diproses</th><th>DLQ</th><th>Terbit</th><th>Selesai</th><th></th></tr></thead><tbody>
      ${queues.map((q) => `<tr><td class="mono">${esc(q.queue)}</td><td class="mono">${q.ready || 0}</td><td class="mono">${q.inflight || 0}</td><td class="mono ${q.dead ? 'hot' : ''}">${q.dead || 0}</td><td class="mono">${q.published || 0}</td><td class="mono">${q.acked || 0}</td><td>${q.dead ? `<button class="btn ghost sm" data-replay="${esc(q.queue)}">Kirim ulang</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="c-row c-pad"><button class="btn ghost sm" id="ping">Uji antrian</button><button class="btn ghost sm" id="poison">Kirim pesan beracun</button><small class="muted">Pesan beracun gagal ${maxAttempts} kali lalu masuk DLQ.</small></div>`;
    $('#ping').addEventListener('click', () => api('/api/admin/queues/publish-test', { method: 'POST', body: { note: 'uji dari konsol' } }).then(() => toast('Pesan uji dikirim.', 'ok')));
    $('#poison').addEventListener('click', () => api('/api/admin/queues/publish-test', { method: 'POST', body: { poison: true, note: 'beracun' } }).then(() => toast('Pesan beracun dikirim. Pantau kolom DLQ.', 'warn')));
    $$('[data-replay]').forEach((b) => b.addEventListener('click', () => api(`/api/admin/queues/${b.dataset.replay}/dlq/replay`, { method: 'POST', body: {} }).then((r) => toast(`${r.replayed} pesan dikirim ulang.`, 'ok'))));
  };
  paint().catch((e) => toast(e.message, 'err'));
  const h = setInterval(() => { if (!document.hidden) paint().catch(() => {}); }, 3000);
  return () => { stop = true; clearInterval(h); };
}

/* ---------- API key ---------- */
function tabKeys(box) {
  box.innerHTML = `<div class="c-panel">
    <h2>API key <em>partner</em></h2><p class="muted">Key penuh hanya tampil sekali, lalu hanya hash yang disimpan.</p>
    <form id="nk" class="c-row"><label class="sr" for="kn">Nama partner</label><input class="c-in" id="kn" placeholder="Nama partner" maxlength="60" required>
      <label class="c-lab" for="kr">Kuota per menit</label><input class="c-in small mono" id="kr" type="number" min="1" max="6000" value="60">
      <label class="c-lab" for="kd">Berlaku (hari)</label><input class="c-in small mono" id="kd" type="number" min="1" max="365" value="30"><button class="btn gold sm">Buat key</button></form>
    <div id="fresh" aria-live="polite"></div><div id="keys"></div></div>`;
  const reveal = (r) => {
    $('#fresh').innerHTML = `<div class="key-once"><p><b>Salin sekarang.</b> Key ini tidak akan ditampilkan lagi.</p><code class="mono">${esc(r.key)}</code></div>`;
    Kiko.react('awas', 'Simpan key-nya sekarang, ya. Hanya tampil sekali!', 3200);
  };
  const load = async () => {
    const { keys } = await api('/api/admin/api-keys');
    $('#keys').innerHTML = keys.length ? `<div class="c-scroll"><table class="c-table"><thead><tr><th>Nama</th><th>Awalan</th><th>Kuota</th><th>Berlaku sampai</th><th>Terakhir dipakai</th><th></th></tr></thead><tbody>
      ${keys.map((k) => `<tr class="${k.revokedAt ? 'dim' : ''}"><td>${esc(k.name)}</td><td class="mono">${esc(k.prefix)}…</td><td class="mono">${k.ratePerMin}/mnt</td><td>${when(k.expiresAt)}</td><td>${k.lastUsedAt ? when(k.lastUsedAt) : '-'}</td>
      <td class="c-acts">${k.revokedAt ? 'Dicabut' : `<button class="btn ghost sm" data-rot="${esc(k.id)}">Rotasi</button><button class="btn ghost sm" data-rev="${esc(k.id)}">Cabut</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted c-pad">Belum ada API key.</p>';
    $$('[data-rot]').forEach((b) => b.addEventListener('click', async () => { reveal(await api(`/api/admin/api-keys/${b.dataset.rot}/rotate`, { method: 'POST', body: {} })); load(); }));
    $$('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Cabut key ini?', body: '<p>Partner langsung kehilangan akses. Key lain tidak terpengaruh.</p>', confirm: 'Cabut', danger: true })) return;
      await api(`/api/admin/api-keys/${b.dataset.rev}`, { method: 'DELETE' });
      load();
    }));
  };
  $('#nk').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      reveal(await api('/api/admin/api-keys', { method: 'POST', body: { name: $('#kn').value.trim(), ratePerMin: Number($('#kr').value), expiresInDays: Number($('#kd').value), scopes: ['partner:read'] } }));
      $('#kn').value = '';
      load();
    } catch (ex) { toast(ex.details?.fields ? Object.values(ex.details.fields)[0] : ex.message, 'err'); }
  });
  load().catch((e) => toast(e.message, 'err'));
}

/* ---------- Audit ---------- */
function tabAudit(box) {
  box.innerHTML = '<div class="c-panel"><h2>Peringatan <em>keamanan</em></h2><div id="alerts"></div><h2 class="c-sec">Audit <em>log</em></h2><div id="audit"></div></div>';
  Promise.all([api('/api/admin/alerts'), api('/api/admin/audit?limit=60')]).then(([{ alerts }, { entries }]) => {
    $('#alerts').innerHTML = alerts.length ? `<div class="c-scroll short"><table class="c-table"><thead><tr><th>Waktu</th><th>Jenis</th><th>Tingkat</th><th>Layanan</th></tr></thead><tbody>${alerts.map((a) => `<tr><td>${when(a.at)}</td><td class="mono">${esc(a.kind)}</td><td><span class="pill ${a.severity === 'high' ? 'cancelled' : 'pending_payment'}">${esc(a.severity)}</span></td><td>${esc(a.service || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted c-pad">Tidak ada peringatan.</p>';
    $('#audit').innerHTML = entries.length ? `<div class="c-scroll"><table class="c-table"><thead><tr><th>Waktu</th><th>Aksi</th><th>Layanan</th><th>Pelaku</th><th>Sasaran</th></tr></thead><tbody>${entries.map((a) => `<tr><td>${when(a.at)}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.service || '')}</td><td class="mono">${esc((a.actor || '-').slice(0, 18))}</td><td class="mono">${esc((a.target || '-').slice(0, 24))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted c-pad">Belum ada catatan.</p>';
  }).catch((e) => toast(e.message, 'err'));
}

export function render(main) {
  const tabs = [
    hasScope('checkin:write') && ['Check-in', tabCheckin],
    hasScope('manifest:read') && ['Perjalanan', tabTrips],
    hasScope('system:read') && ['Sistem', tabSystem],
    hasScope('admin') && ['API key', tabKeys],
    hasScope('audit:read') && ['Audit', tabAudit],
  ].filter(Boolean);
  main.innerHTML = `<div class="page wrap"><div class="page-head"><h1 class="h-sm">Konsol <em>${hasScope('admin') ? 'admin' : 'operator'}</em></h1>
    <div class="c-tabs" role="tablist">${tabs.map(([n], i) => `<button class="tab-c ${i === 0 ? 'on' : ''}" role="tab" aria-selected="${i === 0}" data-i="${i}">${n}</button>`).join('')}</div></div><div id="c-body"></div></div>`;
  let off = null;
  const open = (i) => {
    if (typeof off === 'function') off();
    $$('.tab-c', main).forEach((t, x) => { t.classList.toggle('on', x === i); t.setAttribute('aria-selected', String(x === i)); });
    off = tabs[i][1]($('#c-body'));
  };
  $$('.tab-c', main).forEach((t) => t.addEventListener('click', () => open(Number(t.dataset.i))));
  open(0);
  return () => { if (typeof off === 'function') off(); };
}
