'use strict';
/** Perakitan standar sebuah service: logger, klien mTLS, discovery, bus, dan verifier JWT. */
const { logger } = require('./log');
const mtls = require('./mtls');
const { createRegistryClient } = require('./registry-client');
const { createBus } = require('./bus');
const { createVerifier } = require('./jwt');

function kit(name) {
  const log = logger(name);
  const http = mtls.client(name);
  const registry = createRegistryClient(http, log);
  const bus = createBus(http, log, process.env.INSTANCE_ID || name);
  const verifier = createVerifier(http);
  process.on('uncaughtException', (e) => log.error('uncaught', { err: e.message, stack: e.stack }));
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', { err: e?.message }));
  return { log, http, registry, bus, verifier };
}

module.exports = { kit };
