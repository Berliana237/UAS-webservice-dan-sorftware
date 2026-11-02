'use strict';
/**
 * Notification & audit service: konsumen murni dari message queue.
 * Mengubah event menjadi notifikasi pengguna, menyimpan audit log tanpa token/password,
 * dan menaikkan peringatan bila ada pola mencurigakan.
 */
const crypto = require('node:crypto');
const config = require('../shared/config');
const { createApp, finish, ApiError } = require('../shared/http');
const { kit } = require('../shared/boot');
const { mask } = require('../shared/log');
const mtls = require('../shared/mtls');
const dbm = require('../shared/db');
const { toNotification } = require('./templates');

const { log, registry, bus, verifier } = kit('notification');
const db = dbm.open('notification');
db.exec(`
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ref TEXT, read_at INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS processed(msg_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, service TEXT, actor TEXT, target TEXT, ip TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS alerts(seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, service TEXT, target TEXT, meta TEXT);
CREATE TABLE IF NOT EXISTS test_log(msg_id TEXT PRIMARY KEY, note TEXT, at INTEGER NOT NULL);
`);
const st = {
  seen: db.prepare('INSERT OR IGNORE INTO processed(msg_id,at) VALUES(?,?)'),
  addNotif: db.prepare('INSERT INTO notifications(id,user_id,kind,title,body,ref,created_at) VALUES(?,?,?,?,?,?,?)'),
  listNotif: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50'),
  readNotif: db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL'),
  addAudit: db.prepare('INSERT INTO audit_log(at,action,service,actor,target,ip,meta) VALUES(?,?,?,?,?,?,?)'),
  listAudit: db.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?'),
  addAlert: db.prepare('INSERT INTO alerts(at,kind,severity,service,target,meta) VALUES(?,?,?,?,?,?)'),
  listAlert: db.prepare('SELECT * FROM alerts ORDER BY seq DESC LIMIT 100'),
  addTest: db.prepare('INSERT OR IGNORE INTO test_log(msg_id,note,at) VALUES(?,?,?)'),
  listTest: db.prepare('SELECT * FROM test_log ORDER BY at DESC LIMIT 20'),
};

/* Konsumen idempotent: pesan bisa datang lebih dari sekali (at-least-once), efeknya tetap sekali. */
bus.consume('notification.events', async (m) => {
  if (m.topic === 'test.ping' && m.payload.poison) throw new Error('pesan beracun untuk demo DLQ');
  if (st.seen.run(m.id, Date.now()).changes === 0) return;
  if (m.topic === 'test.ping') { st.addTest.run(m.id, m.payload.note || '', Date.now()); return; }
  const n = toNotification(m.topic, m.payload);
  if (!n || !n.userId) return;
  st.addNotif.run(crypto.randomUUID(), n.userId, n.kind, n.title, n.body, n.ref || null, Date.now());
  log.info('notifikasi dikirim (simulasi email/WhatsApp)', { topic: m.topic, user: n.userId, ref: n.ref });
});

bus.consume('audit.events', async (m) => {
  if (st.seen.run(m.id, Date.now()).changes === 0) return;
  const { action, service, actor, target, ip, at, severity, ...rest } = m.payload;
  if (m.topic.startsWith('security.')) {
    st.addAlert.run(at || Date.now(), m.topic.slice(9), severity || 'medium', service || null, target || null, JSON.stringify(mask(rest)));
    log.warn('peringatan keamanan', { kind: m.topic, severity });
    return;
  }
  st.addAudit.run(at || Date.now(), action || m.topic.slice(6), service || null, actor || null, target || null, ip || null, JSON.stringify(mask(rest)));
});

const app = createApp('notification', log);
const me = verifier.requireAuth();
const auditor = verifier.requireAuth(['audit:read']);
const publicNotif = (n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, ref: n.ref, read: Boolean(n.read_at), createdAt: n.created_at });

app.get('/api/notifications', me, (req, res) => res.json({ notifications: st.listNotif.all(req.user.sub).map(publicNotif) }));
app.post('/api/notifications/:id/read', me, (req, res) => {
  if (st.readNotif.run(Date.now(), req.params.id, req.user.sub).changes === 0) throw new ApiError(404, 'NOTIFICATION_NOT_FOUND', 'Notifikasi tidak ditemukan.');
  res.json({ read: true });
});

app.get('/api/admin/audit', auditor, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json({ entries: st.listAudit.all(limit).map((a) => ({ seq: a.seq, at: a.at, action: a.action, service: a.service, actor: a.actor, target: a.target, ip: a.ip, meta: JSON.parse(a.meta || '{}') })) });
});
app.get('/api/admin/alerts', auditor, (_req, res) => {
  res.json({ alerts: st.listAlert.all().map((a) => ({ seq: a.seq, at: a.at, kind: a.kind, severity: a.severity, service: a.service, target: a.target, meta: JSON.parse(a.meta || '{}') })) });
});
app.get('/api/admin/queue-consumed', auditor, (_req, res) => res.json({ consumed: st.listTest.all() }));

finish(app, log);
mtls.createServer('notification', app, config.ports.notification, log);
registry.register('notification', config.selfUrl('notification', config.ports.notification), { role: 'worker' });
