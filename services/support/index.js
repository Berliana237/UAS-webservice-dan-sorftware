'use strict';
/**
 * Support service: FAQ Pusat Bantuan dan asisten AI (Gemini).
 * Asisten dibekali fakta aplikasi, FAQ, dan data kereta terkini dari catalog-service.
 * Bila Gemini tidak bisa dihubungi, jawaban diambil dari FAQ supaya pengguna tetap terbantu.
 */
const config = require('../shared/config');
const { createApp, finish, ApiError } = require('../shared/http');
const { kit } = require('../shared/boot');
const mtls = require('../shared/mtls');
const { redact, searchFaq, faqWith, systemPrompt } = require('./assistant');

const { log, registry } = kit('support');
const app = createApp('support', log, { jsonLimit: '32kb' });

const PRIMARY = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK = 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 25000;
const CHAT_BUDGET_MS = Number(process.env.SUPPORT_CHAT_BUDGET_MS || 12000);

/* ---------- Data terkini dari catalog, di-cache 5 menit ---------- */
let context = { at: 0, trains: [], stations: [], seniorPercent: 10 };
async function liveContext() {
  if (Date.now() - context.at < 300000 && context.trains.length) return context;
  try {
    const [t, s, p] = await Promise.all([
      registry.call('catalog', '/api/trains', { timeout: 4000 }),
      registry.call('catalog', '/api/stations', { timeout: 4000 }),
      registry.call('catalog', '/api/pricing', { timeout: 4000 }),
    ]);
    context = { at: Date.now(), trains: t.json?.trains || [], stations: s.json?.stations || [], seniorPercent: p.json?.seniorDiscountPercent ?? 10 };
  } catch (e) {
    log.warn('data catalog tidak tersedia untuk asisten', { err: e.message });
  }
  return context;
}

async function askGemini(model, system, messages, timeoutMs = TIMEOUT_MS) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('<')) throw new Error('GEMINI_API_KEY belum diisi');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message?.slice(0, 120) || 'gagal'}`);
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error(`Gemini tidak memberi jawaban (${j.candidates?.[0]?.finishReason || 'kosong'})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/support/faq', async (_req, res) => {
  const ctx = await liveContext();
  res.json({ categories: faqWith(ctx.seniorPercent).map((c) => ({ id: c.id, title: c.title, items: c.items.map(({ id, q, a, keywords }) => ({ id, q, a, keywords })) })) });
});

app.post('/api/support/chat', async (req, res) => {
  const list = Array.isArray(req.body?.messages) ? req.body.messages : null;
  if (!list || !list.length || list.length > 20) throw new ApiError(422, 'VALIDATION_FAILED', 'Kirim 1 sampai 20 pesan.');
  for (const m of list) {
    if (!['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 1000) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Setiap pesan berisi role user atau assistant dan teks 1 sampai 1000 karakter.');
    }
  }
  if (list[list.length - 1].role !== 'user') throw new ApiError(422, 'VALIDATION_FAILED', 'Pesan terakhir harus dari pengguna.');
  // Hanya 8 pesan terakhir yang dikirim, dan data pribadi disamarkan dulu.
  const messages = list.slice(-8).map((m) => ({ role: m.role, content: redact(m.content.trim()) }));
  const question = messages[messages.length - 1].content;
  const ctx = await liveContext();
  const system = systemPrompt(ctx);
  // Anggaran waktu total 12 detik (di bawah batas gateway): model utama, lalu cadangan dengan sisa waktu,
  // lalu FAQ. Pengguna selalu mendapat jawaban, tidak pernah tertahan sampai gateway memutus permintaan.
  const deadline = Date.now() + CHAT_BUDGET_MS;
  for (const model of [PRIMARY, FALLBACK]) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const reply = await askGemini(model, system, messages, model === PRIMARY ? Math.min(left - 2500, 9000) : left);
      return res.json({ reply, source: 'gemini', model });
    } catch (e) {
      log.warn('asisten AI gagal, mencoba cadangan', { model, err: e.message });
    }
  }
  const hit = searchFaq(question, ctx.seniorPercent);
  res.json({
    reply: hit ? `${hit.a}\n\n(Asisten AI sedang tidak tersedia, jadi ini jawaban dari FAQ yang paling mendekati.)`
      : 'Maaf, asisten AI sedang tidak tersedia dan saya belum menemukan jawaban yang cocok di FAQ. Coba lihat daftar pertanyaan di atas, atau hubungi admin Rangkai.',
    source: 'faq',
    matched: hit ? hit.q : null,
  });
});

finish(app, log);
mtls.createServer('support', app, config.ports.support, log);
registry.register('support', config.selfUrl('support', config.ports.support), { role: 'support-assistant' });
