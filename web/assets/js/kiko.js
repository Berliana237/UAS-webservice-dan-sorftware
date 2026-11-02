/**
 * kiko.js: "Kiko", kondektur kereta bergaya chibi yang menemani pengguna.
 * Pola kerjanya mengikuti karakter Guardian di TrustGuard, tetapi digambar ulang untuk tema kereta:
 * topi kondektur, jas hijau berkancing kuningan, syal merah marun, peluit, dan lentera sinyal.
 *
 * Satu markup SVG memuat semua varian mata, mulut, alis, dan efek. Yang tampil dipilih lewat atribut
 * data-eyes / data-mouth / data-brow / data-fx / data-pose pada elemen induk (lihat kiko.css).
 *
 * Interaksi: tekan = kesal, tahan = geli, tahan lalu geser = terangkat dan menggelepar, lepas = jatuh membal,
 * klik dua kali = berputar gembira, arahkan kursor = menoleh, tombol Elus = bahagia. Lima kali ditekan beruntun:
 * Kiko meniup peluit dan kereta melintas di layar. Otonom: berkedip, melirik, lompat kecil, dan tertidur bila lama diam.
 */
import { Sound } from './sound.js';
import { reduceMotion } from './core.js';

let uid = 0;
const coarse = () => matchMedia('(pointer: coarse)').matches;

const MOODS = {
  idle: { eyes: 'open', mouth: 'smile', brow: 'norm', fx: '' },
  happy: { eyes: 'happy', mouth: 'open', brow: 'up', fx: 'blush sparkle' },
  cheer: { eyes: 'star', mouth: 'open', brow: 'up', fx: 'blush sparkle hearts', pose: 'cheer' },
  proud: { eyes: 'wink', mouth: 'grin', brow: 'up', fx: 'sparkle' },
  love: { eyes: 'heart', mouth: 'cat', brow: 'up', fx: 'blush hearts' },
  sad: { eyes: 'sad', mouth: 'frown', brow: 'sad', fx: 'tear sweat' },
  worried: { eyes: 'open', mouth: 'flat', brow: 'sad', fx: 'sweat' },
  alert: { eyes: 'surp', mouth: 'o', brow: 'up', fx: 'alert' },
  thinking: { eyes: 'side', mouth: 'flat', brow: 'norm', fx: 'think' },
  confused: { eyes: 'open', mouth: 'wavy', brow: 'sad', fx: 'quest' },
  wink: { eyes: 'wink', mouth: 'cat', brow: 'up', fx: 'blush' },
  annoyed: { eyes: 'annoy', mouth: 'pout', brow: 'angry', fx: 'vein redblush' },
  pat: { eyes: 'closed', mouth: 'cat', brow: 'norm', fx: 'blush hearts' },
  sleepy: { eyes: 'sleepy', mouth: 'flat', brow: 'norm', fx: 'zzz', pose: 'sleepy' },
  peek: { eyes: 'closed', mouth: 'o', brow: 'up', fx: 'blush', pose: 'peek' },
  giggle: { eyes: 'happy', mouth: 'grin', brow: 'up', fx: 'blush sparkle' },
  lifted: { eyes: 'squeeze', mouth: 'grump', brow: 'sad', fx: 'blush sweat' },
  whistle: { eyes: 'annoy', mouth: 'whistle', brow: 'angry', fx: 'vein notes', pose: 'whistle' },
};

