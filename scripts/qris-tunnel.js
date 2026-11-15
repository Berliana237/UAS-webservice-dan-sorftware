'use strict';
/**
 * Tautan publik sementara khusus halaman QRIS, agar kode QR bisa dipindai dari ponsel di jaringan mana pun
 * (misalnya Wi-Fi kampus yang memblokir koneksi antarperangkat).
 *
 * Yang dibuka ke internet HANYA halaman /qris/<token>, API /api/qris/<token>, dan aset tampilan.
 * Rute lain (admin, login, API pemesanan) dijawab 404 oleh proxy ini, jadi sistem tidak terbuka seluruhnya.
 * Tunnel memakai ssh bawaan Windows ke localhost.run (tanpa memasang aplikasi). Tekan Ctrl+C untuk menutup.
 *
 * Selama tunnel hidup, alamat publiknya ditulis ke .run/qr-public-base dan dipakai otomatis di kode QR baru.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* opsional */ }
const GATEWAY = Number(process.env.PORT || 8080) + Number(process.env.PORT_OFFSET || 0);
const PROXY_PORT = Number(process.env.QRIS_PROXY_PORT || 8090);
const BASE_FILE = path.join(ROOT, '.run', 'qr-public-base');

const TOKEN = '[A-Za-z0-9_-]{8,128}';
const ALLOW = [
  ['GET', new RegExp(`^/qris/${TOKEN}$`)],
  ['GET', new RegExp(`^/api/qris/${TOKEN}$`)],
  ['POST', new RegExp(`^/api/qris/${TOKEN}/pay$`)],
  ['GET', /^\/assets\/[A-Za-z0-9_./-]+$/],
  ['GET', /^\/favicon\.svg$/],
];
const allowed = (method, url) => {
  const p = url.split('?')[0];
  if (p.includes('..')) return false;
  return ALLOW.some(([m, re]) => (m === method || (m === 'GET' && method === 'HEAD')) && re.test(p));
};

const proxy = http.createServer((req, res) => {
  if (!allowed(req.method, req.url)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Tautan publik ini hanya untuk halaman pembayaran QRIS.' } }));
    return;
  }
  // Header Host dipertahankan agar gateway mengenali permintaan dari halaman QRIS sebagai same-origin.
  const up = http.request({ host: '127.0.0.1', port: GATEWAY, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Aplikasi belum berjalan. Jalankan run.bat dulu.'); });
  req.pipe(up);
});

function cleanup() {
  fs.rmSync(BASE_FILE, { force: true });
}

proxy.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`Proxy QRIS-saja di 127.0.0.1:${PROXY_PORT} -> gateway :${GATEWAY}`);
  console.log('Membuka tunnel ke localhost.run ...');
  const ssh = spawn('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', '-R', `80:127.0.0.1:${PROXY_PORT}`, 'nokey@localhost.run'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let announced = false;
  const scan = (buf) => {
    // Alamat tunnel berakhiran .lhr.life. Teks sambutan localhost.run juga memuat https://admin.localhost.run, yang bukan tunnel.
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.lhr\.life/i);
    if (m && !announced) {
      announced = true;
      fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
      fs.writeFileSync(BASE_FILE, m[0]);
      console.log(`\n  Tautan publik QRIS aktif: ${m[0]}`);
      console.log('  Buat pembayaran QRIS baru: kode QR otomatis memakai alamat ini.');
      console.log('  Hanya halaman QRIS yang bisa dibuka dari luar. Tekan Ctrl+C untuk menutup.\n');
    }
  };
  ssh.stdout.on('data', scan);
  ssh.stderr.on('data', scan);
  ssh.on('exit', (code) => { cleanup(); console.log(`Tunnel tertutup (kode ${code}).`); process.exit(code || 0); });
  const stop = () => { cleanup(); ssh.kill(); proxy.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
});
proxy.on('error', (e) => { console.error(`Proxy gagal: ${e.message}`); process.exit(1); });
