/**
 * Pembayaran. Halaman tidak pernah menganggap "bayar berhasil" dari klien: status datang dari webhook penyedia
 * (QRIS) atau keputusan admin (transfer VA), lalu diteruskan lewat message queue ke booking-service.
 * QRIS: kode QR berisi tautan halaman bayar yang bisa dibuka ponsel di Wi-Fi yang sama; begitu dibuka, pembayaran diproses.
 * VA BCA/Mandiri: transfer lalu unggah bukti, admin memverifikasi.
 */
import { invoice, tripContext } from './trip-kit.js';
import { $, $$, api, esc, rupiah, go, uuid, flow, sleep } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { countdown, qrSvg, steps, confetti, icon } from '../ui.js';
import { transferPanel, METHOD } from './pay-kit.js';

const METHODS = [
  { id: 'QRIS', name: 'QRIS', note: 'Pindai dengan kamera ponsel, Google Lens, atau aplikasi bank apa pun', tag: 'Instan' },
  { id: 'VA_BCA', name: 'Virtual Account BCA', note: 'Transfer lalu unggah bukti, diverifikasi admin', tag: 'Kursi ditahan 2 jam' },
  { id: 'VA_MANDIRI', name: 'Virtual Account Mandiri', note: 'Transfer lalu unggah bukti, diverifikasi admin', tag: 'Kursi ditahan 2 jam' },
];

