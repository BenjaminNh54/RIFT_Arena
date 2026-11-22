// RIFT ARENA — Last Core: 8-player battle royale, the rift shrinks, last one standing.
export const def = null;

export function init(room) {
  const cx = (room.map.width / 2) * 64, cy = (room.map.height / 2) * 64;
  const r0 = Math.min(room.map.width, room.map.height) * 64 * 0.5;
  room.safeRadius = { x: cx, y: cy, r: r0, r0, rMin: r0 * 0.14, shrinkFor: (room.modeDef.timer ?? 180000) * 0.75, elapsed: 0 };
  room.modeState = { alive: 0 };
  for (const e of room.ents.values()) if (e.kind === 'player' || e.kind === 'bot') e.team = `F${[...room.ents.values()].filter(x => x.kind === 'player' || x.kind === 'bot').indexOf(e)}`;
}

export function tick(room, dt) {
  const s = room.safeRadius;
  s.elapsed += dt * 1000;
  const k = Math.min(1, s.elapsed / s.shrinkFor);
  s.r = s.r0 + (s.rMin - s.r0) * k;
  // damage outside the rift
  for (const e of room.combatables()) {
    if ((e.kind !== 'player' && e.kind !== 'bot') || e.dead) continue;
    const d = Math.hypot(e.x - s.x, e.y - s.y);
    if (d > s.r) {
      room.applyDamage(e, (400 + (d - s.r) * 0.5) * dt, null, false, true);
    }
  }
}

export function checkEnd(room) {
  const alive = [...room.ents.values()].filter(e => (e.kind === 'player' || e.kind === 'bot') && !e.dead);
  if (alive.length <= 1) return { winner: alive[0]?.team ?? 'draw' };
  return null;
}

export const respawn = false;

export function defaultWinner(room) { return 'draw'; }

export function hud(room) {
  const alive = [...room.ents.values()].filter(e => (e.kind === 'player' || e.kind === 'bot') && !e.dead).length;
  return { kind: 'last_core', alive };
}
