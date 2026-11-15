/** Profil: data diri untuk isi otomatis penumpang, dan ganti kata sandi. */
import { $, api, esc, toast, ageFrom, paxType, showFieldErrors, clearFieldErrors, initials, dateNum, currentUser, wibToday } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';

const ROLE = { customer: 'Pelanggan', masinis: 'Masinis', admin: 'Admin' };

export function render(main) {
  main.innerHTML = `<div class="page wrap profile-page"><div id="body"><span class="skel" style="height:420px"></span></div></div>`;

  api('/api/auth/me').then(({ user }) => {
    if (!main.contains($('#body'))) return;
    $('#body').innerHTML = `
      <div class="profile-hero">
        <span class="avatar xl" aria-hidden="true">${esc(initials(user.name))}</span>
        <div><p class="eyebrow">${ROLE[user.role] || user.role}</p><h1 class="h-sm">${esc(user.name)}</h1><p class="sub">${esc(user.email)} · bergabung ${dateNum(user.createdAt)}</p></div>
      </div>
      <div class="grid-2 profile-grid">
        <form class="card stack" id="pf" novalidate>
          <div class="card-head"><div><h2>Data diri</h2><p>Dipakai untuk mengisi otomatis penumpang pertama saat memesan. Kolom kosong tidak diisi otomatis.</p></div></div>
          <div class="f" data-name="name"><label for="name">Nama lengkap</label><input class="in" id="name" value="${esc(user.name)}" maxlength="80" autocomplete="name"><small class="hint"></small></div>
          <div class="f"><label for="email">Email</label><input class="in" id="email" value="${esc(user.email)}" readonly><small class="hint">Email dipakai untuk masuk dan tidak bisa diubah sendiri.</small></div>
          <div class="grid-2">
            <div class="f" data-name="phone"><label for="phone">Nomor HP <span class="opt">(opsional)</span></label><input class="in mono" id="phone" value="${esc(user.phone || '')}" inputmode="tel" maxlength="16" placeholder="08xxxxxxxxxx" autocomplete="tel"><small class="hint"></small></div>
            <div class="f" data-name="birthDate"><label for="birthDate">Tanggal lahir <span class="opt">(opsional)</span></label><input class="in mono" id="birthDate" type="date" value="${esc(user.birthDate || '')}" max="${wibToday()}"><small class="hint" id="age-hint"></small></div>
          </div>
          <div class="f" data-name="nik"><label for="nik">NIK <span class="opt">(opsional, 16 digit)</span></label><input class="in mono" id="nik" value="${esc(user.nik || '')}" inputmode="numeric" maxlength="16" placeholder="16 digit"><small class="hint">Disimpan terenkripsi. Tiket hanya menampilkan 4 digit terakhir.</small></div>
          <div class="row end"><button class="btn gold" id="save" type="submit">Simpan perubahan</button></div>
        </form>
        <form class="card stack" id="pw" novalidate>
          <div class="card-head"><div><h2>Keamanan akun</h2><p>Setelah kata sandi diganti, sesi di perangkat lain otomatis dikeluarkan.</p></div></div>
          <div class="f" data-name="currentPassword"><label for="cur">Kata sandi saat ini</label><input class="in" id="cur" type="password" autocomplete="current-password" maxlength="72"><small class="hint"></small></div>
          <div class="f" data-name="newPassword"><label for="npw">Kata sandi baru</label><input class="in" id="npw" type="password" autocomplete="new-password" maxlength="72"><small class="hint">Minimal 8 karakter, campuran huruf dan angka.</small></div>
          <div class="f" data-name="confirm"><label for="cpw">Ulangi kata sandi baru</label><input class="in" id="cpw" type="password" autocomplete="new-password" maxlength="72"><small class="hint"></small></div>
          <div class="pw-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <div class="row end"><button class="btn ghost" id="pwsave" type="submit">Ganti kata sandi</button></div>
        </form>
      </div>`;

    const ageHint = () => {
      const a = ageFrom($('#birthDate').value);
      $('#age-hint').textContent = a === null ? 'Mengisi usia penumpang otomatis.' : `${a} tahun, golongan ${paxType(a).label.toLowerCase()}.`;
    };
    ageHint();
    $('#birthDate').addEventListener('input', ageHint);
    $('#nik').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });

    $('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      clearFieldErrors(form);
      const btn = $('#save');
      btn.disabled = true;
      try {
        const r = await api('/api/auth/me', { method: 'PATCH', body: { name: $('#name').value.trim(), phone: $('#phone').value.trim(), nik: $('#nik').value.trim(), birthDate: $('#birthDate').value } });
        $('.profile-hero h1').textContent = r.user.name;
        toast('Profil tersimpan.', 'ok');
        Sound.play('chime');
        Kiko.react('bangga', 'Tersimpan! Pemesanan berikutnya jadi lebih cepat.', 2600);
      } catch (ex) {
        if (!showFieldErrors(form, ex)) toast(ex.message, 'err');
        Kiko.react('bingung', 'Ada yang perlu diperbaiki.');
      } finally { btn.disabled = false; }
    });

    const meter = () => {
      const v = $('#npw').value;
      const score = [v.length >= 8, /[A-Za-z]/.test(v) && /\d/.test(v), v.length >= 12, /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
      document.querySelectorAll('.pw-meter i').forEach((i, n) => i.classList.toggle('on', n < score));
    };
    $('#npw').addEventListener('input', meter);
    $('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      clearFieldErrors(form);
      if ($('#npw').value !== $('#cpw').value) { showFieldErrors(form, { details: { fields: { confirm: 'Kata sandi baru tidak sama.' } } }); return; }
      const btn = $('#pwsave');
      btn.disabled = true;
      try {
        const r = await api('/api/auth/me/password', { method: 'POST', body: { currentPassword: $('#cur').value, newPassword: $('#npw').value } });
        form.reset();
        meter();
        toast(r.notice || 'Kata sandi diganti.', 'ok');
        Kiko.react('bangga', 'Kata sandi baru, akun makin aman!', 2400);
      } catch (ex) {
        if (!showFieldErrors(form, ex)) toast(ex.code === 'RATE_LIMITED' ? 'Terlalu banyak percobaan. Tunggu sebentar.' : ex.message, 'err');
      } finally { btn.disabled = false; }
    });
    Kiko.react('halo', `Halo, ${(currentUser()?.name || '').split(' ')[0]}! Lengkapi profil supaya pesan tiket lebih cepat.`, 3200);
  }).catch((e) => { $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; });
}
