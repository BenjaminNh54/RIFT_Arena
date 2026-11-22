// RIFT ARENA — database entrypoint. Chooses MySQL when configured, JSON store otherwise.
import { CONFIG, USE_MYSQL } from '../config/index.js';
import { JsonStore } from './json_store.js';

let store = null;

// Strict mode: production must never silently fall back to the JSON store —
// data would LOOK persisted while nothing reaches Alwaysdata. DB_STRICT=0 overrides.
export const STRICT_DB = process.env.DB_STRICT
  ? process.env.DB_STRICT !== '0'
  : CONFIG.NODE_ENV === 'production';

export async function getStore() {
  if (store) return store;
  if (USE_MYSQL) {
    try {
      const { MysqlStore } = await import('./mysql_store.js');
      store = await MysqlStore.connect(CONFIG);
      console.log('[db] MYSQL CONNECTÉ —', CONFIG.MYSQL_HOST, CONFIG.MYSQL_DATABASE);
      return store;
    } catch (e) {
      console.error('[db] MYSQL EN ERREUR —', e.code ?? '', e.message);
      if (STRICT_DB) {
        console.error('[db] MODE STRICT : démarrage refusé sur le stockage JSON (les données ne seraient pas persistées dans Alwaysdata). Corrige les variables MYSQL_* ou mets DB_STRICT=0 en dev.');
        throw e;
      }
      console.warn('[db] MODE JSON LOCAL (développement) — les données ne vont PAS vers MySQL.');
    }
  } else if (STRICT_DB) {
    console.error('[db] PRODUCTION sans MySQL : MYSQL_HOST/USER/PASSWORD/DATABASE sont requis. Renseigne les variables Alwaysdata sur Render (DB_STRICT=0 pour forcer le JSON en dev seulement).');
    throw new Error('MYSQL_NOT_CONFIGURED');
  } else {
    console.warn('[db] MODE JSON LOCAL — configure MySQL pour la persistance réelle.');
  }
  store = new JsonStore(CONFIG.DATA_DIR);
  console.log('[db] JSON store at', CONFIG.DATA_DIR);
  return store;
}

// Real DB state for /healthz and logs: MYSQL CONNECTÉ / MYSQL EN ERREUR / MODE JSON LOCAL
export async function dbHealth() {
  if (!store) return { mode: 'none', state: 'down', label: 'DB NON INITIALISÉE' };
  if (store.kind === 'mysql') {
    try {
      await store.ping();
      return { mode: 'mysql', state: 'connected', label: 'MYSQL CONNECTÉ' };
    } catch (e) {
      return { mode: 'mysql', state: 'error', error: String(e.message ?? e).slice(0, 140), label: 'MYSQL EN ERREUR' };
    }
  }
  return {
    mode: 'json',
    state: STRICT_DB ? 'error' : 'local',
    label: STRICT_DB ? 'MYSQL EN ERREUR (repli JSON temporaire)' : 'MODE JSON LOCAL',
  };
}

// Config access with defaults: DB overrides layered on top of DEFAULT_CONFIG
import { DEFAULT_CONFIG } from '../../../shared/game-config/defaults.js';
const configCache = { values: null, at: 0 };

export async function getConfig() {
  if (configCache.values && Date.now() - configCache.at < 10000) return configCache.values;
  const db = await getStore();
  const overrides = await db.getAllConfig();
  configCache.values = { ...DEFAULT_CONFIG, ...overrides };
  configCache.at = Date.now();
  return configCache.values;
}
export function invalidateConfig() { configCache.values = null; }
