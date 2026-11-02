'use strict';
/** Penandatanganan JWT RS256. Pasangan kunci dibuat sekali di folder data dan dipublikasikan lewat JWKS. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SignJWT, importPKCS8, exportJWK } = require('jose');
const config = require('../shared/config');

const file = path.join(config.dataDir, 'auth-signing-key.json');
fs.mkdirSync(config.dataDir, { recursive: true });

function loadPair() {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pair = {
    kid: crypto.randomBytes(8).toString('hex'),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  fs.writeFileSync(file, JSON.stringify(pair), { mode: 0o600 });
  return pair;
}

const pair = loadPair();
let signingKey;
let publicJwk;
const ready = (async () => {
  signingKey = await importPKCS8(pair.privatePem, 'RS256');
  publicJwk = await exportJWK(crypto.createPublicKey(pair.publicPem));
  Object.assign(publicJwk, { kid: pair.kid, alg: 'RS256', use: 'sig' });
})();

async function issueAccessToken({ sub, role, scope, clientId, name }) {
  await ready;
  return new SignJWT({ role, scope, client_id: clientId, ...(name ? { name } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: pair.kid, typ: 'JWT' })
    .setIssuer(config.iss)
    .setAudience(config.aud)
    .setSubject(sub)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${config.accessTtl}s`)
    .sign(signingKey);
}

function jwks() { return { keys: publicJwk ? [publicJwk] : [] }; }

module.exports = { issueAccessToken, jwks, ready };
