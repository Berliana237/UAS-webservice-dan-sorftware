'use strict';
/** SQLite per service (hak akses minimum: tiap service hanya membuka file database miliknya). Semua query memakai prepared statement. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

function open(name) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, `${name}.db`));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON;');
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
}

module.exports = { open };
