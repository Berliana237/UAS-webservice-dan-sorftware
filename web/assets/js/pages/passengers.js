/**
 * Data penumpang. Penumpang pertama diisi otomatis dari profil (bisa diubah; kolom profil yang kosong tetap kosong).
 * Usia diisi langsung atau dihitung dari tanggal lahir, label golongan dan tarif per penumpang berubah saat itu juga.
 * Golongan: bayi 0-3, anak 4-16, dewasa 17-59 (tarif normal), lansia 60+ (potongan sesuai pengaturan admin).
 */
import { $, $$, api, gql, esc, go, uuid, confirmDialog, toast, rupiah, ageFrom, paxType, seniorFare } from '../core.js';
import { Kiko } from '../kiko.js';
import { Sound } from '../sound.js';
import { countdown, routeStrip, steps } from '../ui.js';

const TRIP = `query($id:ID!,$from:String!,$to:String!){trip(id:$id){trainName trainNumber stops{seq departAt arriveAt station{code name}}}
  seatMap(tripId:$id,from:$from,to:$to){seniorDiscountPercent coaches{adultFare coach{code label seatClass}}}}`;
const CLASS = { EKONOMI: 'Ekonomi', EKSEKUTIF: 'Eksekutif', LUXURY: 'Luxury' };

function card(seat, i, coach, total = 1) {
  const p = `p${i}`;
  return `<fieldset class="ticket-wrap pax reveal" style="--i:${i}" data-i="${i}"><div class="ticket pax-card" style="--n:66px">
    <legend class="pax-head"><span class="pax-seat mono">${esc(seat.split('-')[1])}</span><span><b>Penumpang ${i + 1}${i === 0 ? ' <small class="muted">(pemesan)</small>' : ''}</b><small class="muted">${esc(coach?.coach.label || seat.split('-')[0])} · ${CLASS[coach?.coach.seatClass] || ''}</small></span>
      <span class="pax-type" data-type aria-live="polite"><span class="chip mute">Isi usia</span></span><b class="pax-fare mono" data-fare>${rupiah(coach?.adultFare)}</b>${total > 1 ? `<button type="button" class="btn link sm pax-drop" data-drop="${esc(seat)}">Lepas kursi ini</button>` : ''}</legend>
    <div class="perf"></div>
    <div class="pax-grid">
      <div class="field wide"><label for="${p}-name">Nama sesuai identitas</label><input class="input" id="${p}-name" data-k="name" autocomplete="${i === 0 ? 'name' : 'off'}" maxlength="80"><small class="hint"></small></div>
      <div class="field"><label for="${p}-birth">Tanggal lahir <span class="opt">(mengisi usia)</span></label><input class="input mono" id="${p}-birth" data-k="birth" type="date"><small class="hint"></small></div>
      <div class="field"><label for="${p}-age">Usia</label><input class="input mono" id="${p}-age" data-k="age" inputmode="numeric" maxlength="3" placeholder="tahun"><small class="hint"></small></div>
      <div class="field"><label for="${p}-nik">NIK <span class="opt" data-nik-opt hidden>(opsional di bawah 17 tahun)</span></label><input class="input mono" id="${p}-nik" data-k="nik" inputmode="numeric" maxlength="16" placeholder="16 digit"><small class="hint"></small></div>
      <div class="field wide"><label for="${p}-phone">Nomor HP <span class="opt">(opsional)</span></label><input class="input mono" id="${p}-phone" data-k="phone" inputmode="tel" maxlength="16" autocomplete="${i === 0 ? 'tel' : 'off'}" placeholder="08xxxxxxxxxx"><small class="hint"></small></div>
    </div>
  </div></fieldset>`;
}

const rules = {
  name: (v) => (v.trim().length < 2 ? 'Tulis nama lengkap.' : ''),
  birth: () => '',
  age: (v) => {
    if (!/^\d{1,3}$/.test(v)) return 'Isi usia dalam angka (0 untuk bayi di bawah 1 tahun).';
    return Number(v) > 120 ? 'Usia maksimal 120 tahun.' : '';
  },
  nik: (v, age) => {
    if (!v) return Number(age) >= 17 ? 'Wajib untuk usia 17 tahun ke atas.' : '';
    return /^\d{16}$/.test(v) ? '' : `${v.length} dari 16 digit.`;
  },
  phone: (v) => (v && !/^(\+62|62|0)8\d{7,11}$/.test(v.replace(/[\s-]/g, '')) ? 'Contoh: 081234567890' : ''),
};

