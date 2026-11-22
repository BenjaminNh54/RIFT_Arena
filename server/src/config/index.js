// RIFT ARENA — server config (env-driven, no hardcoded secrets)
import './load-env.js';
import { randomBytes } from 'node:crypto';

function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const CONFIG = {
  PORT: parseInt(env('PORT', '8080'), 10),
  NODE_ENV: env('NODE_ENV', 'development'),
  SESSION_SECRET: env('SESSION_SECRET', null),
  ADMIN_BOOTSTRAP_KEY: env('ADMIN_BOOTSTRAP_KEY', null),
  MYSQL_HOST: env('MYSQL_HOST', null),
  MYSQL_PORT: parseInt(env('MYSQL_PORT', '3306'), 10),
  MYSQL_USER: env('MYSQL_USER', null),
  MYSQL_PASSWORD: env('MYSQL_PASSWORD', null),
  MYSQL_DATABASE: env('MYSQL_DATABASE', null),
  DATA_DIR: env('DATA_DIR', './data'),
  CLIENT_DIR: env('CLIENT_DIR', './client'),
  TICK_RATE: 20,
  SNAPSHOT_RATE: 15,
};

export const USE_MYSQL = Boolean(CONFIG.MYSQL_HOST && CONFIG.MYSQL_USER && CONFIG.MYSQL_DATABASE);

if (!CONFIG.SESSION_SECRET) {
  // Dev fallback: random per-boot secret (sessions invalidate on restart — safe default)
  CONFIG.SESSION_SECRET = randomBytes(32).toString('hex');
  if (CONFIG.NODE_ENV === 'production') {
    console.warn('[config] SESSION_SECRET not set — generating an ephemeral one. Set SESSION_SECRET in production!');
  }
}
