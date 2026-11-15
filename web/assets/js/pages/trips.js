/**
 * Perjalanan saya. Pesanan dikelompokkan: perlu tindakan, akan berangkat, dan riwayat.
 * Detail pesanan terbuka di panel samping (juga lewat ?pesanan=<id> dari notifikasi): status bayar,
 * alasan penolakan transfer, unggah ulang bukti, dan tautan ke tiket.
 */
import { $, $$, api, esc, rupiah, timeOf, dateLong, dateShort, go } from '../core.js';
import { Kiko } from '../kiko.js';
import { icon } from '../ui.js';
import { BOOKING_STATUS, PAYMENT_STATUS, METHOD, pill, transferPanel } from './pay-kit.js';
import { delayNote } from './trip-kit.js';

function ride(b, pay) {
  const late = pay?.status === 'REJECTED';
  return `<button type="button" class="ride ${late ? 'attn' : ''}" data-id="${esc(b.id)}">
    <span class="ride-date mono">${dateShort(b.departureAt)}<small>${b.delayMinutes ? `<s>${timeOf(b.departureAt)}</s> ${timeOf(b.departureAt + b.delayMinutes * 60000)}` : timeOf(b.departureAt)}</small></span>
    <span class="ride-main"><b>${esc(b.from.name)} <em>ke</em> ${esc(b.to.name)}${b.delayMinutes && ['CONFIRMED', 'PENDING_PAYMENT'].includes(b.status) ? ` <span class="pill wait">Terlambat ${b.delayMinutes} menit</span>` : ''}</b><span class="muted">${esc(b.trainName)} · ${b.passengers.length} penumpang · <span class="mono">${esc(b.code)}</span></span></span>
    <span class="ride-side">${pay && b.status === 'PENDING_PAYMENT' ? pill(PAYMENT_STATUS, pay.status) : pill(BOOKING_STATUS, b.status)}<b class="mono">${rupiah(b.amount)}</b></span>
  </button>`;
}

