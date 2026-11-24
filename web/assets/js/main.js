/** main.js: titik masuk SPA. Rute, header sesuai peran, lonceng notifikasi, menu pengguna, Kiko di pojok, dan pintu gerbong. */
import { $, $$, api, route, startRouter, restoreSession, currentUser, onSession, logout, go, hasScope, esc, toast, initials, ago, roleHome } from './core.js';
import { Kiko } from './kiko.js';
import { Sound } from './sound.js';
import { doorsOpen, icon } from './ui.js';

const page = (name) => () => import(`./pages/${name}.js`);
route('/', page('home'), { name: 'home' });
route('/masuk', page('auth'), { name: 'auth' });
route('/daftar', page('auth'), { name: 'auth' });
route('/auth/callback', page('auth'), { name: 'auth' });
route('/cari', page('search'), { name: 'search' });
route('/kursi/:tripId', page('seats'), { name: 'seats' });
route('/pesanan/:lockId', page('passengers'), { name: 'passengers', auth: true, scope: 'booking:write' });
route('/bayar/:bookingId', page('pay'), { name: 'pay', auth: true, scope: 'booking:read' });
route('/tiket/:bookingId', page('ticket'), { name: 'ticket', auth: true, scope: 'booking:read' });
route('/perjalanan', page('trips'), { name: 'trips', auth: true, scope: 'booking:read' });
route('/profil', page('profile'), { name: 'profile', auth: true });
route('/bantuan', page('support'), { name: 'support' });
route('/privasi', page('privacy'), { name: 'privacy' });
route('/qris/:token', page('qris'), { name: 'qris' });
route('/admin', page('admin'), { name: 'admin', auth: true, scope: 'admin' });
route('/admin/:section', page('admin'), { name: 'admin', auth: true, scope: 'admin' });
route('/admin/:section/:id', page('admin'), { name: 'admin', auth: true, scope: 'admin' });
route('/masinis', page('masinis'), { name: 'masinis', auth: true, scope: 'masinis' });
route('/masinis/:section', page('masinis'), { name: 'masinis', auth: true, scope: 'masinis' });
route('/masinis/:section/:id', page('masinis'), { name: 'masinis', auth: true, scope: 'masinis' });
route('/konsol', () => Promise.resolve({ render: () => { go(roleHome(currentUser()?.role), { replace: true }); } }), { name: 'redirect', auth: true });
route('.*', page('notfound'), { name: 'notfound', notFound: true });

/* ---------- Navigasi per peran ---------- */
function links() {
  const u = currentUser();
  if (u?.role === 'admin') return [['/admin', 'Dasbor'], ['/admin/data', 'Data Operasional'], ['/admin/pengguna', 'Pengguna'], ['/admin/armada', 'Armada'], ['/admin/transfer', 'Verifikasi Transfer'], ['/admin/sistem', 'Sistem']];
  if (u?.role === 'masinis') return [['/masinis', 'Dasbor'], ['/masinis/jadwal', 'Jadwal Dinas']];
  return [['/', 'Beranda'], ['/cari', 'Cari Tiket'], ...(u ? [['/perjalanan', 'Perjalanan Saya']] : []), ['/bantuan', 'Pusat Bantuan']];
}
const isOn = (href, path) => (href === '/' ? path === '/' : path === href || (href === '/masinis/jadwal' && path.startsWith('/masinis/perjalanan')) || (path.startsWith(`${href}/`) && !['/admin', '/masinis'].includes(href)) || (href === '/cari' && path.startsWith('/kursi')));

let unread = 0;
function renderHeader() {
  const u = currentUser();
  const path = location.pathname;
  const nav = links().map(([h, t]) => `<a class="nav-a ${isOn(h, path) ? 'on' : ''}" href="${h}" data-link ${isOn(h, path) ? 'aria-current="page"' : ''}>${t}</a>`).join('');
  $('#top').innerHTML = `<div class="wrap bar">
    <a class="logo" href="${u ? roleHome(u.role) : '/'}" data-link aria-label="Rangkai, ke beranda">${icon.mark}<span>Rangkai</span></a>
    <nav class="nav-main" aria-label="Navigasi utama">${nav}</nav>
    <div class="nav-side">
      <button class="icon-btn" id="snd" type="button" aria-pressed="${Sound.isOn()}" aria-label="Suara ${Sound.isOn() ? 'aktif' : 'mati'}" title="Suara">${Sound.isOn() ? icon.on : icon.off}</button>
      ${u ? `<button class="icon-btn" id="bell" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Notifikasi${unread ? `, ${unread} belum dibaca` : ''}" title="Notifikasi">${icon.bell}${unread ? `<span class="badge-dot">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
        <button class="user-btn" id="me" type="button" aria-haspopup="menu" aria-expanded="false"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><span class="nm">${esc((u.name || '').split(' ')[0] || u.role)}</span>${icon.chev}</button>`
    : `<a class="nav-a nav-login" href="/masuk" data-link>Masuk</a><a class="btn gold btn-nav" href="/daftar" data-link>Daftar</a>`}
      <button class="icon-btn menu-burger" id="burger" type="button" aria-label="Buka menu">${icon.menu}</button>
    </div>
  </div>`;
  $('#snd').addEventListener('click', () => { Sound.toggle(); renderHeader(); });
  $('#bell')?.addEventListener('click', (e) => openBell(e.currentTarget));
  $('#me')?.addEventListener('click', (e) => openMenu(e.currentTarget));
  $('#burger').addEventListener('click', openDrawer);
}

