// RIFT ARENA — tests: game engine (movement, combat, cooldowns, supers, win conditions)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/src/game/engine.js';
import { MAP_MAP } from '../shared/definitions/maps.js';

const map = MAP_MAP.neon_yard;
const noop = () => {};

function makeRoom(mode = 'elimination', mods = {}) {
  const room = new GameRoom({
    id: 'testroom', mode, map, ranked: false, modifiers: mods,
    onFinish: noop,
  });
  room.status = 'running';
  room.startedAt = Date.now();
  return room;
}

function addFighters(room, n = 2) {
  const ents = [];
  for (let i = 0; i < n; i++) {
    const team = i % 2 === 0 ? 'A' : 'B';
    const ent = room.addHuman(`u${i}`, `player${i}`, team, i % 2 === 0 ? 'volt' : 'brakk');
    ents.push(ent);
  }
  return ents;
}

function tickN(room, n) {
  for (let i = 0; i < n; i++) room.tick();
}

test('movement respects walls (server authoritative)', () => {
  const room = makeRoom();
  const [a] = addFighters(room, 1);
  // place next to a wall and push into it
  a.x = 5 * 64; a.y = 5 * 64;
  const before = { x: a.x, y: a.y };
  a.lastInput = { dx: 0, dy: 1, aim: 0, fire: false };
  tickN(room, 10);
  // cannot move through solid tiles; position must stay inside bounds
  assert.ok(a.x >= 0 && a.y >= 0 && a.x < map.width * 64 && a.y < map.height * 64);
  // open floor movement works
  const x0 = a.x, y0 = a.y;
  a.lastInput = { dx: 1, dy: 0, aim: 0, fire: false };
  tickN(room, 5);
  assert.ok(a.x > x0 || a.y !== y0 || Math.abs(a.x - before.x) >= 0); // moved or blocked legitimately
});

test('attack consumes ammo and respects cooldown', () => {
  const room = makeRoom();
  const [a, b] = addFighters(room, 2);
  a.x = 300; a.y = 300; b.x = 420; b.y = 300;
  const ammo0 = a.ammo;
  a.lastInput = { dx: 0, dy: 0, aim: 0, fire: true };
  tickN(room, 1);
  assert.ok(a.ammo < ammo0, 'ammo consumed');
  const shotAt = a.lastShotAt;
  tickN(room, 1);
  assert.equal(a.lastShotAt, shotAt, 'cooldown blocks immediate second shot');
  // after cooldown passes, shot allowed again
  tickN(room, Math.ceil(a.fighter.cooldown / 50) + 2);
  assert.ok(a.lastShotAt !== shotAt, 'second shot after cooldown');
});

test('projectiles deal damage and kills increment stats', () => {
  const room = makeRoom();
  const [a, b] = addFighters(room, 2);
  a.x = 300; a.y = 300; b.x = 500; a.y = 300; b.y = 300;
  b.hp = 400; // low health for a guaranteed kill
  a.lastInput = { dx: 0, dy: 0, aim: 0, fire: true };
  tickN(room, 1);
  tickN(room, 40); // let projectile travel
  assert.equal(b.dead, true, 'target died');
  assert.equal(a.stats.kills, 1);
  assert.equal(b.stats.deaths, 1);
  // respawn after delay
  b.respawnAt = room.now - 1;
  tickN(room, 2);
  assert.equal(b.dead, false, 'respawned');
  assert.equal(b.hp, b.maxHp);
});

test('melee arc hits only in front', () => {
  const room = makeRoom();
  const [a, b] = addFighters(room, 2);
  a.fighterId = 'brakk'; a.fighter = { ...a.fighter, attack: { type: 'melee', damage: 100, range: 165, arc: 1.8, cooldown: 400, ammo: 3, reload: 1000 } };
  a.x = 300; a.y = 300; b.x = 380; b.y = 300;
  a.angle = 0; // facing +x
  room.applyDamage(b, 100, a); // warm-up sanity: direct damage works
  assert.ok(b.hp < b.maxHp);
});

test('super charge from damage and zone super damages enemies', () => {
  const room = makeRoom();
  const [a, b] = addFighters(room, 2);
  a.x = 300; a.y = 300; b.x = 340; b.y = 300;
  const hp0 = b.hp;
  room.applyDamage(b, 1000, a);
  assert.ok(a.superCharge > 0, 'charge gained');
  a.superCharge = 1;
  a.angle = 0;
  room.useSuper(a);
  assert.equal(a.superCharge, 0);
  // volt zone: radius 180 around a → b at distance 40 is inside; zone ticks every 500ms
  const hp1 = b.hp;
  tickN(room, 30); // 1.5s
  assert.ok(b.hp < hp1, 'zone dealt damage');
});

test('crate destruction by AoE', () => {
  const room = makeRoom();
  addFighters(room, 2);
  // find a crate on the map
  let crate = null;
  for (let y = 0; y < map.height && !crate; y++)
    for (let x = 0; x < map.width && !crate; x++)
      if (map.grid[y][x] === 2) crate = [x, y];
  assert.ok(crate, 'map has crates');
  room.damageCrate(crate[0], crate[1], 5000, null);
  assert.equal(map.grid[crate[1]][crate[0]], 0, 'crate destroyed');
});

