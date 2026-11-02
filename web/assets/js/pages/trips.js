/** Perjalanan saya: yang akan datang di atas, riwayat di bawah, kabar terbaru di samping. */
import { $, api, esc, rupiah, timeOf, dateShort, sleep } from '../core.js';
import { Kiko } from '../kiko.js';

const LABEL = { CONFIRMED: 'Lunas', CHECKED_IN: 'Sudah naik', PENDING_PAYMENT: 'Menunggu bayar', CANCELLED: 'Dibatalkan', EXPIRED: 'Kedaluwarsa' };
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  if (m < 1440) return `${Math.round(m / 60)} jam lalu`;
  return `${Math.round(m / 1440)} hari lalu`;
};

const row = (b, i) => `<a class="ride reveal" style="--i:${i}" data-link href="${b.status === 'PENDING_PAYMENT' ? `/bayar/${b.id}` : `/tiket/${b.id}`}">
  <div class="ride-date mono">${dateShort(b.departureAt)}<small>${timeOf(b.departureAt)}</small></div>
  <div class="ride-main"><b>${esc(b.from.name)} <em>ke</em> ${esc(b.to.name)}</b><span class="muted">${esc(b.trainName)} · ${b.passengers.map((p) => esc(p.seatId.split('-')[1])).join(', ')} · <span class="mono">${esc(b.code)}</span></span></div>
  <div class="ride-side"><span class="pill ${b.status.toLowerCase()}">${LABEL[b.status]}</span><span class="mono">${rupiah(b.amount)}</span></div>
</a>`;

export function render(main) {
  main.innerHTML = `<div class="page wrap"><div class="page-head"><div><h1 class="h-sm">Perjalanan <em>saya</em></h1></div><a class="btn ghost" href="/" data-link>Pesan lagi</a></div>
    <div class="trips-layout"><div id="rides"><span class="skel" style="height:88px;margin-bottom:12px"></span><span class="skel" style="height:88px"></span></div>
    <aside class="news" aria-labelledby="news-h"><h2 id="news-h" class="news-h">Kabar terbaru</h2><div id="news"></div></aside></div></div>`;

  let alive = true;
  (async () => {
    const [{ bookings }, { notifications }] = await Promise.all([api('/api/bookings'), api('/api/notifications')]);
    if (!alive) return;
    const now = Date.now();
    const soon = bookings.filter((b) => ['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status) && b.departureAt > now);
    const past = bookings.filter((b) => !soon.includes(b));
    if (!bookings.length) {
      $('#rides').innerHTML = '<div class="empty"><p>Belum ada perjalanan. Kursi yang Anda pesan akan muncul di sini.</p><a class="btn gold" href="/" data-link>Cari kereta</a></div>';
      Kiko.react('halo', 'Mau ke mana kita hari ini?', 3200);
    } else {
      $('#rides').innerHTML = `${soon.length ? `<h2 class="group-h">Akan datang</h2>${soon.map(row).join('')}` : ''}${past.length ? `<h2 class="group-h">Riwayat</h2>${past.map(row).join('')}` : ''}`;
      Kiko.react('bangga', soon.length ? `Anda punya ${soon.length} perjalanan akan datang.` : 'Ini riwayat perjalanan Anda.', 2800);
    }
    $('#news').innerHTML = notifications.length
      ? notifications.slice(0, 8).map((n) => `<article class="note ${n.read ? '' : 'unread'}" data-id="${esc(n.id)}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small class="muted">${ago(n.createdAt)}</small></article>`).join('')
      : '<p class="muted">Belum ada kabar.</p>';
    await sleep(1500);
    if (!alive) return;
    notifications.filter((n) => !n.read).slice(0, 8).forEach((n) => api(`/api/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {}));
  })().catch((e) => {
    if (!alive) return;
    $('#rides').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
    Kiko.react('gagal');
  });
  return () => { alive = false; };
}