/* ---------- Panel mengambang ---------- */
let popEl = null;
function closePop() {
  if (!popEl) return;
  popEl.anchor?.setAttribute('aria-expanded', 'false');
  popEl.remove();
  popEl = null;
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', escClose);
}
const outside = (e) => { if (popEl && !popEl.contains(e.target) && !popEl.anchor.contains(e.target)) closePop(); };
const escClose = (e) => { if (e.key === 'Escape') { const a = popEl?.anchor; closePop(); a?.focus(); } };
function openPop(anchor, html, label) {
  const same = popEl?.anchor === anchor;
  closePop();
  if (same) return null;
  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.innerHTML = html;
  el.anchor = anchor;
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 10}px`;
  if (innerWidth <= 600) { el.style.left = '10px'; el.style.right = '10px'; el.style.width = 'auto'; el.style.maxHeight = `${innerHeight - r.bottom - 24}px`; }
  else el.style.right = `${Math.max(12, innerWidth - r.right - 4)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  popEl = el;
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escClose); }, 0);
  return el;
}

const TONE_ICON = { success: icon.check, warning: icon.warn, danger: icon.x, info: icon.info };
async function openBell(anchor) {
  const el = openPop(anchor, `<div class="pop-head"><h2>Notifikasi</h2><button class="btn link" id="readall" type="button">Tandai semua dibaca</button></div><div class="pop-list" id="nlist"><div class="pop-empty">Memuat...</div></div>`, 'Notifikasi');
  if (!el) return;
  try {
    const r = await api('/api/notifications');
    unread = r.unread;
    const list = $('#nlist', el);
    if (!list) return;
    list.innerHTML = r.notifications.length ? r.notifications.map((n) => `<button class="notif ${n.read ? '' : 'unread'}" data-tone="${esc(n.tone)}" data-id="${esc(n.id)}" data-link="${esc(n.link)}" type="button">
        <span class="notif-ic" aria-hidden="true">${TONE_ICON[n.tone] || icon.info}</span>
        <span><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${ago(n.createdAt)}${n.read ? '' : ' · belum dibaca'}</small></span></button>`).join('')
      : `<div class="pop-empty">${icon.bell}<b>Belum ada notifikasi</b><span>Pengingat pembayaran, status transfer, dan jadwal berangkat akan muncul di sini.</span></div>`;
    list.addEventListener('click', async (e) => {
      const b = e.target.closest('.notif');
      if (!b) return;
      closePop();
      api(`/api/notifications/${b.dataset.id}/read`, { method: 'POST' }).then(refreshUnread).catch(() => {});
      go(hasScope('booking:read') ? b.dataset.link : roleHome(currentUser()?.role));
    });
    $('#readall', el).addEventListener('click', async () => {
      await api('/api/notifications/read-all', { method: 'POST' });
      $$('.notif.unread', el).forEach((n) => n.classList.remove('unread'));
      unread = 0;
      paintBadge();
    });
  } catch (e) { const l = $('#nlist', el); if (l) l.innerHTML = `<div class="pop-empty">${esc(e.message)}</div>`; }
}

function openMenu(anchor) {
  const u = currentUser();
  const role = { customer: 'Pelanggan', masinis: 'Masinis', admin: 'Admin' }[u.role] || u.role;
  const el = openPop(anchor, `<div class="menu-who"><b>${esc(u.name || '')}</b><span>${esc(u.email || '')}</span><br><span class="role-tag">${role}</span></div>
    <nav class="menu-list" aria-label="Menu akun">
      <a href="/profil" data-link>${icon.user}Profil saya</a>
      ${u.role === 'customer' ? `<a href="/perjalanan" data-link>${icon.ticket}Perjalanan saya</a>` : `<a href="${roleHome(u.role)}" data-link>${icon.grid}${u.role === 'admin' ? 'Panel admin' : 'Dasbor masinis'}</a>`}
      <a href="/bantuan" data-link>${icon.help}Pusat bantuan</a>
      <a href="/privasi" data-link>${icon.shield}Keamanan dan privasi</a>
      <hr><button type="button" id="logout">${icon.out}Keluar</button>
    </nav>`, 'Menu akun');
  if (!el) return;
  el.addEventListener('click', (e) => { if (e.target.closest('a')) closePop(); });
  $('#logout', el).addEventListener('click', async () => {
    closePop();
    await logout();
    unread = 0;
    toast('Anda sudah keluar. Sampai jumpa di perjalanan berikutnya.');
    go('/');
  });
}

