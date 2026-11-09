'use strict';
/** Aturan murni auth (tanpa I/O), diuji langsung oleh unit test node:test. */
const crypto = require('node:crypto');

const ROLES = ['customer', 'masinis', 'admin'];
const ROLE_SCOPES = {
  customer: ['customer', 'schedule:read', 'booking:read', 'booking:write', 'payment:write'],
  masinis: ['masinis', 'schedule:read', 'manifest:read', 'checkin:write'],
  admin: ['admin', 'schedule:read', 'schedule:write', 'manifest:read', 'checkin:write', 'system:read', 'audit:read', 'apikey:manage', 'payment:review', 'user:manage'],
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

/** NIK cukup 16 digit angka. Sistem tidak mencocokkan dengan data kependudukan. */
const validateNik = (v) => (v === '' || v == null || /^\d{16}$/.test(String(v)) ? null : 'NIK harus 16 digit angka.');
const validatePhone = (v) => (v === '' || v == null || /^\+?[0-9][0-9\s-]{7,18}$/.test(String(v)) ? null : 'Contoh: 081234567890');

/** Tanggal lahir yyyy-mm-dd, tidak di masa depan, usia paling tua 120 tahun. */
function validateBirthDate(v, now = new Date()) {
  if (v === '' || v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return 'Format tanggal yyyy-mm-dd.';
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'Tanggal tidak valid.';
  if (d > now) return 'Tanggal lahir tidak boleh di masa depan.';
  if (ageFrom(v, now) > 120) return 'Usia lebih dari 120 tahun tidak valid.';
  return null;
}

function ageFrom(birthDate, now = new Date()) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

/** Scope akhir = irisan permintaan dan izin. Permintaan kosong berarti seluruh izin. Prinsip least privilege. */
function narrowScope(requested, allowed) {
  const set = [...new Set(allowed)];
  if (!requested || !String(requested).trim()) return set.join(' ');
  const want = String(requested).split(/\s+/);
  return set.filter((s) => want.includes(s)).join(' ');
}

module.exports = { ROLES, ROLE_SCOPES, scopesForRole, pkceS256, validatePassword, validateEmail, validateNik, validatePhone, validateBirthDate, ageFrom, narrowScope };
