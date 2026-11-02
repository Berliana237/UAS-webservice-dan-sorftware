/** Beranda: satu tugas utama, mencari kereta. Papan keberangkatan dan penjelasan ruas ada di bawahnya. */
import { $, $$, api, gql, go, wibToday, timeOf, sleep } from '../core.js';
import { Kiko } from '../kiko.js';
import { combobox, scene, flapText, flapTo, icon } from '../ui.js';
import { Sound } from '../sound.js';

export function render(main) {
  main.innerHTML = `
  <section class="hero">
    ${scene('hero')}
    <div class="wrap hero-in">
      <div class="hero-left">
        <p class="eyebrow reveal">Reservasi kereta antarkota</p>
        <h1 class="reveal" style="--i:1">Pesan kursinya,<br><em>sejauh yang Anda perlu.</em></h1>
        <p class="lede reveal" style="--i:2">Kursi dijual per ruas. Penumpang lain turun di Madiun? Kursinya bisa jadi milik Anda sampai Yogyakarta.</p>
        <div class="ticket-wrap reveal" style="--i:3">
          <form class="ticket search" id="search" novalidate>
            <div class="sr-fields">
              <div class="field"><label for="from">Dari</label><input class="input" id="from" placeholder="Kota asal" required></div>
              <button class="swap" id="swap" type="button" aria-label="Tukar asal dan tujuan">${icon.swap}</button>
              <div class="field"><label for="to">Ke</label><input class="input" id="to" placeholder="Kota tujuan" required></div>
            </div>
            <div class="sr-row">
              <div class="field"><label for="date">Tanggal</label><input class="input" id="date" type="date" required></div>
              <div class="field"><span class="label" id="pax-l">Penumpang</span>
                <div class="stepper" role="group" aria-labelledby="pax-l">
                  <button type="button" id="minus" aria-label="Kurangi penumpang">&minus;</button><output id="pax" class="mono" aria-live="polite">1</output><button type="button" id="plus" aria-label="Tambah penumpang">+</button>
                </div>
              </div>
              <button class="btn pri sr-go" type="submit">Cari kereta</button>
            </div>
            <p class="alert" id="err" role="alert" hidden></p>
          </form>
        </div>
      </div>
      <div class="hero-kiko reveal" style="--i:4"><div id="hero-kiko"></div></div>
    </div>
  </section>

  <section class="board-sec wrap" aria-labelledby="board-h">
    <div class="sec-head"><h2 id="board-h">Keberangkatan <em>berikutnya</em></h2><p class="muted">Diperbarui langsung dari jadwal.</p></div>
    <div class="board" id="board" role="table" aria-label="Papan keberangkatan"></div>
  </section>

  <section class="how wrap" aria-labelledby="how-h">
    <div class="how-copy">
      <p class="eyebrow">Mengapa per ruas</p>
      <h2 id="how-h">Satu kursi, <em>dua penumpang.</em></h2>
      <p class="muted">Kursi hanya dikunci pada ruas yang benar-benar Anda lewati. Saat Anda menekan tombol tahan, kursi aman selama 10 menit. Tidak ada penumpang lain yang bisa mengambilnya di ruas itu.</p>
    </div>
    <div class="how-fig" aria-label="Contoh: kursi 7A dipakai Sinta dari Surabaya ke Madiun, lalu Bima dari Madiun ke Yogyakarta">
      <div class="how-rail"><span>Surabaya</span><span>Madiun</span><span>Yogyakarta</span></div>
      <div class="how-track"><i class="p1"><b>Sinta · 7A</b></i><i class="p2"><b>Bima · 7A</b></i></div>
    </div>
  </section>
  <footer class="foot wrap"><span>Rangkai</span><span class="muted">Proyek Web Service &times; Software Testing. Kereta dan pembayaran di sini simulasi.</span><a href="/docs" class="btn link">Dokumen API</a></footer>`;

  const kiko = Kiko.mount($('#hero-kiko'), { pat: true, chatty: true });
  const timers = [];
  timers.push(setTimeout(() => { kiko.mood('wink', 2600); kiko.say(Kiko.greeting(), 3400); kiko.pose('wave', 1600); }, 1400));

  const from = $('#from');
  const to = $('#to');
  const date = $('#date');
  const pax = $('#pax');
  const err = $('#err');
  date.min = wibToday();
  date.max = wibToday(29);
  date.value = wibToday(1);

  let stations = [];
  api('/api/stations', { noAuth: true }).then((r) => { stations = r.stations; });
  const pickers = [
    combobox(from, { options: () => stations, onPick: () => { kiko.mood('happy', 1100); to.focus(); }, onFocus: () => kiko.lookAt(from) }),
    combobox(to, { options: () => stations, onPick: () => { kiko.mood('happy', 1100); date.focus(); }, onFocus: () => kiko.lookAt(to) }),
  ];
  [from, to, date].forEach((i) => i.addEventListener('blur', () => kiko.lookAt(null)));
  date.addEventListener('focus', () => kiko.lookAt(date));

  $('#swap').addEventListener('click', (e) => {
    e.currentTarget.classList.toggle('turned');
    [from.value, to.value] = [to.value, from.value];
    const a = from.dataset.code; const b = to.dataset.code;
    if (b) from.dataset.code = b; else delete from.dataset.code;
    if (a) to.dataset.code = a; else delete to.dataset.code;
    Sound.play('pick');
  });
  const setPax = (d) => {
    const v = Math.min(4, Math.max(1, Number(pax.textContent) + d));
    if (v === Number(pax.textContent) && d > 0) kiko.say('Maksimal 4 kursi dalam satu pesanan.', 2400);
    pax.textContent = v;
  };
  $('#minus').addEventListener('click', () => setPax(-1));
  $('#plus').addEventListener('click', () => setPax(1));

  const fail = (message, field) => {
    err.textContent = message;
    err.hidden = false;
    Kiko.react('bingung', message);
    field?.focus();
    Sound.play('fail');
  };
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    err.hidden = true;
    // Nama yang diketik utuh tetap dikenali walau tidak dipilih dari daftar.
    for (const i of [from, to]) if (!i.dataset.code) { const m = stations.find((s) => s.name.toLowerCase() === i.value.trim().toLowerCase()); if (m) { i.dataset.code = m.code; i.value = m.name; } }
    if (!from.dataset.code) return fail('Pilih stasiun asal dari daftar.', from);
    if (!to.dataset.code) return fail('Pilih stasiun tujuan dari daftar.', to);
    if (from.dataset.code === to.dataset.code) return fail('Asal dan tujuan tidak boleh sama.', to);
    if (!date.value) return fail('Pilih tanggal berangkat.', date);
    return go(`/cari?from=${from.dataset.code}&to=${to.dataset.code}&date=${date.value}&pax=${pax.textContent}`);
  });

  /* Papan split-flap */
  const board = $('#board');
  const W = { time: 5, train: 10, route: 21, status: 7 };
  const blank = Array.from({ length: 5 }, () => `<div class="b-row" role="row">
      <span role="cell" data-k="time">${flapText('', W.time)}</span><span role="cell" data-k="train">${flapText('', W.train)}</span>
      <span role="cell" data-k="route">${flapText('', W.route)}</span><span role="cell" data-k="status">${flapText('', W.status)}</span></div>`).join('');
  board.innerHTML = blank;
  let alive = true;
  const short = (s) => s.replace('Jakarta Gambir', 'Gambir').replace('Yogyakarta Tugu', 'Yogyakarta').replace('Surabaya Gubeng', 'Surabaya').replace('Surabaya Pasar Turi', 'Pasar Turi').replace('Solo Balapan', 'Solo');
  const fill = async (silent) => {
    const { upcomingDepartures: list } = await gql('query{upcomingDepartures(limit:5){tripId trainName fromName toName departureAt status delayMinutes}}');
    const rows = $$('.b-row', board);
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
  const io = new IntersectionObserver(([en]) => {
    if (en.isIntersecting) { io.disconnect(); fill(false).catch(() => {}); }
  }, { threshold: 0.25 });
  io.observe(board);
  timers.push(setInterval(() => { if (!document.hidden) fill(true).catch(() => {}); }, 60000));

  return () => {
    alive = false;
    timers.forEach(clearTimeout);
    timers.forEach(clearInterval);
    pickers.forEach((p) => p.destroy());
    io.disconnect();
    kiko.destroy();
  };
}
