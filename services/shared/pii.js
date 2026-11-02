'use strict';
/** Enkripsi kolom sensitif (AES-256-GCM) dan blind index untuk pencarian tanpa membuka enkripsi. */
const crypto = require('node:crypto');

const key = () => {
  const k = Buffer.from(process.env.PII_KEY_BASE64 || '', 'base64');
  if (k.length !== 32) throw new Error('PII_KEY_BASE64 harus 32 byte dalam base64. Jalankan scripts/setup.js.');
  return k;
};

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
}

function decrypt(blob) {
  const raw = Buffer.from(String(blob).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const blindIndex = (text) => crypto.createHmac('sha256', process.env.BLIND_INDEX_KEY || 'dev').update(String(text).trim().toLowerCase()).digest('hex');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = { encrypt, decrypt, blindIndex, sha256, randomToken, safeEqual };
