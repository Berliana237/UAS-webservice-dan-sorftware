'use strict';
/**
 * Runner pengujian. Pemakaian: node scripts/run-tests.js <suite>
 * Suite: unit-java unit-node pytest postman functional concurrency security load week8 week9 week10 week11 all
 *
 * Suite yang butuh sistem berjalan memakai stack terpisah di port 9080 dengan database baru (data-test),
 * jadi hasilnya bisa diulang dan tidak mengganggu stack demo di port 8080.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startStack, JAR, ROOT } = require('./stack');
const { main: setup, writePostmanEnv } = require('./setup');

const OFFSET = 1000;
const TEST_BASE = `http://localhost:${8080 + OFFSET}`;
const REPORTS = path.join(ROOT, 'reports');
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning'];
fs.mkdirSync(REPORTS, { recursive: true });

const mvnw = path.join(ROOT, 'services', 'booking', 'mvnw.cmd');
const isWin = process.platform === 'win32';

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: isWin && /\.(cmd|bat)$/i.test(cmd), ...opts });
  return r.status === 0;
}

function quoteWin(p) { return isWin && p.includes(' ') ? `"${p}"` : p; }

function maven(goal) {
  const dir = path.join(ROOT, 'services', 'booking');
  if (isWin) return spawnSync(`${quoteWin(mvnw)} -B ${goal}`, { cwd: dir, stdio: 'inherit', shell: true }).status === 0;
  return spawnSync('./mvnw', ['-B', ...goal.split(' ')], { cwd: dir, stdio: 'inherit' }).status === 0;
}

function ensureJar() {
  if (!fs.existsSync(JAR)) { console.log('Membangun booking-service...'); if (!maven('-q package -DskipTests')) throw new Error('Gagal membangun booking-service'); }
}

async function withStack(fn) {
  setup();
  require('../services/shared/config');
  ensureJar();
  const dataDir = path.join(ROOT, 'data-test');
  fs.rmSync(dataDir, { recursive: true, force: true });
  const logDir = path.join(REPORTS, 'logs-test');
  const env = {
    DATA_DIR: 'data-test', PUBLIC_URL: TEST_BASE, CORS_ORIGINS: TEST_BASE, LOAD_USERS: '60',
    RATE_GLOBAL_PER_MIN: '60000', RATE_PUBLIC_READ_PER_MIN: '60000', RATE_GRAPHQL_PER_MIN: '60000', RATE_LOCK_PER_MIN: '6000', RATE_PAYMENT_PER_MIN: '6000', RATE_TOKEN_PER_MIN: '6000', RATE_REGISTER_PER_MIN: '6000',
  };
  console.log(`\nMenyalakan stack pengujian di ${TEST_BASE} ...`);
  const stack = startStack({ offset: OFFSET, env, logDir });
  const childEnv = { ...process.env, ...env, BASE_URL: TEST_BASE, PORT_OFFSET: String(OFFSET), LOG_DIR: path.relative(ROOT, logDir) };
  try {
    await stack.ready();
    await new Promise((r) => setTimeout(r, 2500)); // seed akun beban selesai
    return await fn({ stack, env: childEnv });
  } finally {
    stack.stop();
    await new Promise((r) => setTimeout(r, 500));
  }
}

const nodeScript = (file, env) => spawnSync(process.execPath, [...NODE_FLAGS, path.join(ROOT, file)], { cwd: ROOT, stdio: 'inherit', env }).status === 0;

/* ---------- Suite ---------- */
const suites = {
  'unit-java': async () => {
    console.log('\n=== JUnit 5 (mvn test) ===');
    const ok = maven('test');
    const target = path.join(ROOT, 'services', 'booking', 'target');
    console.log(`Laporan: ${path.relative(ROOT, path.join(target, 'site', 'jacoco', 'index.html'))} dan target/surefire-reports`);
    return ok;
  },
  'unit-node': async () => {
    console.log('\n=== Unit test Node (node:test) ===');
    const out = spawnSync(process.execPath, [...NODE_FLAGS, '--test', '--experimental-test-coverage', '--test-coverage-include=services/**', '--test-reporter=spec', 'tests/node/*.test.js'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: 'data-test' } });
    process.stdout.write(out.stdout);
    process.stderr.write(out.stderr);
    fs.writeFileSync(path.join(REPORTS, 'unit-node.txt'), out.stdout);
    return out.status === 0;
  },
  pytest: () => withStack(async ({ env }) => {
    console.log('\n=== PyTest (EP/BVA lewat API) ===');
    const venv = path.join(ROOT, '.venv');
    const py = isWin ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
    if (!fs.existsSync(py)) {
      if (!sh(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv'])) throw new Error('Gagal membuat virtualenv Python');
      if (!sh(py, ['-m', 'pip', 'install', '-q', '-r', 'tests/pytest/requirements.txt'])) throw new Error('Gagal memasang paket Python');
    }
    return spawnSync(py, ['-m', 'pytest', 'tests/pytest', '-q', '--tb=short', '-p', 'no:cacheprovider', `--html=${path.join('reports', 'pytest.html')}`, '--self-contained-html', `--junitxml=${path.join('reports', 'pytest.xml')}`], { cwd: ROOT, stdio: 'inherit', env }).status === 0;
  }),
  postman: () => withStack(async ({ env }) => {
    console.log('\n=== Postman (Newman) ===');
    const envFile = writePostmanEnv(TEST_BASE, 'test');
    const newman = path.join(ROOT, 'node_modules', 'newman', 'bin', 'newman.js');
    const args = [newman, 'run', path.join(ROOT, 'postman', 'Rangkai.postman_collection.json'), '-e', envFile, '--reporters', 'cli,htmlextra,junit',
      '--reporter-htmlextra-export', path.join(REPORTS, 'postman.html'), '--reporter-htmlextra-title', 'Rangkai Postman', '--reporter-junit-export', path.join(REPORTS, 'postman.xml'), '--timeout-request', '20000', '--color', 'off'];
    const ok = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env }).status === 0;
    fs.rmSync(envFile, { force: true });
    return ok;
  }),
  functional: () => withStack(async ({ env }) => nodeScript('tests/functional/e2e.js', env)),
  concurrency: () => withStack(async ({ env }) => nodeScript('tests/concurrency/run.js', env)),
  security: () => withStack(async ({ env }) => nodeScript('tests/security/run.js', env)),
  load: () => withStack(async ({ env }) => {
    const hasK6 = spawnSync('k6', ['version'], { encoding: 'utf8' }).status === 0;
    if (!hasK6) { console.log('k6 tidak ditemukan, memakai penggerak Node.'); return nodeScript('tests/load/node-load.js', env); }
    return spawnSync('k6', ['run', '-e', `BASE_URL=${TEST_BASE}`, '-e', `SEED_PASSWORD=${env.SEED_USER_PASSWORD}`, '-e', `SUMMARY_FILE=${path.join('reports', 'load-k6-summary.json')}`, '-e', `DURATION=${process.env.LOAD_DURATION || '45s'}`, 'tests/load/k6-booking.js'], { cwd: ROOT, stdio: 'inherit', env }).status === 0;
  }),
};

