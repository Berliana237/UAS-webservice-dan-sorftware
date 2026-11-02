'use strict';
/** Konfigurasi bersama semua service Node. Nilai datang dari environment (.env), bukan dari kode. */
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env opsional bila env sudah diisi platform */ }

const offset = Number(process.env.PORT_OFFSET || 0);
const base = { gateway: 8080, gatewayTls: 8443, registry: 8761, broker: 8770, auth: 8771, catalog: 8772, payment: 8773, notification: 8774, bookingA: 8781, bookingB: 8782 };
const ports = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + offset]));
const num = (k, d) => Number(process.env[k] ?? d);
/** Alamat service lain. Default localhost, dan di Docker Compose diisi nama container, misalnya REGISTRY_HOST=registry. */
const hostOf = (name) => process.env[`${name.toUpperCase()}_HOST`] || 'localhost';
if (process.env.PORT) ports.gateway = Number(process.env.PORT);

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
    token: num('RATE_TOKEN_PER_MIN', 120), lock: num('RATE_LOCK_PER_MIN', 30), payment: num('RATE_PAYMENT_PER_MIN', 30),
    graphql: num('RATE_GRAPHQL_PER_MIN', 600), publicRead: num('RATE_PUBLIC_READ_PER_MIN', 600),
  },
  broker: { maxAttempts: num('BROKER_MAX_ATTEMPTS', 4), visibilityMs: num('BROKER_VISIBILITY_MS', 15000) },
  urls: {
    registry: `https://${hostOf('registry')}:${ports.registry}`,
    broker: `https://${hostOf('broker')}:${ports.broker}`,
    auth: `https://${hostOf('auth')}:${ports.auth}`,
  },
  iss: 'rangkai-auth',
  aud: 'rangkai-api',
};
