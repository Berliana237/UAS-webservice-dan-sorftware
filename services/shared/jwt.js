'use strict';
/** Verifikasi JWT RS256 lewat JWKS milik auth-service. Dipakai gateway dan diulang oleh tiap service (dua lapis). */
const { createLocalJWKSet, jwtVerify } = require('jose');
const config = require('./config');
const { ApiError } = require('./http');

function createVerifier(http) {
  let jwks = null;
  let at = 0;
  async function load(force) {
    if (jwks && !force && Date.now() - at < 300000) return jwks;
    const r = await http.request(`${config.urls.auth}/internal/jwks`);
    if (r.status !== 200) throw new Error('JWKS tidak tersedia');
    jwks = createLocalJWKSet(r.json);
    at = Date.now();
    return jwks;
  }
  async function verify(token) {
    const opts = { algorithms: ['RS256'], issuer: config.iss, audience: config.aud };
    try {
      return (await jwtVerify(token, await load(false), opts)).payload;
    } catch (e) {
      if (e.code === 'ERR_JWKS_NO_MATCHING_KEY') return (await jwtVerify(token, await load(true), opts)).payload;
      throw e;
    }
  }
  /** Middleware Express. scopes: token harus memiliki SEMUA scope ini. optional: lanjut walau tanpa token. */
  function requireAuth(scopes = [], { optional = false } = {}) {
    return async (req, _res, next) => {
      const h = req.headers.authorization || '';
      if (!h.startsWith('Bearer ')) {
        if (optional) return next();
        throw new ApiError(401, 'UNAUTHENTICATED', 'Token akses diperlukan.');
      }
      try {
        req.user = await verify(h.slice(7));
      } catch {
        throw new ApiError(401, 'INVALID_TOKEN', 'Token tidak valid atau sudah kedaluwarsa.');
      }
      const have = String(req.user.scope || '').split(' ');
      const missing = scopes.filter((s) => !have.includes(s));
      if (missing.length) throw new ApiError(403, 'INSUFFICIENT_SCOPE', 'Hak akses tidak mencukupi.', { required: scopes });
      next();
    };
  }
  return { verify, requireAuth };
}

module.exports = { createVerifier };
