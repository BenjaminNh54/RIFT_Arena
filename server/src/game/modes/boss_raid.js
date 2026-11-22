// RIFT ARENA — Boss Raid: 3 co-op fighters vs the Warden of the Rift (phased server boss).
import { moveCircle } from '../movement.js';

export const def = null;

export function init(room) {
  const [bx, by] = room.map.objectives.boss ?? [room.map.width >> 1, room.map.height >> 1];
  const players = [...room.ents.values()].filter(e => e.kind === 'player' || e.kind === 'bot');
  const hp = 30000 + 9000 * Math.max(1, players.length);
  const boss = {
    id: 'boss', kind: 'boss', name: 'WARDEN OF THE RIFT', team: 'BOSS',
    x: (bx + 0.5) * 64, y: (by + 0.5) * 64, angle: 0, radius: 34,
    hp, maxHp: hp, dead: false,
    fighter: { speed: 150 }, // engine skips boss movement; mode handles it
  };
  room.ents.set('boss', boss);
  room.modeState = {
    phase: 1, slamCd: 2000, volleyCd: 5000, ringCd: 9000, lives: players.length * 3,
    target: null, decision: 0,
  };
}

export function start(room) { room.fx({ k: 'bossintro' }); }

export function tick(room, dt) {
  const boss = room.ents.get('boss');
  const ms = room.modeState;
  if (!boss || boss.hp <= 0) return;

  const hpPct = boss.hp / boss.maxHp;
  ms.phase = hpPct > 0.66 ? 1 : hpPct > 0.33 ? 2 : 3;

  // choose target
  ms.decision -= dt * 1000;
  const targets = room.combatables().filter(e => (e.kind === 'player' || e.kind === 'bot') && !e.dead);
  if (!targets.length) return;
  if (!ms.target || ms.target.dead || ms.decision <= 0) {
    ms.target = targets[Math.floor(Math.random() * targets.length)];
    ms.decision = 4000 + Math.random() * 2000;
  }
  const t = ms.target;
  if (t && !t.dead) {
    boss.angle = Math.atan2(t.y - boss.y, t.x - boss.x);
    const speed = ms.phase === 3 ? 190 : 150;
    const dx = Math.cos(boss.angle) * speed * dt, dy = Math.sin(boss.angle) * speed * dt;
    moveCircle(room.map, boss, dx, dy, boss.radius);
  }

  // melee slam
  ms.slamCd -= dt * 1000;
  if (ms.slamCd <= 0) {
    ms.slamCd = ms.phase === 3 ? 1400 : 2200;
    let hit = false;
    for (const e of targets) {
      if (Math.hypot(e.x - boss.x, e.y - boss.y) < 130 + e.radius) {
        room.applyDamage(e, 500 + ms.phase * 120, boss);
        hit = true;
      }
    }
    room.fx({ k: 'wave', x: boss.x, y: boss.y, r: 130, c: '#ff5d3a' });
    if (hit) room.fx({ k: 'shake' });
  }

  // ranged volley
  ms.volleyCd -= dt * 1000;
  if (ms.volleyCd <= 0) {
    ms.volleyCd = ms.phase === 1 ? 5200 : ms.phase === 2 ? 3800 : 2800;
    const n = ms.phase + 2;
    for (let i = 0; i < n; i++) {
      const a = boss.angle + (i - (n - 1) / 2) * 0.16;
      room.projectiles.push({
        id: `bs${room.tickCount}_${i}`, kind: 'bullet', owner: 'boss', team: 'BOSS',
        x: boss.x + Math.cos(a) * 40, y: boss.y + Math.sin(a) * 40,
        vx: Math.cos(a) * 420, vy: Math.sin(a) * 420,
        dmg: 380, heal: 0, radius: 10, range: 700, traveled: 0, pierce: 0,
        overWalls: false, homing: null, color: '#ff5d3a', fighter: 'boss',
      });
    }
  }

  // phase 3: shockwave ring
  ms.ringCd -= dt * 1000;
  if (ms.phase === 3 && ms.ringCd <= 0) {
    ms.ringCd = 8000;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      room.projectiles.push({
        id: `br${room.tickCount}_${i}`, kind: 'bullet', owner: 'boss', team: 'BOSS',
        x: boss.x, y: boss.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330,
        dmg: 420, heal: 0, radius: 10, range: 600, traveled: 0, pierce: 0,
        overWalls: false, homing: null, color: '#ffb03a', fighter: 'boss',
      });
    }
  }
}

export function onBossDamage(room, boss) {
  if (boss.hp <= 0) room.fx({ k: 'bossdeath', x: boss.x, y: boss.y });
}

export function onKill(room, killer, victim) {
  // shared life pool: 3 respawns per player, tracked globally
  room.modeState.lives--;
  if (room.modeState.lives > 0) {
    victim.respawnAt = room.now + 5000;
  } else {
    victim.respawnAt = Infinity; // no respawn left
    victim.noRespawn = true;
  }
}

// engine checks mode.respawn flag; here we override per-entity respawn logic
export function allowRespawn(room, ent) {
  return !ent.noRespawn && room.modeState.lives > 0;
}

export function checkEnd(room) {
  const boss = room.ents.get('boss');
  if (boss && boss.hp <= 0) return { winner: 'A' };
  const anyAliveOrRespawn = [...room.ents.values()].filter(e => (e.kind === 'player' || e.kind === 'bot'));
  const out = anyAliveOrRespawn.every(e => e.dead && e.noRespawn);
  if (out) return { winner: 'BOSS' };
  return null;
}

export const respawn = true;

export function defaultWinner(room) { return 'BOSS'; }

export function hud(room) {
  const boss = room.ents.get('boss');
  return {
    kind: 'boss_raid',
    bossHp: boss ? Math.round((boss.hp / boss.maxHp) * 100) : 0,
    phase: room.modeState.phase,
    lives: room.modeState.lives,
  };
}
