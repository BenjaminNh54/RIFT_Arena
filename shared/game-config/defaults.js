// RIFT ARENA — default configurable content (seeded into DB; admin-editable at runtime)

export const DEFAULT_CONFIG = {
  'trophies.win': 8, 'trophies.loss': -3, 'trophies.star_player_bonus': 2, 'trophies.max_gain': 10,
  'ranked.rp_win': 25, 'ranked.rp_loss': -18, 'ranked.protect_streak': 3,
  'matchmaking.timeout_ms': 20000, 'matchmaking.fill_bots_normal': true, 'matchmaking.fill_bots_ranked': false,
  'xp.per_match': 24, 'xp.win_bonus': 12, 'credits.per_match': 18, 'pass.xp_per_match': 20,
  'events.max_active': 4, 'shop.rotation_size': 6, 'global.chat_rate_ms': 1200,
  'maintenance': false,
};

// Trophy Road — global trophy milestones (admin-configurable in DB table game_config / trophy_road)
export const TROPHY_ROAD = [
  { at: 0, reward: { type: 'credits', amount: 150 }, label: 'Starter cache' },
  { at: 50, reward: { type: 'fighter', id: 'vex' }, label: 'VEX joins your roster' },
  { at: 100, reward: { type: 'credits', amount: 200 }, label: 'Credit drop' },
  { at: 200, reward: { type: 'fighter', id: 'brakk' }, label: 'BRAKK joins your roster' },
  { at: 350, reward: { type: 'chest', id: 'cosmic', amount: 1 }, label: 'Cosmic chest' },
  { at: 500, reward: { type: 'title', id: 'rift_walker' }, label: 'Title: Rift Walker' },
  { at: 750, reward: { type: 'fighter', id: 'nyx' }, label: 'NYX joins your roster' },
  { at: 1000, reward: { type: 'credits', amount: 400 }, label: 'Credit vault' },
  { at: 1500, reward: { type: 'skin', fighter: 'volt', id: 'volt_gold' }, label: 'VOLT Gold Circuit skin' },
  { at: 2000, reward: { type: 'fighter', id: 'kiro' }, label: 'KIRO joins your roster' },
  { at: 3000, reward: { type: 'banner', id: 'banner_nebula' }, label: 'Banner: Nebula' },
  { at: 5000, reward: { type: 'fighter', id: 'patch' }, label: 'PATCH joins your roster' },
  { at: 7500, reward: { type: 'title', id: 'rift_legend' }, label: 'Title: Rift Legend' },
  { at: 10000, reward: { type: 'credits', amount: 1000 }, label: 'Master vault' },
];

// Battle Pass — Season 1 "Rift Awakening"
export const BATTLE_PASS = {
  id: 'pass_s1', season: 1, name: 'Rift Awakening',
  tiers: 30, xpPerTier: 120,
  rewards: (i) => {
    // deterministic generation: alternating free/premium rewards
    const free = [
      { type: 'credits', amount: 80 }, { type: 'chest', id: 'cosmic', amount: 1 },
      { type: 'credits', amount: 120 }, { type: 'rift_tokens', amount: 30 },
      { type: 'credits', amount: 150 }, { type: 'banner', id: 'banner_ion' },
    ];
    const prem = [
      { type: 'skin', fighter: 'vex', id: 'vex_void' }, { type: 'rift_tokens', amount: 60 },
      { type: 'skin', fighter: 'nyx', id: 'nyx_bloom' }, { type: 'title', id: 'storm_rider' },
      { type: 'skin', fighter: 'kiro', id: 'kiro_phantom' }, { type: 'emote', id: 'emote_wrench' },
    ];
    return {
      tier: i + 1,
      free: free[i % free.length],
      premium: prem[i % prem.length],
    };
  },
  premiumPrice: { currency: 'rift_tokens', amount: 170 },
};

