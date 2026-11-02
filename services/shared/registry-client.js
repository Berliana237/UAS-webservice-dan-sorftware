'use strict';
/** Service discovery sisi klien: mendaftar + heartbeat, serta resolusi instance dengan cache dan round robin. */
const config = require('./config');

function createRegistryClient(http, log) {
  const cache = new Map();
  const cursor = new Map();
  const down = new Map();
  let beat = null;

  async function register(name, url, meta = {}) {
    const instanceId = process.env.INSTANCE_ID || `${name}-${process.pid}`;
    const body = { name, instanceId, url, meta };
    const send = async () => {
      try { await http.request(`${config.urls.registry}/register`, { method: 'POST', body }); } catch (e) { log.warn('registry belum bisa dihubungi', { err: e.code || e.message }); }
    };
    await send();
    beat = setInterval(send, 4000);
    beat.unref();
    const bye = () => {
      setTimeout(() => process.exit(0), 300).unref();
      http.request(`${config.urls.registry}/deregister`, { method: 'POST', body: { name, instanceId } }).catch(() => {}).finally(() => process.exit(0));
    };
    process.once('SIGTERM', bye);
    process.once('SIGINT', bye);
  }

  async function instances(name) {
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < 2000) return hit.list;
    try {
      const r = await http.request(`${config.urls.registry}/services/${name}`, { timeout: 2000 });
      const list = r.json?.instances || [];
      cache.set(name, { at: Date.now(), list });
      return list;
    } catch (e) {
      if (hit) return hit.list; // registry sesaat mati: pakai daftar terakhir
      throw e;
    }
  }

  /** Round robin di antara instance sehat. Instance yang baru saja gagal dilewati selama 5 detik. */
  async function pick(name) {
    const list = await instances(name);
    const live = list.filter((i) => (down.get(i.instanceId) || 0) < Date.now());
    const pool = live.length ? live : list;
    if (!pool.length) return null;
    const n = cursor.get(name) || 0;
    cursor.set(name, n + 1);
    return pool[n % pool.length];
  }

  const markDown = (instance) => { down.set(instance.instanceId, Date.now() + 5000); };

  /** Memanggil service lain lewat discovery; pindah ke instance berikutnya bila koneksi gagal. */
  async function call(name, path, opts = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const inst = await pick(name);
      if (!inst) throw Object.assign(new Error(`tidak ada instance ${name}`), { code: 'NO_INSTANCE' });
      try { return await http.request(inst.url + path, opts); } catch (e) { lastErr = e; markDown(inst); }
    }
    throw lastErr;
  }

  return { register, instances, pick, markDown, call };
}

module.exports = { createRegistryClient };
