'use strict';
/**
 * Membuat CA internal dan sertifikat per service untuk mTLS.
 * Juga membuat dua identitas khusus pengujian keamanan:
 *  - intruder: sah dari CA internal tetapi bukan service terdaftar (harus ditolak requireCN)
 *  - rogue: ditandatangani CA lain (harus gagal saat handshake)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const forge = require('node-forge');

const SERVICES = ['gateway', 'registry', 'broker', 'auth', 'catalog', 'booking', 'payment', 'notification', 'intruder'];
const pki = forge.pki;

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { pem, forgePrivate: pki.privateKeyFromPem(pem), forgePublic: pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' })) };
}

const serial = () => `01${crypto.randomBytes(8).toString('hex')}`;

function makeCa(cn) {
  const k = keyPair();
  const cert = pki.createCertificate();
  cert.publicKey = k.forgePublic;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86400000);
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Rangkai Dev CA' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  cert.sign(k.forgePrivate, forge.md.sha256.create());
  return { cert, key: k };
}

function makeLeaf(cn, ca) {
  const k = keyPair();
  const cert = pki.createCertificate();
  cert.publicKey = k.forgePublic;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 825 * 86400000);
  cert.setSubject([{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Rangkai' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: cn }, ...(cn === 'booking' ? [{ type: 2, value: 'booking-a' }, { type: 2, value: 'booking-b' }] : []), { type: 7, ip: '127.0.0.1' }] },
  ]);
  cert.sign(ca.key.forgePrivate, forge.md.sha256.create());
  return { cert, key: k };
}

function generateCerts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, leaf) => {
    fs.writeFileSync(path.join(dir, `${name}.crt`), pki.certificateToPem(leaf.cert));
    fs.writeFileSync(path.join(dir, `${name}.key`), leaf.key.pem, { mode: 0o600 });
  };
  const ca = makeCa('Rangkai Internal CA');
  fs.writeFileSync(path.join(dir, 'ca.crt'), pki.certificateToPem(ca.cert));
  for (const s of SERVICES) write(s, makeLeaf(s, ca));
  const rogueCa = makeCa('Rogue CA');
  write('rogue', makeLeaf('gateway', rogueCa));
}

module.exports = { generateCerts };
