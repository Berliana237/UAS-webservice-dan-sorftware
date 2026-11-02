/**
 * Halaman masuk dan daftar.
 * Masuk: pemandangan dari jendela kereta malam. Kiko menutup mata saat kata sandi diketik.
 * Daftar: karcis tercetak mengikuti isian, tiap kolom yang benar membuat satu lubang pukulan kondektur.
 * Berhasil: pintu gerbong menutup lalu membuka ke halaman tujuan.
 */
import { $, $$, api, beginLogin, completeLogin, currentUser, esc, go, restoreSession, sleep, toast } from '../core.js';
import { Kiko } from '../kiko.js';
import { doorsClose, doorsOpen, icon, scene } from '../ui.js';
import { Sound } from '../sound.js';

const safeNext = (q) => {
  const n = q.get('next') || '/';
  return /^\/(?!\/)[\w\-/?=&%.]*$/.test(n) ? n : '/';
};

function validators(mode) {
  return {
    name: (v) => (v.trim().length < 2 ? 'Tulis minimal 2 huruf.' : v.length > 80 ? 'Maksimal 80 karakter.' : ''),
    email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Contoh: nama@email.com'),
    password: (v) => {
      if (mode === 'login') return v ? '' : 'Isi kata sandi Anda.';
      if (v.length < 8) return 'Minimal 8 karakter.';
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return 'Campurkan huruf dan angka.';
      return '';
    },
  };
}