export function render(main, { query }) {
  let bookings = [];
  let pays = {};
  let cleanPanel = null;
  main.innerHTML = `<div class="page wrap trips-page">
    <div class="page-head"><div><p class="eyebrow">Akun saya</p><h1 class="h-sm">Perjalanan <em>saya</em></h1><p class="sub">Semua pesanan, status pembayaran, dan tiket ada di sini.</p></div><a class="btn gold" href="/cari" data-link>Pesan tiket baru</a></div>
    <div id="list"><span class="skel" style="height:96px;margin-bottom:10px"></span><span class="skel" style="height:96px"></span></div>
  </div>`;

  const closeSheet = () => {
    cleanPanel?.();
    cleanPanel = null;
    $('.sheet')?.remove();
    const u = new URL(location.href);
    if (u.searchParams.has('pesanan')) { u.searchParams.delete('pesanan'); history.replaceState({}, '', u.pathname + u.search); }
  };

  async function openDetail(id) {
    closeSheet();
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="sh-title"><span class="skel" style="height:320px"></span></div>';
    document.body.append(sheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });
    sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    history.replaceState({}, '', `/perjalanan?pesanan=${encodeURIComponent(id)}`);
    try {
      const [b, { payments }] = await Promise.all([api(`/api/bookings/${id}`), api(`/api/payments?bookingId=${encodeURIComponent(id)}`)]);
      const latest = payments.find((p) => p.status !== 'CANCELLED') || payments[0];
      const inner = $('.sheet-in', sheet);
      if (!inner) return;
      inner.innerHTML = `
        <div class="sheet-head"><div><p class="eyebrow">Pesanan ${esc(b.code)}</p><h2 id="sh-title">${esc(b.from.name)} <em>ke</em> ${esc(b.to.name)}</h2><p class="muted">${esc(b.trainName)} · ${dateLong(b.departureAt)}, ${timeOf(b.departureAt)}</p>${delayNote(b)}</div><button class="icon-btn" data-close aria-label="Tutup">${icon.x}</button></div>
        <div class="stack">
          <div class="row">${pill(BOOKING_STATUS, b.status)}${latest ? `<span class="chip">${esc(METHOD[latest.method] || latest.method)}</span>${pill(PAYMENT_STATUS, latest.status)}` : '<span class="chip">Belum memilih metode bayar</span>'}</div>
          <dl class="kv"><div><dt>Total</dt><dd class="mono">${rupiah(b.amount)}</dd></div><div><dt>Penumpang</dt><dd>${b.passengers.length} orang</dd></div>${b.status === 'PENDING_PAYMENT' ? `<div><dt>Bayar sebelum</dt><dd class="mono">${timeOf(b.expiresAt)}, ${dateShort(b.expiresAt)}</dd></div>` : ''}${b.refundAmount ? `<div><dt>Dana kembali</dt><dd class="mono">${rupiah(b.refundAmount)}</dd></div>` : ''}</dl>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kursi</th><th>Penumpang</th><th>Golongan</th><th class="num">Tarif</th></tr></thead><tbody>
            ${b.passengers.map((p) => `<tr><td class="mono">${esc(p.seatId)}</td><td>${esc(p.name)}<span class="sub mono">NIK ${esc(p.nikMasked || '-')}</span></td><td>${esc(p.passengerTypeLabel || '')}</td><td class="num">${rupiah(p.fare)}</td></tr>`).join('')}
          </tbody></table></div>
          <div id="pay-zone"></div>
          <div class="row" id="acts"></div>
        </div>`;
      const zone = $('#pay-zone', inner);
      const acts = $('#acts', inner);
      if (b.status === 'PENDING_PAYMENT') {
        if (latest && latest.method !== 'QRIS' && ['AWAITING_TRANSFER', 'UNDER_REVIEW', 'REJECTED'].includes(latest.status)) {
          zone.innerHTML = '<h3 style="margin-bottom:10px">Pembayaran transfer</h3><div id="tp"></div>';
          cleanPanel = transferPanel($('#tp', zone), latest, { amount: b.amount, compact: true, onChange: () => { openDetail(id); load(); } });
        }
        acts.innerHTML = `<a class="btn gold" href="/bayar/${esc(id)}" data-link>${latest ? 'Buka halaman pembayaran' : 'Bayar sekarang'}</a>`;
      } else if (['CONFIRMED', 'CHECKED_IN'].includes(b.status)) {
        acts.innerHTML = `<a class="btn gold" href="/tiket/${esc(id)}" data-link>Lihat tiket</a>`;
        if (latest?.proofs?.length) { zone.innerHTML = '<div id="tp"></div>'; cleanPanel = transferPanel($('#tp', zone), latest, { amount: b.amount, compact: true }); }
      } else {
        acts.innerHTML = `<a class="btn ghost" href="/tiket/${esc(id)}" data-link>Lihat rincian</a><a class="btn gold" href="/cari" data-link>Pesan lagi</a>`;
      }
      acts.addEventListener('click', (e) => { if (e.target.closest('a')) closeSheet(); });
      $('[data-close]', inner).focus();
      if (latest?.status === 'REJECTED') Kiko.react('cemas', 'Buktinya ditolak. Alasannya ada di panel, unggah ulang, ya.', 3800);
    } catch (e) {
      const inner = $('.sheet-in', sheet);
      if (inner) inner.innerHTML = `<div class="sheet-head"><h2>Pesanan tidak ditemukan</h2><button class="icon-btn" data-close aria-label="Tutup">${icon.x}</button></div><p class="muted">${esc(e.message)}</p>`;
    }
  }

  async function load() {
    const r = await api('/api/bookings');
    bookings = r.bookings;
    const pending = bookings.filter((b) => b.status === 'PENDING_PAYMENT');
    const lists = await Promise.all(pending.map((b) => api(`/api/payments?bookingId=${encodeURIComponent(b.id)}`).catch(() => ({ payments: [] }))));
    pays = Object.fromEntries(pending.map((b, i) => [b.id, lists[i].payments.find((p) => p.status !== 'CANCELLED')]));
    if (!main.contains($('#list'))) return;
    const now = Date.now();
    const act = pending;
    const soon = bookings.filter((b) => ['CONFIRMED', 'CHECKED_IN'].includes(b.status) && b.departureAt > now - 3 * 3600000).sort((a, b) => a.departureAt - b.departureAt);
    const past = bookings.filter((b) => !act.includes(b) && !soon.includes(b));
    if (!bookings.length) {
      $('#list').innerHTML = `<div class="empty"><h2>Belum ada <em>perjalanan</em></h2><p>Pesanan dan tiket Anda akan muncul di sini setelah memesan.</p><a class="btn gold" href="/cari" data-link>Cari kereta</a></div>`;
      Kiko.react('halo', 'Belum ada perjalanan. Yuk, cari kereta pertama Anda!', 3000);
      return;
    }
    const group = (title, list, note) => (list.length ? `<section class="group"><h2 class="group-h">${title}<span>${list.length}</span></h2>${note ? `<p class="muted group-note">${note}</p>` : ''}${list.map((b) => ride(b, pays[b.id])).join('')}</section>` : '');
    $('#list').innerHTML = `
      ${group('Perlu tindakan', act, 'Selesaikan pembayaran sebelum batas waktu, atau periksa bukti transfer yang ditolak.')}
      ${group('Akan berangkat', soon)}
      ${group('Riwayat', past)}`;
    const rejected = act.filter((b) => pays[b.id]?.status === 'REJECTED').length;
    if (rejected) Kiko.react('cemas', `${rejected} bukti transfer ditolak. Ketuk pesanannya untuk unggah ulang.`, 3600);
  }

  $('#list').addEventListener('click', (e) => { const r = e.target.closest('.ride'); if (r) openDetail(r.dataset.id); });
  load().then(() => { const id = query.get('pesanan'); if (id) openDetail(id); }).catch((e) => {
    if (!main.contains($('#list'))) return;
    $('#list').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button class="btn ghost" onclick="location.reload()">Muat ulang</button></div>`;
  });
  const h = setInterval(() => { if (!document.hidden && !$('.sheet')) load().catch(() => {}); }, 20000);

  return () => { clearInterval(h); closeSheet(); };
}