function openDrawer() {
  const d = document.createElement('div');
  d.className = 'drawer';
  d.innerHTML = `<div class="drawer-in" role="dialog" aria-modal="true" aria-label="Menu"><div class="row between"><span class="logo">${icon.mark}<span>Rangkai</span></span><button class="icon-btn" id="dclose" aria-label="Tutup menu">${icon.x}</button></div>
    <nav class="stack" style="--gap:2px;margin-top:18px">${links().map(([h, t]) => `<a class="nav-a ${isOn(h, location.pathname) ? 'on' : ''}" href="${h}" data-link>${t}</a>`).join('')}
    <a class="nav-a" href="/privasi" data-link>Keamanan dan Privasi</a></nav>
    ${currentUser() ? '' : '<div class="drawer-auth"><a class="btn ghost block" href="/masuk" data-link>Masuk</a><a class="btn gold block" href="/daftar" data-link>Daftar akun</a></div>'}</div>`;
  document.body.append(d);
  const close = () => d.remove();
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('#dclose') || e.target.closest('a')) close(); });
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#dclose', d).focus();
}

/* ---------- Hitungan notifikasi belum dibaca ---------- */
function paintBadge() {
  const b = $('#bell');
  if (!b) return;
  b.querySelector('.badge-dot')?.remove();
  if (unread) b.insertAdjacentHTML('beforeend', `<span class="badge-dot">${unread > 9 ? '9+' : unread}</span>`);
  b.setAttribute('aria-label', `Notifikasi${unread ? `, ${unread} belum dibaca` : ''}`);
}
async function refreshUnread() {
  if (!currentUser()) return;
  try {
    const { unread: n } = await api('/api/notifications/unread-count');
    if (n > unread) {
      const b = $('#bell');
      b?.classList.remove('ring');
      void b?.offsetWidth;
      b?.classList.add('ring');
      Sound.play('ding');
    }
    unread = n;
    paintBadge();
  } catch { /* dicoba lagi berikutnya */ }
}
setInterval(() => { if (!document.hidden) refreshUnread(); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshUnread(); });

function solidHeader() {
  $('#top').classList.toggle('solid', scrollY > 24 || !['home', 'auth'].includes(document.body.dataset.page));
}
addEventListener('scroll', solidHeader, { passive: true });

/* Kiko kecil menemani langkah pemesanan. Di halaman yang punya Kiko sendiri, Kiko pojok disembunyikan. */
let dockKiko = null;
function syncDock(name) {
  const dock = $('#dock');
  const wanted = ['search', 'seats', 'passengers', 'pay', 'ticket', 'trips', 'profile', 'privacy', 'notfound'].includes(name);
  if (wanted && !dockKiko) {
    dock.innerHTML = '<div></div>';
    dockKiko = Kiko.mount(dock.firstElementChild, { chatty: true });
  }
  if (!wanted && dockKiko) {
    dockKiko.destroy();
    dockKiko = null;
    dock.innerHTML = '';
  }
}

document.addEventListener('rk:route', (e) => {
  closePop();
  syncDock(e.detail.name);
  renderHeader();
  solidHeader();
  refreshUnread();
});
onSession((u) => { if (!u) unread = 0; renderHeader(); refreshUnread(); });
document.addEventListener('rk:notify-refresh', refreshUnread);

/* Bunyi tekan yang halus pada semua tombol */
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn,.nav-a,.tab,.pm-opt,.side-a,.acc-q')) Sound.play('tap');
});

(async () => {
  let seen = false;
  try { seen = sessionStorage.getItem('rk:doors') === '1'; sessionStorage.setItem('rk:doors', '1'); } catch { /* mode privat */ }
  if (seen || location.pathname.startsWith('/qris/')) { $('#curtain').classList.add('instant'); doorsOpen(); setTimeout(() => $('#curtain').classList.remove('instant'), 100); seen = true; }
  restoreSession();
  await startRouter();
  if (seen) return;
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 900))]);
  setTimeout(doorsOpen, 260);
})();

/* Ponsel: Kiko menyingkir selama menggulir atau mengetik agar tidak menutupi tombol dan isian. */
(() => {
  const mobile = () => innerWidth <= 760;
  let t = 0;
  const hide = (ms) => {
    const d = document.getElementById('dock');
    if (!d || !mobile()) return;
    d.classList.add('busy');
    clearTimeout(t);
    if (ms) t = setTimeout(() => d.classList.remove('busy'), ms);
  };
  addEventListener('scroll', () => hide(1400), { passive: true });
  document.addEventListener('focusin', (e) => { if (e.target.matches('input,textarea,select')) hide(0); });
  document.addEventListener('focusout', (e) => { if (e.target.matches('input,textarea,select')) hide(600); });
})();

/* Label kolom untuk tampilan tabel-kartu di ponsel: tiap <td> diberi data-label dari judul kolomnya. */
(() => {
  const label = () => document.querySelectorAll('table.tbl').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach((tr) => {
      let i = 0;
      for (const td of tr.children) { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || ''); i += Number(td.colSpan || 1); }
    });
  });
  let q = 0;
  new MutationObserver(() => { cancelAnimationFrame(q); q = requestAnimationFrame(label); }).observe(document.body, { childList: true, subtree: true });
})();