const LINES = {
  poke: ['Eh, jangan ditekan-tekan!', 'Geli, tahu!', 'Saya lagi periksa karcis, lho.', 'Hmph! Kondektur juga punya perasaan.'],
  warn: ['Awas ya, nanti saya tiup peluit!', 'Sekali lagi, peluitnya bunyi!'],
  lift: ['Turunkan saya! Kereta mau berangkat!', 'Kaki saya menggantung, tahu!', 'Saya bukan koper!', 'Lepas! Karcis saya bisa jatuh!'],
  drop: ['Aduh, topi saya miring.', 'Jangan sembarangan angkat kondektur!', 'Pusing...'],
  pat: ['Hehe, enak...', 'Terima kasih, penumpang baik.', 'Mrrr... lagi dong.', 'Saya jadi semangat periksa karcis!'],
  spin: ['Wheee!', 'Putar balik di stasiun!'],
  tickle: ['Hihihi, geli!', 'Ampun, ampun!'],
  wake: ['Eh? Sudah sampai mana kita?', 'Siap! Saya tidak tidur, kok.'],
  idle: ['Kursi bisa dipesan per ruas, lho.', 'Ragu? Tekan kursi untuk lihat ruasnya.', 'Hoam... perjalanan masih panjang.'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const INK = '#2a1d17';
const SKIN = '#ffe6d6';
const IRIS_ID = (u) => `kIris${u}`;

function eye(u, cx, side) {
  const cy = 124;
  const out = side === 'L' ? -1 : 1;
  const star = [[0, -9], [2.2, -3], [8.6, -2.8], [3.5, 1.2], [5.3, 7.3], [0, 3.8], [-5.3, 7.3], [-3.5, 1.2], [-8.6, -2.8], [-2.2, -3]].map((p) => p.join(',')).join(' ');
  const lid = `<path d="M${cx - 15} ${cy - 7} Q${cx} ${cy - 27} ${cx + 15} ${cy - 7}" stroke="${INK}" stroke-width="4.4" fill="none" stroke-linecap="round"/>
    <path d="M${cx + out * 14} ${cy - 10} l${out * 5} -5M${cx + out * 16} ${cy - 4} l${out * 6} -2" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  const iris = `<ellipse cx="${cx}" cy="${cy + 1}" rx="13" ry="17" fill="url(#${IRIS_ID(u)})" stroke="#2b1a10" stroke-width="1.4"/>`;
  const shine = `<circle cx="${cx - 4.6}" cy="${cy - 6}" r="4.6" fill="#fff"/><circle cx="${cx + 5}" cy="${cy + 7}" r="2.3" fill="#fff" opacity=".92"/><circle cx="${cx + 3}" cy="${cy - 10}" r="1.3" fill="#fff" opacity=".9"/>`;
  return `<g class="kk-eye">
    <g class="e e-open ${side}"><g class="kk-look">${iris}<ellipse cx="${cx}" cy="${cy + 3}" rx="6" ry="9.5" fill="#1a0f08"/><ellipse cx="${cx}" cy="${cy + 11}" rx="6" ry="2.4" fill="#f3c98a" opacity=".55"/>${shine}</g>${lid}</g>
    <g class="e e-wet"><ellipse cx="${cx + 2}" cy="${cy + 9}" rx="7" ry="3.4" fill="#fff" opacity=".75"/><ellipse cx="${cx - 6}" cy="${cy - 1}" rx="3" ry="4.6" fill="#fff" opacity=".9"/></g>
    <g class="e e-happy ${side}"><path d="M${cx - 12} ${cy + 4} Q${cx} ${cy - 13} ${cx + 12} ${cy + 4}" stroke="${INK}" stroke-width="4.8" fill="none" stroke-linecap="round"/></g>
    <g class="e e-closed"><path d="M${cx - 12} ${cy - 1} Q${cx} ${cy + 10} ${cx + 12} ${cy - 1}" stroke="${INK}" stroke-width="4.6" fill="none" stroke-linecap="round"/></g>
    <g class="e e-annoy"><path d="M${cx - 12.5} ${cy - 1} A12.5 14 0 0 0 ${cx + 12.5} ${cy - 1}Z" fill="url(#${IRIS_ID(u)})" stroke="#2b1a10" stroke-width="1.4"/><ellipse cx="${cx}" cy="${cy + 6}" rx="4" ry="5.5" fill="#1a0f08"/><circle cx="${cx - 3}" cy="${cy + 2}" r="2" fill="#fff"/><path d="M${cx - 16} ${cy - 1}H${cx + 16}" stroke="${INK}" stroke-width="4.6" stroke-linecap="round"/></g>
    <g class="e e-sleepy"><g class="kk-look">${iris}<ellipse cx="${cx}" cy="${cy + 4}" rx="6" ry="9" fill="#1a0f08"/><circle cx="${cx - 4}" cy="${cy + 2}" r="3" fill="#fff"/></g><path d="M${cx - 16} ${cy - 9} Q${cx} ${cy - 28} ${cx + 16} ${cy - 9} L${cx + 16} ${cy + 3} Q${cx} ${cy - 2} ${cx - 16} ${cy + 3}Z" fill="${SKIN}"/><path d="M${cx - 15} ${cy + 2} Q${cx} ${cy - 3} ${cx + 15} ${cy + 2}" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/></g>
    <g class="e e-star">${iris}<polygon transform="translate(${cx} ${cy + 1})" points="${star}" fill="#fff4cf"/>${lid}</g>
    <g class="e e-heart">${iris}<path transform="translate(${cx} ${cy + 2}) scale(1.35)" d="M0 -3C-5 -10 -13 -1 0 8C13 -1 5 -10 0 -3Z" fill="#e0526e"/><circle cx="${cx - 4}" cy="${cy - 5}" r="3" fill="#fff"/>${lid}</g>
    <g class="e e-squeeze"><path d="M${cx + out * 9} ${cy - 4} L${cx - out * 7} ${cy + 5} L${cx + out * 9} ${cy + 14}" stroke="${INK}" stroke-width="4.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g class="e e-surp"><ellipse cx="${cx}" cy="${cy}" rx="14.5" ry="18.5" fill="#fff" stroke="#2b1a10" stroke-width="2"/><circle cx="${cx}" cy="${cy + 1}" r="5" fill="#1a0f08"/><circle cx="${cx - 1.8}" cy="${cy - 1}" r="1.6" fill="#fff"/></g>
  </g>`;
}

const heart = (x, y, cls) => `<g transform="translate(${x} ${y})"><path class="kk-h ${cls}" d="M0 -3C-5 -10 -13 -1 0 8C13 -1 5 -10 0 -3Z" fill="#e0526e"/></g>`;
const glove = (x, y) => `<circle cx="${x}" cy="${y}" r="10.5" fill="#fbf6ea" stroke="#c9bfa9" stroke-width="1.8"/><path d="M${x - 5} ${y - 7}v5M${x} ${y - 8.5}v6M${x + 5} ${y - 7}v5" stroke="#d8cfbb" stroke-width="1.6" stroke-linecap="round"/>`;

function svg(u) {
  return `<svg class="kk-svg" viewBox="0 -44 240 364" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kiko si kondektur">
  <defs>
    <linearGradient id="kHair${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a31"/><stop offset=".6" stop-color="#57311f"/><stop offset="1" stop-color="#3c2115"/></linearGradient>
    <linearGradient id="${IRIS_ID(u)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e7b463"/><stop offset=".5" stop-color="#b06a23"/><stop offset="1" stop-color="#5e300d"/></linearGradient>
    <linearGradient id="kCoat${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d5a49"/><stop offset="1" stop-color="#173429"/></linearGradient>
    <linearGradient id="kCap${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f5e4d"/><stop offset="1" stop-color="#16322a"/></linearGradient>
    <linearGradient id="kBrass${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dfa8"/><stop offset="1" stop-color="#b58a3f"/></linearGradient>
  </defs>
  <ellipse class="kk-shadow" cx="120" cy="306" rx="54" ry="7" fill="#000" opacity=".3"/>
  <g class="kk-all">
    <!-- rambut belakang model bob -->
    <path d="M58 118C50 66 86 44 120 44s70 22 62 74l-2 52c-8 12-18 10-22 2H82c-4 8-14 10-22-2z" fill="url(#kHair${u})"/>
    <g class="kk-tuft l"><path d="M60 138c-10 14-13 30-9 44 4 8 13 6 15-2 2-14 2-28 6-40z" fill="url(#kHair${u})"/></g>
    <g class="kk-tuft r"><path d="M180 138c10 14 13 30 9 44-4 8-13 6-15-2-2-14-2-28-6-40z" fill="url(#kHair${u})"/></g>

    <!-- lentera sinyal di pinggang -->
    <g class="kk-lantern">
      <path d="M170 246v8" stroke="#8a6a32" stroke-width="2.4"/>
      <rect x="161" y="254" width="18" height="24" rx="4" fill="#20302a" stroke="url(#kBrass${u})" stroke-width="2.2"/>
      <rect class="kk-glow" x="165" y="258" width="10" height="16" rx="2.4" fill="#ffc861"/>
      <path d="M159 278h22" stroke="url(#kBrass${u})" stroke-width="3" stroke-linecap="round"/>
    </g>

    <!-- kaki dan sepatu -->
    <g class="kk-leg l"><rect x="101" y="250" width="15" height="34" rx="6" fill="#172a24"/><path d="M95 282h27v10q0 9-9 9h-10q-8 0-8-9z" fill="#1f1512"/><path d="M95 296h27v2q0 4-9 4h-10q-8 0-8-4z" fill="#3b2a22"/><rect x="104" y="284" width="9" height="5" rx="1.5" fill="url(#kBrass${u})"/></g>
    <g class="kk-leg r"><rect x="124" y="250" width="15" height="34" rx="6" fill="#172a24"/><path d="M118 282h27v10q0 9-9 9h-10q-8 0-8-9z" fill="#1f1512"/><path d="M118 296h27v2q0 4-9 4h-10q-8 0-8-4z" fill="#3b2a22"/><rect x="127" y="284" width="9" height="5" rx="1.5" fill="url(#kBrass${u})"/></g>

    <!-- jas kondektur -->
    <g class="kk-body">
      <rect x="112" y="168" width="16" height="26" rx="6" fill="#f6d4c2"/>
      <path d="M84 196Q120 184 156 196L170 262Q120 278 70 262Z" fill="url(#kCoat${u})"/>
      <path d="M72 258Q120 274 168 258" stroke="url(#kBrass${u})" stroke-width="2.6" fill="none"/>
      <g fill="url(#kBrass${u})"><circle cx="106" cy="218" r="3.4"/><circle cx="134" cy="218" r="3.4"/><circle cx="106" cy="236" r="3.4"/><circle cx="134" cy="236" r="3.4"/><circle cx="106" cy="254" r="3.4"/><circle cx="134" cy="254" r="3.4"/></g>
      <path d="M120 200V270" stroke="#0e221b" stroke-width="2"/>
      <path d="M84 198L66 206 74 218 90 210zM156 198l18 8-8 12-16-8z" fill="url(#kBrass${u})" opacity=".92"/>
      <path d="M92 190L148 190 154 204Q120 216 86 204Z" fill="#f6efdf" stroke="#d6cbb1" stroke-width="1.4"/>
      <!-- syal -->
      <path d="M102 196q18 12 36 0l-4 12q-14 8-28 0z" fill="#8b2f2a"/>
      <path d="M114 206l-5 20 11-7 11 7-5-20z" fill="#a33a33"/>
      <!-- peluit di tali -->
      <g class="kk-whistle"><path d="M148 196q-2 22-14 30" stroke="#d6b873" stroke-width="1.8" fill="none"/><path d="M128 224h11a5 5 0 0 1 0 10h-9a6 6 0 0 1-2-10z" fill="url(#kBrass${u})" stroke="#8a6a32" stroke-width="1"/></g>
    </g>

    <!-- lengan -->
    <g class="kk-arm l"><path d="M90 202C72 208 62 222 60 240" stroke="#234a3b" stroke-width="22" stroke-linecap="round" fill="none"/><path d="M48 236l24 3" stroke="url(#kBrass${u})" stroke-width="3" stroke-linecap="round"/>${glove(59, 250)}</g>
    <g class="kk-arm r"><path d="M150 202C168 208 178 222 180 240" stroke="#234a3b" stroke-width="22" stroke-linecap="round" fill="none"/><path d="M168 239l24-3" stroke="url(#kBrass${u})" stroke-width="3" stroke-linecap="round"/>${glove(181, 250)}
      <!-- karcis di tangan -->
      <g class="kk-ticket"><rect x="186" y="238" width="30" height="19" rx="2.5" fill="#f6efdf" stroke="#c9b892" stroke-width="1.4" transform="rotate(-14 200 248)"/><path d="M192 248l18-4M193 253l11-2.5" stroke="#b49a68" stroke-width="1.6" stroke-linecap="round"/></g>
    </g>

    <!-- kepala -->
    <g class="kk-head">
      <path d="M62 112C62 76 88 58 120 58s58 18 58 54c0 38-22 64-58 68-36-4-58-30-58-68z" fill="${SKIN}"/>
      <ellipse class="kk-blush" cx="88" cy="143" rx="11" ry="6" fill="#ec8a8e"/><ellipse class="kk-blush" cx="152" cy="143" rx="11" ry="6" fill="#ec8a8e"/>
      ${eye(u, 96, 'L')}${eye(u, 144, 'R')}
      <path d="M120 139l1.6 2.4" stroke="#d9a690" stroke-width="2" stroke-linecap="round"/>
      <g class="b b-norm"><path d="M84 101Q96 95 110 100M130 100Q144 95 156 101" stroke="#4a2a19" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="b b-up"><path d="M84 95Q96 88 110 93M130 93Q144 88 156 95" stroke="#4a2a19" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="b b-sad"><path d="M84 105L110 97M156 105L130 97" stroke="#4a2a19" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="b b-angry"><path d="M84 95L110 106M156 95L130 106" stroke="#3c2115" stroke-width="3.6" fill="none" stroke-linecap="round"/></g>
      <g class="m m-smile"><path d="M110 151Q120 161 130 151" stroke="#a64450" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="m m-open"><path d="M107 149H133Q131 168 120 168T107 149Z" fill="#7c2a38"/><ellipse cx="120" cy="163" rx="7" ry="3.4" fill="#ec8a8e"/></g>
      <g class="m m-grin"><path d="M108 150Q120 157 132 150Q129 163 120 163T108 150Z" fill="#7c2a38"/><path d="M110 151Q120 156 130 151" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>
      <g class="m m-o"><ellipse cx="120" cy="157" rx="5.5" ry="7.5" fill="#7c2a38"/></g>
      <g class="m m-frown"><path d="M110 161Q120 150 130 161" stroke="#a64450" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="m m-grump"><path d="M109 158Q114.5 150 120 158T131 158" stroke="#a64450" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g class="m m-pout"><path d="M108 156Q114 150 120 156T132 156" stroke="#a64450" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <g class="m m-wavy"><path d="M108 155Q112 150 116 155T124 155T132 155" stroke="#a64450" stroke-width="3" fill="none" stroke-linecap="round"/></g>
      <g class="m m-cat"><path d="M107 150Q113.5 161 120 152Q126.5 161 133 150" stroke="#a64450" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g class="m m-flat"><path d="M112 156H128" stroke="#a64450" stroke-width="3.2" stroke-linecap="round"/></g>
      <g class="m m-whistle"><path d="M112 153h20a6 6 0 0 1 0 12h-18a7 7 0 0 1-2-12z" fill="url(#kBrass${u})" stroke="#8a6a32" stroke-width="1.4"/><circle cx="130" cy="159" r="2.6" fill="#7a5a26"/></g>

      <!-- poni -->
      <path d="M60 106C58 76 84 66 120 66s62 10 60 40l-5-2-7 10-9-10-11 12-10-11-10 11-10-11-11 12-9-12-7 10z" fill="url(#kHair${u})"/>
      <path d="M60 100c-4 22-4 42-1 56 7 5 12 0 12-8-2-20-2-34 0-50zM180 100c4 22 4 42 1 56-7 5-12 0-12-8 2-20 2-34 0-50z" fill="url(#kHair${u})"/>

      <!-- topi kondektur -->
      <g class="kk-cap">
        <path d="M56 78C54 44 86 26 120 26s66 18 64 52q-64 10-128 0z" fill="url(#kCap${u})"/>
        <path d="M56 70q64 11 128 0v10q-64 11-128 0z" fill="url(#kBrass${u})"/>
        <path d="M52 80q68 14 136 0c6 10 2 16-8 17q-60 8-120 0c-10-1-14-7-8-17z" fill="#14100d"/>
        <path d="M66 89q54 8 108 0" stroke="#433a33" stroke-width="2" fill="none"/>
        <g transform="translate(120 52)"><circle r="11" fill="#1a342b" stroke="url(#kBrass${u})" stroke-width="2.4"/><circle r="3.4" fill="url(#kBrass${u})"/><path d="M0-8V8M-8 0H8M-5.6-5.6L5.6 5.6M5.6-5.6L-5.6 5.6" stroke="url(#kBrass${u})" stroke-width="1.5"/><path d="M-12-3q-11-6-17-1 6 1 8 4-5 0-7 3 8 2 16-1zM12-3q11-6 17-1-6 1-8 4 5 0 7 3-8 2-16-1z" fill="url(#kBrass${u})"/></g>
      </g>

      <!-- efek ekspresi -->
      <path class="x x-sweat" d="M172 92c-6 9-7 15-1 18 6 2 9-3 7-9z" fill="#9bd6ee" stroke="#fff" stroke-width="1"/>
      <path class="x x-tear" d="M88 146c-4 8-5 13-.5 15 5 1 7-4 4.5-9z" fill="#9bd6ee" stroke="#fff" stroke-width="1"/>
      <g class="x x-vein" stroke="#d9453c" stroke-width="3.4" stroke-linecap="round" fill="none"><path d="M172 104Q178 106 178 112M188 104Q182 106 182 112M172 124Q178 122 178 116M188 124Q182 122 182 116"/></g>
      <g class="x x-alert"><rect x="112" y="-38" width="16" height="30" rx="7" fill="#d9453c"/><circle cx="120" cy="2" r="5.5" fill="#d9453c"/></g>
      <g class="x x-quest"><path d="M170 8c0-10 8-16 17-16s16 6 16 14c0 11-14 11-14 22" stroke="#e6cd94" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="189" cy="38" r="3.8" fill="#e6cd94"/></g>
      <g class="x x-think"><circle cx="186" cy="52" r="4" fill="#f4efe3"/><circle cx="198" cy="36" r="6" fill="#f4efe3"/><circle cx="214" cy="16" r="9" fill="#f4efe3"/></g>
      <g class="x x-zzz" fill="#e6cd94" font-family="Bodoni Moda,serif" font-weight="600"><text class="z z1" x="178" y="56" font-size="16">z</text><text class="z z2" x="192" y="34" font-size="22">z</text><text class="z z3" x="208" y="8" font-size="28">z</text></g>
      <g class="x x-sparkle" fill="#f4dfa8"><path class="kk-sp s1" d="M36 70l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path class="kk-sp s2" d="M206 74l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z"/><path class="kk-sp s3" d="M128 -14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></g>
      <g class="x x-hearts">${heart(84, 34, 'h1')}${heart(120, 16, 'h2')}${heart(158, 34, 'h3')}</g>
      <g class="x x-notes" fill="#f4dfa8" font-family="Bodoni Moda,serif" font-size="26"><text class="n n1" x="166" y="150">♪</text><text class="n n2" x="186" y="134">♫</text><text class="n n3" x="204" y="154">♪</text></g>

      <!-- tangan menutup mata saat kata sandi diketik -->
      <g class="kk-cover"><rect x="78" y="110" width="36" height="28" rx="13" fill="#fbf6ea" stroke="#c9bfa9" stroke-width="2"/><rect x="126" y="110" width="36" height="28" rx="13" fill="#fbf6ea" stroke="#c9bfa9" stroke-width="2"/><path d="M86 114v20M94 112v24M102 112v24M134 112v24M142 112v24M150 114v20" stroke="#d8cfbb" stroke-width="2" stroke-linecap="round"/></g>
    </g>

    <!-- tangan pengelus -->
    <g class="kk-hand"><rect x="102" y="-34" width="36" height="28" rx="14" fill="#fbf6ea" stroke="#c9bfa9" stroke-width="2"/><rect x="111" y="-10" width="18" height="12" rx="4" fill="#8b2f2a"/></g>
  </g></svg>`;
}

/** Kereta dan uap yang melintas setelah Kiko meniup peluit. Dilewati bila pengguna memilih kurangi gerakan. */
function trainPass() {
  if (reduceMotion()) return;
  let o = document.getElementById('kk-pass');
  if (o) return;
  o = document.createElement('div');
  o.id = 'kk-pass';
  o.setAttribute('aria-hidden', 'true');
  o.innerHTML = `<svg viewBox="0 0 640 120" xmlns="http://www.w3.org/2000/svg">
    <g class="puffs"><circle cx="560" cy="18" r="14"/><circle cx="600" cy="8" r="19"/><circle cx="640" cy="20" r="13"/></g>
    <path d="M0 110H640" stroke="#c8a25e" stroke-width="3"/>
    <g fill="#14231e" stroke="#c8a25e" stroke-width="2">
      <rect x="12" y="46" width="130" height="54" rx="8"/><rect x="152" y="46" width="130" height="54" rx="8"/><rect x="292" y="46" width="130" height="54" rx="8"/>
      <path d="M432 100V46h110q40 2 58 54z"/>
    </g>
    <g fill="#ffc861">${[28, 60, 92, 168, 200, 232, 308, 340, 372, 452, 488].map((x) => `<rect x="${x}" y="58" width="22" height="16" rx="2"/>`).join('')}</g>
    <path d="M540 58h22q14 2 22 16h-44z" fill="#ffe7ad"/>
    <g fill="#0a0f0d" stroke="#c8a25e" stroke-width="2">${[36, 110, 176, 250, 316, 390, 460, 540].map((x) => `<circle cx="${x}" cy="102" r="8"/>`).join('')}</g>
  </svg>`;
  document.body.append(o);
  document.body.classList.add('kk-rumble');
  Sound.play('horn');
  Sound.play('chug');
  setTimeout(() => { o.remove(); document.body.classList.remove('kk-rumble'); }, 2500);
}

let lastInteract = Date.now();
const registry = [];

function build(host, opts = {}) {
  host.classList.add('kiko');
  host.innerHTML = `<div class="kk-say" aria-live="polite"></div><div class="kk-stage"><div class="kk-drag">${svg(++uid)}</div></div>`;
  const stage = host.querySelector('.kk-stage');
  const drag = host.querySelector('.kk-drag');
  const say = host.querySelector('.kk-say');
  const look = [...host.querySelectorAll('.kk-look')];
  const state = { held: false, lifted: false, x0: 0, y0: 0, timer: 0, sayTimer: 0, poseTimer: 0, pats: 0, holdTimer: 0, lastTap: 0, target: null, asleep: false, taps: 0, tapAt: 0, blowing: false };
  const inst = { el: host, state };

  const setLook = (x, y) => look.forEach((l) => { l.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`; });

  inst.mood = (name, ms) => {
    const m = MOODS[name] || MOODS.idle;
    host.dataset.eyes = m.eyes;
    host.dataset.mouth = m.mouth;
    host.dataset.brow = m.brow;
    host.dataset.fx = m.fx;
    host.dataset.pose = m.pose || '';
    host.dataset.m = name;
    state.asleep = name === 'sleepy';
    clearTimeout(state.timer);
    if (ms) state.timer = setTimeout(() => { if (!state.held && !host.classList.contains('patting')) inst.mood('idle'); }, ms);
  };
  inst.pose = (name, ms) => {
    host.dataset.pose = name || '';
    clearTimeout(state.poseTimer);
    if (ms) state.poseTimer = setTimeout(() => { if (host.dataset.pose === name) host.dataset.pose = MOODS[host.dataset.m]?.pose || ''; }, ms);
  };
  inst.say = (text, ms = 3000) => {
    if (!text) return;
    say.textContent = text;
    say.classList.add('show');
    clearTimeout(state.sayTimer);
    state.sayTimer = setTimeout(() => say.classList.remove('show'), ms);
  };
  const aimAt = (el) => {
    const r = host.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height * 0.4);
    const d = Math.max(1, Math.hypot(dx, dy));
    const k = Math.min(1, d / 220);
    setLook((dx / d) * 3 * k, (dy / d) * 3 * k);
  };
  inst.lookAt = (el) => { state.target = el || null; if (el) aimAt(el); else setLook(0, 0); };
  inst.peek = (on) => { if (on) inst.mood('peek'); else if (host.dataset.m === 'peek') inst.mood('idle'); };
  inst.wake = () => {
    if (state.asleep) {
      inst.mood('alert', 900);
      inst.say(pick(LINES.wake), 2200);
      Sound.play('surprise');
      setTimeout(() => inst.mood('idle'), 950);
    }
    lastInteract = Date.now();
  };
  inst.mood('idle');

  function blowWhistle() {
    state.blowing = true;
    host.classList.add('blowing');
    inst.mood('whistle');
    inst.say('PRIIIIT! Kereta mau lewat!', 2400);
    Sound.play('whistle');
    setTimeout(trainPass, 750);
    setTimeout(() => {
      host.classList.remove('blowing');
      state.blowing = false;
      inst.mood('annoyed', 2600);
      inst.say('Nah, jangan ditekan terus, ya!', 3000);
    }, 2200);
  }

  const onMove = (e) => {
    if (coarse() || state.target || state.asleep) return;
    const r = host.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height * 0.4);
    const d = Math.max(1, Math.hypot(dx, dy));
    const k = Math.min(1, d / 260);
    setLook((dx / d) * 2.8 * k, (dy / d) * 2.8 * k);
    if (!state.held) host.style.setProperty('--tilt', d < r.width * 1.1 ? `${((dx / r.width) * 6).toFixed(2)}deg` : '0deg');
  };
  document.addEventListener('pointermove', onMove, { passive: true });

  stage.addEventListener('pointerenter', () => {
    if (coarse() || state.held) return;
    if (state.asleep) { inst.wake(); return; }
    if (host.dataset.m === 'idle') { inst.mood('happy', 1400); Sound.play('chirp'); }
    lastInteract = Date.now();
  });
  stage.addEventListener('pointerdown', (e) => {
    lastInteract = Date.now();
    if (state.blowing) return;
    if (state.asleep) { inst.wake(); return; }
    state.held = true;
    state.lifted = false;
    state.x0 = e.clientX;
    state.y0 = e.clientY;
    host.classList.add('held');
    inst.mood('annoyed');
    try { stage.setPointerCapture(e.pointerId); } catch { /* diabaikan */ }
    Sound.play('squeak');
    clearTimeout(state.holdTimer);
    state.holdTimer = setTimeout(() => {
      if (state.held && !state.lifted) { inst.mood('giggle'); inst.say(pick(LINES.tickle), 1800); Sound.play('giggle'); host.classList.add('tickle'); }
    }, 650);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!state.held) return;
    const dx = e.clientX - state.x0;
    const dy = e.clientY - state.y0;
    if (!state.lifted && Math.hypot(dx, dy) > 10) {
      clearTimeout(state.holdTimer);
      host.classList.remove('tickle');
      state.lifted = true;
      host.classList.add('lifted');
      host.dataset.pose = 'lifted';
      inst.mood('lifted');
      inst.say(pick(LINES.lift), 2200);
      Sound.play('huff');
    }
    if (state.lifted) drag.style.transform = `translate(${Math.max(-90, Math.min(90, dx))}px,${Math.max(-110, Math.min(70, dy))}px) rotate(${Math.max(-14, Math.min(14, dx / 8))}deg)`;
  });
  const release = () => {
    if (!state.held) return;
    clearTimeout(state.holdTimer);
    const wasLifted = state.lifted;
    const wasTickled = host.classList.contains('tickle');
    state.held = false;
    state.lifted = false;
    host.classList.remove('held', 'lifted', 'tickle');
    host.dataset.pose = '';
    drag.style.transform = '';
    const now = Date.now();
    if (!wasLifted && !wasTickled) {
      state.taps = now - state.tapAt < 8000 ? state.taps + 1 : 1;
      state.tapAt = now;
      if (state.taps >= 5) { state.taps = 0; state.lastTap = 0; blowWhistle(); return; }
    }
    if (wasLifted) { Sound.play('drop'); inst.say(pick(LINES.drop), 3000); inst.mood('annoyed', 1800); Sound.play('hmph'); }
    else if (wasTickled) inst.mood('happy', 1200);
    else if (now - state.lastTap < 320 && state.taps <= 2) {
      state.lastTap = 0;
      inst.mood('cheer', 1500);
      inst.pose('spin', 900);
      inst.say(pick(LINES.spin), 1800);
      Sound.play('whee');
      return;
    } else {
      inst.say(state.taps >= 3 ? pick(LINES.warn) : pick(LINES.poke), 2400);
      inst.mood('annoyed', 1500);
      Sound.play('hmph');
    }
    state.lastTap = now;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  /* Tingkah otonom */
  const tick = () => {
    if (document.hidden || !host.isConnected) return;
    const idleFor = Date.now() - lastInteract;
    const m = host.dataset.m;
    if (idleFor > 60000 && m === 'idle') { inst.mood('sleepy'); Sound.play('yawn'); return; }
    if (m !== 'idle' || state.held || state.target) return;
    const r = Math.random();
    if (r < 0.35) { setLook(r < 0.18 ? -3 : 3, -1); setTimeout(() => { if (!state.target) setLook(0, 0); }, 900 + Math.random() * 700); }
    else if (r < 0.55) { host.classList.add('blink2'); setTimeout(() => host.classList.remove('blink2'), 700); }
    else if (r < 0.7) { host.classList.add('wiggle'); setTimeout(() => host.classList.remove('wiggle'), 1200); }
    else if (r < 0.8) inst.pose('hop', 700);
    else if (r < 0.88 && idleFor > 15000 && opts.chatty) { inst.say(pick(LINES.idle), 3200); inst.mood('wink', 1800); }
  };
  if (!reduceMotion()) state.idleTimer = setInterval(tick, 5200 + Math.random() * 3000);

  if (opts.pat) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kk-pat';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg><span>Elus Kiko</span><b class="cnt"></b>';
    host.append(btn);
    btn.addEventListener('click', () => {
      lastInteract = Date.now();
      if (host.classList.contains('patting')) return;
      state.pats += 1;
      host.classList.add('patting');
      inst.mood(state.pats % 3 === 0 ? 'love' : 'pat');
      Sound.play('pat');
      setTimeout(() => Sound.play('purr'), 380);
      inst.say(pick(LINES.pat), 2600);
      btn.querySelector('.cnt').textContent = `x${state.pats}`;
      setTimeout(() => { host.classList.remove('patting'); inst.mood('happy', 1400); }, 2100);
    });
  }
  inst.destroy = () => {
    clearInterval(state.idleTimer);
    clearTimeout(state.timer);
    clearTimeout(state.sayTimer);
    document.removeEventListener('pointermove', onMove);
    const i = registry.indexOf(inst);
    if (i >= 0) registry.splice(i, 1);
  };
  registry.push(inst);
  return inst;
}

