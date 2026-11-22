// RIFT ARENA — seed default content (events, news, shop catalog, battle pass, ranked season, config).
// Works against MySQL when configured, JSON store otherwise (same DAO).
import '../server/src/config/load-env.js';
import { getStore } from '../server/src/database/index.js';
import { EconomySystem } from '../server/src/systems/economy.js';

const db = await getStore();
const economy = new EconomySystem(db, () => ({}));

if ((await db.listEvents()).length === 0) {
  const { EVENT_SEEDS } = await import('../shared/game-config/defaults.js');
  const t = Date.now();
  for (const ev of EVENT_SEEDS) {
    await db.upsertEvent({
      ...ev, status: 'active',
      startAt: new Date(t - 3600e3).toISOString(),
      endAt: new Date(t + 7 * 86400e3).toISOString(),
    });
  }
  console.log('events seeded:', EVENT_SEEDS.length);
}
if ((await db.listNews({ publishedOnly: false })).length === 0) {
  const { NEWS_SEEDS } = await import('../shared/game-config/defaults.js');
  for (const n of NEWS_SEEDS) {
    await db.upsertNews({ ...n, id: n.title.toLowerCase().replace(/\W+/g, '_').slice(0, 40), published: true, date: new Date().toISOString(), author: 'TB_games' });
  }
  console.log('news seeded:', NEWS_SEEDS.length);
}
await economy.ensureCatalog();
await economy.ensurePass();
if (!await db.getSeason()) {
  await db.ensureSeason({ name: 'Season 1 — Rift Awakening', endsAt: new Date(Date.now() + 30 * 86400e3).toISOString() });
  console.log('ranked season created');
}
console.log('seed complete.');
