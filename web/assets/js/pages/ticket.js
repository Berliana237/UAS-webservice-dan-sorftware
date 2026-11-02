/** Tiket: boarding pass per penumpang dengan QR, cap LUNAS, dan pembatalan yang menjelaskan refund sebelum dilakukan. */
import { $, api, esc, rupiah, timeOf, dateLong, confirmDialog, go, toast } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { qrSvg, steps, confetti } from '../ui.js';

const TYPE = { CHILD: 'Anak', ADULT: 'Dewasa', SENIOR: 'Lansia' };
const STATE = {
  CONFIRMED: ['LUNAS', 'ok'], CHECKED_IN: ['SUDAH NAIK', 'ok'], CANCELLED: ['DIBATALKAN', 'bad'], EXPIRED: ['KEDALUWARSA', 'bad'], PENDING_PAYMENT: ['MENUNGGU BAYAR', 'wait'],
};

function pass(b, p, i) {
  const valid = b.status === 'CONFIRMED' || b.status === 'CHECKED_IN';
  return `<article class="ticket-wrap bp-wrap reveal" style="--i:${i}"><div class="ticket bp" style="--n:calc(100% - 118px)">
    <div class="bp-main">
      <header class="bp-head"><span class="eyebrow">${esc(b.trainName)}</span><span class="mono bp-code">${esc(b.code)}</span></header>
      <div class="bp-route">
        <div><b class="mono">${timeOf(b.departureAt)}</b><span>${esc(b.from.name)}</span></div>
        <i class="bp-line" aria-hidden="true"></i>
        <div class="end"><span>${esc(b.to.name)}</span></div>
      </div>
      <dl class="bp-meta">
        <div><dt>Penumpang</dt><dd>${esc(p.name)}</dd></div>
        <div><dt>Kursi</dt><dd class="mono">${esc(p.seatId)}</dd></div>
        <div><dt>Golongan</dt><dd>${TYPE[p.passengerType] || ''}</dd></div>
        <div><dt>NIK</dt><dd class="mono">${esc(p.nikMasked || '-')}</dd></div>
      </dl>
      <p class="bp-date muted">${dateLong(b.departureAt)}</p>
    </div>
    <div class="perf"></div>
    <div class="bp-stub">
      ${valid && p.ticketCode ? `<div class="bp-qr" role="img" aria-label="Kode QR tiket">${qrSvg(p.ticketCode)}</div><small class="mono">${esc(p.ticketCode.slice(0, 16))}…</small>` : '<div class="bp-void">Tidak berlaku</div>'}
      ${p.checkedIn ? '<small class="bp-in">Sudah check-in</small>' : ''}
    </div>
  </div></article>`;
}

export function render(main, { params, query }) {
  const id = params.bookingId;
  main.innerHTML = `<div class="page wrap ticket-page" id="tp"><span class="skel" style="height:320px"></span></div>`;

  const paint = (b) => {
    const [label, cls] = STATE[b.status] || [b.status, 'wait'];
    const fresh = query.get('baru') === '1' && b.status === 'CONFIRMED';
    $('#tp').innerHTML = `
      <div class="page-head no-pad no-print">${b.status === 'CONFIRMED' ? steps(3) : ''}<a class="btn link" href="/perjalanan" data-link>Semua perjalanan</a></div>
      <div class="tk-head">
        <div><h1 class="h-sm">${b.status === 'CONFIRMED' ? 'Selamat <em>jalan.</em>' : b.status === 'CHECKED_IN' ? 'Selamat <em>menikmati.</em>' : `Pesanan <em>${esc(b.code)}</em>`}</h1>
          <p class="sub">${b.status === 'CANCELLED' ? (b.refundAmount > 0 ? `Dana ${rupiah(b.refundAmount)} dikembalikan.` : 'Tidak ada dana yang perlu dikembalikan.') : 'Tunjukkan QR ini kepada kondektur.'}</p></div>
        <span class="stamp ${cls} ${fresh ? 'fresh' : ''}" aria-label="Status pesanan: ${label}">${label}</span>
      </div>
      <div class="bp-list">${b.passengers.map((p, i) => pass(b, p, i)).join('')}</div>
      <div class="tk-actions no-print">
        ${b.status === 'CONFIRMED' ? '<button class="btn ghost" id="print">Cetak</button><button class="btn ghost" id="cancel">Batalkan pesanan</button>' : ''}
        ${b.status === 'PENDING_PAYMENT' ? `<a class="btn gold" href="/bayar/${esc(id)}" data-link>Lanjut bayar</a><button class="btn ghost" id="cancel">Batalkan pesanan</button>` : ''}
        ${['CANCELLED', 'EXPIRED'].includes(b.status) ? '<a class="btn gold" href="/" data-link>Cari kereta lagi</a>' : ''}
      </div>`;
    $('#print')?.addEventListener('click', () => print());
    $('#cancel')?.addEventListener('click', () => cancel(b));
    if (fresh) {
      setTimeout(() => {
        Sound.play('punch');
        const s = $('.stamp').getBoundingClientRect();
        confetti(s.left + s.width / 2, s.top, 60);
        Kiko.react('sukses', 'Karcis sah! Sampai jumpa di peron.', 3000);
      }, 520);
      history.replaceState({}, '', location.pathname);
    }
  };

  async function cancel(b) {
    const prev = await api(`/api/bookings/${id}/refund-preview`);
    if (!prev.cancellable) { toast(prev.reason, 'warn'); return; }
    Kiko.react('cemas', 'Yakin mau dibatalkan?', 3000);
    const yes = await confirmDialog({
      title: 'Batalkan pesanan ini?',
      body: prev.paid
        ? `<p>Dana yang kembali <b>${rupiah(prev.refundAmount)}</b> (${prev.percent} persen dari ${rupiah(b.amount)}), menurut sisa waktu sebelum berangkat. Kursi langsung dilepas.</p>`
        : '<p>Pesanan belum dibayar, jadi tidak ada biaya. Kursi langsung dilepas.</p>',
      confirm: 'Ya, batalkan', cancel: 'Tidak jadi', danger: true,
    });
    if (!yes) { Kiko.react('bangga', 'Syukurlah, perjalanan tetap jalan!', 2400); return; }
    try {
      paint(await api(`/api/bookings/${id}/cancel`, { method: 'POST' }));
      toast('Pesanan dibatalkan.', 'ok');
      Kiko.react('gagal', 'Sampai jumpa di perjalanan lain.', 2800);
    } catch (e) { toast(e.message, 'err'); }
  }

  api(`/api/bookings/${id}`).then(paint).catch((e) => {
    if (!main.contains($('#tp'))) return;
    if (e.status === 404) { toast('Pesanan tidak ditemukan.', 'warn'); go('/perjalanan', { replace: true }); return; }
    $('#tp').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
  });
}