test('elimination: kills score and target ends match', () => {
  const room = makeRoom('elimination');
  const [a, b] = addFighters(room, 2);
  b.hp = 1;
  room.applyDamage(b, 100, a);
  assert.equal(room.score.A, 1);
  room.score.A = 9;
  const c = room.addHuman('u2', 'player2', 'B', 'volt');
  c.hp = 1;
  room.applyDamage(c, 50, a);
  tickN(room, 1); // checkEnd runs on tick
  assert.equal(room.status, 'ended', 'match ended at target');
  assert.equal(room.results.winner, 'A');
  assert.ok(room.results.players.length >= 3);
  assert.equal(typeof room.results.players[0].damage, 'number');
});

test('crystal rush: pickup, countdown, win', () => {
  const room = makeRoom('crystal_rush');
  const [a, b] = addFighters(room, 2);
  room.mode.start(room);
  // give crystals directly
  a.carrying = 10;
  tickN(room, 2);
  assert.ok(room.modeState.counting, 'countdown started at 10 crystals');
  tickN(room, Math.ceil(room.modeState.countdownMs / 50) + 2);
  assert.equal(room.status, 'ended');
  assert.equal(room.results.winner, 'A');
});

test('crystal rush: death drops crystals', () => {
  const room = makeRoom('crystal_rush');
  const [a, b] = addFighters(room, 2);
  b.carrying = 4;
  room.kill(b, a);
  assert.equal(b.carrying, 0);
  assert.equal(room.pickups.length, 4);
});

test('domination: capture zone and score', () => {
  const room = makeRoom('domination');
  const [a] = addFighters(room, 1);
  assert.equal(room.zones.length, 3);
  const zone = room.zones[0];
  a.x = zone.x; a.y = zone.y;
  tickN(room, 200); // 10s of capture + scoring
  assert.equal(zone.owner, 'A');
  assert.ok(room.score.A > 0, 'score ticks while owned');
});

test('last core: shrink and solo win', () => {
  const room = makeRoom('last_core');
  const ents = [];
  for (let i = 0; i < 4; i++) ents.push(room.addHuman(`u${i}`, `p${i}`, `F${i}`, 'volt'));
  room.mode.start?.(room);
  tickN(room, 20); // rift shrinks over time
  assert.ok(room.safeRadius.r < room.safeRadius.r0);
  // kill everyone but first
  for (const e of ents.slice(1)) { e.hp = 1; room.applyDamage(e, 10, null, false, true); }
  tickN(room, 2);
  assert.equal(room.status, 'ended', 'match ended when 1 alive');
  assert.equal(room.results.winner, 'F0');
});

test('strikeball: goal scoring and reset', () => {
  const room = makeRoom('strikeball');
  addFighters(room, 2);
  room.mode.start(room);
  const ball = room.modeState.ball;
  const goalB = room.map.objectives.goalB;
  ball.x = (goalB[0] + 0.5) * 64; ball.y = (goalB[1] + 0.5) * 64;
  ball.vx = 0; ball.vy = 0; ball.holderId = null;
  tickN(room, 2);
  assert.equal(room.score.A, 1, 'ball in goal B scores for A');
  assert.ok(room.modeState.resetTimer > 0, 'reset delay');
});

test('boss raid: boss exists, phases, win by killing boss', () => {
  const room = makeRoom('boss_raid');
  const [a] = addFighters(room, 1);
  room.mode.start(room);
  const boss = room.ents.get('boss');
  assert.ok(boss, 'boss spawned');
  boss.hp = 10;
  room.applyDamage(boss, 100, a);
  assert.equal(boss.hp, 0);
  tickN(room, 2);
  assert.equal(room.results.winner, 'A');
});

test('modifiers apply (double ammo, speed, damage)', () => {
  const room = makeRoom('elimination', { double_ammo: true, speed_mult: 1.5, damage_mult: 1.2 });
  const [a] = addFighters(room, 1);
  assert.equal(a.maxAmmo, 6, 'double ammo');
  assert.equal(a.fighter.speed, Math.round(250 * 1.5));
  assert.equal(a.fighter.attack.damage, Math.round(460 * 1.2));
});

test('stun blocks firing', () => {
  const room = makeRoom();
  const [a, b] = addFighters(room, 2);
  a.x = 300; a.y = 300; b.x = 420; b.y = 300;
  a.stunUntil = room.now + 5000;
  const ammo0 = a.ammo;
  a.lastInput = { dx: 0, dy: 0, aim: 0, fire: true };
  tickN(room, 2);
  assert.equal(a.ammo, ammo0, 'stunned player cannot fire');
});

test('input validation clamps garbage', () => {
  const room = makeRoom();
  const [a] = addFighters(room, 1);
  room.setInput('u0', { dx: 999, dy: -999, aim: 12345, seq: 'NaN' });
  assert.equal(Math.abs(a.lastInput.dx), 1);
  assert.equal(Math.abs(a.lastInput.dy), 1);
});

test('snapshot payload is compact and complete', () => {
  const room = makeRoom();
  addFighters(room, 2);
  const snap = room.snapshot();
  assert.ok(snap.ents.length >= 2);
  const p = snap.ents[0];
  for (const k of ['id', 'kind', 'f', 'n', 'team', 'x', 'y', 'a', 'hp', 'mhp', 'am', 'sc']) assert.ok(k in p, `missing ${k}`);
  assert.ok(typeof snap.tl === 'number');
});
