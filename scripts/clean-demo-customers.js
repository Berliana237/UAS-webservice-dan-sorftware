'use strict';
/**
 * Menghapus data pelanggan rekaan dari database demo (folder data), tanpa menyentuh akun admin dan masinis.
 *
 * Yang dihapus:
 *  - akun pelanggan buatan seeder dan pengujian: email @rangkai.test atau @uji.rangkai dengan peran customer
 *  - akun dengan peran lama yang sudah tidak berlaku (misalnya operator)
 *  - pesanan fiktif riwayat armada (id berawalan hist-)
 *  - semua pesanan, penumpang, lock, pembayaran, bukti transfer, notifikasi, dan sesi milik akun-akun di atas
 *
 * Akun yang didaftarkan sendiri (email lain), admin, dan masinis tetap ada beserta datanya.
 * Jalankan saat sistem mati: stop.bat lalu `node scripts/clean-demo-customers.js`. Tambah --dry-run untuk melihat dulu.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../services/shared/config');
const pii = require('../services/shared/pii');

const DRY = process.argv.includes('--dry-run');
const ROLES = new Set(['customer', 'masinis', 'admin']);
const DEMO_DOMAIN = /@(rangkai\.test|uji\.rangkai)$/i;
const dir = config.dataDir;
const open = (name) => new DatabaseSync(path.join(dir, `${name}.db`));

if (fs.existsSync(path.join(config.ROOT, '.run', 'pids.json'))) {
  console.error('[X] Sistem masih berjalan. Jalankan stop.bat dulu, lalu ulangi.');
  process.exit(1);
}

const auth = open('auth');
const users = auth.prepare('SELECT id, email_enc, name_enc, role FROM users').all().map((u) => ({ ...u, email: pii.decrypt(u.email_enc), name: pii.decrypt(u.name_enc) }));
const doomed = users.filter((u) => !ROLES.has(u.role) || (u.role === 'customer' && DEMO_DOMAIN.test(u.email)));
const kept = users.filter((u) => !doomed.includes(u));
const ids = doomed.map((u) => u.id);

console.log(`Akun dihapus (${doomed.length}):`);
doomed.forEach((u) => console.log(`  - ${u.role.padEnd(8)} ${u.email}  (${u.name})`));
console.log(`Akun tetap (${kept.length}):`);
kept.forEach((u) => console.log(`  + ${u.role.padEnd(8)} ${u.email}`));

const inList = (n) => (n ? `(${Array(n).fill('?').join(',')})` : '(NULL)');

const booking = open('booking');
const bookingIds = booking.prepare(`SELECT id FROM bookings WHERE id LIKE 'hist-%' OR user_id IN ${inList(ids.length)}`).all(...ids).map((r) => r.id);
const lockIds = booking.prepare(`SELECT id FROM seat_locks WHERE user_id IN ${inList(ids.length)}`).all(...ids).map((r) => r.id);
const payment = open('payment');
const payments = payment.prepare(`SELECT id FROM payments WHERE user_id IN ${inList(ids.length)} OR booking_id IN ${inList(bookingIds.length)}`).all(...ids, ...bookingIds).map((r) => r.id);
const proofs = payment.prepare(`SELECT id, file_path FROM proofs WHERE payment_id IN ${inList(payments.length)}`).all(...payments);
const notif = open('notification');
const notifCount = notif.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id IN ${inList(ids.length)}`).get(...ids).c;

console.log(`\nPesanan ${bookingIds.length} (termasuk riwayat fiktif), lock ${lockIds.length}, pembayaran ${payments.length}, bukti transfer ${proofs.length}, notifikasi ${notifCount}.`);
if (DRY) { console.log('\n--dry-run: tidak ada yang dihapus.'); process.exit(0); }

const tx = (db, fn) => { db.exec('BEGIN IMMEDIATE'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } };
const run = (db, sql, args) => db.prepare(sql).run(...args).changes;

tx(booking, () => {
  const owners = [...bookingIds, ...lockIds];
  run(booking, `DELETE FROM seat_claims WHERE owner_id IN ${inList(owners.length)}`, owners);
  run(booking, `DELETE FROM passengers WHERE booking_id IN ${inList(bookingIds.length)}`, bookingIds);
  run(booking, `DELETE FROM bookings WHERE id IN ${inList(bookingIds.length)}`, bookingIds);
  run(booking, `DELETE FROM seat_locks WHERE id IN ${inList(lockIds.length)}`, lockIds);
  run(booking, `DELETE FROM idempotency WHERE user_id IN ${inList(ids.length)}`, ids);
  booking.prepare("DELETE FROM kv WHERE key='history_seeded'").run();
});
tx(payment, () => {
  run(payment, `DELETE FROM proofs WHERE payment_id IN ${inList(payments.length)}`, payments);
  run(payment, `DELETE FROM payments WHERE id IN ${inList(payments.length)}`, payments);
  run(payment, `DELETE FROM idempotency WHERE user_id IN ${inList(ids.length)}`, ids);
});
const uploads = path.join(dir, 'uploads');
for (const p of payments) fs.rmSync(path.join(uploads, p), { recursive: true, force: true });
tx(notif, () => run(notif, `DELETE FROM notifications WHERE user_id IN ${inList(ids.length)}`, ids));
tx(auth, () => {
  run(auth, `DELETE FROM refresh_tokens WHERE user_id IN ${inList(ids.length)}`, ids);
  run(auth, `DELETE FROM auth_codes WHERE user_id IN ${inList(ids.length)}`, ids);
  run(auth, `DELETE FROM users WHERE id IN ${inList(ids.length)}`, ids);
});
console.log('\nSelesai. Jalankan run.bat untuk menyalakan sistem lagi.');
