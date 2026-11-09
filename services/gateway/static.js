'use strict';
/** Reverse proxy sisi statis: melayani SPA, dokumen API, dan Swagger UI. Rute tak dikenal dikembalikan ke index.html. */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../shared/config');

const WEB = path.join(config.ROOT, 'web');
const DOCS = path.join(config.ROOT, 'docs');
const SWAGGER = path.join(config.ROOT, 'node_modules', 'swagger-ui-dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.yaml': 'text/yaml; charset=utf-8', '.graphql': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function send(req, res, file, cache) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return json(req, res, 404, 'NOT_FOUND', 'Berkas tidak ditemukan.');
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', cache);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  });
}

/** Mencegah path traversal: hasil akhir harus tetap berada di dalam folder dasar. */
function safeJoin(base, rel) {
  const full = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

const DOCS_HTML = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Rangkai API</title><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/docs/swagger/swagger-ui.css"><style>body{margin:0}.topbar{display:none}</style></head><body><div id="ui"></div>
<script src="/docs/swagger/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/docs/openapi.yaml',dom_id:'#ui',deepLinking:true,persistAuthorization:true})</script></body></html>`;

/** Halaman aplikasi web. Hanya alamat ini yang dijawab index.html, selain itu klien API mendapat JSON yang jelas. */
const SPA_ROUTES = /^\/(masuk|daftar|cari|perjalanan|konsol|auth\/callback|(kursi|pesanan|bayar|tiket)\/[^/]+)?$/;

function json(req, res, status, code, message, details) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: { code, message, details }, requestId: req.id }));
}

const HINT = { docs: '/docs', openapi: '/docs/openapi.yaml', health: '/healthz', graphql: 'POST /graphql' };

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return json(req, res, 400, 'INVALID_PATH', 'Path tidak valid.'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(req, res, 404, 'NOT_FOUND', `Rute ${req.method} ${rel} tidak ditemukan. Endpoint API berawalan /api, /oauth, atau /graphql.`, HINT);
  }

  if (rel === '/docs' || rel === '/docs/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(DOCS_HTML); }
  if (rel === '/docs/openapi.yaml') return send(req, res, path.join(DOCS, 'openapi.yaml'), 'no-cache');
  if (rel.startsWith('/docs/swagger/')) {
    const f = safeJoin(SWAGGER, rel.slice('/docs/swagger/'.length));
    if (f) return send(req, res, f, 'public, max-age=86400');
  }
  if (rel.startsWith('/assets/') || rel === '/favicon.svg') {
    const f = safeJoin(WEB, rel.slice(1));
    if (f) return send(req, res, f, 'no-cache');
    return json(req, res, 404, 'NOT_FOUND', 'Berkas tidak ditemukan.');
  }
  if (SPA_ROUTES.test(rel)) return send(req, res, path.join(WEB, 'index.html'), 'no-cache');
  return json(req, res, 404, 'NOT_FOUND', `Rute ${req.method} ${rel} tidak ditemukan. Endpoint API berawalan /api, /oauth, atau /graphql.`, HINT);
}

module.exports = { serveStatic, safeJoin };
