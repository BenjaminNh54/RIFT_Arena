// RIFT ARENA — Domination: capture and hold zones A/B/C, first to 100 points.
export const def = null;

export function init(room) {
  const z = room.map.objectives.zones ?? { A: [8, 11], B: [24, 11], C: [16, 11] };
  room.zones = Object.entries(z).map(([id, [tx, ty]]) => ({
    id, x: (tx + 0.5) * 64, y: (ty + 0.5) * 64, r: 115, owner: null, prog: 0,
  }));
  room.modeState = { target: room.modeDef.target ?? 100 };
  room.score = { A: 0, B: 0 };
}

export function tick(room, dt) {
  for (const z of room.zones) {
    let a = 0, b = 0;
    for (const e of room.combatables()) {
      if ((e.kind !== 'player' && e.kind !== 'bot') || e.dead) continue;
      if (Math.hypot(e.x - z.x, e.y - z.y) > z.r) continue;
      if (e.team === 'A') a++; else if (e.team === 'B') b++;
    }
    if (a > 0 && b === 0) {
      // team A pushing
      if (z.owner === 'A') { /* held */ }
      else {
        z.prog += dt * 22 * Math.min(a, 3);
        if (z.owner === 'B') { z.prog -= dt * 44; if (z.prog <= 0) { z.owner = null; z.prog = 0; } }
        else if (z.prog >= 100) { z.owner = 'A'; z.prog = 100; room.fx({ k: 'capture', id: z.id, team: 'A' }); }
      }
    } else if (b > 0 && a === 0) {
      if (z.owner === 'B') { /* held */ }
      else {
        z.prog -= dt * 22 * Math.min(b, 3);
        if (z.owner === 'A') { z.prog += dt * 44; if (z.prog >= 100) { z.owner = null; z.prog = 0; } }
        else if (z.prog <= -100) { z.owner = 'B'; z.prog = 0; room.fx({ k: 'capture', id: z.id, team: 'B' }); }
      }
    }
    // scoring: owned zones tick points
    if (z.owner === 'A') room.score.A += dt;
    else if (z.owner === 'B') room.score.B += dt;
  }
}

export function checkEnd(room) {
  if (room.score.A >= room.modeState.target) return { winner: 'A' };
  if (room.score.B >= room.modeState.target) return { winner: 'B' };
  return null;
}

export function defaultWinner(room) {
  return room.score.A > room.score.B ? 'A' : room.score.B > room.score.A ? 'B' : 'draw';
}

export const respawn = true;

export function hud(room) {
  return { kind: 'domination', target: room.modeState.target };
}
