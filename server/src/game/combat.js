// RIFT ARENA — server combat: attacks, projectiles, damage, deaths, super charge
import { FIGHTER_MAP } from '../../../shared/definitions/fighters.js';

let projId = 0;
let fxId = 0;

// Compute a fighter's effective stats under room modifiers
export function effectiveFighter(fighterId, modifiers = {}) {
  const base = FIGHTER_MAP[fighterId];
  if (!base) return null;
  const dmg = modifiers.damage_mult ?? 1;
  return {
    ...base,
    attack: { ...base.attack, damage: Math.round(base.attack.damage * dmg) },
    speed: Math.round(base.speed * (modifiers.speed_mult ?? 1)),
    reload: Math.round(base.attack.reload / (modifiers.cooldown_mult ?? 1)),
    cooldown: Math.round(base.attack.cooldown / (modifiers.cooldown_mult ?? 1)),
    ammo: modifiers.double_ammo ? base.attack.ammo * 2 : base.attack.ammo,
  };
}

// Attempt an attack. Returns true if performed. (cooldowns & ammo are server-validated)
export function tryAttack(room, ent) {
  if (ent.dead || ent.stunUntil > room.now) return false;
  if (room.now - ent.lastShotAt < ent.fighter.cooldown) return false;
  if (ent.ammo < 1) return false;
  ent.lastShotAt = room.now;
  ent.ammo -= 1;

  const atk = ent.fighter.attack;
  const angle = ent.angle;
  const mult = ent.buffNextDamageMult ?? 1;
  ent.buffNextDamageMult = null;

  if (atk.type === 'melee') {
    meleeArc(room, ent, angle, atk.range, atk.arc, atk.damage * mult);
  } else if (atk.type === 'spread') {
    for (let i = 0; i < atk.count; i++) {
      const off = (i - (atk.count - 1) / 2) * atk.spread;
      spawnProjectile(room, ent, angle + off, atk, mult);
    }
  } else if (atk.type === 'lob') {
    // target point along aim, clamped to range; flies over walls
    const dist = Math.min(atk.range, atk.range);
    const tx = ent.x + Math.cos(angle) * dist;
    const ty = ent.y + Math.sin(angle) * dist;
    room.projectiles.push({
      id: ++projId, kind: 'lob', owner: ent.id, team: ent.team,
      x: ent.x, y: ent.y, sx: ent.x, sy: ent.y, tx, ty,
      t: 0, flight: atk.flight / 1000, dmg: atk.damage * mult, aoe: atk.aoe,
      color: atk.color, fighter: ent.fighter.id,
    });
  } else if (atk.type === 'homing') {
    const target = nearestEnemy(room, ent, atk.range);
    spawnProjectile(room, ent, angle, atk, mult, target ? { targetId: target.id, turn: atk.turn } : null);
  } else {
    spawnProjectile(room, ent, angle, atk, mult);
  }
  return true;
}

function spawnProjectile(room, ent, angle, atk, mult, homing = null) {
  room.projectiles.push({
    id: ++projId, kind: homing ? 'homing' : 'bullet', owner: ent.id, team: ent.team,
    x: ent.x + Math.cos(angle) * (ent.radius + 6), y: ent.y + Math.sin(angle) * (ent.radius + 6),
    vx: Math.cos(angle) * atk.speed, vy: Math.sin(angle) * atk.speed,
    dmg: atk.damage * mult, heal: atk.heal ?? 0, radius: atk.radius ?? 6,
    range: atk.range, traveled: 0, pierce: atk.pierce ?? 0,
    overWalls: atk.overWalls ?? false, homing,
    color: atk.color, fighter: ent.fighter.id,
  });
}

function meleeArc(room, ent, angle, range, arc, dmg) {
  for (const other of room.combatables()) {
    if (other.team === ent.team || other.dead || other.id === ent.id) continue;
    const dx = other.x - ent.x, dy = other.y - ent.y;
    const d = Math.hypot(dx, dy);
    if (d > range + other.radius) continue;
    let da = Math.atan2(dy, dx) - angle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > arc / 2) continue;
    room.applyDamage(other, dmg, ent);
  }
  room.fx({ k: 'slash', x: ent.x, y: ent.y, a: angle, r: range, c: ent.fighter.attack.color });
}

function nearestEnemy(room, ent, maxDist) {
  let best = null, bd = maxDist;
  for (const other of room.combatables()) {
    if (other.team === ent.team || other.dead) continue;
    const d = Math.hypot(other.x - ent.x, other.y - ent.y);
    if (d < bd) { bd = d; best = other; }
  }
  return best;
}

