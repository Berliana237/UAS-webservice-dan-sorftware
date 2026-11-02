'use strict';
/** Tanda tangan webhook: HMAC-SHA256 atas "timestamp.body", dengan toleransi waktu untuk mencegah replay. */
const crypto = require('node:crypto');

const TOLERANCE_MS = 5 * 60 * 1000;

function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function verify(secret, header, rawBody, now = Date.now()) {
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(String(header || ''));
  if (!m) return { ok: false, reason: 'format' };
  const ts = Number(m[1]);
  if (Math.abs(now - ts) > TOLERANCE_MS) return { ok: false, reason: 'timestamp' };
  const expected = Buffer.from(sign(secret, ts, rawBody));
  const given = Buffer.from(m[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'signature' };
  return { ok: true };
}

const header = (secret, rawBody, now = Date.now()) => `t=${now},v1=${sign(secret, now, rawBody)}`;

/** Mendeteksi nomor kartu (Luhn) agar data kartu mentah tidak pernah diterima sistem. */
function looksLikePan(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0; let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

module.exports = { sign, verify, header, looksLikePan, TOLERANCE_MS };
