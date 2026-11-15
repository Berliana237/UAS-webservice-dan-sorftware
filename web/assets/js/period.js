/**
 * Filter periode waktu: satu dropdown (misalnya 7 hari, 30 hari, tahun ini) dan pilihan Custom yang
 * memunculkan tanggal awal dan akhir. Dipakai halaman admin dan masinis agar perilakunya seragam.
 */
import { $, esc, toast, wibToday } from './core.js';

/** Preset siap pakai. range() mengembalikan { from, to } dalam yyyy-mm-dd (WIB), atau string kosong untuk tanpa batas. */
export const PERIODS = {
  all: { label: 'Semua waktu', range: () => ({ from: '', to: '' }) },
  today: { label: 'Hari ini', range: () => ({ from: wibToday(), to: wibToday() }) },
  past7: { label: '7 hari terakhir', range: () => ({ from: wibToday(-6), to: wibToday() }) },
  past30: { label: '30 hari terakhir', range: () => ({ from: wibToday(-29), to: wibToday() }) },
  year: { label: 'Tahun ini', range: () => ({ from: `${wibToday().slice(0, 4)}-01-01`, to: wibToday() }) },
  next7: { label: '7 hari', range: () => ({ from: wibToday(), to: wibToday(7) }) },
  next14: { label: '14 hari', range: () => ({ from: wibToday(), to: wibToday(14) }) },
  next30: { label: '30 hari', range: () => ({ from: wibToday(), to: wibToday(30) }) },
};

/**
 * @param {HTMLElement} el wadah kosong
 * @param {{ presets: string[], initial: string, onChange: (r: {from: string, to: string, key: string}) => void, id?: string }} opts
 */
export function periodFilter(el, { presets, initial, onChange, id = 'pf' }) {
  el.innerHTML = `<form class="period filter-bar" novalidate>
    <div class="f period-main"><label for="${id}-sel">Periode</label>
      <select class="sel" id="${id}-sel">${presets.map((k) => `<option value="${k}" ${k === initial ? 'selected' : ''}>${esc(PERIODS[k].label)}</option>`).join('')}<option value="custom">Custom</option></select></div>
    <div class="f period-custom" hidden><label for="${id}-from">Dari tanggal</label><input class="in mono" type="date" id="${id}-from"></div>
    <div class="f period-custom" hidden><label for="${id}-to">Sampai tanggal</label><input class="in mono" type="date" id="${id}-to"></div>
    <button class="btn gold sm period-custom" type="submit" hidden>Terapkan</button>
  </form>`;
  const form = $('form', el);
  const sel = $(`#${id}-sel`, el);
  const custom = [...el.querySelectorAll('.period-custom')];
  const emit = (key) => {
    const r = PERIODS[key].range();
    $(`#${id}-from`, el).value = r.from;
    $(`#${id}-to`, el).value = r.to;
    onChange({ ...r, key });
  };
  sel.addEventListener('change', () => {
    const isCustom = sel.value === 'custom';
    custom.forEach((x) => { x.hidden = !isCustom; });
    if (isCustom) $(`#${id}-from`, el).focus();
    else emit(sel.value);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = $(`#${id}-from`, el).value;
    const to = $(`#${id}-to`, el).value;
    if (!from || !to) { toast('Isi tanggal awal dan akhir.', 'warn'); return; }
    if (from > to) { toast('Tanggal awal harus sebelum tanggal akhir.', 'warn'); return; }
    onChange({ from, to, key: 'custom' });
  });
  const start = PERIODS[initial].range();
  $(`#${id}-from`, el).value = start.from;
  $(`#${id}-to`, el).value = start.to;
  return { ...start, key: initial };
}
