'use strict';
/** Menyalakan semua service untuk demo. Log tiap service ada di reports/logs. Tutup jendela atau Ctrl+C untuk berhenti. */
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { startStack, JAR, ROOT } = require('./stack');
const { main: setup } = require('./setup');

setup();
require('../services/shared/config');
if (!fs.existsSync(JAR)) { console.error(`[X] ${JAR} belum ada. Jalankan run.bat atau: cd services\\booking && mvnw.cmd -q package -DskipTests`); process.exit(1); }

const runDir = path.join(ROOT, '.run');
fs.mkdirSync(runDir, { recursive: true });
console.log('\nMenyalakan semua proses: registry, broker, auth, catalog, booking, payment, notification, support, gateway...');
/*
 * Supervisor: service yang berhenti tanpa diminta (crash, termasuk kode 3221226505 / 0xC0000409 yang pernah
 * teramati pada catalog dan gateway) dinyalakan ulang otomatis. Jeda naik bertahap 1, 2, 4, ... maks 30 detik,
 * dan kembali ke 1 detik bila service sudah stabil lebih dari 60 detik. Setiap kejadian dicatat di
 * reports/logs/supervisor.log agar tetap bisa dianalisis.
 */
const supLog = path.join(ROOT, 'reports', 'logs', 'supervisor.log');
const note = (msg) => { const line = `${new Date().toISOString()} ${msg}`; console.log(`[!] ${msg}`); try { fs.appendFileSync(supLog, `${line}\n`); } catch { /* log opsional */ } };
const restarts = new Map();
const savePids = () => fs.writeFileSync(path.join(runDir, 'pids.json'), JSON.stringify({ launcher: process.pid, children: stack.children.map((c) => c.pid) }));
const onExit = (name, code) => {
  if (stopping) return;
  const r = restarts.get(name) || { count: 0, delay: 1000, since: 0 };
  if (Date.now() - r.since > 60000) r.delay = 1000;
  r.count += 1;
  note(`${name} berhenti (kode ${code}). Dinyalakan ulang otomatis dalam ${r.delay / 1000} detik (restart ke-${r.count}). Lihat reports/logs/${name}.log`);
  const wait = r.delay;
  r.delay = Math.min(r.delay * 2, 30000);
  restarts.set(name, r);
  setTimeout(() => {
    if (stopping) return;
    r.since = Date.now();
    stack.start(name);
    savePids();
    note(`${name} sudah dinyalakan ulang.`);
  }, wait).unref();
};
let stopping = false;
const stack = startStack({ onExit });
savePids();

const stop = () => { stopping = true; stack.stop(); setTimeout(() => process.exit(0), 400); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

stack.ready().then(() => {
  console.log(`
====================================================
  Rangkai siap dipakai
  Aplikasi   : http://localhost:8080
  Dari ponsel: ${require('../services/shared/config').qrPublicBase()}  (Wi-Fi yang sama, untuk QRIS)
  HTTPS      : https://localhost:8443  (sertifikat dev)
  Dokumen API: http://localhost:8080/docs
  GraphQL    : POST http://localhost:8080/graphql

  Akun demo (password: ${process.env.SEED_USER_PASSWORD})
    Pelanggan : daftar sendiri lewat halaman Daftar (tidak ada akun pelanggan bawaan)
    Masinis   : masinis@rangkai.test, masinis2@rangkai.test
    Admin     : admin@rangkai.test

  Jangan tutup jendela ini selama aplikasi dipakai.
====================================================`);
  if (process.env.OPEN_BROWSER === '1') exec('start "" "http://localhost:8080"');
}).catch((e) => { console.error(`[X] ${e.message}. Lihat folder reports/logs.`); stop(); });
