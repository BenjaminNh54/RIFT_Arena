// RIFT ARENA — migration runner: applies schema + numbered migrations, tracks applied set.
// Usage: npm run db:migrate   (uses env MYSQL_*; errors out with a clear message if not configured)
import './server/src/config/load-env.js';
import { CONFIG } from '../server/src/config/index.js';
import mysql from 'mysql2/promise';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

if (!CONFIG.MYSQL_HOST || !CONFIG.MYSQL_USER || !CONFIG.MYSQL_DATABASE) {
  console.error('MySQL not configured (MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE).');
  console.error('Local dev works without it (JSON store). Configure .env to target Alwaysdata.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: CONFIG.MYSQL_HOST, port: CONFIG.MYSQL_PORT, user: CONFIG.MYSQL_USER,
  password: CONFIG.MYSQL_PASSWORD, database: CONFIG.MYSQL_DATABASE,
  multipleStatements: true,
  connectionLimit: 4,
});

async function main() {
  // migrations table
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name VARCHAR(80) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // 1. base schema
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('schema.sql applied (IF NOT EXISTS — idempotent)');

  // 2. numbered migrations not yet applied
  const [applied] = await pool.query('SELECT name FROM _migrations');
  const done = new Set(applied.map(r => r.name));
  const files = readdirSync(join(here, 'migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) { console.log(`skip ${f} (applied)`); continue; }
    const sql = readFileSync(join(here, 'migrations', f), 'utf8').replace(/^SOURCE .+;$/m, ''); // handled by schema.sql
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (name) VALUES (?)', [f]);
    console.log(`applied ${f}`);
  }
  console.log('migrations complete.');
  await pool.end();
}

main().catch((e) => {
  console.error('migration failed:', e.message);
  process.exit(1);
});
