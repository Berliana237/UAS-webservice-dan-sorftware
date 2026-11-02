'use strict';
/**
 * Broker: message queue durable (SQLite) untuk komunikasi asinkron.
 * Semantik mengikuti work-queue AMQP: routing topik ke antrian, at-least-once, lease (visibility timeout),
 * ack/nack, retry dengan backoff, dead letter queue, dan deduplikasi berdasarkan id pesan.
 */
const crypto = require('node:crypto');
const config = require('../shared/config');
const { createApp, finish, ApiError } = require('../shared/http');
const { kit } = require('../shared/boot');
const dbm = require('../shared/db');
const mtls = require('../shared/mtls');
const { resolveQueues, BINDINGS } = require('./routing');

const { log, registry, verifier } = kit('broker');
const db = dbm.open('broker');
db.exec(`
CREATE TABLE IF NOT EXISTS messages(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT NOT NULL, queue TEXT NOT NULL, topic TEXT NOT NULL, msg_key TEXT, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY', attempts INTEGER NOT NULL DEFAULT 0, visible_at INTEGER NOT NULL, lease_token TEXT, consumer TEXT,
  last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(msg_id, queue));
CREATE INDEX IF NOT EXISTS idx_msg_ready ON messages(queue, status, visible_at);
CREATE TABLE IF NOT EXISTS counters(queue TEXT PRIMARY KEY, published INTEGER NOT NULL DEFAULT 0, acked INTEGER NOT NULL DEFAULT 0, nacked INTEGER NOT NULL DEFAULT 0, dead INTEGER NOT NULL DEFAULT 0);
`);
const q = {
  insert: db.prepare(`INSERT OR IGNORE INTO messages(msg_id,queue,topic,msg_key,payload,visible_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`),
  next: db.prepare(`SELECT seq,msg_id,topic,msg_key,payload,attempts FROM messages WHERE queue=? AND status IN ('READY','INFLIGHT') AND visible_at<=? ORDER BY seq LIMIT ?`),
  lease: db.prepare(`UPDATE messages SET status='INFLIGHT',attempts=attempts+1,visible_at=?,lease_token=?,consumer=?,updated_at=? WHERE seq=?`),
  bump: db.prepare(`INSERT INTO counters(queue,published,acked,nacked,dead) VALUES(?,?,?,?,?) ON CONFLICT(queue) DO UPDATE SET published=published+excluded.published,acked=acked+excluded.acked,nacked=nacked+excluded.nacked,dead=dead+excluded.dead`),
  byLease: db.prepare(`SELECT seq,attempts,queue FROM messages WHERE queue=? AND lease_token=?`),
  del: db.prepare(`DELETE FROM messages WHERE seq=?`),
  retry: db.prepare(`UPDATE messages SET status='READY',visible_at=?,lease_token=NULL,last_error=?,updated_at=? WHERE seq=?`),
  dead: db.prepare(`UPDATE messages SET status='DEAD',lease_token=NULL,last_error=?,updated_at=? WHERE seq=?`),
  stats: db.prepare(`SELECT queue, SUM(status='READY') ready, SUM(status='INFLIGHT') inflight, SUM(status='DEAD') dead FROM messages GROUP BY queue`),
  counters: db.prepare(`SELECT * FROM counters`),
  listDead: db.prepare(`SELECT seq,msg_id,topic,msg_key,attempts,last_error,payload,updated_at FROM messages WHERE queue=? AND status='DEAD' ORDER BY seq DESC LIMIT 50`),
  replay: db.prepare(`UPDATE messages SET status='READY',attempts=0,visible_at=?,last_error=NULL,updated_at=? WHERE queue=? AND status='DEAD'`),
  purgeLease: db.prepare(`UPDATE messages SET status='DEAD',lease_token=NULL,last_error=COALESCE(last_error,'lease berulang kali habis'),updated_at=? WHERE status='INFLIGHT' AND visible_at<=? AND attempts>=?`),
};

const app = createApp('broker', log, { jsonLimit: '256kb' });
const requireAdmin = verifier.requireAuth(['system:read']);

function publishOne({ id, topic, key, payload }) {
  const now = Date.now();
  const queues = resolveQueues(topic);
  const body = JSON.stringify(payload ?? {});
  db.tx(() => {
    for (const queue of queues) {
      const r = q.insert.run(id, queue, topic, key ?? null, body, now, now, now);
      if (r.changes) q.bump.run(queue, 1, 0, 0, 0);
    }
  });
  return queues;
}

app.post('/publish', (req, res) => {
  const { id, topic, key, payload } = req.body || {};
  if (!topic || typeof topic !== 'string') throw new ApiError(400, 'INVALID_MESSAGE', 'topic wajib diisi.');
  const queues = publishOne({ id: id || crypto.randomUUID(), topic, key, payload });
  res.status(202).json({ accepted: true, queues });
});

