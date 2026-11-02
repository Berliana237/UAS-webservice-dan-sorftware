/** main.js: titik masuk SPA. Mendaftarkan rute, header, Kiko di pojok, dan pembuka pintu gerbong. */
import { $, route, startRouter, restoreSession, currentUser, onSession, logout, go, hasScope, esc, toast } from './core.js';
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
route('/pesanan/:lockId', page('passengers'), { name: 'passengers', auth: true });
route('/bayar/:bookingId', page('pay'), { name: 'pay', auth: true });
route('/tiket/:bookingId', page('ticket'), { name: 'ticket', auth: true });
route('/perjalanan', page('trips'), { name: 'trips', auth: true });
route('/konsol', page('console'), { name: 'console', auth: true });
route('.*', page('notfound'), { name: 'notfound', notFound: true });

function renderHeader() {
  const u = currentUser();
  const path = location.pathname;
  const canConsole = hasScope('operator') || hasScope('admin');
  const canBook = hasScope('booking:read');
  $('#top').innerHTML = `<div class="wrap bar">
    <a class="logo" href="/" data-link aria-label="Rangkai, ke beranda">${icon.mark}<span>Rangkai</span></a>
    <nav aria-label="Navigasi utama">
      ${canBook ? `<a class="nav-a ${path === '/perjalanan' ? 'on' : ''}" href="/perjalanan" data-link>Perjalanan saya</a>` : ''}
      ${canConsole ? `<a class="nav-a ${path === '/konsol' ? 'on' : ''}" href="/konsol" data-link>Konsol</a>` : ''}
      <button class="icon-btn" id="snd" type="button" aria-pressed="${Sound.isOn()}" aria-label="Suara ${Sound.isOn() ? 'aktif' : 'mati'}">${Sound.isOn() ? icon.on : icon.off}</button>
      ${u ? `<div class="nav-user"><span title="${esc(u.name || '')}">${esc(u.name || u.role)}</span><button class="icon-btn" id="logout" type="button" aria-label="Keluar">${icon.out}</button></div>`
    : `<a class="nav-a ${path === '/masuk' ? 'on' : ''}" href="/masuk" data-link>Masuk</a>`}
    </nav>
  </div>`;
  $('#snd').addEventListener('click', () => { Sound.toggle(); renderHeader(); });
  $('#logout')?.addEventListener('click', async () => {
    await logout();
    toast('Anda sudah keluar. Sampai jumpa di perjalanan berikutnya.');
    go('/');
  });
}

function solidHeader() {
  $('#top').classList.toggle('solid', scrollY > 24 || !['home', 'auth'].includes(document.body.dataset.page));
}
addEventListener('scroll', solidHeader, { passive: true });

/* Kiko kecil menemani langkah pemesanan. Di beranda dan halaman masuk, Kiko tampil besar di halaman itu sendiri. */
let dockKiko = null;
function syncDock(name) {
  const dock = $('#dock');
  const wanted = !['home', 'auth'].includes(name);
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
  syncDock(e.detail.name);
  renderHeader();
  solidHeader();
});
onSession(renderHeader);

/* Bunyi tekan yang halus pada semua tombol */
document.addEventListener('click', (e) => {
  if (e.target.closest('.btn,.nav-a,.tab,.pm-opt')) Sound.play('tap');
});

(async () => {
  let seen = false;
  try { seen = sessionStorage.getItem('rk:doors') === '1'; sessionStorage.setItem('rk:doors', '1'); } catch { /* mode privat */ }
  if (seen) { $('#curtain').classList.add('instant'); doorsOpen(); setTimeout(() => $('#curtain').classList.remove('instant'), 100); }
  restoreSession();
  await startRouter();
  if (seen) return;
  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 900))]);
  setTimeout(doorsOpen, 260);
})();