export function render(main, { url, query }) {
  const mode = url.pathname === '/daftar' ? 'signup' : 'login';
  const next = safeNext(query);
  const nextQ = next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  if (url.pathname === '/auth/callback') { go('/masuk', { replace: true }); return undefined; }

  main.innerHTML = `
  <section class="auth ${mode}">
    <div class="auth-view" aria-hidden="false">
      ${scene('window')}
      <div class="auth-frame"></div>
      <div class="auth-kiko"><div id="auth-kiko"></div></div>
    </div>
    <div class="auth-side">
      <div class="auth-in reveal">
        <div class="auth-tabs" role="tablist">
          <a href="/masuk${nextQ}" data-link role="tab" aria-selected="${mode === 'login'}" class="${mode === 'login' ? 'on' : ''}">Masuk</a>
          <a href="/daftar${nextQ}" data-link role="tab" aria-selected="${mode === 'signup'}" class="${mode === 'signup' ? 'on' : ''}">Daftar</a>
          <i class="tab-ind"></i>
        </div>
        <h1>${mode === 'login' ? 'Selamat datang <em>kembali.</em>' : 'Karcis pertama <em>Anda.</em>'}</h1>
        <p class="muted">${mode === 'login' ? 'Masuk untuk melanjutkan pesanan dan melihat tiket.' : 'Isi tiga kolom ini, karcis Anda langsung dicetak.'}</p>
        ${mode === 'signup' ? `
        <div class="ticket-wrap print-wrap"><div class="ticket printing" aria-hidden="true">
          <div class="pr-top"><span class="eyebrow">Karcis penumpang</span><span class="mono pr-no">No. RK-${String(Math.floor(Math.random() * 90000) + 10000)}</span></div>
          <div class="pr-name" id="pr-name">Nama Anda</div>
          <div class="pr-mail mono" id="pr-mail">email@anda.com</div>
          <div class="holes"><i data-h="name"></i><i data-h="email"></i><i data-h="password"></i></div>
        </div></div>` : ''}
        <form id="form" novalidate>
          ${mode === 'signup' ? `<div class="af"><input id="name" name="name" autocomplete="name" placeholder=" " maxlength="80"><label for="name">Nama lengkap</label><small id="h-name"></small></div>` : ''}
          <div class="af"><input id="email" name="email" type="email" inputmode="email" autocomplete="username" placeholder=" " maxlength="120"><label for="email">Email</label><small id="h-email"></small></div>
          <div class="af"><input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder=" " maxlength="72"><label for="password">Kata sandi</label>
            <button class="af-eye" id="eye" type="button" aria-pressed="false" aria-label="Tampilkan kata sandi">${icon.eye}</button><small id="h-password"></small><small class="caps" id="caps" hidden>Caps Lock aktif</small></div>
          <p class="auth-err" id="err" role="alert" hidden></p>
          <button class="btn gold block" id="submit" type="submit"><span class="tx">${mode === 'login' ? 'Masuk' : 'Cetak karcis saya'}</span></button>
        </form>
        ${mode === 'login' ? `<details class="demo"><summary>Akun demo untuk penguji</summary><div class="demo-grid">
          ${['customer', 'operator', 'admin'].map((r) => `<button type="button" class="btn ghost sm" data-demo="${r}@rangkai.test">${r === 'customer' ? 'Pelanggan' : r === 'operator' ? 'Operator' : 'Admin'}</button>`).join('')}
          </div><p class="muted">Tombol ini mengisi email. Kata sandi demo ada di README.</p></details>` : ''}
      </div>
    </div>
  </section>`;

  const kiko = Kiko.mount($('#auth-kiko'), { pat: true });
  const timers = [setTimeout(() => { kiko.mood('wink', 2400); kiko.say(mode === 'login' ? 'Silakan, karcisnya saya tunggu.' : 'Penumpang baru! Selamat datang.', 3000); kiko.pose('wave', 1600); }, 1100)];

  restoreSession().then((ok) => { if (ok && currentUser() && main.contains($('#form'))) go(next, { replace: true }); });

  const form = $('#form');
  const err = $('#err');
  const sub = $('#submit');
  const pw = $('#password');
  const v = validators(mode);
  const showErr = (m) => { err.textContent = m; err.hidden = false; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); };

  function check(input, final) {
    const fn = v[input.id];
    if (!fn) return true;
    const message = fn(input.value);
    const box = input.parentElement;
    const hint = $(`#h-${input.id}`);
    const touched = final || box.dataset.touched;
    box.classList.toggle('bad', Boolean(message && touched));
    box.classList.toggle('good', !message && Boolean(input.value));
    hint.textContent = message && touched ? message : '';
    const hole = $(`[data-h="${input.id}"]`);
    if (hole) {
      const was = hole.classList.contains('on');
      hole.classList.toggle('on', !message);
      if (!message && !was) { Sound.play('punch'); kiko.mood('happy', 900); }
    }
    return !message;
  }

  $$('.af input', form).forEach((input) => {
    input.addEventListener('focus', () => {
      if (input.id === 'password' && pw.type === 'password') kiko.peek(true);
      else { kiko.peek(false); kiko.lookAt(input); }
    });
    input.addEventListener('blur', () => { kiko.peek(false); kiko.lookAt(null); input.parentElement.dataset.touched = '1'; check(input, false); });
    input.addEventListener('input', () => {
      err.hidden = true;
      check(input, false);
      if (input.id === 'name') $('#pr-name').textContent = input.value.trim() || 'Nama Anda';
      if (input.id === 'email' && $('#pr-mail')) $('#pr-mail').textContent = input.value.trim() || 'email@anda.com';
    });
  });
  ['keydown', 'keyup'].forEach((ev) => pw.addEventListener(ev, (e) => { if (e.getModifierState) $('#caps').hidden = !e.getModifierState('CapsLock'); }));
  $('#eye').addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.setAttribute('aria-pressed', String(show));
    e.currentTarget.setAttribute('aria-label', show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    if (show) { kiko.peek(false); kiko.mood('wink', 1500); kiko.say('Saya tidak mengintip, kok.', 1800); } else if (document.activeElement === pw) kiko.peek(true);
    pw.focus();
  });
  $$('[data-demo]', main).forEach((b) => b.addEventListener('click', () => { $('#email').value = b.dataset.demo; check($('#email'), false); pw.focus(); }));

  /* Tahap PKCE dimulai lebih dulu supaya tombol masuk langsung siap */
  let flowState = null;
  const ensureFlow = async () => { flowState ||= await beginLogin(); return flowState; };
  ensureFlow().catch(() => {});

  const succeed = async (user) => {
    sub.classList.add('okk');
    $('.tx', sub).textContent = mode === 'login' ? `Silakan naik, ${(user.name || '').split(' ')[0]}` : 'Karcis tercetak';
    Kiko.react('sukses', mode === 'login' ? 'Karcis sah. Silakan naik!' : 'Selamat bergabung!', 1800);
    if (mode === 'signup') $('.printing')?.classList.add('stamped');
    await sleep(mode === 'signup' ? 1200 : 750);
    await doorsClose();
    await go(next, { replace: true });
    setTimeout(doorsOpen, 120);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const inputs = $$('.af input', form);
    const ok = inputs.map((i) => check(i, true)).every(Boolean);
    if (!ok) { showErr('Periksa kolom yang ditandai.'); Kiko.react('bingung', 'Ada yang belum pas. Lihat kolom merah, ya.'); Sound.play('fail'); inputs.find((i) => i.parentElement.classList.contains('bad'))?.focus(); return; }
    sub.disabled = true;
    sub.classList.add('busy');
    $('.tx', sub).insertAdjacentHTML('beforebegin', '<span class="spin" aria-hidden="true"></span>');
    kiko.mood('thinking');
    try {
      if (mode === 'signup') await api('/api/auth/register', { method: 'POST', noAuth: true, body: { name: $('#name').value.trim(), email: $('#email').value.trim(), password: pw.value } });
      const f = await ensureFlow();
      const user = await completeLogin(f, $('#email').value.trim(), pw.value);
      $('.spin', sub)?.remove();
      await succeed(user);
    } catch (ex) {
      $('.spin', sub)?.remove();
      sub.disabled = false;
      sub.classList.remove('busy');
      flowState = null;
      ensureFlow().catch(() => {});
      const fields = ex.details?.fields;
      if (fields) Object.entries(fields).forEach(([k, m]) => { const h = $(`#h-${k}`); if (h) { h.textContent = m; h.parentElement.classList.add('bad'); } });
      const msg = ex.code === 'RATE_LIMITED' ? `Terlalu banyak percobaan. Coba lagi ${ex.details?.retryAfterSeconds || 60} detik lagi.` : ex.message;
      showErr(msg);
      Kiko.react('gagal', ex.code === 'INVALID_CREDENTIALS' ? 'Hmm, karcisnya belum cocok. Coba periksa lagi.' : esc(msg));
      if (ex.code === 'NETWORK') toast(ex.message, 'err');
    }
  });

  return () => { timers.forEach(clearTimeout); kiko.destroy(); };
}