export function render(main, { params }) {
  const id = params.bookingId;
  let stopTimer = null;
  let poll = 0;
  let alive = true;
  let cleanPanel = null;
  let booking = null;
  main.innerHTML = `<div class="page wrap pay-page"><div class="page-head no-pad">${steps(2)}<span id="timer"></span></div><div id="body"><span class="skel" style="height:360px"></span></div></div>`;

  const showExpired = () => {
    stopTimer?.();
    clearInterval(poll);
    Kiko.react('gagal', 'Waktunya habis. Kursinya sudah dilepas.', 4000);
    $('#body').innerHTML = `<div class="empty"><h2>Waktu pembayaran habis</h2><p>Kursi dilepas otomatis. Tidak ada biaya yang terpotong. Anda bisa memesan lagi kapan saja.</p><a class="btn gold" href="/cari" data-link>Cari kereta lagi</a></div>`;
  };
  const startTimer = (expiresAt) => {
    stopTimer?.();
    stopTimer = countdown($('#timer'), expiresAt, { onLow: () => Kiko.react('cemas', 'Semenit lagi! Selesaikan pembayarannya, ya.', 4000), onEnd: () => setTimeout(check, 1500) });
  };
  const succeed = async () => {
    clearInterval(poll);
    stopTimer?.();
    const box = $('#stage');
    const r = box?.getBoundingClientRect();
    if (r) confetti(r.left + r.width / 2, r.top + 60, 90);
    Kiko.react('sukses', 'Lunas! Ini tiket Anda.', 2600);
    await sleep(800);
    if (alive) go(`/tiket/${id}?baru=1`, { replace: true });
  };

  (async () => {
    booking = await api(`/api/bookings/${id}`);
    if (!alive) return;
    if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') { go(`/tiket/${id}`, { replace: true }); return; }
    if (booking.status !== 'PENDING_PAYMENT') { showExpired(); return; }
    startTimer(booking.expiresAt);
    const paxRows = booking.passengers.map((p) => `<li><b class="mono">${esc(p.seatId.split('-')[1])}</b><span>${esc(p.name)}<small class="muted">${esc(p.passengerTypeLabel || '')}${p.passengerType === 'SENIOR' ? ' · potongan' : ''}</small></span><span class="mono r">${rupiah(p.fare)}</span></li>`).join('');
    $('#body').innerHTML = `
      <div class="pay-layout">
        <div class="pay-main">
          <h1 class="h-sm">Satu langkah <em>lagi.</em></h1>
          <p class="sub simul">Mode simulasi. Tidak ada uang sungguhan yang berpindah.</p>
          <div id="stage"></div>
        </div>
        <aside class="ticket-wrap"><div class="ticket pay-sum" style="--n:128px">
          <div class="sum-head"><p class="eyebrow">Pesanan ${esc(booking.code)}</p><h2 class="sum-route">${esc(booking.from.name)} <em>ke</em> ${esc(booking.to.name)}</h2><p class="muted">${esc(booking.trainName)}</p></div>
          <div class="perf"></div>
          <div class="sum-body" id="inv">${invoice(booking, null)}</div>
        </div></aside>
      </div>`;
    // Rincian tarif normal dan potongan lansia dilengkapi setelah tarif gerbong dimuat.
    tripContext(booking).then((ctx) => { if (alive && ctx && $('#inv')) $('#inv').innerHTML = invoice(booking, ctx); });

    // Lanjutkan pembayaran yang sudah dibuat sebelumnya (misalnya setelah halaman dimuat ulang).
    const { payments } = await api(`/api/payments?bookingId=${encodeURIComponent(id)}`).catch(() => ({ payments: [] }));
    const open = payments.find((p) => ['AWAITING_TRANSFER', 'UNDER_REVIEW', 'REJECTED'].includes(p.status));
    if (open) { vaStage(open); return; }
    const qris = payments.find((p) => p.status === 'PENDING' && p.method === 'QRIS');
    if (qris && flow.get(`pay:${id}:QRIS`)) { start('QRIS'); return; }
    choose();
    Kiko.react('halo', 'Pilih cara bayar yang paling nyaman.', 2800);
  })().catch((e) => {
    if (!alive) return;
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/perjalanan" data-link>Ke perjalanan saya</a></div>`;
    Kiko.react('gagal');
  });

  function choose(message) {
    clearInterval(poll);
    cleanPanel?.();
    $('#stage').innerHTML = `
      ${message ? `<p class="alert on-dark" role="alert">${esc(message)}</p>` : ''}
      <div class="pm" role="radiogroup" aria-label="Metode pembayaran">
        ${METHODS.map((m, i) => `<label class="pm-opt"><input type="radio" name="pm" value="${m.id}" ${i === 0 ? 'checked' : ''}><span class="pm-dot"></span><span class="pm-txt"><b>${esc(m.name)}</b><small>${esc(m.note)}</small></span><span class="chip">${esc(m.tag)}</span></label>`).join('')}
      </div>
      <button class="btn gold pay-go" id="go">Lanjut bayar ${rupiah(booking.amount)}</button>`;
    $$('.pm-opt input').forEach((r) => r.addEventListener('change', () => Sound.play('pick')));
    $('#go').addEventListener('click', () => start($('input[name=pm]:checked').value));
  }

  async function start(method) {
    const btn = $('#go');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Menyiapkan pembayaran'; }
    const keyName = `pay:${id}:${method}`;
    const key = flow.get(keyName) || uuid();
    flow.set(keyName, key);
    try {
      const r = await api('/api/payments', { method: 'POST', idem: key, body: { bookingId: id, method } });
      if (r.expiresAt) startTimer(r.expiresAt);
      if (method === 'QRIS') qrisStage(r, keyName);
      else { flow.del(keyName); vaStage(r.payment); }
    } catch (e) {
      flow.del(keyName);
      if (e.code === 'BOOKING_EXPIRED' || e.code === 'BOOKING_NOT_PAYABLE') { showExpired(); return; }
      choose(e.message);
      Kiko.react('gagal');
    }
  }

  function qrisStage(r, keyName) {
    const url = r.instructions?.qrisUrl;
    $('#stage').innerHTML = `<div class="qris reveal">
      <div class="qris-card">
        <div class="qris-brand"><b>QRIS</b><span>${esc(r.instructions?.merchant || 'RANGKAI KERETA')}</span></div>
        <div class="qris-code" role="img" aria-label="Kode QR pembayaran">${qrSvg(url)}<span class="scanline" aria-hidden="true"></span></div>
        <div class="qris-amt"><span>Total bayar</span><b class="mono">${rupiah(booking.amount)}</b></div>
      </div>
      <div class="qris-side stack">
        <h2 class="h-xs">Pindai untuk membayar</h2>
        <ol class="va-steps"><li>Hubungkan ponsel ke Wi-Fi yang sama dengan komputer ini.</li><li>Buka kamera, Google Lens, atau aplikasi pemindai apa pun, lalu arahkan ke kode.</li><li>Ketuk tautan yang muncul. Pembayaran langsung diproses.</li></ol>
        <div class="wait-line" role="status"><span class="dot"></span>Menunggu pembayaran dari ponsel Anda...</div>
        <details class="fallback"><summary>Tidak bisa memindai?</summary>
          <p class="muted">Bila tautan di bawah tidak terbuka di ponsel, Wi-Fi ini memblokir koneksi antarperangkat (umum di Wi-Fi kampus atau publik). Sambungkan laptop ke hotspot ponsel, atau gunakan tombol simulasi. Hasilnya tetap dikirim lewat webhook bertanda tangan, sama seperti pembayaran sungguhan.</p>
          <div class="row"><button class="btn gold sm" id="ok">Simulasikan berhasil</button><button class="btn ghost sm" id="bad">Simulasikan gagal</button></div>
          <p class="muted mono qris-url">${esc(url)}</p>
        </details>
        <button class="btn link" id="other">Ganti metode pembayaran</button>
      </div>
    </div>`;
    $('#other').addEventListener('click', () => { flow.del(keyName); choose(); });
    const send = async (outcome) => {
      $$('#stage .fallback button').forEach((x) => { x.disabled = true; });
      try { await api(`/api/mock-gateway/checkout/${r.checkoutToken}/pay`, { method: 'POST', body: { outcome } }); } catch (e) { choose(e.message); }
    };
    $('#ok').addEventListener('click', () => send('success'));
    $('#bad').addEventListener('click', () => send('fail'));
    Kiko.react('pilih', 'Pindai pakai kamera ponsel, ya. Saya tunggu di sini.', 3200);
    watch(r.payment.id, keyName);
  }

  function vaStage(payment) {
    clearInterval(poll);
    cleanPanel?.();
    $('#stage').innerHTML = `<div class="reveal"><div id="va-box"></div><button class="btn link" id="other" ${payment.status === 'UNDER_REVIEW' ? 'hidden' : ''}>Ganti metode pembayaran</button>
      ${payment.status === 'UNDER_REVIEW' ? '<p class="muted" style="margin-top:12px">Anda boleh menutup halaman ini. Hasil pemeriksaan masuk ke notifikasi dan halaman <a href="/perjalanan" data-link>Perjalanan saya</a>.</p>' : ''}</div>`;
    cleanPanel = transferPanel($('#va-box'), payment, { amount: booking.amount, onChange: (p, exp) => { if (exp) startTimer(exp); vaStage(p); } });
    $('#other').addEventListener('click', () => choose());
    Kiko.react('halo', payment.status === 'REJECTED' ? 'Buktinya ditolak. Cek alasannya, lalu unggah ulang, ya.' : payment.status === 'UNDER_REVIEW' ? 'Bukti sedang diperiksa admin.' : `Transfer ke VA ${METHOD[payment.method].split(' ').pop()}, lalu unggah buktinya.`, 3600);
    if (payment.status === 'UNDER_REVIEW') watch(payment.id, null, 4000);
  }

  function watch(paymentId, keyName, every = 1200) {
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const [bk, py] = await Promise.all([api(`/api/bookings/${id}`), api(`/api/payments/${paymentId}`)]);
        if (bk.status === 'CONFIRMED') { if (keyName) flow.del(keyName); succeed(); } else if (bk.status === 'EXPIRED' || bk.status === 'CANCELLED') showExpired();
        else if (py.payment.status === 'FAILED') {
          if (keyName) flow.del(keyName);
          choose('Pembayaran gagal dan tidak ada dana yang terpotong. Coba lagi atau pilih metode lain.');
          Kiko.react('gagal', 'Pembayarannya gagal. Kursi Anda masih aman, kok.', 3400);
        } else if (py.payment.status === 'REJECTED' && !keyName) vaStage(py.payment);
      } catch { /* dicoba lagi pada detak berikutnya */ }
    }, every);
  }

  async function check() {
    try {
      const b = await api(`/api/bookings/${id}`);
      if (b.status === 'CONFIRMED') go(`/tiket/${id}`, { replace: true });
      else if (b.status === 'PENDING_PAYMENT') startTimer(b.expiresAt);
      else showExpired();
    } catch { showExpired(); }
  }

  return () => { alive = false; stopTimer?.(); clearInterval(poll); cleanPanel?.(); };
}
