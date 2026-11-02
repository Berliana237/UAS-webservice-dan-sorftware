'use strict';
/** Aturan murni auth (tanpa I/O), diuji langsung oleh unit test node:test. */
const crypto = require('node:crypto');

const ROLE_SCOPES = {
  customer: ['customer', 'schedule:read', 'booking:read', 'booking:write', 'payment:write'],
  operator: ['operator', 'schedule:read', 'schedule:write', 'manifest:read', 'checkin:write'],
  admin: ['admin', 'operator', 'schedule:read', 'schedule:write', 'manifest:read', 'checkin:write', 'system:read', 'audit:read', 'apikey:manage'],
};
const scopesForRole = (role) => ROLE_SCOPES[role] || [];

const pkceS256 = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

/** Kata sandi: 8 sampai 72 karakter, ada huruf dan angka. */
function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Minimal 8 karakter.';
  if (p.length > 72) return 'Maksimal 72 karakter.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Gunakan kombinasi huruf dan angka.';
  return null;
}

function validateEmail(e) {
  if (typeof e !== 'string' || e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Format email tidak valid.';
  return null;
}

/** Scope akhir = irisan permintaan dan izin. Permintaan kosong berarti seluruh izin. Prinsip least privilege. */
function narrowScope(requested, allowed) {
  const set = [...new Set(allowed)];
  if (!requested || !String(requested).trim()) return set.join(' ');
  const want = String(requested).split(/\s+/);
  return set.filter((s) => want.includes(s)).join(' ');
}

module.exports = { ROLE_SCOPES, scopesForRole, pkceS256, validatePassword, validateEmail, narrowScope };
