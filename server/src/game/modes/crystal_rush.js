// RIFT ARENA — Crystal Rush: grab crystals, hold 10, survive the countdown.
export const def = null; // set by registry

let cid = 0;

export function init(room) {
  room.modeState = {
    target: 10,
    countdownMs: room.modeDef.countdown ?? 15000,
    countdownLeft: room.modeDef.countdown ?? 15000,
    counting: false,
    spawnTimer: 0,
    spawnEvery: 4000,
    maxOnField: 6,
  };
}

export function start(room) {
  const pts = room.map.objectives.crystals ?? [[room.map.width >> 1, room.map.height >> 1]];
  for (const [tx, ty] of pts) spawnCrystal(room, tx, ty);
}

function spawnCrystal(room, tx, ty) {
  if (room.pickups.length >= room.modeState.maxOnField) return;
  room.pickups.push({ id: `c${++cid}`, x: (tx + 0.5) * 64, y: (ty + 0.5) * 64, kind: 'crystal' });
}

export function tick(room, dt) {
  const ms = room.modeState;
  // spawn crystals over time
  ms.spawnTimer += dt * 1000;
  if (ms.spawnTimer >= ms.spawnEvery) {
    ms.spawnTimer = 0;
    const pts = room.map.objectives.crystals ?? [];
    if (pts.length) {
      const [tx, ty] = pts[Math.floor(Math.random() * pts.length)];
      spawnCrystal(room, tx, ty);
    }
  }
  // team crystal counts (held by living + dead-but-holding players)
  const counts = { A: 0, B: 0 };
  for (const e of room.ents.values()) {
    if ((e.kind !== 'player' && e.kind !== 'bot') || !e.carrying) continue;
    if (e.team === 'A' || e.team === 'B') counts[e.team] += e.carrying;
  }
  room.score.A = counts.A; room.score.B = counts.B;
  // countdown
  const lead = counts.A >= ms.target ? 'A' : counts.B >= ms.target ? 'B' : null;
  if (lead) {
    if (!ms.counting) { ms.counting = true; ms.countdownLeft = ms.countdownMs; room.fx({ k: 'countdown', team: lead }); }
    ms.countdownLeft -= dt * 1000;
    if (ms.countdownLeft <= 0) { room._crystalWinner = lead; }
  } else {
    ms.counting = false;
    ms.countdownLeft = ms.countdownMs;
  }
}

export function onPickup(room, ent) { /* count updated in tick */ }

export function onKill(room, killer, victim) {
  // scatter carried crystals near the corpse
  for (let i = 0; i < (victim.carrying ?? 0); i++) {
    room.pickups.push({
      id: `c${++cid}`, kind: 'crystal', delay: 0.7,
      x: victim.x + (Math.random() * 60 - 30), y: victim.y + (Math.random() * 60 - 30),
    });
  }
  victim.carrying = 0;
}

export function checkEnd(room) {
  if (room._crystalWinner) return { winner: room._crystalWinner };
  return null;
}

export function defaultWinner(room) {
  return room.score.A > room.score.B ? 'A' : room.score.B > room.score.A ? 'B' : 'draw';
}

export const respawn = true;

export function hud(room) {
  const ms = room.modeState;
  return {
    kind: 'crystal', target: ms.target,
    counting: ms.counting,
    countdownLeft: Math.max(0, Math.ceil(ms.countdownLeft / 1000)),
  };
}
