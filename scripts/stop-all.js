'use strict';
/** Menghentikan proses yang dicatat start-all.js. */
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '..', '.run', 'pids.json');
if (!fs.existsSync(file)) { console.log('Tidak ada stack yang tercatat berjalan.'); process.exit(0); }
const { launcher, children } = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const pid of [...children, launcher]) {
  try { process.kill(pid); n += 1; } catch { /* sudah berhenti */ }
}
fs.rmSync(file, { force: true });
console.log(`${n} proses dihentikan.`);
