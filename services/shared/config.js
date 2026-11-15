'use strict';
/** Konfigurasi bersama semua service Node. Nilai datang dari environment (.env), bukan dari kode. */
const path = require('node:path');
const os = require('node:os');
const ROOT = path.resolve(__dirname, '..', '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env opsional bila env sudah diisi platform */ }

const offset = Number(process.env.PORT_OFFSET || 0);
const base = { gateway: 8080, gatewayTls: 8443, registry: 8761, broker: 8770, auth: 8771, catalog: 8772, payment: 8773, notification: 8774, support: 8775, bookingA: 8781, bookingB: 8782 };
const ports = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + offset]));
const num = (k, d) => Number(process.env[k] ?? d);
/**
 * Alamat service lain. Default 127.0.0.1, dan di Docker Compose diisi nama container, misalnya REGISTRY_HOST=registry.
 * Sengaja bukan "localhost": di Windows nama itu dicoba lewat IPv6 (::1) dulu, padahal service hanya mendengar di IPv4,
 * sehingga tiap koneksi baru tertahan ratusan milidetik sampai 2 detik sebelum jatuh ke 127.0.0.1.
 */
const hostOf = (name) => process.env[`${name.toUpperCase()}_HOST`] || '127.0.0.1';
if (process.env.PORT) ports.gateway = Number(process.env.PORT);

/** Alamat IPv4 jaringan lokal, agar ponsel di Wi-Fi yang sama bisa membuka tautan QRIS. Adapter virtual dilewati. */
function lanAddress() {
  const skip = /vethernet|virtualbox|vmware|wsl|docker|loopback|hyper-v/i;
  const list = [];
  const wifi = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (skip.test(name)) continue;
    for (const a of addrs || []) {
      // 192.168.56.x dan 192.168.99.x adalah jaringan host-only VirtualBox dan Docker Machine, bukan jaringan yang dipakai ponsel.
      if (a.family !== 'IPv4' || a.internal || /^192\.168\.(56|99)\./.test(a.address)) continue;
      (/wi-?fi|wlan|wireless/i.test(name) ? wifi : list).push(a.address);
    }
  }
  if (wifi.length) return wifi[0];
  return list.find((a) => a.startsWith('192.168.')) || list.find((a) => a.startsWith('10.')) || list.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) || list[0] || null;
}

module.exports = {
  ROOT,
  ports,
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  selfUrl: (name, port) => `https://${hostOf(name)}:${port}`,
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  certDir: path.resolve(ROOT, process.env.CERT_DIR || 'certs'),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${ports.gateway}`,
  corsOrigins: (process.env.CORS_ORIGINS || `http://localhost:${ports.gateway},https://localhost:${ports.gatewayTls}`).split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
  mockGateway: process.env.MOCK_GATEWAY !== '0',
  loadUsers: num('LOAD_USERS', 0),
  accessTtl: num('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTtl: num('REFRESH_TOKEN_TTL_SECONDS', 604800),
  rate: {
    global: num('RATE_GLOBAL_PER_MIN', 1200), login: num('RATE_LOGIN_PER_MIN', 10), register: num('RATE_REGISTER_PER_MIN', 20),
    token: num('RATE_TOKEN_PER_MIN', 120), lock: num('RATE_LOCK_PER_MIN', 120), payment: num('RATE_PAYMENT_PER_MIN', 30),
    graphql: num('RATE_GRAPHQL_PER_MIN', 600), publicRead: num('RATE_PUBLIC_READ_PER_MIN', 600),
    support: num('RATE_SUPPORT_PER_MIN', 12),
  },
  broker: { maxAttempts: num('BROKER_MAX_ATTEMPTS', 4), visibilityMs: num('BROKER_VISIBILITY_MS', 15000) },
  urls: {
    registry: `https://${hostOf('registry')}:${ports.registry}`,
    broker: `https://${hostOf('broker')}:${ports.broker}`,
    auth: `https://${hostOf('auth')}:${ports.auth}`,
  },
  /** Basis tautan di dalam kode QRIS. auto: alamat LAN bila gateway terbuka ke jaringan, selain itu PUBLIC_URL. */
  qrPublicBase() {
    // Tautan publik sementara dari scripts/qris-tunnel.js (qris-tunnel.bat) dipakai selama tunnel hidup.
    try { const t = require('node:fs').readFileSync(path.join(ROOT, '.run', 'qr-public-base'), 'utf8').trim(); if (/^https:\/\//.test(t)) return t; } catch { /* tidak ada tunnel */ }
    const v = process.env.QR_PUBLIC_BASE;
    if (v && v !== 'auto') return v.replace(/\/$/, '');
    if (process.env.GATEWAY_HOST === '0.0.0.0') { const ip = lanAddress(); if (ip) return `http://${ip}:${ports.gateway}`; }
    return (process.env.PUBLIC_URL || `http://localhost:${ports.gateway}`).replace(/\/$/, '');
  },
  lanAddress,
  iss: 'rangkai-auth',
  aud: 'rangkai-api',
};