export function render(main, { params }) {
  const lockId = params.lockId;
  let stopTimer = null;
  let idem = uuid();
  main.innerHTML = `<div class="page wrap pax-page"><div class="page-head no-pad">${steps(1)}<span id="timer"></span></div><div id="body"><span class="skel" style="height:360px"></span></div></div>`;

  const expired = async (tripId, fromCode, toCode) => {
    stopTimer?.();
    Kiko.react('gagal', 'Waktu habis, kursinya sudah dilepas.', 4000);
    await confirmDialog({ title: 'Waktu menahan kursi habis', body: '<p>Kursi sudah dilepas agar penumpang lain bisa memesan. Silakan pilih kursi lagi.</p>', confirm: 'Pilih kursi lagi', cancel: 'Tutup' });
    go(`/kursi/${encodeURIComponent(tripId)}?from=${fromCode}&to=${toCode}`, { replace: true });
  };

  (async () => {
    const lock = await api(`/api/locks/${lockId}`);
    const codes = (await gql('query($id:ID!){trip(id:$id){stops{station{code}}}}', { id: lock.tripId })).trip.stops.map((x) => x.station.code);
    const fromCode = codes[lock.fromIndex];
    const toCode = codes[lock.toIndex];
    if (lock.status !== 'ACTIVE' || lock.expiresAt <= lock.serverTime) {
      if (lock.status === 'CONVERTED') { toast('Kursi ini sudah menjadi pesanan. Lanjutkan dari Perjalanan saya.'); go('/perjalanan', { replace: true }); return; }
      await expired(lock.tripId, fromCode, toCode);
      return;
    }
    const [{ trip, seatMap }, me] = await Promise.all([gql(TRIP, { id: lock.tripId, from: fromCode, to: toCode }), api('/api/auth/me').catch(() => ({ user: {} }))]);
    if (!main.contains($('#body'))) return;
    const profile = me.user || {};
    const pct = seatMap.seniorDiscountPercent;
    const coachOf = (seat) => seatMap.coaches.find((c) => seat.startsWith(`${c.coach.code}-`));
    const a = trip.stops[lock.fromIndex];
    const b = trip.stops[lock.toIndex];
    stopTimer = countdown($('#timer'), lock.expiresAt, {
      skew: lock.serverTime - Date.now(),
      onLow: () => Kiko.react('cemas', 'Tinggal semenit lagi! Yuk, cepat diselesaikan.', 4000),
      onEnd: () => expired(lock.tripId, a.station.code, b.station.code),
    });

    $('#body').innerHTML = `
      <div class="pax-layout">
        <div>
          <div class="page-title"><h1 class="h-sm">Siapa yang <em>berangkat?</em></h1><p class="sub">${esc(trip.trainName)} · ${esc(a.station.name)} ke ${esc(b.station.name)}</p></div>
          <div class="seat-route">${routeStrip(trip.stops, lock.fromIndex, lock.toIndex, { compact: true })}</div>
          ${profile.name ? `<p class="autofill-note">${profile.nik || profile.birthDate || profile.phone ? 'Penumpang 1 diisi dari profil Anda. Silakan ubah bila yang berangkat orang lain.' : 'Nama penumpang 1 diisi dari profil. Lengkapi NIK dan tanggal lahir di Profil agar berikutnya terisi otomatis.'}</p>` : ''}
          <form id="form" novalidate>${lock.seats.map((s, i) => card(s, i, coachOf(s), lock.seats.length)).join('')}
            <p class="alert on-dark" id="err" role="alert" hidden></p>
            <div class="form-act"><button class="btn ghost" type="button" id="release">${lock.seats.length > 1 ? 'Lepas semua kursi' : 'Lepas kursi'}</button><button class="btn gold" type="submit" id="submit">Lanjut ke pembayaran</button></div>
          </form>
        </div>
        <aside class="pax-side">
          <div class="ticket-wrap"><div class="ticket" style="--n:96px">
            <div class="sum-head"><p class="eyebrow">Ringkasan tarif</p><h2 class="sum-route">${lock.seats.length} penumpang</h2></div>
            <div class="perf"></div>
            <div class="sum-body"><ul class="sum-list" id="fare-list"></ul><div class="sum-total big"><span>Total</span><b class="mono" id="fare-total">-</b></div>
              <p class="sum-note muted">Bayi, anak, dan dewasa bertarif normal dan mendapat kursi sendiri. Lansia 60 tahun ke atas mendapat potongan ${pct}%.</p></div>
          </div></div>
        </aside>
      </div>`;
    Kiko.react('halo', 'NIK Anda dienkripsi, dan hanya 4 digit terakhir yang ditampilkan.', 4200);

    const form = $('#form');
    const fareOf = (i) => {
      const c = coachOf(lock.seats[i]);
      const age = $(`#p${i}-age`).value;
      const t = age === '' ? null : paxType(Number(age), pct);
      return { t, fare: t?.code === 'SENIOR' ? seniorFare(c.adultFare, pct) : c.adultFare, adult: c.adultFare };
    };
    const paintFares = () => {
      let sum = 0;
      $('#fare-list').innerHTML = lock.seats.map((s, i) => {
        const { t, fare, adult } = fareOf(i);
        sum += fare;
        const cardEl = $(`fieldset[data-i="${i}"]`);
        $('[data-type]', cardEl).innerHTML = t ? `<span class="chip ${t.code === 'SENIOR' ? 'gold' : t.code === 'ADULT' ? '' : 'go'}">${t.label}${t.code === 'SENIOR' ? ` · -${pct}%` : ''}</span>` : '<span class="chip mute">Isi usia</span>';
        $('[data-fare]', cardEl).innerHTML = fare < adult ? `<s class="muted">${rupiah(adult)}</s> ${rupiah(fare)}` : rupiah(fare);
        const nm = $(`#p${i}-name`).value.trim() || `Penumpang ${i + 1}`;
        return `<li><b class="mono">${esc(s.split('-')[1])}</b><span>${esc(nm)}<small class="muted">${t ? `${t.label}, ${t.note}` : 'usia belum diisi'}</small></span><span class="mono r">${rupiah(fare)}</span></li>`;
      }).join('');
      $('#fare-total').textContent = rupiah(sum);
    };

    const checkField = (input, final) => {
      const cardEl = input.closest('.pax-card');
      const age = $('[data-k=age]', cardEl).value;
      let msg = rules[input.dataset.k](input.value.trim(), age);
      if (!msg && input.dataset.k === 'nik' && input.value) {
        const dup = $$('[data-k=nik]', form).some((o) => o !== input && o.value.trim() === input.value.trim());
        if (dup) msg = 'NIK ini sudah dipakai penumpang lain dalam pesanan.';
      }
      const box = input.parentElement;
      const quiet = !final && !box.dataset.touched;
      box.classList.toggle('bad', Boolean(msg) && !quiet);
      box.classList.toggle('good', !msg && Boolean(input.value));
      $('.hint', box).textContent = quiet ? '' : msg;
      return !msg;
    };
    const syncNikOpt = (cardEl) => {
      const v = $('[data-k=age]', cardEl).value;
      $('[data-nik-opt]', cardEl).hidden = !(v !== '' && Number(v) < 17);
    };

    // Isi otomatis penumpang pertama dari profil
    const set = (id, v) => { if (v) $(id).value = v; };
    set('#p0-name', profile.name);
    set('#p0-nik', profile.nik);
    set('#p0-phone', profile.phone);
    if (profile.birthDate) { $('#p0-birth').value = profile.birthDate; $('#p0-age').value = String(ageFrom(profile.birthDate)); }
    $$('.pax-card', form).forEach(syncNikOpt);
    paintFares();

    $$('input', form).forEach((i) => {
      if (i.dataset.k === 'birth') i.max = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      i.addEventListener('blur', () => { i.parentElement.dataset.touched = '1'; checkField(i, false); });
      i.addEventListener('input', () => {
        const c = i.closest('.pax-card');
        if (i.dataset.k === 'nik' || i.dataset.k === 'age') i.value = i.value.replace(/\D/g, '');
        if (i.dataset.k === 'birth') {
          const age = ageFrom(i.value);
          if (age !== null && age >= 0) { const ageIn = $('[data-k=age]', c); ageIn.value = String(age); ageIn.parentElement.dataset.touched = '1'; checkField(ageIn, false); }
        }
        if (i.dataset.k === 'age') $('[data-k=birth]', c).value = '';
        checkField(i, false);
        if (['age', 'birth'].includes(i.dataset.k)) {
          syncNikOpt(c);
          const nik = $('[data-k=nik]', c);
          if (nik.parentElement.dataset.touched) checkField(nik, false);
          const t = paxType($('[data-k=age]', c).value, pct);
          if (t?.code === 'SENIOR') Kiko.react('bangga', `Lansia dapat potongan ${pct}%. Sudah saya hitung.`, 2400);
        }
        if (i.dataset.k === 'nik' && i.value.length === 16) { Sound.play('punch'); Kiko.mood('happy', 900); }
        paintFares();
      });
    });

    // Isian penumpang disimpan per kursi, agar tidak hilang saat satu kursi dilepas dan halaman dimuat ulang.
    const draftKey = `rk:paxdraft:${lockId}`;
    const saveDraft = () => {
      const out = {};
      lock.seats.forEach((seat, i) => { const f = $(`fieldset[data-i="${i}"]`); if (!f) return; out[seat] = Object.fromEntries($$('[data-k]', f).map((x) => [x.dataset.k, x.value])); });
      try { sessionStorage.setItem(draftKey, JSON.stringify(out)); } catch { /* mode privat */ }
    };
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
      if (draft) {
        lock.seats.forEach((seat, i) => {
          const f = $(`fieldset[data-i="${i}"]`);
          const v = draft[seat];
          if (!f || !v) return;
          $$('[data-k]', f).forEach((x) => { if (v[x.dataset.k]) { x.value = v[x.dataset.k]; x.dispatchEvent(new Event('input', { bubbles: true })); } });
        });
        sessionStorage.removeItem(draftKey);
      }
    } catch { /* draf rusak diabaikan */ }

    // Lepas satu kursi: sisa kursi tetap ditahan lewat PUT /api/locks/{id}; batas waktu tidak berubah.
    $$('.pax-drop').forEach((btn) => btn.addEventListener('click', async () => {
      const seat = btn.dataset.drop;
      const yes = await confirmDialog({ title: `Lepas kursi ${esc(seat.split('-')[1])}?`, body: '<p>Kursi ini langsung tersedia lagi untuk penumpang lain. Kursi lainnya tetap ditahan untuk Anda.</p>', confirm: 'Lepas kursi ini', cancel: 'Tetap tahan', danger: true });
      if (!yes) return;
      saveDraft();
      try {
        await api(`/api/locks/${lockId}`, { method: 'PUT', body: { seats: lock.seats.filter((x) => x !== seat) } });
        toast(`Kursi ${seat.split('-')[1]} sudah dilepas.`);
        go(location.pathname + location.search, { replace: true });
      } catch (e) {
        try { sessionStorage.removeItem(draftKey); } catch { /* mode privat */ }
        toast(e.message, 'warn');
      }
    }));

    $('#release').addEventListener('click', async () => {
      const yes = await confirmDialog({ title: 'Lepas kursi ini?', body: '<p>Kursi langsung tersedia lagi untuk penumpang lain, dan Anda perlu memilih dari awal.</p>', confirm: 'Lepas kursi', cancel: 'Tetap tahan', danger: true });
      if (!yes) return;
      await api(`/api/locks/${lockId}`, { method: 'DELETE' }).catch(() => {});
      toast('Kursi sudah dilepas.');
      go(`/kursi/${encodeURIComponent(lock.tripId)}?from=${a.station.code}&to=${b.station.code}`, { replace: true });
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
        return { seatId, name: v('name'), age: Number(v('age')), ...(v('nik') ? { nik: v('nik') } : {}), ...(v('phone') ? { phone: v('phone').replace(/[\s-]/g, '') } : {}) };
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
    $('#body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p><a class="btn ghost" href="/cari" data-link>Kembali ke pencarian</a></div>`;
    Kiko.react('gagal');
  });

  return () => stopTimer?.();
}
