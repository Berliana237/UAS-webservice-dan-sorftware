/** Data penumpang: satu kartu per kursi, validasi langsung, dan hitung mundur yang selalu terlihat. */
import { $, $$, api, gql, esc, go, uuid, confirmDialog, toast } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { countdown, routeStrip, steps } from '../ui.js';

const TRIP = 'query($id:ID!){trip(id:$id){trainName stops{seq departAt arriveAt station{code name}}}}';

const NIK_OK = (n) => {
  if (!/^\d{16}$/.test(n)) return false;
  const prov = Number(n.slice(0, 2));
  const day = Number(n.slice(6, 8));
  const mon = Number(n.slice(8, 10));
  return prov >= 11 && prov <= 96 && ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && mon >= 1 && mon <= 12;
};

function card(seat, i) {
  const p = `p${i}`;
  return `<fieldset class="ticket-wrap pax reveal" style="--i:${i}"><div class="ticket pax-card" style="--n:62px">
    <legend class="pax-head"><span class="pax-seat mono">${esc(seat.split('-')[1])}</span><span><b>Penumpang ${i + 1}</b><small class="muted">${esc(seat.split('-')[0])}</small></span></legend>
    <div class="perf"></div>
    <div class="pax-grid">
      <div class="field wide"><label for="${p}-name">Nama sesuai identitas</label><input class="input" id="${p}-name" data-k="name" autocomplete="${i === 0 ? 'name' : 'off'}" maxlength="80"><small class="hint"></small></div>
      <div class="field"><label for="${p}-age">Usia</label><input class="input mono" id="${p}-age" data-k="age" inputmode="numeric" maxlength="3"><small class="hint"></small></div>
      <div class="field"><label for="${p}-nik">NIK <span class="opt" data-nik-opt hidden>(opsional)</span></label><input class="input mono" id="${p}-nik" data-k="nik" inputmode="numeric" maxlength="16" placeholder="16 digit"><small class="hint"></small></div>
      <div class="field"><label for="${p}-phone">Nomor HP <span class="opt">(opsional)</span></label><input class="input mono" id="${p}-phone" data-k="phone" inputmode="tel" maxlength="20" autocomplete="${i === 0 ? 'tel' : 'off'}"><small class="hint"></small></div>
    </div>
  </div></fieldset>`;
}

const rules = {
  name: (v) => (v.trim().length < 2 ? 'Tulis nama lengkap.' : ''),
  age: (v) => {
    if (!/^\d{1,3}$/.test(v)) return 'Isi usia dalam angka.';
    const a = Number(v);
    if (a < 3) return 'Bayi di bawah 3 tahun tidak perlu kursi sendiri.';
    return a > 120 ? 'Usia tidak valid.' : '';
  },
  nik: (v, age) => {
    if (!v) return Number(age) >= 17 ? 'Wajib untuk usia 17 tahun ke atas.' : '';
    if (v.length < 16) return `${v.length} dari 16 digit.`;
    return NIK_OK(v) ? '' : 'Format NIK belum benar. Periksa kembali.';
  },
  phone: (v) => (v && !/^[0-9+][0-9\s-]{7,18}$/.test(v) ? 'Contoh: 081234567890' : ''),
};