// Step all projectiles; returns events. Destructible crates take damage.
export function stepProjectiles(room, dt) {
  const alive = [];
  for (const p of room.projectiles) {
    if (p.kind === 'lob') { stepLob(room, p, dt); continue; }
    if (p.homing) steerHoming(room, p, dt);
    const stepX = p.vx * dt, stepY = p.vy * dt;
    const nx = p.x + stepX, ny = p.y + stepY;
    p.traveled += Math.hypot(stepX, stepY);

    // walls (unless overWalls)
    if (!p.overWalls && hitsWall(room.map, nx, ny, p.radius)) {
      room.fx({ k: 'hit', x: p.x, y: p.y, c: p.color });
      damageCratesNear(room, nx, ny, p.dmg, p.owner);
      continue; // projectile dies
    }
    // bounds
    if (nx < 0 || ny < 0 || nx > room.map.width * 64 || ny > room.map.height * 64) continue;
    p.x = nx; p.y = ny;

    // entity hits
    let consumed = false;
    for (const other of room.combatables()) {
      if (other.dead || other.id === p.owner) continue;
      const friendly = other.team === p.team;
      const d = Math.hypot(other.x - p.x, other.y - p.y);
      if (d > other.radius + p.radius + 2) continue;
      if (!friendly) {
        const src = room.ents.get(p.owner);
        room.applyDamage(other, p.dmg, src);
        room.fx({ k: 'hit', x: p.x, y: p.y, c: p.color });
        if (p.pierce > 0) { p.pierce--; } else { consumed = true; }
        break;
      } else if (p.heal > 0 && d < other.radius + 14) {
        room.applyDamage(other, -p.heal, room.ents.get(p.owner), true);
      }
    }
    if (consumed) continue;
    // range
    if (p.traveled >= p.range) { room.fx({ k: 'hit', x: p.x, y: p.y, c: p.color }); continue; }
    alive.push(p);
  }
  room.projectiles = alive;
}

function stepLob(room, p, dt) {
  p.t += dt;
  const k = Math.min(1, p.t / p.flight);
  p.x = p.sx + (p.tx - p.sx) * k;
  p.y = p.sy + (p.ty - p.sy) * k;
  p.arcH = Math.sin(k * Math.PI) * 40; // visual arc height
  if (k >= 1) {
    // explode: AoE
    for (const other of room.combatables()) {
      if (other.team === p.team || other.dead) continue;
      const d = Math.hypot(other.x - p.x, other.y - p.y);
      if (d <= p.aoe + other.radius) {
        room.applyDamage(other, p.dmg * (1 - (d / (p.aoe + other.radius)) * 0.3), room.ents.get(p.owner));
      }
    }
    damageCratesNear(room, p.x, p.y, p.dmg, p.owner);
    room.fx({ k: 'boom', x: p.x, y: p.y, r: p.aoe, c: p.color });
  } else {
    room.projectiles.push(p);
  }
}

function steerHoming(room, p, dt) {
  const target = room.ents.get(p.homing.targetId);
  if (!target || target.dead || target.team === p.team) { p.homing = null; return; }
  const desired = Math.atan2(target.y - p.y, target.x - p.x);
  const cur = Math.atan2(p.vy, p.vx);
  let da = desired - cur;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const turn = p.homing.turn * dt;
  const ang = cur + Math.max(-turn, Math.min(turn, da));
  const sp = Math.hypot(p.vx, p.vy);
  p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
}

function hitsWall(map, x, y, r) {
  const minTx = Math.floor((x - r) / 64), maxTx = Math.floor((x + r) / 64);
  const minTy = Math.floor((y - r) / 64), maxTy = Math.floor((y + r) / 64);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const t = (ty >= 0 && ty < map.height && tx >= 0 && tx < map.width) ? map.grid[ty][tx] : 1;
      if (t === 1 || t === 2) {
        const cx = Math.max(tx * 64, Math.min(x, tx * 64 + 64));
        const cy = Math.max(ty * 64, Math.min(y, ty * 64 + 64));
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
  }
  return false;
}

export function damageCratesNear(room, x, y, dmg, ownerId) {
  const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = tx + dx, cy = ty + dy;
    if (cy < 0 || cy >= room.map.height || cx < 0 || cx >= room.map.width) continue;
    if (room.map.grid[cy][cx] !== 2) continue;
    room.damageCrate(cx, cy, dmg, ownerId);
  }
}

export function makeFxId() { return ++fxId; }