function lease(queue, consumer, max) {
  const now = Date.now();
  return db.tx(() => {
    q.purgeLease.run(now, now, config.broker.maxAttempts);
    const rows = q.next.all(queue, now, Math.min(max, 50));
    return rows.map((m) => {
      const leaseToken = crypto.randomBytes(12).toString('hex');
      q.lease.run(now + config.broker.visibilityMs, leaseToken, consumer, now, m.seq);
      return { id: m.msg_id, topic: m.topic, key: m.msg_key, payload: JSON.parse(m.payload), attempts: m.attempts + 1, leaseToken };
    });
  });
}

app.post('/consume', async (req, res) => {
  const { queue, consumer = mtls.peerCN(req), max = 10, waitMs = 0 } = req.body || {};
  if (!queue) throw new ApiError(400, 'INVALID_QUEUE', 'queue wajib diisi.');
  const until = Date.now() + Math.min(Number(waitMs) || 0, 8000);
  let messages = lease(queue, consumer, max);
  while (!messages.length && Date.now() < until && !req.socket.destroyed) {
    await new Promise((r) => setTimeout(r, 120));
    messages = lease(queue, consumer, max);
  }
  res.json({ messages });
});

app.post('/ack', (req, res) => {
  const { queue, leaseToken } = req.body || {};
  const m = q.byLease.get(queue, leaseToken);
  if (!m) throw new ApiError(409, 'LEASE_NOT_FOUND', 'Lease tidak ditemukan atau sudah habis.');
  db.tx(() => { q.del.run(m.seq); q.bump.run(queue, 0, 1, 0, 0); });
  res.json({ ok: true });
});

app.post('/nack', (req, res) => {
  const { queue, leaseToken, error } = req.body || {};
  const m = q.byLease.get(queue, leaseToken);
  if (!m) throw new ApiError(409, 'LEASE_NOT_FOUND', 'Lease tidak ditemukan atau sudah habis.');
  const now = Date.now();
  db.tx(() => {
    if (m.attempts >= config.broker.maxAttempts) {
      q.dead.run(error || 'gagal', now, m.seq); q.bump.run(queue, 0, 0, 1, 1);
      log.warn('pesan masuk DLQ', { queue, seq: m.seq });
    } else {
      q.retry.run(now + 300 * 2 ** m.attempts, error || 'gagal', now, m.seq); q.bump.run(queue, 0, 0, 1, 0);
    }
  });
  res.json({ ok: true });
});

function stats() {
  const out = {};
  for (const b of BINDINGS) out[b.queue] = { queue: b.queue, ready: 0, inflight: 0, dead: 0, published: 0, acked: 0, nacked: 0, deadTotal: 0 };
  for (const c of q.counters.all()) Object.assign(out[c.queue] ||= { queue: c.queue, ready: 0, inflight: 0, dead: 0 }, { published: c.published, acked: c.acked, nacked: c.nacked, deadTotal: c.dead });
  for (const s of q.stats.all()) Object.assign(out[s.queue] ||= { queue: s.queue }, { ready: s.ready, inflight: s.inflight, dead: s.dead });
  return Object.values(out);
}
const parseDead = (r) => ({ seq: r.seq, id: r.msg_id, topic: r.topic, attempts: r.attempts, lastError: r.last_error, payload: JSON.parse(r.payload), at: r.updated_at });

// Rute admin, diteruskan gateway. JWT diverifikasi lagi di sini.
app.get('/api/admin/queues', requireAdmin, (_req, res) => res.json({ queues: stats(), bindings: BINDINGS, maxAttempts: config.broker.maxAttempts }));
app.get('/api/admin/queues/:queue/dlq', requireAdmin, (req, res) => res.json({ queue: req.params.queue, messages: q.listDead.all(req.params.queue).map(parseDead) }));
app.post('/api/admin/queues/:queue/dlq/replay', requireAdmin, (req, res) => {
  const now = Date.now();
  res.json({ replayed: Number(q.replay.run(now, now, req.params.queue).changes) });
});
app.post('/api/admin/queues/publish-test', requireAdmin, (req, res) => {
  const { poison = false, note = 'uji antrian' } = req.body || {};
  const id = crypto.randomUUID();
  const queues = publishOne({ id, topic: 'test.ping', payload: { poison: Boolean(poison), note, at: Date.now() } });
  res.status(202).json({ id, topic: 'test.ping', queues, poison: Boolean(poison) });
});

finish(app, log);
mtls.createServer('broker', app, config.ports.broker, log);
registry.register('broker', config.urls.broker, { role: 'message-queue' });
