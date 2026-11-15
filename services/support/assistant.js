'use strict';
/** Logika asisten yang tidak bergantung jaringan: penyamaran data pribadi, pencarian FAQ, dan susunan prompt. Diuji unit test. */
const { FAQ, APP_FACTS } = require('./knowledge');

/** Data pribadi disamarkan sebelum pesan dikirim ke penyedia AI. */
function redact(text) {
  return String(text)
    .replace(/\b\d{16}\b/g, '[NIK disamarkan]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email disamarkan]')
    .replace(/(\+62|62|0)8\d{7,11}\b/g, '[nomor disamarkan]');
}

const words = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const STOP = new Set(['yang', 'dan', 'atau', 'untuk', 'dengan', 'saya', 'apa', 'bagaimana', 'kenapa', 'apakah', 'bisa', 'ini', 'itu', 'ada', 'tidak', 'mau', 'kalau', 'gimana', 'cara']);

function faqWith(seniorPercent) {
  return FAQ.map((c) => ({ id: c.id, title: c.title, items: c.items.map(([q, a, k], i) => ({ id: `${c.id}-${i}`, q, a: a.replaceAll('{SENIOR}', String(seniorPercent)), keywords: k })) }));
}

/** Jawaban cadangan: FAQ dengan kata kunci paling banyak cocok. */
function searchFaq(question, seniorPercent) {
  const q = new Set(words(question).filter((w) => !STOP.has(w)));
  let best = null;
  for (const c of faqWith(seniorPercent)) {
    for (const item of c.items) {
      const pool = new Set([...words(item.q), ...words(item.keywords)]);
      let score = 0;
      for (const w of q) if (pool.has(w)) score += 1;
      if (!best || score > best.score) best = { score, item };
    }
  }
  return best && best.score >= 1 ? best.item : null;
}

function systemPrompt({ seniorPercent, trains, stations }) {
  const faqText = faqWith(seniorPercent).map((c) => `## ${c.title}\n${c.items.map((i) => `T: ${i.q}\nJ: ${i.a}`).join('\n')}`).join('\n\n');
  const trainText = trains.map((t) => `- ${t.name} (${t.number}): ${t.route.map((r) => r.station.name).join(' - ')}. Kelas: ${t.classes.join(', ')}. Berangkat dari ${t.origin.name}: ${t.departures.join(', ') || 'tidak ada jadwal'}.`).join('\n');
  return `Kamu adalah Kiko, kondektur chibi yang ramah dan asisten Pusat Bantuan aplikasi Rangkai.
Jawab dalam Bahasa Indonesia yang hangat, jelas, dan singkat (umumnya 2 sampai 5 kalimat, boleh pakai poin bila menjelaskan langkah). Sapa pengguna dengan "Anda". Langsung ke inti jawaban tanpa slogan pembuka seperti "Choo-choo", dan pakai paling banyak satu emoji. Format yang boleh dipakai hanya **tebal** dan daftar berawalan "- ".
Aturan:
1. Jawab hanya hal yang berkaitan dengan Rangkai, perjalanan kereta, atau cara memakai aplikasi. Untuk topik lain, tolak dengan sopan lalu arahkan kembali.
2. Gunakan fakta di bawah. Jangan mengarang jadwal, harga pasti, ketersediaan kursi, atau kebijakan yang tidak tertulis. Untuk ketersediaan kursi dan harga pasti, arahkan ke halaman Cari Tiket.
3. Jangan pernah meminta kata sandi, kode OTP, atau NIK lengkap. Bila pengguna mengirim data pribadi, ingatkan agar tidak membagikannya.
4. Bila tidak tahu atau masalahnya butuh pemeriksaan akun (misalnya status transfer tertentu), katakan terus terang dan sarankan menghubungi admin atau membuka Perjalanan saya.
5. Jangan mengaku manusia. Jangan menjanjikan tindakan yang tidak bisa kamu lakukan, karena kamu tidak bisa mengubah pesanan.
6. Sistem ini lingkungan demo untuk tugas kuliah, dan pembayaran bersifat simulasi.

# Fakta aplikasi
${APP_FACTS.replaceAll('{SENIOR}', String(seniorPercent))}

# Kereta yang beroperasi saat ini
${trainText || '- (data kereta sedang tidak tersedia)'}

# Stasiun
${stations.map((s) => `${s.name} (${s.code}, ${s.city})`).join('; ')}

# FAQ resmi
${faqText}`;
}

module.exports = { redact, searchFaq, faqWith, systemPrompt };
