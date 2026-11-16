'use strict';
/**
 * Persiapan sekali jalan (idempoten): membuat .env dengan secret acak, sertifikat mTLS,
 * dan environment Postman lokal. Aman dijalankan berulang, file yang sudah ada tidak ditimpa.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateCerts, SERVICES } = require('./gen-certs');

const ROOT = path.resolve(__dirname, '..');
const envFile = path.join(ROOT, '.env');
const hex = (n = 32) => crypto.randomBytes(n).toString('hex');

function ensureEnv() {
  // Di platform (Railway) secret datang dari environment. Jangan buat .env acak: kunci PII harus tetap sama antar deploy.
  if (fs.existsSync(envFile) || process.env.PII_KEY_BASE64) return false;
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const filled = example
    .replace('PII_KEY_BASE64=<base64-32-byte>', `PII_KEY_BASE64=${crypto.randomBytes(32).toString('base64')}`)
    .replace('BLIND_INDEX_KEY=<random-hex>', `BLIND_INDEX_KEY=${hex()}`)
    .replace('WEBHOOK_SECRET=<random-hex>', `WEBHOOK_SECRET=${hex()}`)
    .replace('SVC_PAYMENT_CLIENT_SECRET=<random-hex>', `SVC_PAYMENT_CLIENT_SECRET=${hex()}`)
    .replace('SVC_BOOKING_CLIENT_SECRET=<random-hex>', `SVC_BOOKING_CLIENT_SECRET=${hex()}`)
    .replace('PARTNER_DEMO_CLIENT_SECRET=<random-hex>', `PARTNER_DEMO_CLIENT_SECRET=${hex()}`)
    .replace('SEED_USER_PASSWORD=<password-demo>', 'SEED_USER_PASSWORD=Rangkai2026!')
    // Lingkungan lokal adalah lingkungan uji: akun penguji memakai kata sandi yang sama dengan deployment dan reset data uji aktif.
    .replace('TESTER_PASSWORD=<password-penguji>', 'TESTER_PASSWORD=PengujiB-Rangkai26')
    .replace('TEST_RESET_ENABLED=0', 'TEST_RESET_ENABLED=1');
  fs.writeFileSync(envFile, filled, { mode: 0o600 });
  return true;
}

function parseEnv() {
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
}

/** Environment Postman berisi secret lokal hasil setup. Berkas ini tidak untuk dibagikan. */
function writePostmanEnv(baseUrl = 'http://localhost:8080', suffix = 'local') {
  const env = parseEnv();
  const values = {
    baseUrl, webhookSecret: env.WEBHOOK_SECRET, partnerClientSecret: env.PARTNER_DEMO_CLIENT_SECRET, seedPassword: env.SEED_USER_PASSWORD,
    masinisEmail: 'masinis@rangkai.test', adminEmail: 'admin@rangkai.test',
  };
  const file = path.join(ROOT, 'postman', `Rangkai.${suffix}.postman_environment.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    id: crypto.randomUUID(), name: `Rangkai (${suffix})`, _postman_variable_scope: 'environment',
    values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: /secret|password/i.test(key) ? 'secret' : 'default' })),
  }, null, 2));
  return file;
}

function main() {
  const created = ensureEnv();
  console.log(created ? '[OK] .env dibuat dengan secret acak.' : '[OK] .env sudah ada.');
  const certDir = path.join(ROOT, 'certs');
  // Kunci CA tidak disimpan, jadi bila ada satu sertifikat service yang hilang (mis. service baru), semua dibuat ulang.
  const missing = ['ca', ...SERVICES, 'rogue'].filter((n) => !fs.existsSync(path.join(certDir, `${n}.crt`)));
  if (missing.length) { generateCerts(certDir); console.log(`[OK] Sertifikat mTLS dibuat di folder certs (${missing.join(', ')} belum ada).`); } else console.log('[OK] Sertifikat mTLS sudah lengkap.');
  if (fs.existsSync(envFile)) console.log(`[OK] Environment Postman: ${path.relative(ROOT, writePostmanEnv())}`);
}

if (require.main === module) main();
module.exports = { main, writePostmanEnv, parseEnv };
