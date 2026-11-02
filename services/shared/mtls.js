'use strict';
/**
 * mTLS antar service: setiap service punya sertifikat sendiri yang ditandatangani CA internal.
 * Server menolak koneksi tanpa sertifikat klien yang sah (handshake gagal), lalu requireCN membatasi
 * service mana yang boleh memanggil endpoint tertentu.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const config = require('./config');
const { ApiError } = require('./http');

function material(name) {
  const f = (x) => fs.readFileSync(path.join(config.certDir, x));
  return { key: f(`${name}.key`), cert: f(`${name}.crt`), ca: f('ca.crt') };
}

function createServer(name, app, port, log) {
  const server = https.createServer({ ...material(name), requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, app);
  server.listen(port, config.bindHost, () => log?.info(`mTLS aktif di ${port}`));
  return server;
}

const peerCN = (req) => req.socket.getPeerCertificate?.()?.subject?.CN || null;

function requireCN(...allowed) {
  return (req, _res, next) => {
    const cn = peerCN(req);
    if (!allowed.includes(cn)) throw new ApiError(403, 'SERVICE_NOT_ALLOWED', `Service "${cn}" tidak diizinkan memanggil endpoint ini.`);
    next();
  };
}

/** Klien HTTP internal: selalu membawa sertifikat service pemanggil dan memverifikasi server terhadap CA internal. */
function client(name) {
  const agent = new https.Agent({ ...material(name), keepAlive: true, maxSockets: 256, timeout: 60000, minVersion: 'TLSv1.2' });
  function request(url, { method = 'GET', headers = {}, body, timeout = 8000, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const h = { ...headers };
      if (payload) { h['content-length'] = payload.length; h['content-type'] = h['content-type'] || 'application/json'; }
      const req = https.request(url, { method, headers: h, agent, timeout }, (res) => {
        if (raw) return resolve(res);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* bukan JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  return { request, agent };
}

module.exports = { material, createServer, requireCN, peerCN, client };
