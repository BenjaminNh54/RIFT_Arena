// RIFT ARENA — auto-migration at server boot (no shell required: Render free, PaaS).
// When MySQL is configured, applies database/schema.sql (idempotent) + numbered
// migrations not yet applied, tracked in _migrations. Fails soft: on error the
// server keeps booting (JSON fallback) with a clear log message.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { CONFIG } from '../config/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(here, '../../../database'); // server/src/database -> <project>/database

export function mysqlConfigured() {
  return Boolean(CONFIG.MYSQL_HOST && CONFIG.MYSQL_USER && CONFIG.MYSQL_DATABASE);
}

export async function autoMigrate(log = console.log) {
  if (!mysqlConfigured()) {
    return { ran: false, reason: 'mysql-not-configured (JSON fallback store active)' };
  }
  const conn = await mysql.createConnection({
    host: CONFIG.MYSQL_HOST,
    port: CONFIG.MYSQL_PORT,
    user: CONFIG.MYSQL_USER,
    password: CONFIG.MYSQL_PASSWORD,
    database: CONFIG.MYSQL_DATABASE,
    multipleStatements: true,
    connectTimeout: 10000,
  });
  try {
    // migration tracking table (kept even though schema.sql also creates it)
    await conn.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(80) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    // 1) base schema — every statement is IF NOT EXISTS, safe to re-run
    const schema = readFileSync(join(DB_DIR, 'schema.sql'), 'utf8');
    await conn.query(schema);
    log('[auto-migrate] schema.sql applied');

    // 2) numbered migrations not yet applied (SOURCE lines are handled above)
    const [applied] = await conn.query('SELECT name FROM _migrations');
    const done = new Set(applied.map(r => r.name));
    let files = [];
    try { files = readdirSync(join(DB_DIR, 'migrations')).filter(f => f.endsWith('.sql')).sort(); }
    catch { /* no migrations dir in deployment bundle */ }
    let appliedCount = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(join(DB_DIR, 'migrations', f), 'utf8').replace(/^SOURCE .+;$/m, '');
      await conn.query(sql);
      await conn.query('INSERT INTO _migrations (name) VALUES (?)', [f]);
      appliedCount++;
      log(`[auto-migrate] applied ${f}`);
    }
    return { ran: true, appliedMigrations: appliedCount };
  } finally {
    await conn.end();
  }
}
