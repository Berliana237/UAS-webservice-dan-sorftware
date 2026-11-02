'use strict';
/**
 * Registry: service discovery berbasis heartbeat (mirip Eureka versi kecil).
 * Instance mendaftar lalu mengirim heartbeat; yang diam lebih dari 12 detik dianggap mati dan dikeluarkan.
 */
const config = require('../shared/config');
const { createApp, finish, ApiError } = require('../shared/http');
const { logger } = require('../shared/log');
const mtls = require('../shared/mtls');

const log = logger('registry');
const TTL_MS = 12000;
const app = createApp('registry', log);
const services = new Map(); // name -> Map(instanceId -> {…})

function sweep() {
  const now = Date.now();
  for (const [name, list] of services) {
    for (const [id, inst] of list) if (now - inst.lastBeat > TTL_MS) { list.delete(id); log.warn('instance dikeluarkan (heartbeat hilang)', { name, id }); }
    if (!list.size) services.delete(name);
  }
}
setInterval(sweep, 2000).unref();

app.post('/register', (req, res) => {
  const { name, instanceId, url, meta } = req.body || {};
  if (!name || !instanceId || !url) throw new ApiError(400, 'INVALID_REGISTRATION', 'name, instanceId, dan url wajib diisi.');
  // Service hanya boleh mendaftar atas nama identitas sertifikatnya sendiri.
  if (mtls.peerCN(req) !== name) throw new ApiError(403, 'IDENTITY_MISMATCH', 'Nama service harus sama dengan CN sertifikat.');
  if (!services.has(name)) services.set(name, new Map());
  const list = services.get(name);
  const prev = list.get(instanceId);
  if (!prev) log.info('instance terdaftar', { name, instanceId, url });
  list.set(instanceId, { name, instanceId, url, meta: meta || {}, registeredAt: prev?.registeredAt || Date.now(), lastBeat: Date.now() });
  res.json({ ok: true, ttlMs: TTL_MS });
});

app.post('/deregister', (req, res) => {
  const { name, instanceId } = req.body || {};
  if (mtls.peerCN(req) !== name) throw new ApiError(403, 'IDENTITY_MISMATCH', 'Nama service harus sama dengan CN sertifikat.');
  services.get(name)?.delete(instanceId);
  log.info('instance keluar', { name, instanceId });
  res.json({ ok: true });
});

app.get('/services/:name', (req, res) => {
  sweep();
  res.json({ name: req.params.name, instances: [...(services.get(req.params.name)?.values() || [])] });
});

app.get('/services', (_req, res) => {
  sweep();
  res.json({ services: Object.fromEntries([...services].map(([n, l]) => [n, [...l.values()]])), ttlMs: TTL_MS });
});

finish(app, log);
mtls.createServer('registry', app, config.ports.registry, log);
