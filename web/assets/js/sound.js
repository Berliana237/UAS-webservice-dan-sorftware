/**
 * sound.js: efek suara sintetis (WebAudio), tanpa berkas audio. Idenya sama dengan TrustGuard:
 * suara baru berbunyi setelah pengguna berinteraksi dan bisa dimatikan lewat tombol di header.
 */
let ctx = null;
let master = null;
let enabled = true;
try { enabled = localStorage.getItem('rk:sound') !== '0'; } catch { /* mode privat */ }

function ready() {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

function tone(f, t, d, vol = 0.22, wave = 'sine', slide) {
  const c = ready();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + t;
  o.type = wave;
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + d + 0.03);
}

function noise(t, d, vol = 0.1, freq = 1800) {
  const c = ready();
  if (!c) return;
  const len = Math.floor(c.sampleRate * d);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  const t0 = c.currentTime + t;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t0);
}

/** Desis untuk napas dan hembusan. */
function hiss(t, d, vol, f0, f1) {
  const c = ready();
  if (!c) return;
  const len = Math.floor(c.sampleRate * d);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  const flt = c.createBiquadFilter();
  const g = c.createGain();
  const t0 = c.currentTime + t;
  src.buffer = buf;
  flt.type = 'bandpass';
  flt.Q.value = 1.2;
  flt.frequency.setValueAtTime(f0, t0);
  flt.frequency.exponentialRampToValueAtTime(f1, t0 + d);
  g.gain.value = vol;
  src.connect(flt);
  flt.connect(g);
  g.connect(master);
  src.start(t0);
}

/** Nada suara karakter: vibrato kecil agar terdengar hidup, bukan bip mesin. */
function voice(f, t, d, vol = 0.2, slide) {
  const c = ready();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  const v = c.createOscillator();
  const vg = c.createGain();
  const t0 = c.currentTime + t;
  o.type = 'triangle';
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + d);
  v.frequency.value = 7;
  vg.gain.value = f * 0.02;
  v.connect(vg);
  vg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g);
  g.connect(master);
  v.start(t0);
  o.start(t0);
  o.stop(t0 + d + 0.03);
  v.stop(t0 + d + 0.03);
}

/** Suara bernada tinggi lewat sintesis formant, teknik yang sama dengan karakter Guardian di TrustGuard. */
function formant(f0a, f0b, t, d, vol, bands) {
  const c = ready();
  if (!c) return;
  const t0 = c.currentTime + t;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0a, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(60, f0b), t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.025);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.03, d - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  bands.forEach(([freq, q, gain]) => {
    const b = c.createBiquadFilter();
    const fg = c.createGain();
    b.type = 'bandpass';
    b.frequency.value = freq;
    b.Q.value = q;
    fg.gain.value = gain;
    o.connect(b);
    b.connect(fg);
    fg.connect(g);
  });
  g.connect(master);
  o.start(t0);
  o.stop(t0 + d + 0.03);
}
const NASAL = [[300, 5, 1.7], [1150, 7, 0.35], [2600, 6, 0.16]];
const UH = [[430, 5, 1.5], [1250, 7, 0.5], [2750, 6, 0.2]];

