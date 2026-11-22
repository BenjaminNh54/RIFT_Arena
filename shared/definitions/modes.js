// RIFT ARENA — game mode metadata (rules implemented per-mode in server/src/game/modes)

export const MODES = [
  {
    id: 'crystal_rush', name: 'Crystal Rush', type: 'team', teamSize: 3,
    desc: 'Grab rift crystals. Hold 10 and survive the countdown.',
    timer: 150000, target: 10, countdown: 15000, ranked: true,
  },
  {
    id: 'strikeball', name: 'Strikeball', type: 'team', teamSize: 3,
    desc: 'Carry or kick the core-ball into the enemy goal. First to 2.',
    timer: 150000, target: 2, overtime: true, ranked: true,
  },
  {
    id: 'domination', name: 'Domination', type: 'team', teamSize: 3,
    desc: 'Capture and hold zones A, B and C. First to 100 points.',
    timer: 150000, target: 100, ranked: true,
  },
  {
    id: 'elimination', name: 'Elimination', type: 'team', teamSize: 3,
    desc: 'Every elimination scores. First to 10, or best score at timeout.',
    timer: 150000, target: 10, ranked: true,
  },
  {
    id: 'last_core', name: 'Last Core', type: 'ffa', teamSize: 1, players: 8,
    desc: '8 fighters, shrinking rift, one survivor. Position is everything.',
    timer: 180000, ranked: true,
  },
  {
    id: 'boss_raid', name: 'Boss Raid', type: 'coop', teamSize: 3,
    desc: '3 fighters vs the Warden of the Rift. Break its phases before you fall.',
    timer: 240000,
  },
];

export const MODE_MAP = Object.fromEntries(MODES.map(m => [m.id, m]));

// League ladder (ranked)
export const LEAGUES = [
  { id: 'bronze', name: 'Bronze', color: '#b08d57', min: 0, divisions: 3 },
  { id: 'silver', name: 'Silver', color: '#c0c8d2', min: 400, divisions: 3 },
  { id: 'gold', name: 'Gold', color: '#f2c14e', min: 800, divisions: 3 },
  { id: 'platinum', name: 'Platinum', color: '#7dd8c3', min: 1200, divisions: 3 },
  { id: 'diamond', name: 'Diamond', color: '#6ea8ff', min: 1600, divisions: 3 },
  { id: 'master', name: 'Master', color: '#c77dff', min: 2000, divisions: 1 },
  { id: 'rift_legend', name: 'Rift Legend', color: '#ff7b54', min: 2400, divisions: 1 },
];

export const RP_PER_DIVISION = 100;

export function leagueForRp(rp) {
  let l = LEAGUES[0], idx = 0;
  LEAGUES.forEach((lg, i) => { if (rp >= lg.min) { l = lg; idx = i; } });
  const next = LEAGUES[idx + 1];
  const span = next ? next.min - l.min : 400;
  const divSize = RP_PER_DIVISION;
  const div = Math.min(l.divisions, Math.max(1, Math.floor((rp - l.min) / divSize) + 1));
  const divProgress = Math.min(1, ((rp - l.min) % divSize) / divSize);
  return { league: l, index: idx, division: l.divisions === 1 ? 1 : div, divProgress, nextLeague: next ?? null };
}
