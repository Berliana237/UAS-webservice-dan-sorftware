/**
 * Halaman QRIS di ponsel. Dibuka dari hasil pindai kamera atau Google Lens.
 * Begitu terbuka, pembayaran langsung diproses (simulasi penyedia QRIS); layar pemesanan di komputer ikut berubah.
 */
import { $, api, esc, rupiah, timeOf, dateLong, sleep } from '../core.js';
import { Sound } from '../sound.js';
import { icon } from '../ui.js';

export function render(main, { params }) {
  const token = params.token;
  let alive = true;
  main.innerHTML = `<div class="qp"><div class="qp-card" id="qp"><div class="qp-brand"><b>QRIS</b><span>Pembayaran simulasi</span></div><div class="qp-load"><span class="spin"></span><p>Membuka tagihan...</p></div></div></div>`;
  const box = $('#qp');
  const shell = (body) => `<div class="qp-brand"><b>QRIS</b><span>Pembayaran simulasi</span></div>${body}`;

  (async () => {
    let info;
    try { info = await api(`/api/qris/${encodeURIComponent(token)}`, { noAuth: true }); } catch (e) {
      box.innerHTML = shell(`<div class="qp-state bad">${icon.x}<h1>Kode tidak berlaku</h1><p>${esc(e.message)}</p></div>`);
      return;
    }
    const detail = `<dl class="qp-dl"><div><dt>Merchant</dt><dd>${esc(info.merchant)}</dd></div>${info.bookingCode ? `<div><dt>Pesanan</dt><dd class="mono">${esc(info.bookingCode)}</dd></div>` : ''}${info.trainName ? `<div><dt>Kereta</dt><dd>${esc(info.trainName)}</dd></div>` : ''}${info.from ? `<div><dt>Rute</dt><dd>${esc(info.from)} ke ${esc(info.to)}</dd></div>` : ''}${info.departureAt ? `<div><dt>Berangkat</dt><dd>${dateLong(info.departureAt)}, ${timeOf(info.departureAt)}</dd></div>` : ''}</dl>`;
    if (info.status === 'SUCCEEDED') { box.innerHTML = shell(`<div class="qp-state ok">${icon.check}<h1>Sudah dibayar</h1><p class="qp-amt mono">${rupiah(info.amount)}</p></div>${detail}`); return; }
    if (info.status !== 'PENDING') { box.innerHTML = shell(`<div class="qp-state bad">${icon.x}<h1>Tagihan sudah ditutup</h1><p>Kode QR ini tidak berlaku lagi. Buat pembayaran baru dari aplikasi.</p></div>${detail}`); return; }
    box.innerHTML = shell(`<p class="qp-label">Total pembayaran</p><p class="qp-amt mono">${rupiah(info.amount)}</p>${detail}<div class="qp-progress" role="status"><i></i><span>Memproses pembayaran...</span></div>`);
    await sleep(1300);
    if (!alive) return;
    try {
      const r = await api(`/api/qris/${encodeURIComponent(token)}/pay`, { method: 'POST', noAuth: true, body: {} });
      if (r.accepted === false) { box.innerHTML = shell(`<div class="qp-state ${r.status === 'SUCCEEDED' ? 'ok' : 'bad'}">${r.status === 'SUCCEEDED' ? icon.check : icon.x}<h1>${esc(r.message)}</h1></div>${detail}`); return; }
      Sound.play('success');
      box.innerHTML = shell(`<div class="qp-state ok">${icon.check}<h1>Pembayaran berhasil</h1><p class="qp-amt mono">${rupiah(info.amount)}</p><p>Silakan kembali ke layar pemesanan. Tiket akan muncul otomatis dalam beberapa detik.</p></div>${detail}`);
    } catch (e) {
      box.innerHTML = shell(`<div class="qp-state bad">${icon.x}<h1>Pembayaran gagal</h1><p>${esc(e.message)}</p></div>${detail}`);
    }
  })();
  return () => { alive = false; };
}
