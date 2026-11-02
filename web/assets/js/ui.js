/** ui.js: komponen tampilan bersama. Combobox stasiun, garis rute, langkah, hitung mundur, papan split-flap, QR, pintu, dan konfeti. */
import { $, esc, sleep, reduceMotion } from './core.js';
import { Sound } from './sound.js';

/* ---------- Ikon ---------- */
export const icon = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3"/></svg>',
  on: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h3l5 4V6L7 10zM21 9l-5 6M16 9l5 6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  mark: '<svg viewBox="0 0 30 22" aria-hidden="true" fill="none"><path d="M1 6h28M1 16h28" stroke="#c8a25e" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="16" r="4" fill="#0a1210" stroke="#e6cd94" stroke-width="1.8"/><circle cx="21" cy="6" r="4" fill="#0a1210" stroke="#e6cd94" stroke-width="1.8"/></svg>',
};

/* ---------- Combobox stasiun ---------- */
export function combobox(input, { options, onPick, onFocus }) {
  let list = null;
  let active = -1;
  let shown = [];
  const id = `cb-${Math.random().toString(36).slice(2, 8)}`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  input.setAttribute('autocomplete', 'off');

  const close = () => {
    list?.remove();
    list = null;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const place = () => {
    if (!list) return;
    const r = input.getBoundingClientRect();
    const below = innerHeight - r.bottom;
    list.style.left = `${r.left}px`;
    list.style.width = `${Math.max(r.width, 260)}px`;
    if (below < 240 && r.top > below) { list.style.bottom = `${innerHeight - r.top + 6}px`; list.style.top = 'auto'; } else { list.style.top = `${r.bottom + 6}px`; list.style.bottom = 'auto'; }
  };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const current = input.dataset.code && options().find((o) => o.code === input.dataset.code)?.name === input.value;
    shown = options().filter((o) => current || !q || o.name.toLowerCase().includes(q) || o.city.toLowerCase().includes(q) || o.code.toLowerCase() === q).slice(0, 40);
    if (!list) {
      list = document.createElement('div');
      list.className = 'combo-list';
      list.id = id;
      list.setAttribute('role', 'listbox');
      document.body.append(list);
      list.addEventListener('pointerdown', (e) => {
        const o = e.target.closest('.combo-opt');
        if (o) { e.preventDefault(); choose(shown[Number(o.dataset.i)]); }
      });
    }
    list.innerHTML = shown.length
      ? shown.map((o, i) => `<div class="combo-opt" role="option" id="${id}-${i}" data-i="${i}" aria-selected="${i === active}"><span>${esc(o.name)}</span><small>${esc(o.code)}</small></div>`).join('')
      : '<div class="combo-empty">Stasiun tidak ditemukan. Coba nama kota.</div>';
    input.setAttribute('aria-expanded', 'true');
    place();
  };
  const choose = (o) => {
    if (!o) return;
    input.value = o.name;
    input.dataset.code = o.code;
    close();
    Sound.play('pick');
    onPick?.(o);
  };
  input.addEventListener('focus', () => { onFocus?.(); paint(); input.select(); });
  input.addEventListener('input', () => { delete input.dataset.code; active = -1; paint(); });
  input.addEventListener('blur', () => setTimeout(close, 80));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!list) paint();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
      paint();
      input.setAttribute('aria-activedescendant', `${id}-${active}`);
      list?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && list && shown.length) {
      e.preventDefault();
      choose(shown[Math.max(active, 0)]);
    } else if (e.key === 'Escape') close();
  });
  addEventListener('scroll', place, { passive: true, capture: true });
  addEventListener('resize', place, { passive: true });
  return { close, destroy: () => { close(); removeEventListener('scroll', place, { capture: true }); removeEventListener('resize', place); } };
}

