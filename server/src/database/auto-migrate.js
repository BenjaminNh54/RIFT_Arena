// RIFT ARENA — auto-migration at server boot (no shell required: Render free, PaaS).
// When MySQL is configured, applies database/schema.sql (idempotent) + numbered
// migrations not yet applied, tracked in _migrations. Statements run ONE BY ONE so
// a failure names the exact SQL — and the error propagates: with MySQL configured
// the store IS MySQL, so a broken schema must abort the boot (index.js exits).
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

// split an SQL file into individual statements using a small state scanner:
// a semicolon only ends a statement OUTSIDE of quoted strings; -- and /* */
// comments are stripped (they may legally contain semicolons, e.g.
// "-- sha256 of token; raw token never stored" which must NOT split).
export function splitSqlStatements(sql) {
  const out = [];
  let cur = '';
  let strCh = null; // active quote char: ' " or `
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], n = sql[i + 1];
    if (strCh) {
      cur += c;
      if (c === strCh) {
        if (sql[i + 1] === strCh) { cur += sql[i + 1]; i++; } // escaped doubling ''
        else strCh = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { strCh = c; cur += c; continue; }
    if (c === '-' && n === '-') { // line comment — swallow to end of line
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += ' ';
      continue;
    }
    if (c === '/' && n === '*') { // block comment
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++;
      cur += ' ';
      continue;
    }
    if (c === ';') {
      const s = cur.trim();
      if (s) out.push(s);
      cur = '';
      continue;
    }
    cur += c;
  }
  const s = cur.trim();
  if (s) out.push(s);
  return out;
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
    charset: 'utf8mb4_unicode_ci',
  });
  const runStatements = async (sql, label) => {
    const statements = splitSqlStatements(sql);
    for (let i = 0; i < statements.length; i++) {
      try {
        await conn.query(statements[i]);
      } catch (e) {
        const head = statements[i].replace(/\s+/g, ' ').slice(0, 120);
        throw new Error(`${label} — statement ${i + 1}/${statements.length} échoué: ${e.message} | SQL: ${head}`);
      }
    }
  };
  try {
    // migration tracking table (explicit collation, kept even though schema.sql also creates it)
    await conn.query(`CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(80) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // 1) base schema — every statement is IF NOT EXISTS, safe to re-run
    const schema = readFileSync(join(DB_DIR, 'schema.sql'), 'utf8');
    await runStatements(schema, 'schema.sql');
    log('[auto-migrate] schema.sql appliqué (toutes les tables)');

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
      await runStatements(sql, `migration ${f}`);
      await conn.query('INSERT INTO _migrations (name) VALUES (?)', [f]);
      appliedCount++;
      log(`[auto-migrate] migration ${f} appliquée`);
    }
    return { ran: true, appliedMigrations: appliedCount };
  } finally {
    await conn.end();
  }
}
