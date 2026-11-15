/**
 * Beranda: profil perusahaan. Tentang Rangkai, papan keberangkatan, jadwal per kereta, armada, kelas layanan,
 * dan cara kerja kursi per ruas. Pencarian tiket ada di halaman Cari Tiket.
 */
import { $, $$, api, gql, esc, timeOf, sleep, rupiah } from '../core.js';
import { Kiko } from '../kiko.js';
import { scene, flapText, flapTo, icon } from '../ui.js';

const CLASS = { EKONOMI: 'Ekonomi', EKSEKUTIF: 'Eksekutif', LUXURY: 'Luxury' };
const composition = (coaches) => {
  const count = new Map();
  coaches.forEach((c) => { const k = c.label.replace(/\s\d+$/, ''); count.set(k, (count.get(k) || 0) + 1); });
  return [...count].map(([k, n]) => `${n} ${k}`).join(' · ');
};
const short = (s) => s.replace('Surabaya Pasar Turi', 'Pasar Turi').replace('Surabaya Gubeng', 'Gubeng').replace('Pasar Senen', 'Senen').replace('Semarang Tawang', 'Tawang').replace('Semarang Poncol', 'Poncol').replace('Solo Balapan', 'Solo').replace('Yogyakarta', 'Yogya');

export function render(main) {
  main.innerHTML = `
  <section class="hero hero-co">
    ${scene('hero')}
    <div class="wrap hero-in">
      <div class="hero-left">
        <p class="eyebrow reveal">PT Rangkai Nusantara Rel</p>
        <h1 class="reveal" style="--i:1">Perjalanan antarkota,<br><em>dirangkai dengan tenang.</em></h1>
        <p class="lede reveal" style="--i:2">Kami menjual kursi kereta per ruas. Penumpang lain turun di Yogyakarta? Kursi yang sama bisa Anda pakai sampai Malang. Lebih banyak pilihan, tanpa rebutan.</p>
        <div class="row reveal" style="--i:3;--gap:12px">
          <a class="btn gold" href="/cari" data-link>Cari tiket</a>
          <a class="btn ghost" href="#jadwal">Lihat jadwal hari ini</a>
        </div>
      </div>
      <div class="hero-kiko reveal" style="--i:4"><div id="hero-kiko"></div></div>
    </div>
  </section>

  <section class="wrap facts" aria-label="Rangkai dalam angka">
    <div class="fact"><b id="f-trains">8</b><span>Kereta antarkota</span></div>
    <div class="fact"><b id="f-stations">33</b><span>Stasiun dilayani</span></div>
    <div class="fact"><b>9</b><span>Gerbong per rangkaian</span></div>
    <div class="fact"><b id="f-deps">-</b><span>Keberangkatan per hari</span></div>
  </section>

  <section class="wrap about" aria-labelledby="about-h">
    <div class="about-copy">
      <p class="eyebrow">Tentang kami</p>
      <h2 id="about-h">Operator kereta yang <em>menghargai waktu Anda.</em></h2>
      <p>Rangkai menghubungkan Jakarta, Bandung, Semarang, Yogyakarta, Solo, Surabaya, dan Malang lewat delapan rangkaian kereta antarkota. Setiap kursi dijual per ruas perjalanan, sehingga satu kursi bisa melayani beberapa penumpang secara bergantian sepanjang rute.</p>
      <p>Pemesanan, pembayaran, dan tiket ada dalam satu aplikasi. Kursi Anda ditahan selagi Anda mengisi data dan membayar, dan status pembayaran hanya dipercaya dari penyedia pembayaran atau verifikasi petugas kami.</p>
    </div>
    <ul class="values">
      <li><span>${icon.ticket}</span><div><b>Kursi per ruas</b><p>Dikunci hanya pada ruas yang Anda lewati. Ruas lain tetap bisa dipesan orang lain.</p></div></li>
      <li><span>${icon.shield}</span><div><b>Data terlindungi</b><p>NIK dan kontak dienkripsi. Tiket hanya menampilkan 4 digit terakhir NIK.</p></div></li>
      <li><span>${icon.bell}</span><div><b>Selalu diberi kabar</b><p>Pengingat batas bayar, hasil verifikasi transfer, dan jadwal berangkat langsung masuk notifikasi.</p></div></li>
    </ul>
  </section>

  <section class="wrap sched" id="jadwal" aria-labelledby="board-h">
    <div class="sec-head"><div><p class="eyebrow">Jadwal</p><h2 id="board-h">Keberangkatan <em>berikutnya</em></h2></div><p class="muted">Papan diperbarui langsung dari jadwal operasional.</p></div>
    <div class="board" id="board" role="table" aria-label="Papan keberangkatan"></div>
    <div class="sched-table">
      <div class="row between" style="margin:34px 0 14px"><h3>Jadwal tetap per kereta</h3><div class="seg" id="dir" role="group" aria-label="Arah"><button type="button" aria-pressed="true" data-d="A">Arah berangkat</button><button type="button" aria-pressed="false" data-d="B">Arah pulang</button></div></div>
      <div class="tbl-wrap"><table class="tbl" id="sched"><thead><tr><th>Kereta</th><th>Relasi</th><th>Jam berangkat</th><th>Kelas</th><th></th></tr></thead><tbody><tr><td colspan="5"><span class="skel" style="height:120px"></span></td></tr></tbody></table></div>
    </div>
  </section>

  <section class="wrap fleet" aria-labelledby="fleet-h">
    <div class="sec-head"><div><p class="eyebrow">Armada</p><h2 id="fleet-h">Delapan rangkaian, <em>satu standar.</em></h2></div><p class="muted">Nama kereta, rute, dan kelas mengikuti layanan KAI.</p></div>
    <div class="fleet-grid" id="fleet">${Array.from({ length: 4 }, () => '<span class="skel" style="height:250px"></span>').join('')}</div>
  </section>

  <section class="wrap classes" aria-labelledby="cls-h">
    <div class="sec-head"><div><p class="eyebrow">Kelas layanan</p><h2 id="cls-h">Pilih kenyamanan <em>Anda.</em></h2></div></div>
    <div class="cls-grid">
      <article class="cls"><span class="cls-tag">Ekonomi</span><h3>Hemat untuk setiap hari</h3><p>Kursi 2-2 dengan sandaran tegak dan meja lipat. Argo Parahyangan memakai Ekonomi Premium dengan kursi yang bisa diputar.</p><ul><li>Konfigurasi 2-2</li><li>Dua pasang kursi berhadapan di tengah gerbong</li><li>Colokan listrik tiap baris</li></ul></article>
      <article class="cls mid"><span class="cls-tag">Eksekutif</span><h3>Lega untuk jarak jauh</h3><p>Kursi rebah dengan sandaran kaki, ruang kaki lebih panjang, dan kabin lebih tenang.</p><ul><li>Konfigurasi 2-2, 13 baris</li><li>Kursi rebah dan sandaran kaki</li><li>Selimut dan bantal</li></ul></article>
      <article class="cls top"><span class="cls-tag">Luxury</span><h3>Privat seperti kabin pesawat</h3><p>Kursi 1-1 yang bisa direbahkan hampir datar, layar hiburan, dan layanan makan. Panoramic punya jendela lebar sampai atap.</p><ul><li>Konfigurasi 1-1 (Panoramic 2-1)</li><li>Semua kursi menghadap arah laju</li><li>Layanan makan di kursi</li></ul></article>
    </div>
  </section>

  <section class="how wrap" aria-labelledby="how-h">
    <div class="how-copy">
      <p class="eyebrow">Mengapa per ruas</p>
      <h2 id="how-h">Satu kursi, <em>dua penumpang.</em></h2>
      <p class="muted">Kursi hanya dikunci pada ruas yang benar-benar Anda lewati. Saat Anda menekan Tahan kursi, kursi aman selama 10 menit dan tidak ada penumpang lain yang bisa mengambilnya di ruas itu.</p>
    </div>
    <div class="how-fig" aria-label="Contoh: kursi 7A dipakai Sinta dari Gambir ke Yogyakarta, lalu Bima dari Yogyakarta ke Malang">
      <div class="how-rail"><span>Gambir</span><span>Yogyakarta</span><span>Malang</span></div>
      <div class="how-track"><i class="p1"><b>Sinta · 7A</b></i><i class="p2"><b>Bima · 7A</b></i></div>
    </div>
  </section>

  <section class="wrap cta-band">
    <div><h2>Siap <em>berangkat?</em></h2><p class="muted">Pilih stasiun, tanggal, dan kursi Anda. Kiko akan menemani sampai tiket terbit.</p></div>
    <div class="row" style="--gap:10px"><a class="btn gold" href="/cari" data-link>Cari tiket</a><a class="btn ghost" href="/bantuan" data-link>Tanya Kiko</a></div>
  </section>

  <footer class="site-foot wrap">
    <div class="sf-brand"><span class="logo">${icon.mark}<span>Rangkai</span></span><p class="muted">PT Rangkai Nusantara Rel. Proyek mata kuliah Web Service dan Software Testing. Kereta, jadwal, dan pembayaran di aplikasi ini adalah simulasi.</p></div>
    <nav class="sf-col" aria-label="Layanan"><b>Layanan</b><a href="/cari" data-link>Cari tiket</a><a href="/perjalanan" data-link>Perjalanan saya</a><a href="#jadwal">Jadwal</a></nav>
    <nav class="sf-col" aria-label="Bantuan"><b>Bantuan</b><a href="/bantuan" data-link>Pusat bantuan</a><a href="/privasi" data-link>Keamanan dan privasi</a><a href="/docs">Dokumen API</a></nav>
    <div class="sf-col"><b>Kontak</b><span class="muted">halo@rangkai.test</span><span class="muted">Layanan 24 jam lewat asisten Kiko</span></div>
  </footer>`;

  const kiko = Kiko.mount($('#hero-kiko'), { pat: true, chatty: true });
  const timers = [setTimeout(() => { kiko.mood('wink', 2600); kiko.say(Kiko.greeting(), 3400); kiko.pose('wave', 1600); }, 1400)];

  /* Armada dan jadwal tetap */
  let trains = [];
  let dir = 'A';
  const paintSched = () => {
    const rows = trains.map((t) => {
      const route = dir === 'A' ? t.route : [...t.route].reverse();
      const times = t.services.filter((s) => s.active && s.direction === dir).map((s) => s.departureTime);
      return `<tr><td><b>${esc(t.name)}</b><span class="sub mono">${esc(t.number)}</span></td>
        <td>${esc(route[0].station.name)} <span class="muted">ke</span> ${esc(route[route.length - 1].station.name)}<span class="sub">${route.length - 2} pemberhentian</span></td>
        <td class="mono">${times.join(' · ') || '-'}</td>
        <td>${t.classes.map((c) => `<span class="chip">${CLASS[c]}</span>`).join(' ')}</td>
        <td class="acts"><a class="btn ghost sm" data-link href="/cari?train=${t.id}&from=${route[0].station.code}&to=${route[route.length - 1].station.code}">Pesan</a></td></tr>`;
    }).join('');
    $('#sched tbody').innerHTML = rows || '<tr><td colspan="5" class="muted">Belum ada kereta yang beroperasi.</td></tr>';
  };
  $$('#dir button').forEach((b) => b.addEventListener('click', () => {
    dir = b.dataset.d;
    $$('#dir button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paintSched();
  }));

  Promise.all([api('/api/trains', { noAuth: true }), api('/api/stations', { noAuth: true })]).then(([t, s]) => {
    if (!main.contains($('#fleet'))) return;
    trains = t.trains;
    $('#f-trains').textContent = trains.length;
    $('#f-stations').textContent = s.stations.length;
    $('#f-deps').textContent = trains.reduce((n, x) => n + x.services.filter((v) => v.active).length, 0);
    paintSched();
    $('#fleet').innerHTML = trains.map((x, i) => {
      const from = x.route[0];
      const to = x.route[x.route.length - 1];
      const loop = from.station.code === to.station.code;
      const full = Math.min(...Object.values(x.fares).map((f) => Math.ceil((f.base + f.perKm * to.km) / 1000) * 1000));
      return `<article class="tcard reveal" style="--i:${i % 4}">
        <header><span class="mono">${esc(x.number)}</span>${x.classes.map((c) => `<span class="chip ${c === 'LUXURY' ? 'gold' : ''}">${CLASS[c]}</span>`).join('')}</header>
        <h3>${esc(x.name)}</h3>
        <p class="tc-route">${esc(short(from.station.name))} <i aria-hidden="true"></i> ${loop ? 'kembali ke ' : ''}${esc(short(to.station.name))}</p>
        <ol class="tc-stops" aria-label="Pemberhentian">${x.route.map((r) => `<li title="${esc(r.station.name)}"></li>`).join('')}</ol>
        <dl class="tc-meta"><div><dt>Rangkaian</dt><dd>${esc(composition(x.coaches))}</dd></div><div><dt>Jarak</dt><dd class="mono">${to.km} km</dd></div><div><dt>Berangkat</dt><dd class="mono">${x.departures.join(', ') || '-'}</dd></div><div><dt>Ujung ke ujung</dt><dd class="mono">${Number.isFinite(full) ? `mulai ${rupiah(full)}` : '-'}</dd></div></dl>
        <a class="btn ghost sm" data-link href="/cari?train=${x.id}&from=${from.station.code}&to=${(loop ? x.route[Math.floor(x.route.length / 2)] : to).station.code}">Lihat jadwal dan kursi</a>
      </article>`;
    }).join('');
  }).catch(() => { $('#fleet').innerHTML = '<p class="muted">Data armada belum bisa dimuat. Coba muat ulang halaman.</p>'; });

  /* Papan split-flap */
  const board = $('#board');
  const W = { time: 5, train: 16, route: 19, status: 7 };
  const head = (t, n) => `<span role="columnheader" style="width:calc((var(--fw) + 2px) * ${n})">${t}</span>`;
  board.innerHTML = `<div class="b-row b-head" role="row">${head('Jam', W.time)}${head('Kereta', W.train)}${head('Relasi', W.route)}${head('Status', W.status)}</div>${Array.from({ length: 6 }, () => `<div class="b-row" role="row">
      <span role="cell" data-k="time">${flapText('', W.time)}</span><span role="cell" data-k="train">${flapText('', W.train)}</span>
      <span role="cell" data-k="route">${flapText('', W.route)}</span><span role="cell" data-k="status">${flapText('', W.status)}</span></div>`).join('')}`;
  let alive = true;
  const fill = async (silent) => {
    const { upcomingDepartures: list } = await gql('query{upcomingDepartures(limit:6){tripId trainName fromName toName departureAt status delayMinutes}}');
    const rows = $$('.b-row:not(.b-head)', board);
    for (let i = 0; i < rows.length && alive; i++) {
      const d = list[i];
      if (!d) continue;
      const status = d.status === 'DELAYED' ? `+${d.delayMinutes}MNT` : d.status === 'CANCELLED' ? 'BATAL' : 'TEPAT';
      rows[i].dataset.status = d.status;
      flapTo($('[data-k=time]', rows[i]), timeOf(d.departureAt), { silent });
      flapTo($('[data-k=train]', rows[i]), d.trainName, { silent: true });
      flapTo($('[data-k=route]', rows[i]), `${short(d.fromName)}-${short(d.toName)}`, { silent: true });
      flapTo($('[data-k=status]', rows[i]), status, { silent: true });
      await sleep(140);
    }
  };
  const io = new IntersectionObserver(([en]) => { if (en.isIntersecting) { io.disconnect(); fill(false).catch(() => {}); } }, { threshold: 0.25 });
  io.observe(board);
  timers.push(setInterval(() => { if (!document.hidden) fill(true).catch(() => {}); }, 60000));

  /* Muncul saat digulir */
  const ro = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('shown'); ro.unobserve(en.target); } }), { threshold: 0.05 });
  $$('.facts,.about,.fleet,.classes,.how,.cta-band,.sched-table', main).forEach((el) => { el.classList.add('fade-up'); ro.observe(el); });

  return () => {
    alive = false;
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    io.disconnect();
    ro.disconnect();
    kiko.destroy();
  };
}
