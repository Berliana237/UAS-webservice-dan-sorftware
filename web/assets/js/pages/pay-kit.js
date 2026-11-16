/**
 * Komponen pembayaran yang dipakai halaman Bayar dan Perjalanan saya:
 * label status, panel transfer virtual account (nomor VA, unggah bukti, alasan penolakan, unggah ulang).
 */
import { $, api, esc, rupiah, fileToBase64, dateTime, toast, protectedBlobUrl, openProof } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { icon } from '../ui.js';

export const BOOKING_STATUS = {
  PENDING_PAYMENT: ['Menunggu pembayaran', 'wait'], CONFIRMED: ['Lunas', 'ok'], CHECKED_IN: ['Sudah naik', 'ok'],
  CANCELLED: ['Dibatalkan', 'bad'], EXPIRED: ['Kedaluwarsa', 'bad'],
};
export const PAYMENT_STATUS = {
  PENDING: ['Menunggu pembayaran', 'wait'], AWAITING_TRANSFER: ['Menunggu transfer', 'wait'], UNDER_REVIEW: ['Pending, menunggu verifikasi admin', 'wait'],
  REJECTED: ['Ditolak, unggah ulang', 'bad'], SUCCEEDED: ['Berhasil', 'ok'], FAILED: ['Gagal', 'bad'], CANCELLED: ['Diganti metode lain', 'mute'],
  REFUNDED: ['Dikembalikan', 'info'], AMOUNT_MISMATCH: ['Nominal tidak cocok', 'bad'],
};
export const METHOD = { QRIS: 'QRIS', VA_BCA: 'Virtual Account BCA', VA_MANDIRI: 'Virtual Account Mandiri' };
export const pill = (map, s) => { const [t, c] = map[s] || [s, 'mute']; return `<span class="pill ${c}">${esc(t)}</span>`; };
const vaFmt = (v) => String(v || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX = 3 * 1024 * 1024;

/**
 * Panel transfer VA. payment: objek dari /api/payments. onChange(paymentBaru) dipanggil setelah bukti terkirim.
 * Mengembalikan fungsi pembersih.
 */
export function transferPanel(box, payment, { amount, onChange, compact = false } = {}) {
  let file = null;
  let preview = null;
  const latest = payment.proofs?.[0];
  const canUpload = ['AWAITING_TRANSFER', 'REJECTED'].includes(payment.status);

  const head = `<div class="va-card">
      <div class="va-top"><span class="bank-logo ${payment.method === 'VA_BCA' ? 'bca' : 'mdr'}">${esc(payment.bank || '')}</span>${pill(PAYMENT_STATUS, payment.status)}</div>
      <span class="label">Nomor virtual account</span>
      <div class="va-num"><b class="mono" id="va-num">${esc(vaFmt(payment.vaNumber))}</b><button class="icon-btn" type="button" id="copy-va" aria-label="Salin nomor virtual account" title="Salin">${icon.copy}</button></div>
      <div class="va-amt"><span>Jumlah transfer</span><b class="mono">${rupiah(amount ?? payment.amount)}</b></div>
    </div>`;

  const rejected = payment.status === 'REJECTED' && latest?.reason ? `<div class="callout danger" role="alert">${icon.warn}<div><b>Bukti transfer ditolak</b><p>${esc(latest.reason)}</p><p>Silakan unggah bukti yang benar di bawah ini, lalu kirim ulang.</p></div></div>` : '';
  const review = payment.status === 'UNDER_REVIEW' ? `<div class="callout" role="status">${icon.clock}<div><b>Bukti sedang diperiksa</b><p>Dikirim ${latest ? dateTime(latest.createdAt) : ''}. Biasanya selesai dalam beberapa menit. Kursi tetap ditahan selama pemeriksaan, dan hasilnya dikirim lewat notifikasi.</p></div></div>` : '';
  const done = payment.status === 'SUCCEEDED' ? `<div class="callout ok">${icon.check}<div><b>Transfer diterima</b><p>Pembayaran sudah diverifikasi. Tiket sudah terbit.</p></div></div>` : '';
  const history = payment.proofs?.length ? `<details class="proof-hist"${compact ? '' : ' open'}><summary>Riwayat bukti (${payment.proofs.length})</summary><ul>${payment.proofs.map((p) => `<li><span>${esc(p.fileName)}<small class="muted">${dateTime(p.createdAt)}${p.note ? ` · "${esc(p.note)}"` : ''}</small></span>${pill({ SUBMITTED: ['Diperiksa', 'info'], ACCEPTED: ['Diterima', 'ok'], REJECTED: ['Ditolak', 'bad'] }, p.status)}<button class="btn link" type="button" data-view="${esc(p.id)}">Lihat</button></li>`).join('')}</ul></details>` : '';

  const steps = canUpload ? `<ol class="va-steps"><li>Buka aplikasi atau ATM ${esc(payment.bank || '')}, pilih transfer ke virtual account.</li><li>Masukkan nomor di atas. Nominal harus sama persis.</li><li>Simpan bukti transfer, lalu unggah di bawah.</li></ol>` : '';
  const form = canUpload ? `<form class="stack proof-form" id="proof-form" novalidate>
      <div class="f" data-name="file"><span class="lbl">Bukti transfer</span>
        <label class="drop" id="drop">${icon.upload}<b>Pilih atau seret berkas ke sini</b><small>JPG, PNG, WEBP, atau PDF. Maksimal 3 MB.</small><input type="file" id="proof-file" accept="${ACCEPT}"></label>
        <div id="prev"></div><small class="hint"></small></div>
      <div class="f" data-name="note"><label for="proof-note">Catatan untuk admin <span class="opt">(opsional)</span></label><textarea class="ta" id="proof-note" maxlength="300" placeholder="Contoh: transfer dari rekening atas nama Sinta, pukul 14.05"></textarea><small class="hint"><span id="note-n">0</span>/300</small></div>
      <button class="btn gold" type="submit" id="proof-send" disabled>${payment.status === 'REJECTED' ? 'Kirim ulang bukti' : 'Kirim bukti transfer'}</button>
    </form>` : '';

  box.innerHTML = `<div class="stack transfer">${head}${rejected}${review}${done}${steps}${form}${history}</div>`;

  $('#copy-va', box)?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(payment.vaNumber); toast('Nomor virtual account disalin.', 'ok'); } catch { toast('Salin manual: pilih nomor lalu Ctrl+C.', 'warn'); }
  });
  box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await openProof(`/api/payments/proofs/${b.dataset.view}/file`);
    } catch (e) { toast(e.message, 'err'); }
  }));
  if (!canUpload) return () => {};

  const input = $('#proof-file', box);
  const drop = $('#drop', box);
  const fbox = box.querySelector('[data-name=file]');
  const setErr = (m) => { fbox.classList.toggle('bad', Boolean(m)); fbox.querySelector('.hint').textContent = m || ''; };
  const choose = (f) => {
    setErr('');
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) { setErr('Format harus JPG, PNG, WEBP, atau PDF.'); return; }
    if (f.size > MAX) { setErr(`Ukuran ${(f.size / 1048576).toFixed(1)} MB. Maksimal 3 MB.`); return; }
    file = f;
    if (preview) URL.revokeObjectURL(preview);
    preview = f.type.startsWith('image/') || f.type === 'application/pdf' ? URL.createObjectURL(f) : null;
    $('#prev', box).innerHTML = `<div class="drop-prev">${preview ? (f.type === 'application/pdf' ? `<iframe class="tx-pdf" src="${preview}#toolbar=0&navpanes=0&view=FitH" title="Pratinjau bukti PDF"></iframe>` : `<img src="${preview}" alt="Pratinjau bukti">`) : '<span class="doc">PDF</span>'}<span><b>${esc(f.name)}</b><small>${(f.size / 1024).toFixed(0)} KB</small></span><button class="btn link" type="button" id="rm">Ganti</button></div>`;
    drop.hidden = true;
    $('#proof-send', box).disabled = false;
    $('#rm', box).addEventListener('click', () => { file = null; $('#prev', box).innerHTML = ''; drop.hidden = false; input.value = ''; $('#proof-send', box).disabled = true; });
    Sound.play('pick');
  };
  input.addEventListener('change', () => choose(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => choose(e.dataTransfer.files[0]));
  $('#proof-note', box).addEventListener('input', (e) => { $('#note-n', box).textContent = e.target.value.length; });

  $('#proof-form', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) { setErr('Pilih berkas bukti transfer dulu.'); return; }
    const btn = $('#proof-send', box);
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Mengunggah';
    try {
      const dataBase64 = await fileToBase64(file);
      const r = await api(`/api/payments/${payment.id}/proof`, { method: 'POST', body: { fileName: file.name, dataBase64, note: $('#proof-note', box).value.trim() } });
      Sound.play('chime');
      Kiko.react('bangga', 'Bukti terkirim! Admin akan memeriksanya.', 3000);
      toast('Bukti transfer terkirim. Hasil pemeriksaan dikirim lewat notifikasi.', 'ok');
      document.dispatchEvent(new CustomEvent('rk:notify-refresh'));
      onChange?.(r.payment, r.expiresAt);
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = 'Kirim bukti transfer';
      if (ex.details?.fields?.file) setErr(ex.details.fields.file);
      else toast(ex.message, 'err');
      Kiko.react('gagal', ex.message);
    }
  });
  return () => { if (preview) URL.revokeObjectURL(preview); };
}