for (const [week, file] of [['week8', 'week08'], ['week9', 'week09'], ['week10', 'week10'], ['week11', 'week11']]) {
  suites[week] = () => withStack(async ({ stack, env }) => {
    Object.assign(process.env, env);
    delete require.cache[require.resolve('../tests/lib/client')];
    const mod = require(`../tests/weeks/${file}`);
    const out = await mod.run({ stack });
    return (out?.failed ?? (process.exitCode ? 1 : 0)) === 0;
  });
}

async function runAll() {
  const order = ['unit-java', 'unit-node', 'functional', 'postman', 'pytest', 'concurrency', 'security', 'week8', 'week9', 'week10', 'week11', 'load'];
  const results = [];
  for (const name of order) {
    const t0 = Date.now();
    let ok = false;
    try { ok = await suites[name](); } catch (e) { console.error(`[${name}] ${e.message}`); }
    process.exitCode = 0;
    results.push({ name, ok, seconds: Math.round((Date.now() - t0) / 1000) });
    console.log(`\n>>> ${name}: ${ok ? 'LULUS' : 'GAGAL'} (${results.at(-1).seconds} detik)`);
  }
  const md = ['# Ringkasan Seluruh Pengujian', '', `Waktu: ${new Date().toISOString()}`, '', '| Suite | Hasil | Durasi |', '|---|---|---|', ...results.map((r) => `| ${r.name} | ${r.ok ? 'LULUS' : 'GAGAL'} | ${r.seconds} detik |`)].join('\n');
  fs.writeFileSync(path.join(REPORTS, 'SUMMARY.md'), md);
  console.log(`\n${md}\n`);
  return results.every((r) => r.ok);
}

(async () => {
  const name = process.argv[2] || 'all';
  const fn = name === 'all' ? runAll : suites[name];
  if (!fn) { console.error(`Suite tidak dikenal: ${name}. Pilihan: ${Object.keys(suites).join(', ')}, all`); process.exit(2); }
  const ok = await fn();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
