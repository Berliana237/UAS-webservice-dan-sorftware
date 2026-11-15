/**
 * Potongan tampilan bersama untuk halaman bayar, tiket, dan perjalanan saya:
 * rincian tarif dengan potongan lansia, rute lengkap perjalanan, dan info keterlambatan.
 */
import { api, esc, rupiah, timeOf } from '../core.js';

const TYPE = { INFANT: 'Bayi', CHILD: 'Anak', ADULT: 'Dewasa', SENIOR: 'Lansia' };

/** Mengambil rute perjalanan dan tarif normal per gerbong untuk ruas pesanan. Gagal diam-diam: tampilan inti tetap jalan. */
export async function tripContext(b) {
  try {
    const [{ trip }, map] = await Promise.all([
      api(`/api/trips/${encodeURIComponent(b.tripId)}`),
      api(`/api/trips/${encodeURIComponent(b.tripId)}/seats?from=${encodeURIComponent(b.from.code)}&to=${encodeURIComponent(b.to.code)}`),
    ]);
    const fareByCoach = Object.fromEntries(map.coaches.map((c) => [c.coach.code, c.adultFare]));
    return { trip, fareByCoach, seniorPct: map.seniorDiscountPercent, fromIdx: map.fromIndex, toIdx: map.toIndex };
  } catch {
    return null;
  }
}

/** Tarif normal (sebelum potongan) satu penumpang, dari tarif dewasa gerbongnya. */
const normalFare = (p, ctx) => (ctx?.fareByCoach?.[p.seatId.split('-')[0]] ?? p.fare);

/** Rincian tarif: tiap penumpang, potongan lansia, subtotal, dan total. */
export function invoice(b, ctx, { compact = false } = {}) {
  const rows = b.passengers.map((p) => {
    const normal = Math.max(normalFare(p, ctx), p.fare);
    const cut = normal - p.fare;
    return { p, normal, cut };
  });
  const subtotal = rows.reduce((n, r) => n + r.normal, 0);
  const discount = rows.reduce((n, r) => n + r.cut, 0);
  const seniors = rows.filter((r) => r.p.passengerType === 'SENIOR').length;
  return `<div class="inv ${compact ? 'compact' : ''}">
    <ul class="inv-list">${rows.map(({ p, normal, cut }) => `<li>
      <b class="mono">${esc(p.seatId.split('-')[1])}</b>
      <span>${esc(p.name)}<small class="muted">${esc(p.passengerTypeLabel || TYPE[p.passengerType] || '')}${cut > 0 ? ` · potongan lansia ${ctx?.seniorPct ?? ''}${ctx?.seniorPct != null ? '%' : ''}` : ''}</small></span>
      <span class="mono r">${cut > 0 ? `<s class="muted">${rupiah(normal)}</s> ` : ''}${rupiah(p.fare)}</span></li>`).join('')}</ul>
    ${discount > 0 ? `<div class="inv-line"><span>Subtotal tarif normal</span><b class="mono">${rupiah(subtotal)}</b></div>
      <div class="inv-line disc"><span>Diskon lansia${seniors > 1 ? ` (${seniors} penumpang)` : ''}</span><b class="mono">&minus;${rupiah(discount)}</b></div>` : ''}
    <div class="sum-total big"><span>Total${b.status === 'CONFIRMED' || b.status === 'CHECKED_IN' ? ' dibayar' : ''}</span><b class="mono">${rupiah(b.amount)}</b></div>
  </div>`;
}

const shift = (iso, min) => (iso ? new Date(Date.parse(iso) + min * 60000).toISOString() : null);

/** Keterlambatan: label dan jam berangkat baru dari stasiun penumpang. */
export function delayNote(b) {
  if (!b.delayMinutes) return '';
  return `<p class="delay-note" role="status"><span class="pill wait">Terlambat ${b.delayMinutes} menit</span> Jadwal ${timeOf(b.departureAt)}, perkiraan berangkat <b class="mono">${timeOf(b.departureAt + b.delayMinutes * 60000)}</b></p>`;
}

/** Rute lengkap: semua stasiun dari awal sampai akhir, ruas penumpang disorot, jam digeser bila terlambat. */
export function routeTimeline(b, ctx) {
  if (!ctx?.trip) return '';
  const delay = b.delayMinutes || 0;
  const stops = ctx.trip.stops;
  const a = ctx.fromIdx;
  const z = ctx.toIdx;
  return `<section class="rt" aria-label="Rute perjalanan">
    <h2 class="h-xs">Rute perjalanan</h2>
    <p class="muted">${esc(ctx.trip.trainName)} ${esc(ctx.trip.trainNumber || '')} · ${stops.length} stasiun · ruas Anda ${esc(stops[a].station.name)} sampai ${esc(stops[z].station.name)}</p>
    <ol class="rt-list">${stops.map((s, i) => {
      const role = i === a ? 'naik' : i === z ? 'turun' : i > a && i < z ? 'lewat' : 'luar';
      const arr = shift(s.arriveAt, delay);
      const dep = shift(s.departAt, delay);
      return `<li class="rt-stop ${role}">
        <span class="rt-dot" aria-hidden="true"></span>
        <span class="rt-name"><b>${esc(s.station.name)}</b> <small class="muted mono">${esc(s.station.code)}</small>${role === 'naik' ? ' <span class="chip gold">Naik</span>' : role === 'turun' ? ' <span class="chip gold">Turun</span>' : ''}</span>
        <span class="rt-time mono">${i === 0 ? '' : `tiba ${timeOf(arr)}`}${i > 0 && i < stops.length - 1 ? ' · ' : ''}${i === stops.length - 1 ? '' : `berangkat ${timeOf(dep)}`}</span>
      </li>`;
    }).join('')}</ol>
    ${delay ? `<p class="muted">Jam di atas sudah ditambah keterlambatan ${delay} menit.</p>` : ''}
  </section>`;
}