export function render(main, { params }) {
  const lockId = params.lockId;
  let stopTimer = null;
  let idem = uuid();
  main.innerHTML = `<div class="page wrap pax-page"><div class="page-head no-pad">${steps(1)}<span id="timer"></span></div><div id="body"><span class="skel" style="height:360px"></span></div></div>`;

  const expired = async (tripId, fromCode, toCode) => {
    Kiko.react('gagal', 'Waktu habis, kursinya sudah dilepas.', 4000);
    await confirmDialog({ title: 'Waktu menahan kursi habis', body: '<p>Kursi sudah dilepas agar penumpang lain bisa memesan. Silakan pilih kursi lagi.</p>', confirm: 'Pilih kursi lagi', cancel: 'Tutup' });
    go(`/kursi/${encodeURIComponent(tripId)}?from=${fromCode}&to=${toCode}`, { replace: true });
  };

  (async () => {
    const lock = await api(`/api/locks/${lockId}`);
    if (lock.status !== 'ACTIVE' || lock.expiresAt <= lock.serverTime) {
      const { trip } = await gql(TRIP, { id: lock.tripId });
      await expired(lock.tripId, trip.stops[lock.fromIndex].station.code, trip.stops[lock.toIndex].station.code);
      return;
    }
    const { trip } = await gql(TRIP, { id: lock.tripId });
    if (!main.contains($('#body'))) return;
    const a = trip.stops[lock.fromIndex];
    const b = trip.stops[lock.toIndex];
    const skew = lock.serverTime - Date.now();
    stopTimer = countdown($('#timer'), lock.expiresAt, {
      skew,
      onLow: () => Kiko.react('cemas', 'Tinggal semenit lagi! Yuk, cepat diselesaikan.', 4000),
      onEnd: () => expired(lock.tripId, a.station.code, b.station.code),
    });

    $('#body').innerHTML = `
      <div class="page-title"><h1 class="h-sm">Siapa yang <em>berangkat?</em></h1><p class="sub">${esc(trip.trainName)} · ${esc(a.station.name)} ke ${esc(b.station.name)}</p></div>
      <div class="seat-route">${routeStrip(trip.stops, lock.fromIndex, lock.toIndex, { compact: true })}</div>
      <form id="form" novalidate>${lock.seats.map(card).join('')}
        <p class="alert on-dark" id="err" role="alert" hidden></p>
        <div class="form-act"><button class="btn ghost" type="button" id="release">Lepas kursi</button><button class="btn gold" type="submit" id="submit">Lanjut ke pembayaran</button></div>
      </form>`;
    Kiko.react('halo', 'NIK Anda dienkripsi, dan hanya 4 digit terakhir yang ditampilkan.', 4200);

    const form = $('#form');
    const checkField = (input, final) => {
      const cardEl = input.closest('.pax-card');
      const age = $('[data-k=age]', cardEl).value;
      const msg = rules[input.dataset.k](input.value.trim(), age);
      const box = input.parentElement;
      const quiet = !final && !box.dataset.touched && input.dataset.k !== 'nik';
      box.classList.toggle('bad', Boolean(msg) && !quiet && !(input.dataset.k === 'nik' && !final && input.value.length < 16 && input.value.length > 0));
      box.classList.toggle('good', !msg && Boolean(input.value));
      $('.hint', box).textContent = quiet ? '' : msg;
      return !msg;
    };
    $$('input', form).forEach((i) => {
      i.addEventListener('blur', () => { i.parentElement.dataset.touched = '1'; checkField(i, false); });
      i.addEventListener('input', () => {
        if (i.dataset.k === 'nik' || i.dataset.k === 'age') i.value = i.value.replace(/\D/g, '');
        checkField(i, false);
        if (i.dataset.k === 'age') {
          const c = i.closest('.pax-card');
          $('[data-nik-opt]', c).hidden = !(i.value !== '' && Number(i.value) < 17);
          if ($('[data-k=nik]', c).parentElement.dataset.touched) checkField($('[data-k=nik]', c), false);
        }
        if (i.dataset.k === 'nik' && NIK_OK(i.value)) { Sound.play('punch'); Kiko.mood('happy', 900); }
      });
    });

    $('#release').addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Lepas kursi ini?', body: '<p>Kursi langsung tersedia lagi untuk penumpang lain, dan Anda perlu memilih dari awal.</p>', confirm: 'Lepas kursi', cancel: 'Tetap tahan', danger: true });
      if (!yes) return;
      await api(`/api/locks/${lockId}`, { method: 'DELETE' }).catch(() => {});
      toast('Kursi sudah dilepas.');
      go(`/kursi/${encodeURIComponent(lock.tripId)}?from=${a.station.code}&to=${b.station.code}&pax=${lock.seats.length}`, { replace: true });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err');
      err.hidden = true;
      const inputs = $$('input', form);
      if (!inputs.map((i) => checkField(i, true)).every(Boolean)) {
        inputs.find((i) => i.parentElement.classList.contains('bad'))?.focus();
        err.textContent = 'Ada isian yang perlu diperbaiki.';
        err.hidden = false;
        Kiko.react('bingung', 'Coba lihat kolom yang merah, ya.');
        Sound.play('fail');
        return;
      }
      const passengers = lock.seats.map((seatId, i) => {
        const v = (k) => $(`#p${i}-${k}`).value.trim();
        return { seatId, name: v('name'), age: Number(v('age')), ...(v('nik') ? { nik: v('nik') } : {}), ...(v('phone') ? { phone: v('phone') } : {}) };
      });
      const btn = $('#submit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span> Menyimpan';
      try {
        const booking = await api('/api/bookings', { method: 'POST', idem, body: { lockId, passengers } });
        Sound.play('chime');
        go(`/bayar/${booking.id}`, { replace: true });
      } catch (ex) {
        idem = uuid();
        btn.disabled = false;
        btn.textContent = 'Lanjut ke pembayaran';
        if (ex.code === 'LOCK_EXPIRED' || ex.code === 'LOCK_NOT_ACTIVE') { expired(lock.tripId, a.station.code, b.station.code); return; }
        err.textContent = ex.message;
        err.hidden = false;
        Kiko.react('gagal', ex.message);
      }
    });
  })().catch((e) => {
    if (!main.contains($('#body'))) return;
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/" data-link>Kembali ke beranda</a></div>`;
    Kiko.react('gagal');
  });

  return () => stopTimer?.();
}

