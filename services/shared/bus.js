'use strict';
/** Klien message broker: publish at-least-once dan consumer long-poll dengan ack/nack. */
const crypto = require('node:crypto');
const config = require('./config');

function createBus(http, log, consumerName) {
  async function publish(topic, payload, { key = null, id = crypto.randomUUID() } = {}) {
    const r = await http.request(`${config.urls.broker}/publish`, { method: 'POST', body: { id, topic, key, payload } });
    if (r.status >= 300) throw new Error(`broker menolak publish: ${r.status}`);
    return id;
  }
  /** Publish yang tidak boleh menggagalkan alur utama (audit, notifikasi tambahan). */
  const publishSafe = (topic, payload, opts) => publish(topic, payload, opts).catch((e) => log.warn('publish gagal', { topic, err: e.message }));

  function consume(queue, handler, { waitMs = 4000, max = 10 } = {}) {
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          const r = await http.request(`${config.urls.broker}/consume`, { method: 'POST', timeout: waitMs + 4000, body: { queue, consumer: consumerName, max, waitMs } });
          for (const m of r.json?.messages || []) {
            try {
              await handler(m);
              await http.request(`${config.urls.broker}/ack`, { method: 'POST', body: { queue, leaseToken: m.leaseToken } });
            } catch (e) {
              log.warn('pesan gagal diproses', { queue, topic: m.topic, err: e.message });
              await http.request(`${config.urls.broker}/nack`, { method: 'POST', body: { queue, leaseToken: m.leaseToken, error: String(e.message).slice(0, 200) } }).catch(() => {});
            }
          }
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    loop();
    return () => { stopped = true; };
  }
  return { publish, publishSafe, consume };
}

module.exports = { createBus };
