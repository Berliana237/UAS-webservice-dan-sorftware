'use strict';
/** Logger JSON dengan masking: token, password, NIK, email, dan kontak tidak pernah tertulis utuh di log. */
const SENSITIVE_KEY = /pass|secret|token|authorization|cookie|nik|phone|email|card|api.?key|verifier/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const LONG_DIGITS = /\b\d{12,19}\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const APIKEY = /rk_(live|test)_[A-Za-z0-9_-]+/g;

function maskString(s) {
  return String(s)
    .replace(BEARER, 'Bearer ***')
    .replace(APIKEY, 'rk_***')
    .replace(EMAIL, '$1***@$2')
    .replace(LONG_DIGITS, (d) => `${d.slice(0, 4)}********${d.slice(-2)}`);
}

function mask(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (typeof value === 'string') return maskString(value);
  if (Array.isArray(value)) return value.map((v) => mask(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '***' : mask(v, depth + 1)]));
  }
  return value;
}

function logger(service) {
  const write = (level, msg, meta) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, service, msg: maskString(msg), ...(meta ? mask(meta) : {}) });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return { info: (m, d) => write('info', m, d), warn: (m, d) => write('warn', m, d), error: (m, d) => write('error', m, d) };
}

module.exports = { logger, mask, maskString };
