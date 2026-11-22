// RIFT ARENA — shared constants (used by server AND client)

export const GAME = {
  TICK_RATE: 20,              // server simulation ticks / second
  TICK_MS: 1000 / 20,
  SNAPSHOT_RATE: 15,          // snapshots sent per second
  INTERP_DELAY_MS: 100,       // client render delay behind latest snapshot
  TILE: 64,                   // world px per tile
  MAX_PLAYERS_TEAM: 3,
  FFA_PLAYERS: 8,
  RESPAWN_MS: 3500,
  MATCH_OVERTIME_MS: 30000,
  MAX_USERNAME: 16,
  MIN_USERNAME: 3,
  MIN_PASSWORD: 6,
  SESSION_DAYS: 30,
};

// Tile ids (grid codes) — mirror of editor palette
export const TILE = {
  FLOOR: 0, WALL: 1, CRATE: 2, BUSH: 3, WATER: 4, HAZARD: 5, PORTAL: 6,
};

// Tile properties used by movement / projectiles / vision
export const TILE_PROPS = {
  0: { solid: false, blocksShot: false, hide: false, water: false },
  1: { solid: true, blocksShot: true, hide: false, water: false },
  2: { solid: true, blocksShot: true, hide: false, water: false, destructible: true, hp: 2000 },
  3: { solid: false, blocksShot: false, hide: true, water: false },
  4: { solid: true, blocksShot: false, hide: false, water: true },
  5: { solid: false, blocksShot: false, hide: false, water: false, hazard: true, dps: 800 },
  6: { solid: false, blocksShot: false, hide: false, water: false, portal: true },
};

// Fighter classes
export const CLASSES = ['Assault', 'Sniper', 'Tank', 'Support', 'Controller', 'Assassin', 'Engineer'];

// Rarities
export const RARITIES = {
  starter: { name: 'Starter', color: '#9fb4c7' },
  rare: { name: 'Rare', color: '#39c46f' },
  epic: { name: 'Epic', color: '#b14ef0' },
  legendary: { name: 'Legendary', color: '#f7a531' },
};

// Currencies
export const CURRENCY = {
  CREDITS: 'credits',
  TOKENS: 'rift_tokens',
  PASS_XP: 'pass_xp',
  TROPHIES: 'trophies',
};

// Admin roles and their permission matrix (server-enforced)
export const ADMIN_ROLES = {
  ADMIN: {
    label: 'Admin',
    perms: ['*'],
  },
  MODERATOR: {
    label: 'Moderator',
    perms: [
      'players.view', 'reports.view', 'reports.resolve', 'mute', 'tempban',
      'unban.own', 'chat.view', 'matches.view', 'logs.view', 'news.view',
    ],
  },
  HELPER: {
    label: 'Helper',
    perms: ['players.view', 'reports.view', 'chat.view'],
  },
};

export function hasPerm(role, perm) {
  const def = ADMIN_ROLES[role];
  if (!def) return false;
  return def.perms.includes('*') || def.perms.includes(perm);
}

// Server-config keys admins may override at runtime (validated in shared/validators)
export const CONFIG_KEYS = [
  'trophies.win', 'trophies.loss', 'trophies.star_player_bonus', 'trophies.max_gain',
  'ranked.rp_win', 'ranked.rp_loss', 'ranked.protect_streak',
  'matchmaking.timeout_ms', 'matchmaking.fill_bots_normal', 'matchmaking.fill_bots_ranked',
  'xp.per_match', 'xp.win_bonus', 'credits.per_match', 'pass.xp_per_match',
  'events.max_active', 'shop.rotation_size', 'global.chat_rate_ms',
];

// Event modifiers whitelist — engine-supported only, no arbitrary scripts
export const EVENT_MODIFIERS = [
  'speed_mult', 'damage_mult', 'cooldown_mult', 'energy_mult',
  'no_bushes', 'same_fighter', 'mini_fighters', 'no_obstacles', 'double_ammo', 'regen',
];

// Graphics quality presets
export const GRAPHICS = {
  low:    { particles: 0.3, shake: 0, glow: false, decor: false },
  medium: { particles: 0.7, shake: 0.7, glow: true, decor: true },
  high:   { particles: 1, shake: 1, glow: true, decor: true },
};