// Shop catalog (rotations + permanent offers). Skins come from fighter defs.
export const SHOP_CATALOG = [
  { id: 'skins_volt_gold', kind: 'skin', ref: 'volt/volt_gold', price: 320, currency: 'credits' },
  { id: 'skins_vex_void', kind: 'skin', ref: 'vex/vex_void', price: 80, currency: 'rift_tokens' },
  { id: 'skins_nyx_bloom', kind: 'skin', ref: 'nyx/nyx_bloom', price: 80, currency: 'rift_tokens' },
  { id: 'skins_kiro_phantom', kind: 'skin', ref: 'kiro/kiro_phantom', price: 120, currency: 'rift_tokens' },
  { id: 'skins_patch_hazard', kind: 'skin', ref: 'patch/patch_hazard', price: 120, currency: 'rift_tokens' },
  { id: 'skins_brakk_magma', kind: 'skin', ref: 'brakk/brakk_magma', price: 80, currency: 'rift_tokens' },
  { id: 'banner_ion', kind: 'banner', ref: 'banner_ion', price: 150, currency: 'credits' },
  { id: 'banner_nebula', kind: 'banner', ref: 'banner_nebula', price: 260, currency: 'credits' },
  { id: 'banner_rift', kind: 'banner', ref: 'banner_rift', price: 200, currency: 'credits' },
  { id: 'avatar_ion', kind: 'avatar', ref: 'avatar_ion', price: 100, currency: 'credits' },
  { id: 'avatar_shade', kind: 'avatar', ref: 'avatar_shade', price: 100, currency: 'credits' },
  { id: 'avatar_pulse', kind: 'avatar', ref: 'avatar_pulse', price: 100, currency: 'credits' },
  { id: 'title_arena_regular', kind: 'title', ref: 'Arena Regular', price: 180, currency: 'credits' },
  { id: 'title_core_hunter', kind: 'title', ref: 'Core Hunter', price: 240, currency: 'credits' },
  { id: 'emote_wrench', kind: 'emote', ref: 'emote_wrench', price: 70, currency: 'credits' },
  { id: 'emote_thumbsup', kind: 'emote', ref: 'emote_thumbsup', price: 70, currency: 'credits' },
  { id: 'emote_skull', kind: 'emote', ref: 'emote_skull', price: 90, currency: 'credits' },
  { id: 'effect_trail_ion', kind: 'effect', ref: 'trail_ion', price: 140, currency: 'credits' },
  { id: 'effect_trail_magma', kind: 'effect', ref: 'trail_magma', price: 140, currency: 'credits' },
  { id: 'chest_cosmic', kind: 'chest', ref: 'cosmic', price: 300, currency: 'credits' },
];

// Chest contents (cosmetic chest — deterministic-ish weighted loot, server rolls)
export const CHESTS = {
  cosmic: {
    name: 'Cosmic Chest',
    rolls: 2,
    pool: [
      { kind: 'credits', amount: 120, weight: 30 },
      { kind: 'credits', amount: 260, weight: 16 },
      { kind: 'rift_tokens', amount: 40, weight: 20 },
      { kind: 'rift_tokens', amount: 90, weight: 8 },
      { kind: 'banner', id: 'banner_nebula', weight: 8 },
      { kind: 'avatar', id: 'avatar_pulse', weight: 8 },
      { kind: 'title', id: 'Core Hunter', weight: 6 },
      { kind: 'effect', id: 'trail_ion', weight: 4 },
    ],
  },
};

// Titles (claimable via road/pass/shop)
export const TITLES = {
  rift_walker: 'Rift Walker',
  rift_legend: 'Rift Legend',
  storm_rider: 'Storm Rider',
  'Core Hunter': 'Core Hunter',
  'Arena Regular': 'Arena Regular',
};

// Mission templates — server picks & tracks per user (daily / weekly)
export const MISSION_TEMPLATES = {
  daily: [
    { id: 'd_play3', desc: 'Play 3 matches', metric: 'matches', target: 3, reward: { credits: 40 } },
    { id: 'd_win2', desc: 'Win 2 matches', metric: 'wins', target: 2, reward: { credits: 60 } },
    { id: 'd_kills15', desc: 'Score 15 eliminations', metric: 'kills', target: 15, reward: { credits: 60 } },
    { id: 'd_super3', desc: 'Use 3 Supers', metric: 'supers', target: 3, reward: { pass_xp: 60 } },
    { id: 'd_play_friend', desc: 'Play a match with a friend or clanmate', metric: 'social_matches', target: 1, reward: { rift_tokens: 15 } },
    { id: 'd_crystals', desc: 'Collect 10 crystals', metric: 'objectives', target: 10, reward: { credits: 50 } },
  ],
  weekly: [
    { id: 'w_win15', desc: 'Win 15 matches', metric: 'wins', target: 15, reward: { credits: 300 } },
    { id: 'w_kills100', desc: 'Score 100 eliminations', metric: 'kills', target: 100, reward: { pass_xp: 400 } },
    { id: 'w_modes5', desc: 'Play 5 different modes', metric: 'modes_played', target: 5, reward: { rift_tokens: 80 } },
    { id: 'w_clan5', desc: 'Play 5 matches with a clanmate', metric: 'clan_matches', target: 5, reward: { credits: 250 } },
    { id: 'w_event1', desc: 'Play an Event match', metric: 'event_matches', target: 1, reward: { rift_tokens: 50 } },
  ],
  seasonal: [
    { id: 's_trophies', desc: 'Earn 400 trophies in the season', metric: 'season_trophies', target: 400, reward: { rift_tokens: 150 } },
  ],
};

