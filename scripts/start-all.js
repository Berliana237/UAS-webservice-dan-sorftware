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
console.log('\nMenyalakan semua proses: registry, broker, auth, catalog, booking, payment, notification, gateway...');
const stack = startStack({ onExit: (name, code) => { if (!stopping) console.log(`[!] ${name} berhenti (kode ${code}). Lihat reports/logs/${name}.log`); } });
let stopping = false;
fs.writeFileSync(path.join(runDir, 'pids.json'), JSON.stringify({ launcher: process.pid, children: stack.children.map((c) => c.pid) }));

const stop = () => { stopping = true; stack.stop(); setTimeout(() => process.exit(0), 400); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

stack.ready().then(() => {
  console.log(`
====================================================
  Rangkai siap dipakai
  Aplikasi   : http://localhost:8080
  HTTPS      : https://localhost:8443  (sertifikat dev)
  Dokumen API: http://localhost:8080/docs
  GraphQL    : POST http://localhost:8080/graphql

  Akun demo (password: ${process.env.SEED_USER_PASSWORD})
    customer@rangkai.test, customer2@rangkai.test
    operator@rangkai.test, admin@rangkai.test

  Jangan tutup jendela ini selama aplikasi dipakai.
====================================================`);
  if (process.env.OPEN_BROWSER === '1') exec('start "" "http://localhost:8080"');
}).catch((e) => { console.error(`[X] ${e.message}. Lihat folder reports/logs.`); stop(); });