const SOUNDS = {
  tap: () => tone(620, 0, 0.05, 0.12, 'triangle'),
  hover: () => tone(980, 0, 0.03, 0.04, 'sine'),
  pick: () => { tone(740, 0, 0.07, 0.14, 'triangle'); tone(990, 0.05, 0.08, 0.12, 'triangle'); },
  unpick: () => tone(520, 0, 0.09, 0.12, 'triangle', 380),
  flap: () => noise(0, 0.025, 0.05, 3200),
  punch: () => { noise(0, 0.05, 0.22, 900); tone(180, 0, 0.06, 0.16, 'square', 90); },
  lock: () => { tone(330, 0, 0.08, 0.2, 'square', 300); noise(0.06, 0.06, 0.2, 1200); tone(660, 0.11, 0.12, 0.14, 'triangle'); },
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.2, 0.17, 'triangle')),
  fail: () => { tone(300, 0, 0.16, 0.18, 'sawtooth', 220); tone(220, 0.14, 0.24, 0.16, 'sawtooth', 150); },
  door: () => { noise(0, 0.5, 0.1, 500); tone(150, 0, 0.5, 0.08, 'sine', 90); },
  chime: () => { tone(880, 0, 0.5, 0.11); tone(659, 0.22, 0.65, 0.11); },
  squeak: () => voice(900, 0, 0.12, 0.22, 1500),
  hmph: () => {
    const k = 0.94 + Math.random() * 0.12;
    if (Math.random() < 0.6) {
      hiss(0, 0.07, 0.08, 2600, 1500);
      formant(560 * k, 600 * k, 0.05, 0.09, 0.36, NASAL);
      formant(600 * k, 400 * k, 0.13, 0.2, 0.36, UH.map(([f, q, g]) => [f * 0.8, q, g]));
      hiss(0.31, 0.05, 0.17, 1500, 3600);
      hiss(0.34, 0.14, 0.1, 3200, 1800);
    } else {
      hiss(0, 0.08, 0.07, 2400, 1400);
      formant(520 * k, 560 * k, 0.06, 0.14, 0.28, NASAL);
      formant(560 * k, 360 * k, 0.19, 0.34, 0.26, NASAL);
      hiss(0.55, 0.05, 0.15, 1500, 3400);
      hiss(0.58, 0.17, 0.09, 3000, 1600);
    }
  },
  huff: () => { hiss(0, 0.3, 0.12, 900, 300); tone(260, 0, 0.22, 0.15, 'square', 180); },
  drop: () => { tone(300, 0, 0.16, 0.26, 'sine', 90); hiss(0.05, 0.12, 0.06, 400, 200); },
  giggle: () => [0, 0.09, 0.17, 0.26, 0.33].forEach((t, i) => voice(880 + i * 60, t, 0.07, 0.16, 1100 + i * 40)),
  chirp: () => { voice(1100, 0, 0.09, 0.12, 1500); voice(1500, 0.08, 0.1, 0.1, 1300); },
  whee: () => { voice(500, 0, 0.5, 0.2, 1500); hiss(0, 0.5, 0.05, 600, 3000); },
  pat: () => { tone(520, 0, 0.09, 0.2, 'sine', 780); tone(780, 0.09, 0.09, 0.18, 'sine', 1040); tone(1040, 0.18, 0.16, 0.16, 'sine'); },
  purr: () => { for (let i = 0; i < 10; i++) tone(95 + (i % 2) * 12, i * 0.05, 0.08, 0.1, 'sawtooth'); },
  yawn: () => { voice(500, 0, 0.5, 0.12, 320); voice(330, 0.45, 0.4, 0.08, 240); },
  surprise: () => { voice(700, 0, 0.08, 0.2, 1400); tone(1400, 0.08, 0.12, 0.14, 'sine'); },
  aww: () => { voice(600, 0, 0.22, 0.16, 420); voice(420, 0.22, 0.3, 0.12, 330); },
  whistle: () => {
    for (let i = 0; i < 2; i++) { tone(2350, i * 0.32, 0.26, 0.2, 'square'); tone(2520, i * 0.32, 0.26, 0.14, 'square'); }
    tone(2400, 0.66, 0.5, 0.2, 'square');
  },
  horn: () => { [196, 247, 294].forEach((f) => tone(f, 0, 0.95, 0.15, 'sawtooth')); [196, 247, 294].forEach((f) => tone(f, 1.05, 1.3, 0.13, 'sawtooth')); },
  chug: () => { for (let i = 0; i < 12; i++) noise(i * 0.17, 0.09, 0.12 + i * 0.008, 600); },
};

export const Sound = {
  play(name) { try { SOUNDS[name]?.(); } catch { /* suara tidak boleh mengganggu alur */ } },
  isOn: () => enabled,
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem('rk:sound', enabled ? '1' : '0'); } catch { /* mode privat */ }
    if (enabled) this.play('chirp');
    return enabled;
  },
};
