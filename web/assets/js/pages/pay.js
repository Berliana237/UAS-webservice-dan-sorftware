/**
 * Pembayaran. Halaman tidak pernah menganggap "bayar berhasil" dari klien:
 * statusnya menunggu webhook yang diteruskan lewat message queue, sambil memantau status pesanan.
 */
import { $, $$, api, esc, rupiah, go, uuid, flow, sleep } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { countdown, qrSvg, steps, confetti } from '../ui.js';

const METHODS = [
  { id: 'QRIS', name: 'QRIS', note: 'Pindai dari aplikasi bank atau dompet digital' },
  { id: 'VA_BCA', name: 'Virtual Account BCA', note: 'Transfer ke nomor yang diberikan' },
  { id: 'VA_MANDIRI', name: 'Virtual Account Mandiri', note: 'Transfer ke nomor yang diberikan' },
  { id: 'CARD_TOKEN', name: 'Kartu (token)', note: 'Nomor kartu tidak pernah melewati sistem kami' },
];

export function render(main, { params }) {
  const id = params.bookingId;
  let stopTimer = null;
  let poll = 0;
  let alive = true;
  main.innerHTML = `<div class="page wrap pay-page"><div class="page-head no-pad">${steps(2)}<span id="timer"></span></div><div id="body"><span class="skel" style="height:360px"></span></div></div>`;

  const showExpired = () => {
    Kiko.react('gagal', 'Waktunya habis. Kursinya sudah dilepas.', 4000);
    $('#body').innerHTML = `<div class="empty"><h2>Waktu pembayaran habis</h2><p>Kursi dilepas otomatis. Tidak ada biaya yang terpotong. Anda bisa memesan lagi kapan saja.</p><a class="btn gold" href="/" data-link>Cari kereta lagi</a></div>`;
  };

  (async () => {
    const b = await api(`/api/bookings/${id}`);
    if (!alive) return;
    if (b.status === 'CONFIRMED' || b.status === 'CHECKED_IN') { go(`/tiket/${id}`, { replace: true }); return; }
    if (b.status !== 'PENDING_PAYMENT') { showExpired(); return; }
    stopTimer = countdown($('#timer'), b.expiresAt, { onLow: () => Kiko.react('cemas', 'Semenit lagi! Selesaikan pembayarannya, ya.', 4000), onEnd: () => setTimeout(check, 1500) });

    const paxRows = b.passengers.map((p) => `<li><b class="mono">${esc(p.seatId.split('-')[1])}</b><span>${esc(p.name)}<small class="muted">${{ CHILD: 'Anak', ADULT: 'Dewasa', SENIOR: 'Lansia' }[p.passengerType] || ''}</small></span><span class="mono r">${rupiah(p.fare)}</span></li>`).join('');
    $('#body').innerHTML = `
      <div class="pay-layout">
        <div class="pay-main">
          <h1 class="h-sm">Satu langkah <em>lagi.</em></h1>
          <p class="sub simul">Mode simulasi. Tidak ada uang sungguhan yang berpindah.</p>
          <div id="stage"></div>
        </div>
        <aside class="ticket-wrap"><div class="ticket pay-sum" style="--n:128px">
          <div class="sum-head"><p class="eyebrow">Pesanan ${esc(b.code)}</p><h2 class="sum-route">${esc(b.from.name)} <em>ke</em> ${esc(b.to.name)}</h2><p class="muted">${esc(b.trainName)}</p></div>
          <div class="perf"></div>
          <div class="sum-body"><ul class="sum-list">${paxRows}</ul><div class="sum-total big"><span>Total</span><b class="mono">${rupiah(b.amount)}</b></div></div>
        </div></aside>
      </div>`;
    choose(b);
    Kiko.react('halo', 'Pilih cara bayar yang paling nyaman.', 2800);
  })().catch((e) => {
    if (!alive) return;
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/perjalanan" data-link>Ke perjalanan saya</a></div>`;
    Kiko.react('gagal');
  });

  function choose(b, message) {
    $('#stage').innerHTML = `
      ${message ? `<p class="alert on-dark" role="alert">${esc(message)}</p>` : ''}
      <div class="pm" role="radiogroup" aria-label="Metode pembayaran">
        ${METHODS.map((m, i) => `<label class="pm-opt"><input type="radio" name="pm" value="${m.id}" ${i === 0 ? 'checked' : ''}><span class="pm-dot"></span><span><b>${esc(m.name)}</b><small>${esc(m.note)}</small></span></label>`).join('')}
      </div>
      <button class="btn gold pay-go" id="go">Bayar ${rupiah(b.amount)}</button>`;
    $$('.pm-opt input').forEach((r) => r.addEventListener('change', () => Sound.play('pick')));
    $('#go').addEventListener('click', () => start(b, $('input[name=pm]:checked').value));
  }

  async function start(b, method) {
    const btn = $('#go');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Membuat pembayaran';
    const keyName = `pay:${id}:${method}`;
    const key = flow.get(keyName) || uuid();
    flow.set(keyName, key);
    try {
      const r = await api('/api/payments', { method: 'POST', idem: key, body: { bookingId: id, method } });
      instructions(b, r, method, keyName);
    } catch (e) {
      flow.del(keyName);
      if (e.code === 'BOOKING_EXPIRED' || e.code === 'BOOKING_NOT_PAYABLE') { showExpired(); return; }
      choose(b, e.message);
      Kiko.react('gagal');
    }
  }

  function instructions(b, r, method, keyName) {
    const ins = r.instructions || {};
    const visual = method === 'QRIS'
      ? `<div class="pay-qr">${qrSvg(ins.qrString || r.payment.id)}</div><p class="muted">Pindai kode ini, atau tekan tombol simulasi di bawah.</p>`
      : method === 'CARD_TOKEN'
        ? `<div class="pay-va"><span class="label">Token kartu dari gateway</span><b class="mono">tok_demo${r.payment.id.slice(-6)}</b></div><p class="muted">Kartu sudah ditukar token oleh gateway. Sistem kami tidak menerima nomor kartu.</p>`
        : `<div class="pay-va"><span class="label">Nomor virtual account</span><b class="mono">${esc((ins.virtualAccount || '').replace(/(\d{4})(?=\d)/g, '$1 '))}</b></div><p class="muted">Transfer tepat ${rupiah(b.amount)}.</p>`;
    $('#stage').innerHTML = `<div class="pay-ins reveal">${visual}
      <div class="pay-acts"><button class="btn gold" id="ok">Simulasikan bayar berhasil</button><button class="btn ghost" id="bad">Simulasikan gagal</button></div>
      <button class="btn link" id="other">Ganti metode</button></div>`;
    $('#other').addEventListener('click', () => { flow.del(keyName); choose(b); });
    const send = async (outcome) => {
      $$('#stage button').forEach((x) => { x.disabled = true; });
      const body = { outcome, ...(method === 'CARD_TOKEN' ? { cardToken: `tok_demo${r.payment.id.slice(-6)}` } : {}) };
      try {
        await api(`/api/mock-gateway/checkout/${r.checkoutToken}/pay`, { method: 'POST', body });
        waiting(b, r, keyName);
      } catch (e) { choose(b, e.message); }
    };
    $('#ok').addEventListener('click', () => send('success'));
    $('#bad').addEventListener('click', () => send('fail'));
    Kiko.react('pilih', 'Status bayar datang dari gateway, bukan dari tombol ini.', 3200);
  }

  function waiting(b, r, keyName) {
    $('#stage').innerHTML = `<div class="pay-wait" role="status"><div class="track"><i class="loco"></i></div><p>Menunggu konfirmasi dari gateway pembayaran...</p></div>`;
    Kiko.mood('thinking');
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const [bk, py] = await Promise.all([api(`/api/bookings/${id}`), api(`/api/payments/${r.payment.id}`)]);
        if (bk.status === 'CONFIRMED') {
          clearInterval(poll);
          stopTimer?.();
          const box = $('.pay-wait');
          confetti(box.getBoundingClientRect().left + 120, box.getBoundingClientRect().top, 90);
          Kiko.react('sukses', 'Lunas! Ini tiket Anda.', 2600);
          await sleep(700);
          if (alive) go(`/tiket/${id}?baru=1`, { replace: true });
        } else if (py.payment.status === 'FAILED') {
          clearInterval(poll);
          flow.del(keyName);
          choose(b, 'Pembayaran gagal dan tidak ada dana yang terpotong. Coba lagi atau pilih metode lain.');
          Kiko.react('gagal', 'Pembayarannya gagal. Kursi Anda masih aman, kok.', 3400);
        } else if (bk.status === 'EXPIRED') {
          clearInterval(poll);
          showExpired();
        }
      } catch { /* dicoba lagi pada detak berikutnya */ }
    }, 700);
  }

  async function check() {
    try {
      const b = await api(`/api/bookings/${id}`);
      if (b.status === 'CONFIRMED') go(`/tiket/${id}`, { replace: true });
      else showExpired();
    } catch { showExpired(); }
  }

  return () => { alive = false; stopTimer?.(); clearInterval(poll); };
}
