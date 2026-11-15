'use strict';
/** Pemeriksaan berkas bukti transfer dari isinya (magic bytes). Fungsi murni, diuji unit test. */
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

function sniffMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.toString('ascii', 0, 4) === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

module.exports = { sniffMime, MAX_PROOF_BYTES };
