'use strict';
/** Kerangka Express bersama: format error seragam, request id, header keamanan, dan log akses bermasker. */
const crypto = require('node:crypto');
const express = require('express');

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

function createApp(name, log, { jsonLimit = '64kb', rawJson = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const t0 = Date.now();
    res.on('finish', () => { if (req.path !== '/health') log.info('req', { id: req.id, m: req.method, p: req.path, s: res.statusCode, ms: Date.now() - t0 }); });
    next();
  });
  if (!rawJson) {
    app.use(express.json({ limit: jsonLimit }));
    app.use(express.urlencoded({ extended: false, limit: jsonLimit }));
  }
  app.get('/health', (_req, res) => res.json({ status: 'UP', service: name, instance: process.env.INSTANCE_ID || name, uptime: Math.round(process.uptime()) }));
  return app;
}

function finish(app, log) {
  app.use((req, _res, next) => next(new ApiError(404, 'NOT_FOUND', `Rute ${req.method} ${req.path} tidak ditemukan.`)));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let code = err.code || 'INTERNAL_ERROR';
    let message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Body bukan JSON yang valid.'; }
    if (err.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Body terlalu besar.'; }
    if (status >= 500) { log.error('unhandled', { id: req.id, p: req.path, err: err.message }); code = 'INTERNAL_ERROR'; message = 'Terjadi kesalahan pada server.'; }
    res.status(status).json({ error: { code, message, details: err.details }, requestId: req.id });
  });
}

/** Membungkus error koneksi antar service jadi 503 yang ramah. */
const unavailable = (svc) => new ApiError(503, 'SERVICE_UNAVAILABLE', `Layanan ${svc} sedang tidak tersedia. Coba lagi sebentar.`);

module.exports = { ApiError, createApp, finish, unavailable };