// Launch events (seeded into events table; admin-editable via Event Builder)
export const EVENT_SEEDS = [
  {
    id: 'rift_weekend', name: 'Rift Weekend', status: 'scheduled',
    category: 'event', mode: 'crystal_rush', map: 'neon_yard',
    modifiers: { energy_mult: 1.5 },
    desc: 'Crystal Rush with 50% faster super charge. The rift is wide open.',
    mission: { metric: 'matches', target: 5, desc: 'Play 5 Rift Weekend matches' },
    reward: { rift_tokens: 100 },
    banner: '#3b2f7a', accent: '#8b7cf6',
  },
  {
    id: 'chaos_arena', name: 'Chaos Arena', status: 'scheduled',
    category: 'event', mode: 'elimination', map: 'ember_pit',
    modifiers: { speed_mult: 1.2, damage_mult: 1.3 },
    desc: 'Everyone is faster, everyone hits harder. Pure chaos.',
    mission: { metric: 'kills', target: 20, desc: 'Score 20 eliminations in Chaos Arena' },
    reward: { credits: 400 },
    banner: '#7a2f2f', accent: '#f87171',
  },
  {
    id: 'crystal_fever', name: 'Crystal Fever', status: 'scheduled',
    category: 'event', mode: 'crystal_rush', map: 'moss_temple',
    modifiers: { double_ammo: true },
    desc: 'Double ammo in Crystal Rush. Hold the middle and never stop firing.',
    mission: { metric: 'objectives', target: 25, desc: 'Collect 25 crystals in Crystal Fever' },
    reward: { rift_tokens: 60 },
    banner: '#2f5a3a', accent: '#4ade80',
  },
  {
    id: 'survival_night', name: 'Survival Night', status: 'scheduled',
    category: 'event', mode: 'last_core', map: 'sky_circuit',
    modifiers: { no_bushes: true },
    desc: 'Last Core with every bush removed. Nowhere to hide.',
    mission: { metric: 'wins', target: 2, desc: 'Win 2 Survival Night matches' },
    reward: { title: 'Storm Rider' },
    banner: '#1f2a44', accent: '#6ea8ff',
  },
  {
    id: 'clan_wars_open', name: 'Clan Wars: Opening', status: 'scheduled',
    category: 'clan', mode: 'domination', map: 'dust_canyon',
    modifiers: {},
    desc: 'Clan score week. Every Domination win with a clanmate counts.',
    mission: { metric: 'clan_matches', target: 5, desc: 'Play 5 matches with a clanmate' },
    reward: { credits: 500 },
    banner: '#5a3a2f', accent: '#fb923c',
  },
  {
    id: 'creator_contest', name: 'Map Creator Contest', status: 'scheduled',
    category: 'community', mode: 'elimination', map: 'lost_factory',
    modifiers: {},
    desc: 'Publish a community map this week; the admin pick joins the official rotation.',
    mission: { metric: 'maps_published', target: 1, desc: 'Publish a community map' },
    reward: { title: 'Rift Walker' },
    banner: '#2f4a5a', accent: '#38bdf8',
  },
];

// News seeds
export const NEWS_SEEDS = [
  { title: 'RIFT ARENA is live', category: 'Update', priority: 10, body: 'Season 1 Rift Awakening begins now. Six fighters, eight arenas, six game modes. Jump into the lobby and queue up — the rift is open.' },
  { title: 'VEX joins the roster', category: 'Combattant', priority: 8, body: 'The railgun marksman VEX is available at 50 trophies. Long range, heavy damage, fragile as glass. Scan Pulse reveals every enemy on the field.' },
  { title: 'Season 1: Rift Awakening', category: 'Event', priority: 9, body: 'A 30-tier Battle Pass is live: free and premium tracks, daily and weekly missions, seasonal events. Rift Weekend kicks off this weekend with boosted super charge.' },
  { title: 'Patch 1.0.1 — balance', category: 'Patch', priority: 6, body: 'VEX reload slightly faster. BRAKK Shockwave radius +10%. Strikeball overtime added. Crystal Rush countdown now pauses if the leading team drops below 10 crystals.' },
];

// Ranked seasons
export const SEASON_SEED = {
  id: 'season_1', name: 'Season 1 — Rift Awakening',
  startedAt: null, // set at seed time
  endsAt: null,    // admin-configurable duration; default 30 days
  resetTo: 'gold', // soft reset target league
};

// Starting currency
export const STARTING_WALLET = { credits: 300, rift_tokens: 50, pass_xp: 0 };

// Clan config
export const CLAN_CONFIG = {
  maxMembers: 30,
  roles: ['leader', 'coleader', 'officer', 'member', 'recruit'],
  createCost: 200,
  levels: [
    { level: 1, xp: 0 }, { level: 2, xp: 2000 }, { level: 3, xp: 6000 },
    { level: 4, xp: 14000 }, { level: 5, xp: 26000 }, { level: 6, xp: 44000 },
    { level: 7, xp: 68000 }, { level: 8, xp: 98000 }, { level: 9, xp: 134000 },
    { level: 10, xp: 176000 },
  ],
  xpPerMatch: 12, xpPerWin: 20,
};
