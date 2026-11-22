// RIFT ARENA — bot AI (fills normal matches; clearly labeled as bots, never used in ranked)
import { lineBlocked } from './movement.js';

// One AI step per bot. Runs every tick; decisions throttled per bot.
export function runBots(room) {
  for (const ent of room.ents.values()) {
    if (ent.kind !== 'bot' || ent.dead) continue;
    const ai = ent.ai;
    if (room.now < ai.decideAt) { ent.lastInput.fire = false; continue; }
    ai.decideAt = room.now + 120 + Math.random() * 120;

    const input = { dx: 0, dy: 0, aim: ent.angle, aimDist: 0, fire: false, wantSuper: false, wantAbility: false, wantKick: false };
    const atk = ent.fighter.attack;
    const enemy = pickTarget(room, ent, atk.range * 2.2);

    // mode objective behavior
    const obj = modeObjective(room, ent, input);

    if (enemy) {
      const d = Math.hypot(enemy.x - ent.x, enemy.y - ent.y);
      const lead = 0.05 + Math.random() * 0.1; // aim noise = fair difficulty
      input.aim = Math.atan2(enemy.y - ent.y, enemy.x - ent.x) + lead;
      // les tirs courbes atterrissent sur l'ennemi, pas toujours à portée max
      input.aimDist = Math.min(d, atk.range);
      // engage / kite: approche, strafe, ne recule QUE très proche (avant: fuir dès 70% du
      // range → les tireurs passaient leur temps à fuir dos aux murs sans jamais tirer)
      const ideal = atk.type === 'melee' ? atk.range * 0.6 : atk.range * 0.62;
      const fleeAt = atk.type === 'melee' ? 0 : atk.range * 0.45;
      if (!obj.handled) {
        if (d > ideal + 30) { input.dx = Math.cos(input.aim); input.dy = Math.sin(input.aim); }
        else if (atk.type !== 'melee' && d < fleeAt) { input.dx = -Math.cos(input.aim); input.dy = -Math.sin(input.aim); }
        else if (Math.random() < 0.35) { // strafe
          const s = Math.random() < 0.5 ? 1 : -1;
          input.dx = Math.cos(input.aim + Math.PI / 2) * s;
          input.dy = Math.sin(input.aim + Math.PI / 2) * s;
        }
      }
      if (d < atk.range * 0.95 && !lineBlocked(room.map, ent.x, ent.y, enemy.x, enemy.y)) input.fire = true;
      if (ent.superCharge >= 1 && d < atk.range * 1.1) input.wantSuper = true;
      if (ent.abilityUses > 0 && Math.random() < 0.25 && d < atk.range) input.wantAbility = true;
      // low hp escape
      if (ent.hp < ent.maxHp * 0.25 && Math.random() < 0.6) {
        input.dx = -Math.cos(input.aim); input.dy = -Math.sin(input.aim);
      }
    } else if (!obj.handled) {
      // wander toward a random reachable point
      if (!ai.wanderTo || Math.hypot(ai.wanderTo.x - ent.x, ai.wanderTo.y - ent.y) < 40) {
        ai.wanderTo = {
          x: (1 + Math.random() * (room.map.width - 2)) * 64,
          y: (1 + Math.random() * (room.map.height - 2)) * 64,
        };
      }
      const a = Math.atan2(ai.wanderTo.y - ent.y, ai.wanderTo.x - ent.x);
      input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
    }

    // simple wall-slide: if desired dir blocked, try perpendicular
    if (input.dx || input.dy) {
      const nx = ent.x + input.dx * 20, ny = ent.y + input.dy * 20;
      if (blocked(room, nx, ny)) {
        const a = Math.atan2(input.dy, input.dx);
        const alt = a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
        input.dx = Math.cos(alt); input.dy = Math.sin(alt);
      }
    }

    ent.lastInput = input;
    ent.angle = input.aim;
  }
}

function blocked(room, x, y) {
  const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
  const t = (ty >= 0 && ty < room.map.height && tx >= 0 && tx < room.map.width) ? room.map.grid[ty][tx] : 1;
  return t === 1 || t === 2 || t === 4;
}

function pickTarget(room, ent, maxDist) {
  let best = null, bd = maxDist;
  for (const other of room.combatables()) {
    if (other.team === ent.team || other.dead) continue;
    if (other.kind === 'boss') { if (Math.hypot(other.x - ent.x, other.y - ent.y) < bd) return other; continue; }
    const d = Math.hypot(other.x - ent.x, other.y - ent.y);
    if (d < bd) { bd = d; best = other; }
  }
  return best;
}

function modeObjective(room, ent, input) {
  const mode = room.modeId;
  // crystal rush: grab crystals
  if (mode === 'crystal_rush' && room.pickups.length) {
    let best = null, bd = 1e9;
    for (const p of room.pickups) {
      const d = Math.hypot(p.x - ent.x, p.y - ent.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && bd < 420) {
      const a = Math.atan2(best.y - ent.y, best.x - ent.x);
      input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
      return { handled: true };
    }
  }
  // strikeball: chase ball / push toward goal
  if (mode === 'strikeball' && room.modeState.ball) {
    const ball = room.modeState.ball;
    const goals = room.map.objectives;
    if (ent.hasBall) {
      const goal = ent.team === 'A' ? goals.goalB : goals.goalA;
      const gx = (goal[0] + 0.5) * 64, gy = (goal[1] + 0.5) * 64;
      const a = Math.atan2(gy - ent.y, gx - ent.x);
      input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
      if (Math.hypot(gx - ent.x, gy - ent.y) < 260 && Math.random() < 0.4) input.wantKick = true;
      return { handled: true };
    }
    if (!ball.holderId) {
      const d = Math.hypot(ball.x - ent.x, ball.y - ent.y);
      if (d < 500) {
        const a = Math.atan2(ball.y - ent.y, ball.x - ent.x);
        input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
        return { handled: true };
      }
    }
  }
  // domination: go to nearest non-owned / contested zone
  if (mode === 'domination' && room.zones.length) {
    let best = null, bd = 1e9;
    for (const z of room.zones) {
      const weight = z.owner === ent.team ? 1.5 : 1; // prefer contested/enemy zones
      const d = Math.hypot(z.x - ent.x, z.y - ent.y) * weight;
      if (d < bd) { bd = d; best = z; }
    }
    if (best && Math.hypot(best.x - ent.x, best.y - ent.y) > best.r * 0.6) {
      const a = Math.atan2(best.y - ent.y, best.x - ent.x);
      input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
      return { handled: true };
    }
  }
  // last core: stay inside the rift
  if (mode === 'last_core' && room.safeRadius) {
    const s = room.safeRadius;
    const d = Math.hypot(ent.x - s.x, ent.y - s.y);
    if (d > s.r * 0.7) {
      const a = Math.atan2(s.y - ent.y, s.x - ent.x);
      input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
      return { handled: true };
    }
  }
  // boss raid: kite the boss when it is very close
  if (mode === 'boss_raid') {
    const boss = room.ents.get('boss');
    if (boss && !boss.dead) {
      const d = Math.hypot(boss.x - ent.x, boss.y - ent.y);
      if (d < 140) {
        const a = Math.atan2(ent.y - boss.y, ent.x - boss.x);
        input.aim = a; input.dx = Math.cos(a); input.dy = Math.sin(a);
        return { handled: true };
      }
    }
  }
  return { handled: false };
}
