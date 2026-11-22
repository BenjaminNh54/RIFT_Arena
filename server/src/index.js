// RIFT ARENA — server entrypoint: HTTP + static + WebSocket + wiring + auto-seed
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { CONFIG, USE_MYSQL } from './config/index.js';
import { getStore, getConfig } from './database/index.js';
import { AuthService } from './auth/index.js';
import { createApi } from './api/index.js';
import { RoomManager } from './game/rooms.js';
import { Matchmaker } from './matchmaking/index.js';
import { SocialSystem } from './systems/social.js';
import { EconomySystem } from './systems/economy.js';
import { RewardSystem } from './systems/rewards.js';
import { AdminApi } from './admin/api.js';
import { attachGateway } from './websocket/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../..');   // server/src -> project root
const CLIENT_DIR = join(ROOT, 'client');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ttf': 'font/ttf',
};

// ---------- bootstrap systems ----------
// No-shell deployments (Render free): MySQL schema + migrations are applied at boot.
// MySQL is the active store whenever it is configured — a failed schema replay is
// therefore ALWAYS fatal (a broken schema would crash every query), regardless of
// DB_STRICT. JSON fallback only exists when MySQL is not configured at all.
import { autoMigrate, mysqlConfigured } from './database/auto-migrate.js';
let db;
try {
  db = await getStore(); // strict gate: throws in production if MySQL is missing/unreachable
} catch (e) {
  console.error('[boot] BASE DE DONNÉES INDISPONIBLE —', e.message);
  console.error('[boot] Sur Render : vérifie MYSQL_HOST/USER/PASSWORD/DATABASE (Alwaysdata) puis redéploie. (DB_STRICT=0 pour forcer le JSON en dev seulement.)');
  process.exit(1);
}
try {
  const mig = await autoMigrate(console.log);
  if (mig.ran) console.log(`[boot] MySQL prêt — schéma + ${mig.appliedMigrations} migration(s) appliquée(s)`);
} catch (e) {
  console.error('[boot] AUTO-MIGRATE ÉCHOUÉ —', e.message);
  console.error('[boot] Le schéma MySQL n\'est pas complet : arrêt (les requêtes planteraient). Corrige la base (voir AUDIT_REPORT.md §13) puis redéploie.');
  process.exit(1);
}
const auth = new AuthService(db);
const config = () => getConfig();
const rooms = new RoomManager(db, null, config);
const rewards = new RewardSystem(db, config);
rooms.systems = rewards;
const matchmaker = new Matchmaker(rooms, config);
const social = new SocialSystem(db, rooms);
const economy = new EconomySystem(db, config);
const admin = new AdminApi({ db, getConfig: config, rooms, matchmaker, social, economy });
const api = createApi({ auth, db, social, economy, rewards, matchmaker, rooms, admin, getConfig: config });

let lastAnnouncement = null;
admin.announce = (msg) => {
  lastAnnouncement = msg;
  for (const [, set] of rooms.sockets) for (const ws of set) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
};

// ---------- auto-seed default content ----------
// Resilient: one failing seed block must not crash the boot (logged and skipped).
await seedContent(db, config);

async function seedContent(db, config) {
  const safe = async (label, fn) => {
    try { await fn(); }
    catch (e) { console.error(`[seed] ${label} a échoué —`, e.message); }
  };
  await safe('events seeded', async () => {
    if ((await db.listEvents()).length !== 0) return;
    const { EVENT_SEEDS } = await import('../../shared/game-config/defaults.js');
    const t = Date.now();
    for (const ev of EVENT_SEEDS) {
      await db.upsertEvent({
        ...ev, status: 'active',
        startAt: new Date(t - 3600e3).toISOString(),
        endAt: new Date(t + 7 * 86400e3).toISOString(),
      });
    }
    console.log('[seed] events seeded');
  });
  await safe('news seeded', async () => {
    if ((await db.listNews({ publishedOnly: false })).length !== 0) return;
    const { NEWS_SEEDS } = await import('../../shared/game-config/defaults.js');
    for (const n of NEWS_SEEDS) await db.upsertNews({ ...n, id: n.title.toLowerCase().replace(/\W+/g, '_').slice(0, 40), published: true, date: new Date().toISOString(), author: 'TB_games' });
    console.log('[seed] news seeded');
  });
  await safe('shop catalog ensured', () => economy.ensureCatalog());
  await safe('battle pass ensured', () => economy.ensurePass());
  await safe('ranked season ensured', async () => {
    if (!await db.getSeason()) {
      await db.ensureSeason({ name: 'Season 1 — Rift Awakening', endsAt: new Date(Date.now() + 30 * 86400e3).toISOString() });
    }
  });
}

// ---------- HTTP ----------
const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch { pathname = '/'; }

  // security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    if (pathname.startsWith('/api/')) {
      return await api(req, res, pathname);
    }

    // health check for Render — reports the REAL database state
    if (pathname === '/healthz') {
      const { dbHealth } = await import('./database/index.js');
      const db = await dbHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 'ok',
        db: { mode: db.mode, state: db.state, label: db.label, ...(db.error ? { error: db.error } : {}) },
        uptime_s: Math.floor(process.uptime()),
      }));
    }

    // static files with SPA fallback
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); return res.end();
    }
    return serveStatic(pathname, res);
  } catch (e) {
    console.error('[http]', pathname, e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'SERVER_ERROR' })); }
  }
});

function serveStatic(pathname, res) {
  try {
    if (pathname === '/') pathname = '/index.html';
    // shared game definitions are served to the browser (public data, no secrets)
    const shared = pathname.startsWith('/shared/');
    let file = shared ? join(ROOT, pathname) : join(CLIENT_DIR, pathname.replace(/\\/g, '/').replace(/\.\./g, ''));
    let notFound = false;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (!pathname.startsWith('/assets/')) file = join(CLIENT_DIR, 'index.html'); // SPA fallback
      else notFound = true;
    }
    if (notFound) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache';
    const body = readFileSync(file);
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(body);
    }
  } catch (e) {
    console.error('[static]', pathname, e.message);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('static error'); }
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });
attachGateway(wss, { auth, db, rooms, social, matchmaker, getConfig: config });

// graceful shutdown (Render)
function shutdown(signal) {
  console.log(`[server] ${signal} — closing`);
  for (const ws of wss.clients) { try { ws.close(1001, 'server shutdown'); } catch { /* gone */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

server.listen(CONFIG.PORT, () => {
  console.log(`RIFT ARENA server — port ${CONFIG.PORT} — env ${CONFIG.NODE_ENV} — db ${db.kind ?? 'json'}`);
  console.log(`  client served from ${CLIENT_DIR}`);
});
