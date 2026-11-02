'use strict';
/** Menjalankan seluruh service sebagai proses terpisah, dipakai start-all.js dan runner pengujian. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const JAR = path.join(ROOT, 'services', 'booking', 'target', 'booking-service.jar');
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning'];
const BOOKING_INSTANCES = Number(process.env.BOOKING_INSTANCES || 2);
const gatewayPort = (offset) => Number(process.env.PORT || 8080 + offset);

function plan(offset) {
  const node = (name, dir = name, env = {}) => ({ name, cmd: process.execPath, args: [...NODE_FLAGS, path.join(ROOT, 'services', dir, 'index.js')], env: { INSTANCE_ID: name, ...env } });
  const booking = (id, port) => ({
    name: id, cmd: 'java', args: ['-XX:+UseSerialGC', '-Xss512k', '-Xmx256m', '-jar', JAR],
    env: { INSTANCE_ID: id, BOOKING_PORT: String(port + offset) },
  });
  return [
    node('registry'), node('broker'), node('auth'), node('catalog'),
    booking('booking-a', 8781), ...(BOOKING_INSTANCES > 1 ? [booking('booking-b', 8782)] : []),
    node('payment'), node('notification'), node('gateway'),
  ];
}

const waitFor = (url, timeoutMs) => new Promise((resolve, reject) => {
  const until = Date.now() + timeoutMs;
  const tick = () => {
    const req = http.get(url, (res) => { res.resume(); if (res.statusCode === 200) resolve(); else retry(); });
    req.on('error', retry);
    req.setTimeout(1500, () => req.destroy());
  };
  const retry = () => (Date.now() > until ? reject(new Error(`timeout menunggu ${url}`)) : setTimeout(tick, 300));
  tick();
});

async function waitForInstances(base, want, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/bookings/instance`);
      if (r.status === 200) {
        const seen = new Set();
        for (let i = 0; i < 6; i++) { const x = await fetch(`${base}/api/bookings/instance`); if (x.status === 200) seen.add((await x.json()).instance); }
        const st = await fetch(`${base}/api/stations`);
        if (seen.size >= want && st.status === 200) return;
      }
    } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('layanan belum siap dalam batas waktu');
}

function startStack({ offset = 0, env = {}, logDir, stdio = 'file', onExit } = {}) {
  const children = [];
  const logs = logDir || path.join(ROOT, 'reports', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const baseEnv = { ...process.env, PORT_OFFSET: String(offset), ...env };
  const specs = plan(offset);
  const launch = (s, flag = 'w') => {
    const out = stdio === 'file' ? fs.openSync(path.join(logs, `${s.name}.log`), flag) : 'inherit';
    const child = spawn(s.cmd, s.args, { cwd: ROOT, env: { ...baseEnv, ...s.env }, stdio: ['ignore', out, out], windowsHide: true });
    child.serviceName = s.name;
    child.on('exit', (code) => onExit?.(s.name, code));
    return child;
  };
  for (const s of specs) children.push(launch(s));
  return {
    children,
    /** Menyalakan lagi satu service yang dimatikan, dipakai demo failover dan antrian. */
    start: (name) => {
      const i = children.findIndex((c) => c.serviceName === name);
      const s = specs.find((x) => x.name === name);
      if (i >= 0 && s) children[i] = launch(s, 'a');
    },
    base: `http://localhost:${gatewayPort(offset)}`,
    ready: async (timeoutMs = 90000) => {
      await waitFor(`http://localhost:${gatewayPort(offset)}/healthz`, timeoutMs);
      await waitForInstances(`http://localhost:${gatewayPort(offset)}`, BOOKING_INSTANCES, timeoutMs);
    },
    stop: () => { for (const c of children) { try { c.kill(); } catch { /* sudah berhenti */ } } },
    kill: (name) => { const c = children.find((x) => x.serviceName === name); if (c) c.kill(); return Boolean(c); },
  };
}

module.exports = { startStack, plan, JAR, ROOT };