/* ---------- Garis rute ---------- */
export function routeStrip(stops, fromIdx, toIdx, { compact = false } = {}) {
  const dots = stops.map((s, i) => {
    const inside = i >= fromIdx && i <= toIdx;
    const edge = i === fromIdx || i === toIdx;
    return `<li class="rs-stop ${inside ? 'in' : ''} ${edge ? 'edge' : ''}" style="--i:${i}"><i></i><span>${esc(s.station?.name || s.name)}</span></li>`;
  }).join('');
  const n = Math.max(stops.length - 1, 1);
  return `<ol class="route ${compact ? 'compact' : ''}" style="--from:${(fromIdx / n) * 100};--len:${((toIdx - fromIdx) / n) * 100}" aria-label="Rute dari ${esc(stops[fromIdx].station?.name || stops[fromIdx].name)} ke ${esc(stops[toIdx].station?.name || stops[toIdx].name)}">${dots}</ol>`;
}

export const steps = (now) => {
  const names = ['Kursi', 'Data penumpang', 'Bayar', 'Tiket'];
  return `<ol class="steps" aria-label="Langkah pemesanan">${names.map((n, i) => `<li class="${i < now ? 'done' : i === now ? 'now' : ''}" ${i === now ? 'aria-current="step"' : ''}><b>${i < now ? '✓' : i + 1}</b><span>${n}</span></li>`).join('')}</ol>`;
};

/* ---------- Hitung mundur ---------- */
export function countdown(el, expiresAt, { onLow, onEnd, skew = 0 } = {}) {
  let warned = false;
  let ended = false;
  el.classList.add('timer');
  el.setAttribute('role', 'timer');
  el.innerHTML = `${icon.clock}<span></span>`;
  const label = el.querySelector('span');
  const tick = () => {
    const left = Math.max(0, expiresAt - (Date.now() + skew));
    const s = Math.ceil(left / 1000);
    label.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    el.setAttribute('aria-label', `Sisa waktu ${Math.floor(s / 60)} menit ${s % 60} detik`);
    if (s <= 60 && !warned) { warned = true; el.classList.add('low'); onLow?.(); }
    if (left <= 0 && !ended) { ended = true; clearInterval(h); onEnd?.(); }
  };
  const h = setInterval(tick, 250);
  tick();
  return () => clearInterval(h);
}

/* ---------- Papan split-flap ---------- */
const CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-';
function flapCell(ch) {
  return `<span class="flap" data-c="${esc(ch)}"><i class="t">${esc(ch)}</i><i class="b">${esc(ch)}</i></span>`;
}
export const flapText = (text, width) => String(text).toUpperCase().padEnd(width, ' ').slice(0, width).split('').map((c) => flapCell(CHARS.includes(c) ? c : ' ')).join('');

/** Membalik sel satu per satu menuju teks baru, seperti papan keberangkatan stasiun lama. */
export async function flapTo(root, text, { silent = false } = {}) {
  const cells = [...root.querySelectorAll('.flap')];
  const target = String(text).toUpperCase().padEnd(cells.length, ' ').slice(0, cells.length);
  if (reduceMotion()) {
    cells.forEach((c, i) => { c.querySelectorAll('i').forEach((x) => { x.textContent = target[i]; }); c.dataset.c = target[i]; });
    return;
  }
  await Promise.all(cells.map(async (c, i) => {
    const want = CHARS.includes(target[i]) ? target[i] : ' ';
    await sleep(i * 26);
    const start = CHARS.indexOf(c.dataset.c);
    const end = CHARS.indexOf(want);
    if (start === end) return;
    const hops = Math.min(6, (end - start + CHARS.length) % CHARS.length);
    for (let h = hops; h >= 0; h--) {
      const ch = h === 0 ? want : CHARS[(end - h + CHARS.length) % CHARS.length];
      c.classList.remove('flip');
      void c.offsetWidth;
      c.querySelector('.b').textContent = ch;
      c.classList.add('flip');
      await sleep(62);
      c.querySelector('.t').textContent = ch;
    }
    c.dataset.c = want;
    if (!silent && i % 3 === 0) Sound.play('flap');
  }));
}

