'use strict';
/**
 * Persiapan sekali jalan (idempoten): membuat .env dengan secret acak, sertifikat mTLS,
 * dan environment Postman lokal. Aman dijalankan berulang, file yang sudah ada tidak ditimpa.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { generateCerts } = require('./gen-certs');

const ROOT = path.resolve(__dirname, '..');
const envFile = path.join(ROOT, '.env');
const hex = (n = 32) => crypto.randomBytes(n).toString('hex');

function ensureEnv() {
  if (fs.existsSync(envFile)) return false;
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const filled = example
    .replace('PII_KEY_BASE64=<base64-32-byte>', `PII_KEY_BASE64=${crypto.randomBytes(32).toString('base64')}`)
    .replace('BLIND_INDEX_KEY=<random-hex>', `BLIND_INDEX_KEY=${hex()}`)
    .replace('WEBHOOK_SECRET=<random-hex>', `WEBHOOK_SECRET=${hex()}`)
    .replace('SVC_PAYMENT_CLIENT_SECRET=<random-hex>', `SVC_PAYMENT_CLIENT_SECRET=${hex()}`)
    .replace('SVC_BOOKING_CLIENT_SECRET=<random-hex>', `SVC_BOOKING_CLIENT_SECRET=${hex()}`)
    .replace('PARTNER_DEMO_CLIENT_SECRET=<random-hex>', `PARTNER_DEMO_CLIENT_SECRET=${hex()}`)
    .replace('SEED_USER_PASSWORD=<password-demo>', 'SEED_USER_PASSWORD=Rangkai2026!');
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
    customerEmail: 'customer@rangkai.test', customer2Email: 'customer2@rangkai.test', operatorEmail: 'operator@rangkai.test', adminEmail: 'admin@rangkai.test',
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
  if (!fs.existsSync(path.join(certDir, 'ca.crt'))) { generateCerts(certDir); console.log('[OK] Sertifikat mTLS dibuat di folder certs.'); } else console.log('[OK] Sertifikat mTLS sudah ada.');
  console.log(`[OK] Environment Postman: ${path.relative(ROOT, writePostmanEnv())}`);
}

if (require.main === module) main();
module.exports = { main, writePostmanEnv, parseEnv };
