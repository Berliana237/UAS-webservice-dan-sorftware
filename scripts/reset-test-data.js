'use strict';
/**
 * Mengembalikan DATA UJI kelompok penguji ke kondisi awal, tanpa menyentuh data demo.
 *
 * Yang dianggap data uji: semua akun berdomain @penguji.rangkai dan @uji.rangkai (akun yang dibuat koleksi Postman/tes).
 *  - Empat akun penguji resmi (lihat ACCOUNTS) TETAP ADA, tetapi seluruh datanya dihapus:
 *    pesanan, penumpang, kursi yang ditahan, pembayaran, bukti transfer, notifikasi, dan sesi login.
 *  - Akun pelanggan lain berdomain tersebut dihapus beserta datanya.
 * Akun admin/masinis pembangun, akun pelanggan biasa, jadwal, kereta, dan stasiun tidak disentuh.
 *
 * Cara pakai:
 *   node scripts/reset-test-data.js --dry-run   lihat apa yang akan dihapus
 *   node scripts/reset-test-data.js             jalankan saat sistem mati (stop.bat dulu)
 *   node scripts/reset-test-data.js --live      jalankan saat sistem hidup (dipakai endpoint POST /api/admin/test-data/reset)
 *   tambah --json untuk keluaran ringkasan dalam JSON
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../services/shared/config');
const pii = require('../services/shared/pii');

const DRY = process.argv.includes('--dry-run');
const LIVE = process.argv.includes('--live');
const JSON_OUT = process.argv.includes('--json');
/** Akun penguji resmi (sama dengan TESTER_ACCOUNTS di services/auth/store.js). */
const ACCOUNTS = new Set(['pelanggan1@penguji.rangkai', 'pelanggan2@penguji.rangkai', 'masinis@penguji.rangkai', 'admin@penguji.rangkai']);
const TEST_DOMAIN = /@(penguji\.rangkai|uji\.rangkai)$/i;
const dir = config.dataDir;
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

if (!LIVE && !DRY && fs.existsSync(path.join(config.ROOT, '.run', 'pids.json'))) {
  console.error('[X] Sistem masih berjalan. Jalankan stop.bat dulu, atau pakai --live.');
  process.exit(1);
}
const open = (name) => {
  const db = new DatabaseSync(path.join(dir, `${name}.db`));
  db.exec('PRAGMA busy_timeout=8000');
  return db;
};

const auth = open('auth');
const users = auth.prepare('SELECT id, email_enc, role FROM users').all().map((u) => ({ id: u.id, role: u.role, email: pii.decrypt(u.email_enc) }));
const testUsers = users.filter((u) => TEST_DOMAIN.test(u.email));
const official = testUsers.filter((u) => ACCOUNTS.has(u.email.toLowerCase()));
const removeAccounts = testUsers.filter((u) => !ACCOUNTS.has(u.email.toLowerCase()) && u.role === 'customer');
const ids = [...official, ...removeAccounts].map((u) => u.id);
const removeIds = removeAccounts.map((u) => u.id);

const inList = (n) => (n ? `(${Array(n).fill('?').join(',')})` : '(NULL)');
const booking = open('booking');
const bookingIds = booking.prepare(`SELECT id FROM bookings WHERE user_id IN ${inList(ids.length)}`).all(...ids).map((r) => r.id);
const lockIds = booking.prepare(`SELECT id FROM seat_locks WHERE user_id IN ${inList(ids.length)}`).all(...ids).map((r) => r.id);
const payment = open('payment');
const payments = payment.prepare(`SELECT id FROM payments WHERE user_id IN ${inList(ids.length)} OR booking_id IN ${inList(bookingIds.length)}`).all(...ids, ...bookingIds).map((r) => r.id);
const proofs = payment.prepare(`SELECT id FROM proofs WHERE payment_id IN ${inList(payments.length)}`).all(...payments).length;
const notif = open('notification');
const notifCount = notif.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id IN ${inList(ids.length)}`).get(...ids).c;

const summary = {
  dryRun: DRY, keptTesterAccounts: official.map((u) => u.email), deletedAccounts: removeAccounts.length,
  bookings: bookingIds.length, locks: lockIds.length, payments: payments.length, proofs, notifications: notifCount,
};
say(`Akun penguji resmi yang dipertahankan: ${summary.keptTesterAccounts.join(', ') || '(belum ada)'}`);
say(`Akun uji lain yang dihapus: ${removeAccounts.length}`);
say(`Data dihapus: pesanan ${bookingIds.length}, lock ${lockIds.length}, pembayaran ${payments.length}, bukti ${proofs}, notifikasi ${notifCount}`);

if (!DRY) {
  const tx = (db, fn) => { db.exec('BEGIN IMMEDIATE'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const run = (db, sql, args) => db.prepare(sql).run(...args).changes;
  tx(booking, () => {
    const owners = [...bookingIds, ...lockIds];
    run(booking, `DELETE FROM seat_claims WHERE owner_id IN ${inList(owners.length)}`, owners);
    run(booking, `DELETE FROM passengers WHERE booking_id IN ${inList(bookingIds.length)}`, bookingIds);
    run(booking, `DELETE FROM bookings WHERE id IN ${inList(bookingIds.length)}`, bookingIds);
    run(booking, `DELETE FROM seat_locks WHERE id IN ${inList(lockIds.length)}`, lockIds);
    run(booking, `DELETE FROM idempotency WHERE user_id IN ${inList(ids.length)}`, ids);
  });
  tx(payment, () => {
    run(payment, `DELETE FROM proofs WHERE payment_id IN ${inList(payments.length)}`, payments);
    run(payment, `DELETE FROM payments WHERE id IN ${inList(payments.length)}`, payments);
    run(payment, `DELETE FROM idempotency WHERE user_id IN ${inList(ids.length)}`, ids);
  });
  for (const p of payments) fs.rmSync(path.join(dir, 'uploads', p), { recursive: true, force: true });
  tx(notif, () => run(notif, `DELETE FROM notifications WHERE user_id IN ${inList(ids.length)}`, ids));
  tx(auth, () => {
    run(auth, `DELETE FROM refresh_tokens WHERE user_id IN ${inList(ids.length)}`, ids);
    run(auth, `DELETE FROM auth_codes WHERE user_id IN ${inList(ids.length)}`, ids);
    run(auth, `DELETE FROM users WHERE id IN ${inList(removeIds.length)}`, removeIds);
    run(auth, `UPDATE users SET failed_count=0, locked_until=0 WHERE id IN ${inList(ids.length)}`, ids);
  });
  say('Selesai. Data uji kembali ke kondisi awal.');
}
if (JSON_OUT) console.log(JSON.stringify(summary));
