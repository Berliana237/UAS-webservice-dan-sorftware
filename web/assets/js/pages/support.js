/**
 * Pusat Bantuan: FAQ berkategori (klik untuk membuka jawaban, bisa dicari) dan konsultasi dengan Kiko lewat asisten AI.
 * Percakapan hanya disimpan di memori halaman ini.
 */
import { $, $$, api, esc, debounce, currentUser, go } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { icon } from '../ui.js';

const SUGGEST = ['Berapa lama kursi ditahan?', 'Bagaimana bayar pakai QRIS?', 'Bukti transfer saya ditolak', 'Apakah lansia dapat potongan?', 'Kereta apa saja dari Gambir?'];

/** Markdown minimal yang aman: **tebal** dan daftar "- ". Semua teks di-escape lebih dulu. */
function mdLite(text) {
  const lines = esc(text).split(/\n/);
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-*•]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${line.replace(/^\s*[-*•]\s+/, '')}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

export function render(main) {
  // Pusat Bantuan hanya untuk pelanggan dan tamu. Admin dan masinis diarahkan ke panelnya.
  const role = currentUser()?.role;
  if (role === 'admin' || role === 'masinis') { go(role === 'admin' ? '/admin' : '/masinis', { replace: true }); return undefined; }
  const history = [];
  main.innerHTML = `<div class="page wrap help-page">
    <section class="help-hero">
      <div><p class="eyebrow">Pusat bantuan</p><h1>Ada yang bisa <em>kami bantu?</em></h1><p class="lede">Cari jawaban cepat di bawah, atau tanya langsung ke Kiko. Kiko paham jadwal, kursi per ruas, pembayaran, dan tiket di Rangkai.</p>
        <div class="search-in help-search">${icon.search}<input class="in" id="q" type="search" placeholder="Cari: refund, QRIS, lansia, NIK..." aria-label="Cari pertanyaan"></div></div>
      <div class="help-kiko"><div id="help-kiko"></div></div>
    </section>
    <div class="help-layout">
      <section aria-labelledby="faq-h">
        <div class="row between"><h2 id="faq-h" class="h-xs">Pertanyaan yang sering diajukan</h2><span class="muted" id="faq-n"></span></div>
        <div class="cat-chips" id="cats" role="group" aria-label="Kategori"></div>
        <div id="faq"><span class="skel" style="height:300px"></span></div>
      </section>
      <aside aria-labelledby="chat-h">
        <div class="chat">
          <div class="chat-head"><span class="chat-av"><span id="chat-kiko"></span></span><div><b id="chat-h">Tanya Kiko</b><small><i></i>Asisten AI Rangkai</small></div></div>
          <div class="chat-log" id="log" aria-live="polite"></div>
          <div>
            <div class="chat-suggest" id="sug">${SUGGEST.map((s) => `<button type="button">${esc(s)}</button>`).join('')}</div>
            <form class="chat-form" id="cf"><label class="sr" for="msg">Pesan untuk Kiko</label><textarea class="ta" id="msg" rows="1" maxlength="1000" placeholder="Tulis pertanyaan Anda..."></textarea><button class="btn gold" id="send" aria-label="Kirim">${icon.send}</button></form>
            <p class="chat-note">Jangan bagikan kata sandi atau NIK lengkap. Angka 16 digit, email, dan nomor HP disamarkan otomatis sebelum dikirim ke AI.</p>
          </div>
        </div>
      </aside>
    </div>
  </div>`;

  const big = Kiko.mount($('#help-kiko'), { pat: true, chatty: false });
  const tiny = Kiko.mount($('#chat-kiko'), {});
  const timers = [setTimeout(() => { big.mood('wink', 2400); big.say('Tanya apa saja soal perjalanan Anda!', 3200); big.pose('wave', 1500); }, 900)];

  /* ---------- FAQ ---------- */
  let cats = [];
  let active = 'all';
  const paintFaq = () => {
    const q = $('#q').value.trim().toLowerCase();
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    const hl = (t) => (words.length ? esc(t).replace(new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'), '<mark>$1</mark>') : esc(t));
    let n = 0;
    const html = cats.filter((c) => active === 'all' || c.id === active).map((c) => {
      const items = c.items.filter((i) => !words.length || words.every((w) => `${i.q} ${i.a}`.toLowerCase().includes(w)));
      n += items.length;
      if (!items.length) return '';
      return `<div class="faq-cat"><h3>${esc(c.title)}</h3><div class="acc">${items.map((i) => `<div class="acc-item"><button class="acc-q" type="button" aria-expanded="${words.length ? 'true' : 'false'}" aria-controls="a-${i.id}" id="q-${i.id}">${hl(i.q)}<i aria-hidden="true"></i></button>
        <div class="acc-a" id="a-${i.id}" role="region" aria-labelledby="q-${i.id}"><div><p>${hl(i.a)}</p></div></div></div>`).join('')}</div></div>`;
    }).join('');
    $('#faq').innerHTML = html || `<div class="empty"><p>Belum ada jawaban untuk "${esc(q)}". Coba tanyakan ke Kiko di samping.</p><button class="btn ghost sm" type="button" id="ask-q">Tanya Kiko soal ini</button></div>`;
    $('#faq-n').textContent = `${n} pertanyaan`;
    $('#ask-q')?.addEventListener('click', () => ask($('#q').value.trim()));
  };
  api('/api/support/faq', { noAuth: true }).then((r) => {
    cats = r.categories;
    $('#cats').innerHTML = [['all', 'Semua'], ...cats.map((c) => [c.id, c.title])].map(([id, t]) => `<button type="button" class="seg-chip" data-c="${id}" aria-pressed="${id === 'all'}">${esc(t)}</button>`).join('');
    paintFaq();
  }).catch(() => { $('#faq').innerHTML = '<p class="muted">FAQ belum bisa dimuat. Coba muat ulang halaman.</p>'; });
  $('#cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    active = b.dataset.c;
    $$('#cats [data-c]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paintFaq();
  });
  $('#q').addEventListener('input', debounce(paintFaq, 160));
  $('#faq').addEventListener('click', (e) => {
    const q = e.target.closest('.acc-q');
    if (!q) return;
    const open = q.getAttribute('aria-expanded') === 'true';
    q.setAttribute('aria-expanded', String(!open));
    if (!open) big.mood('happy', 900);
  });

  /* ---------- Obrolan ---------- */
  const log = $('#log');
  const add = (role, html, extra = '') => {
    log.insertAdjacentHTML('beforeend', `<div class="msg ${role === 'user' ? 'me' : 'ai'}">${html}${extra}</div>`);
    log.scrollTop = log.scrollHeight;
  };
  add('assistant', mdLite('Halo! Saya **Kiko**, kondektur sekaligus asisten Rangkai. Mau tanya soal jadwal, kursi, pembayaran, atau tiket?'));

  let busy = false;
  async function ask(text) {
    const t = String(text || '').trim();
    if (!t || busy) return;
    busy = true;
    $('#sug').hidden = true;
    $('#msg').value = '';
    $('#msg').style.height = '';
    add('user', esc(t));
    history.push({ role: 'user', content: t });
    log.insertAdjacentHTML('beforeend', '<div class="msg ai typing-wrap"><span class="typing"><i></i><i></i><i></i></span></div>');
    log.scrollTop = log.scrollHeight;
    tiny.mood('thinking');
    big.mood('thinking');
    $('#send').disabled = true;
    try {
      const r = await api('/api/support/chat', { method: 'POST', noAuth: true, body: { messages: history.slice(-12) } });
      $('.typing-wrap', log)?.remove();
      history.push({ role: 'assistant', content: r.reply.slice(0, 1000) });
      add('assistant', mdLite(r.reply), r.source === 'faq' ? '<span class="src">Jawaban dari FAQ karena asisten AI sedang tidak tersedia.</span>' : '');
      tiny.mood('happy', 1400);
      big.mood('happy', 1400);
      Sound.play('chirp');
    } catch (e) {
      $('.typing-wrap', log)?.remove();
      history.pop();
      add('assistant', esc(e.code === 'RATE_LIMITED' ? 'Wah, pertanyaannya banyak sekali. Tunggu sebentar, lalu coba lagi, ya.' : `Maaf, saya belum bisa menjawab: ${e.message}`));
      tiny.mood('sad', 2000);
      big.mood('sad', 2000);
    } finally {
      busy = false;
      $('#send').disabled = false;
      $('#msg').focus();
    }
  }
  $('#cf').addEventListener('submit', (e) => { e.preventDefault(); ask($('#msg').value); });
  $('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#msg').value); } });
  $('#msg').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`; });
  $('#sug').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); });

  return () => { timers.forEach(clearTimeout); big.destroy(); tiny.destroy(); };
}