['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => {
  lastInteract = Date.now();
  registry.forEach((i) => { if (i.state.asleep) i.wake(); });
}, { passive: true, capture: true }));

/** Reaksi siap pakai untuk kejadian di aplikasi. Selalu menuju instans utama yang sedang tampil. */
const REACT = {
  halo: ['wink', null, 2600, null],
  pilih: ['happy', null, 1200, null],
  sukses: ['cheer', null, 2600, 'success'],
  gagal: ['sad', null, 3200, 'fail'],
  bingung: ['confused', null, 2800, null],
  mikir: ['thinking', null, 0, null],
  awas: ['alert', null, 2400, 'surprise'],
  cemas: ['worried', null, 3000, null],
  bangga: ['proud', null, 2600, null],
};

const main = () => registry[registry.length - 1];

export const Kiko = {
  mount: (host, opts) => build(host, opts),
  mood: (n, ms) => main()?.mood(n, ms),
  say: (t, ms) => main()?.say(t, ms),
  lookAt: (el) => main()?.lookAt(el),
  peek: (on) => main()?.peek(on),
  react(kind, text, ms) {
    const r = REACT[kind];
    const m = main();
    if (!r || !m) return;
    m.mood(r[0], ms ?? r[2]);
    if (text) m.say(text, ms || r[2] || 3000);
    if (r[3]) Sound.play(r[3]);
  },
  greeting() {
    const h = Number(new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(new Date()));
    const part = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
    return `Selamat ${part}! Saya Kiko, kondektur Anda.`;
  },
};
