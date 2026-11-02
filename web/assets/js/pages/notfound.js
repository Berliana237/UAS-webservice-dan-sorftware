/** Halaman tidak ditemukan. */
import { Kiko } from '../kiko.js';

export function render(main) {
  main.innerHTML = `<div class="page wrap"><div class="empty"><h1>Salah <em>peron.</em></h1><p>Halaman ini tidak ada di jadwal kami. Mari kembali ke stasiun utama.</p><a class="btn gold" href="/" data-link>Ke beranda</a></div></div>`;
  setTimeout(() => Kiko.react('bingung', 'Eh, kita tersesat ke mana ini?', 3200), 300);
}
