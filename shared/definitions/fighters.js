// RIFT ARENA — fighter definitions (data-driven; engine implements the generic mechanics)
// Attack types: projectile | spread | melee | lob | homing
// Super specials: zone | dash | turret | drone | reveal | shockwave | shield | buff
// Ability types: reload | dash | shield | heal | buff
// Passive types: speed_on_hit | shield_regen | ally_speed | adrenaline

export const FIGHTERS = [
  {
    id: 'volt', name: 'VOLT', clazz: 'Assault', rarity: 'starter',
    tagline: 'Circuit-breaker brawler. Fast bolts, faster feet.',
    hp: 3600, speed: 250, radius: 22,
    attack: {
      type: 'projectile', name: 'Bolt', damage: 460, range: 480, speed: 820,
      radius: 8, ammo: 3, reload: 1500, cooldown: 320, color: '#35e0ff',
    },
    super: {
      name: 'Surge Field', special: 'zone', charge: 3600,
      zone: { radius: 180, dps: 300, duration: 4200, tick: 500, selfSpeed: 1.25 },
      color: '#35e0ff',
    },
    ability: { name: 'Overcharge', type: 'reload', uses: 2, amount: 1, cooldown: 8000 },
    passive: { type: 'speed_on_hit', mult: 1.14, duration: 2000 },
    shape: 'bolt', body: '#22d3ee', accent: '#a5f3fc', dark: '#0e7490',
    unlock: { type: 'default' },
    skins: [
      { id: 'volt_gold', name: 'Gold Circuit', price: 320, currency: 'credits', body: '#fbbf24', accent: '#fef3c7', dark: '#92400e' },
    ],
  },
  {
    id: 'vex', name: 'VEX', clazz: 'Sniper', rarity: 'rare',
    tagline: 'One beam, one problem gone. Fragile but lethal.',
    hp: 2600, speed: 235, radius: 20,
    attack: {
      type: 'projectile', name: 'Rail', damage: 1150, range: 900, speed: 1500,
      radius: 6, ammo: 2, reload: 2600, cooldown: 500, color: '#c084fc',
    },
    super: {
      name: 'Scan Pulse', special: 'reveal', charge: 4200,
      reveal: { duration: 8000, pierceNext: true },
      color: '#c084fc',
    },
    ability: { name: 'Focus', type: 'buff', uses: 2, buff: { nextDamageMult: 1.4 }, cooldown: 9000 },
    passive: { type: 'shield_regen', rate: 120, max: 400, delay: 4000 },
    shape: 'ranger', body: '#a855f7', accent: '#e9d5ff', dark: '#6b21a8',
    unlock: { type: 'trophies', value: 50 },
    skins: [
      { id: 'vex_void', name: 'Void Scope', price: 80, currency: 'rift_tokens', body: '#f43f5e', accent: '#fecdd3', dark: '#881337' },
    ],
  },
  {
    id: 'brakk', name: 'BRAKK', clazz: 'Tank', rarity: 'rare',
    tagline: 'A walking bulwark. Get close, regret it.',
    hp: 5600, speed: 225, radius: 26,
    attack: {
      type: 'melee', name: 'Slam', damage: 820, range: 165, arc: 1.8,
      ammo: 3, reload: 1400, cooldown: 600, color: '#fb923c',
    },
    super: {
      name: 'Shockwave', special: 'shockwave', charge: 4800,
      wave: { radius: 240, damage: 700, knockback: 300, stun: 800 },
      color: '#fb923c',
    },
    ability: { name: 'Bulwark', type: 'shield', uses: 2, amount: 1200, duration: 3000, cooldown: 10000 },
    passive: { type: 'shield_regen', rate: 250, max: 800, delay: 4000 },
    shape: 'brute', body: '#f97316', accent: '#fed7aa', dark: '#7c2d12',
    unlock: { type: 'trophies', value: 150 },
    skins: [
      { id: 'brakk_magma', name: 'Magma Core', price: 80, currency: 'rift_tokens', body: '#dc2626', accent: '#fecaca', dark: '#450a0a' },
    ],
  },
  {
    id: 'nyx', name: 'NYX', clazz: 'Support', rarity: 'epic',
    tagline: 'Spirit engineer. Her drones mend and maim.',
    hp: 3200, speed: 245, radius: 21,
    attack: {
      type: 'homing', name: 'Pulse Drone', damage: 340, heal: 170, range: 620, speed: 560,
      turn: 3.2, radius: 9, ammo: 3, reload: 1300, cooldown: 450, color: '#4ade80',
    },
    super: {
      name: 'Guardian', special: 'drone', charge: 3800,
      drone: { radius: 210, healPerSec: 140, duration: 8000, hp: 1500 },
      color: '#4ade80',
    },
    ability: { name: 'Ward', type: 'shield', uses: 2, amount: 900, duration: 3000, aoe: 200, cooldown: 10000 },
    passive: { type: 'ally_speed', radius: 190, mult: 1.1 },
    shape: 'spirit', body: '#22c55e', accent: '#bbf7d0', dark: '#166534',
    unlock: { type: 'trophies', value: 300 },
    skins: [
      { id: 'nyx_bloom', name: 'Bloom Warden', price: 80, currency: 'rift_tokens', body: '#e879f9', accent: '#fae8ff', dark: '#86198f' },
    ],
  },
  {
    id: 'kiro', name: 'KIRO', clazz: 'Assassin', rarity: 'epic',
    tagline: 'Between the shadows and your back.',
    hp: 2800, speed: 275, radius: 20,
    attack: {
      type: 'spread', name: 'Fang Blades', damage: 380, count: 2, spread: 0.18, range: 430,
      speed: 1000, radius: 6, ammo: 3, reload: 1100, cooldown: 380, color: '#f43f5e',
    },
    super: {
      name: 'Shadow Step', special: 'dash', charge: 3200,
      dash: { distance: 380, duration: 200, buff: { nextDamageMult: 1.5 } },
      color: '#f43f5e',
    },
    ability: { name: 'Blink', type: 'dash', uses: 2, distance: 240, duration: 150, cooldown: 9000 },
    passive: { type: 'adrenaline', below: 0.4, mult: 1.15 },
    shape: 'shade', body: '#ef4444', accent: '#fecaca', dark: '#7f1d1d',
    unlock: { type: 'trophies', value: 600 },
    skins: [
      { id: 'kiro_phantom', name: 'Phantom Protocol', price: 120, currency: 'rift_tokens', body: '#334155', accent: '#94a3b8', dark: '#0f172a' },
    ],
  },
  {
    id: 'patch', name: 'PATCH', clazz: 'Engineer', rarity: 'legendary',
    tagline: 'Builds turrets. Breaks sieges. Owns the zone.',
    hp: 3400, speed: 240, radius: 22,
    attack: {
      type: 'lob', name: 'Arc Lob', damage: 700, aoe: 120, range: 560, flight: 700,
      ammo: 3, reload: 2000, cooldown: 600, color: '#facc15', overWalls: true,
    },
    super: {
      name: 'Turret Mk-II', special: 'turret', charge: 4400,
      turret: { hp: 2800, range: 430, damage: 320, interval: 1100, lifetime: 22000, speed: 700 },
      color: '#facc15',
    },
    ability: { name: 'Repair Protocol', type: 'heal', uses: 2, amount: 600, healTurret: true, cooldown: 11000 },
    passive: { type: 'ally_speed', radius: 150, mult: 1.05 },
    shape: 'tech', body: '#eab308', accent: '#fef08a', dark: '#713f12',
    unlock: { type: 'trophies', value: 900 },
    skins: [
      { id: 'patch_hazard', name: 'Hazard Crew', price: 160, currency: 'rift_tokens', body: '#14b8a6', accent: '#ccfbf1', dark: '#134e4a' },
    ],
  },
];

export const FIGHTER_MAP = Object.fromEntries(FIGHTERS.map(f => [f.id, f]));

export const BOT_NAMES = [
  'RIV-3R', 'NOVA-7', 'AXEL', 'JYNX', 'ORBIT', 'PICO', 'ZANE', 'MIRA',
  'DUSK', 'HALO', 'TARN', 'LYNX', 'ECHO', 'FUSE', 'GLYPH', 'IRIS',
];