/* ---------- QR ---------- */
export function qrSvg(text) {
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/* ---------- Pintu gerbong ---------- */
export async function doorsClose() {
  const c = $('#curtain');
  c.classList.remove('open');
  Sound.play('door');
  await sleep(reduceMotion() ? 0 : 900);
}
export function doorsOpen() {
  $('#curtain').classList.add('open');
}

/* ---------- Konfeti kuningan ---------- */
export function confetti(x, y, count = 70) {
  if (reduceMotion()) return;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;z-index:120;pointer-events:none';
  cv.width = innerWidth;
  cv.height = innerHeight;
  document.body.append(cv);
  const g = cv.getContext('2d');
  const colors = ['#e6cd94', '#c8a25e', '#f4efe3', '#b9463f', '#3f9d73'];
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, s: 4 + Math.random() * 7, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 };
  });
  const t0 = performance.now();
  const frame = (t) => {
    const age = t - t0;
    g.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => {
      p.vy += 0.26;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - age / 1900);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.62);
      g.restore();
    });
    if (age < 1900) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}

/* ---------- Pemandangan malam bergerak (hero dan halaman masuk) ---------- */
const TREES = (y, step, seed) => {
  let d = `M0 120V${y}`;
  for (let x = 0; x <= 1200; x += step) {
    const h = 14 + ((x * seed) % 26);
    d += `L${x + step * 0.25} ${y}L${x + step * 0.5} ${y - h}L${x + step * 0.75} ${y}`;
  }
  return `${d}L1200 ${y}V120Z`;
};
const stars = Array.from({ length: 70 }, (_, i) => {
  const x = (i * 97.3) % 100;
  const y = (i * 53.7) % 62;
  const s = 0.5 + ((i * 13) % 10) / 10;
  return `<i style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${s}px;height:${s}px;animation-delay:${(i % 9) * 0.5}s"></i>`;
}).join('');

const carriage = (x, w) => `<g transform="translate(${x} 0)"><rect y="6" width="${w}" height="42" rx="6" fill="#14231d" stroke="#c8a25e" stroke-width="1"/><path d="M0 40h${w}" stroke="#c8a25e" stroke-width="1"/>${[10, 34, 58, 82, 106].filter((v) => v + 18 < w).map((v, i) => `<rect class="tw" style="animation-delay:${i * 0.7}s" x="${v}" y="14" width="18" height="14" rx="2"/>`).join('')}<circle cx="16" cy="51" r="5" fill="#070c0a" stroke="#8f7236"/><circle cx="${w - 16}" cy="51" r="5" fill="#070c0a" stroke="#8f7236"/></g>`;

export const scene = (mode = 'hero') => `
<div class="scene m-${mode}" aria-hidden="true">
  <div class="sky"><div class="stars">${stars}</div><div class="moon"></div><div class="glow"></div></div>
  <svg class="ly ly1" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 120V70C110 30 210 60 320 46S520 18 660 50 880 74 1010 38 1140 50 1200 70V120Z"/><path transform="translate(1200 0)" d="M0 120V70C110 30 210 60 320 46S520 18 660 50 880 74 1010 38 1140 50 1200 70V120Z"/></svg>
  <svg class="ly ly2" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="${TREES(82, 40, 7)}"/><path transform="translate(1200 0)" d="${TREES(82, 40, 7)}"/></svg>
  <svg class="ly ly3" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="${TREES(96, 24, 11)}"/><path transform="translate(1200 0)" d="${TREES(96, 24, 11)}"/></svg>
  <div class="poles"><i></i><i></i><i></i><i></i></div>
  <div class="ground"></div>
  <svg class="train" viewBox="0 0 640 60"><g class="tr-body">${carriage(0, 138)}${carriage(146, 138)}${carriage(292, 138)}<g transform="translate(438 0)"><path d="M0 48V6h118q42 2 62 42z" fill="#1c3028" stroke="#c8a25e"/><rect class="tw" x="14" y="14" width="20" height="14" rx="2"/><rect class="tw" x="46" y="14" width="20" height="14" rx="2"/><path d="M116 14h12q14 2 22 14h-34z" fill="#ffe7ad"/><circle cx="24" cy="51" r="5" fill="#070c0a" stroke="#8f7236"/><circle cx="130" cy="51" r="5" fill="#070c0a" stroke="#8f7236"/></g></g><path class="beam" d="M618 40L900 18V60Z"/></svg>
  <div class="rails"></div>
</div>`;
