// RIFT ARENA — authoritative game room: lifecycle, input, movement, supers, abilities, deaths
import { GAME, TILE_PROPS } from '../../../shared/constants.js';
import { moveCircle } from './movement.js';
import { tryAttack, stepProjectiles, effectiveFighter } from './combat.js';
import { getModeModule } from './modes/index.js';
import { freePointNear } from './movement.js';

const nowMs = () => Date.now();

export class GameRoom {
  constructor(opts) {
    this.id = opts.id;
    this.modeId = opts.mode;
    this.mode = getModeModule(opts.mode);
    this.map = opts.map;
    this.ranked = !!opts.ranked;
    this.event = opts.event ?? null;
    this.modifiers = opts.modifiers ?? {};
    this.config = opts.config ?? {};
    this.onFinish = opts.onFinish;   // async (room, results) => void
    this.status = 'lobby';           // lobby | countdown | running | ended
    this.ents = new Map();           // slot -> entity (players + bots + turrets + boss)
    this.humanCount = 0;
    this.projectiles = [];
    this.pickups = [];               // crystals
    this.zones = [];                 // domination zones
    this.fxBuffer = [];
    this.score = { A: 0, B: 0 };
    this.crates = new Map();         // "x,y" -> hp
    this.startedAt = 0;
    this.now = nowMs();
    this.timeLeft = this.mode.def.timer;
    this.countdown = 3000;
    this.tickCount = 0;
    this.lastSnapshotAt = 0;
    this.modeState = {};
    this.results = null;
    this.safeRadius = null;          // last_core
    this.mode.init?.(this);
  }

  get modeDef() { return this.mode.def; }

  combatables() {
    const out = [];
    for (const e of this.ents.values()) {
      if (e.kind === 'turret' || e.kind === 'boss') { out.push(e); continue; }
      if (!e.dead) out.push(e);
    }
    return out;
  }

  humans() { return [...this.ents.values()].filter(e => e.kind === 'player'); }

  spawnPointFor(team) {
    const spawns = this.map.spawns[team === 'F' ? 'FFA' : team] ?? this.map.spawns.FFA ?? [[3, 3]];
    const i = Math.floor(Math.random() * spawns.length);
    const [tx, ty] = spawns[i];
    return freePointNear(this.map, tx, ty, 24);
  }

  addHuman(userId, name, team, fighterId) {
    const slot = `p_${userId}`;
    const existing = this.ents.get(slot);
    if (existing && existing.kind === 'player') { existing.disconnected = false; return existing; }
    const ent = this.makeFighterEnt(slot, 'player', userId, name, team, fighterId);
    this.ents.set(slot, ent);
    this.humanCount++;
    return ent;
  }

  addBot(name, team, fighterId) {
    const slot = `b_${name}`;
    const ent = this.makeFighterEnt(slot, 'bot', null, name, team, fighterId);
    ent.isBot = true;
    ent.ai = { target: null, decideAt: 0, wanderTo: null };
    this.ents.set(slot, ent);
    return ent;
  }

  makeFighterEnt(slot, kind, userId, name, team, fighterId) {
    const fighter = effectiveFighter(fighterId, this.modifiers);
    if (!fighter) throw new Error(`unknown fighter ${fighterId}`);
    const sp = this.spawnPointFor(team);
    return {
      id: slot, kind, userId, name, team, fighterId, fighter,
      x: sp.x, y: sp.y, angle: 0, radius: fighter.radius ?? 22,
      hp: fighter.hp, maxHp: fighter.hp, shield: 0, shieldMax: 0, shieldUntil: 0,
      dead: false, respawnAt: 0, disconnected: false,
      ammo: fighter.ammo, maxAmmo: fighter.ammo, lastShotAt: 0,
      superCharge: 0, abilityUses: fighter.ability?.uses ?? 0, lastAbilityAt: 0,
      buffNextDamageMult: null, pierceNext: 0,
      stunUntil: 0, speedUntil: 0, speedMult: 1, revealUntil: 0, portalCd: 0,
      lastDamagedAt: 0, carrying: 0, hasBall: false,
      stats: { kills: 0, deaths: 0, damage: 0, objectives: 0, heals: 0 },
      lastInput: { dx: 0, dy: 0, aim: 0, fire: false },
      inputSeq: 0,
    };
  }

  setInput(userId, input) {
    const ent = this.ents.get(`p_${userId}`);
    if (!ent || ent.kind !== 'player') return;
    // validate & clamp — the client never sends positions, only intent
    const dx = Math.max(-1, Math.min(1, +input.dx || 0));
    const dy = Math.max(-1, Math.min(1, +input.dy || 0));
    const aim = Math.max(-Math.PI * 4, Math.min(Math.PI * 4, +input.aim || 0));
    ent.inputSeq = +input.seq || ent.inputSeq + 1;
    ent.lastInput = { dx, dy, aim, fire: !!input.fire };
    if (input.fireAngle !== undefined) ent.angle = aim;
    if (input.wantSuper) this.useSuper(ent);
    if (input.wantAbility) this.useAbility(ent);
    if (input.wantKick) this.mode.onKick?.(this, ent);
  }

  // ---------- tick ----------
  tick() {
    if (this.status === 'ended') return;
    const dt = GAME.TICK_MS / 1000;
    // simulation clock: independent of wall time (robust to server lag, deterministic tests)
    this.now += GAME.TICK_MS;

    if (this.status === 'countdown') {
      this.countdown -= GAME.TICK_MS;
      if (this.countdown <= 0) { this.status = 'running'; this.startedAt = this.now; this.mode.start?.(this); }
      return;
    }
    if (this.status !== 'running') return;

    this.timeLeft -= GAME.TICK_MS;
    this.tickCount++;

    // simulation
    for (const ent of this.ents.values()) this.stepEnt(ent, dt);
    this.stepTurrets(dt);
    stepProjectiles(this, dt);
    this.stepZonesAndPickups(dt);
    this.stepHazards(dt);
    this.mode.tick?.(this, dt);

    // win conditions
    const end = this.mode.checkEnd?.(this);
    if (end || this.timeLeft <= 0) {
      this.finish(end?.winner ?? this.mode.defaultWinner?.(this) ?? null);
      return;
    }
  }

  stepEnt(ent, dt) {
    if (ent.kind !== 'player' && ent.kind !== 'boss') return;
    if (ent.kind === 'boss') return; // boss handled by mode module
    if (ent.dead) {
      const allow = this.mode.allowRespawn?.(this, ent) ?? (this.mode.respawn ?? true);
      if (this.now >= ent.respawnAt && allow) this.respawn(ent);
      return;
    }

    // stunned?
    const stunned = this.now < ent.stunUntil;

    // speed calculation
    let speed = ent.fighter.speed;
    if (this.now < ent.speedUntil) speed *= ent.speedMult;
    if (ent.fighter.passive?.type === 'adrenaline' && ent.hp < ent.maxHp * ent.fighter.passive.below) speed *= ent.fighter.passive.mult;
    if (ent.fighter.passive?.type === 'ally_speed') {
      // aura: allies inside radius get speedMult (applied below)
    }

    // movement (from input — direction only; positions are authoritative here)
    if (!stunned && (ent.lastInput.dx || ent.lastInput.dy)) {
      const len = Math.hypot(ent.lastInput.dx, ent.lastInput.dy) || 1;
      const dx = (ent.lastInput.dx / len) * speed * dt;
      const dy = (ent.lastInput.dy / len) * speed * dt;
      moveCircle(this.map, ent, dx, dy, ent.radius);
    }
    if (!ent.lastInput.aimManual) ent.angle = ent.lastInput.aim;
    else ent.angle = ent.lastInput.aim;

    // ammo regen
    if (ent.ammo < ent.maxAmmo) {
      ent.ammo = Math.min(ent.maxAmmo, ent.ammo + dt * 1000 / ent.fighter.reload);
    }

    // fire
    if (ent.lastInput.fire && !stunned) tryAttack(this, ent);

    // shield expiry
    if (ent.shield > 0 && this.now > ent.shieldUntil) ent.shield = 0;

    // passive shield_regen
    if (ent.fighter.passive?.type === 'shield_regen' && ent.shield < ent.fighter.passive.max) {
      if (this.now - ent.lastDamagedAt > ent.fighter.passive.delay) {
        ent.shield = Math.min(ent.fighter.passive.max, ent.shield + ent.fighter.passive.rate * dt);
      }
    }

    // ally speed aura (Nyx / Patch passive)
    if (ent.fighter.passive?.type === 'ally_speed') {
      for (const other of this.ents.values()) {
        if (other.kind !== 'player' && other.kind !== 'bot') continue;
        if (other.team !== ent.team || other.id === ent.id || other.dead) continue;
        if (Math.hypot(other.x - ent.x, other.y - ent.y) < ent.fighter.passive.radius) {
          other.speedUntil = Math.max(other.speedUntil, this.now + 100);
          other.speedMult = Math.max(other.speedMult, ent.fighter.passive.mult);
        }
      }
    }
  }

  stepTurrets(dt) {
    for (const ent of this.ents.values()) {
      if (ent.kind !== 'turret') continue;
      ent.lifetime -= dt * 1000;
      if (ent.lifetime <= 0 || ent.hp <= 0) { this.ents.delete(ent.id); this.fx({ k: 'despawn', id: ent.id }); continue; }
      ent.acc = (ent.acc ?? 0) + dt * 1000;
      let target = null, bd = ent.turret.range;
      for (const other of this.combatables()) {
        if (other.team === ent.team || other.dead || other.kind === 'turret') continue;
        const d = Math.hypot(other.x - ent.x, other.y - ent.y);
        if (d < bd) { bd = d; target = other; }
      }
      if (target && ent.acc >= ent.turret.interval) {
        ent.acc = 0;
        const ang = Math.atan2(target.y - ent.y, target.x - ent.x);
        this.projectiles.push({
          id: `t${++this._tid ?? (this._tid = 1)}`, kind: 'bullet', owner: ent.id, team: ent.team,
          x: ent.x, y: ent.y, vx: Math.cos(ang) * ent.turret.speed, vy: Math.sin(ang) * ent.turret.speed,
          dmg: ent.turret.damage, heal: 0, radius: 6, range: ent.turret.range, traveled: 0,
          pierce: 0, overWalls: false, homing: null, color: '#facc15', fighter: 'patch',
        });
        this.fx({ k: 'shot', x: ent.x, y: ent.y, a: ang, c: '#facc15' });
      }
    }
  }

  stepZonesAndPickups(dt) {
    // crystal pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age = (p.age ?? 0) + dt;
      if (p.delay && p.age < p.delay) continue;
      for (const ent of this.combatables()) {
        if (ent.kind !== 'player' && ent.kind !== 'bot') continue;
        if (Math.hypot(ent.x - p.x, ent.y - p.y) < ent.radius + 20) {
          ent.carrying = (ent.carrying ?? 0) + 1;
          ent.stats.objectives++;
          this.pickups.splice(i, 1);
          this.mode.onPickup?.(this, ent, p);
          this.fx({ k: 'pickup', x: p.x, y: p.y, id: ent.id });
          break;
        }
      }
    }
    // zone entities (surge field, guardian drone)
    for (const ent of [...this.ents.values()]) {
      if (ent.kind !== 'zone' && ent.kind !== 'drone') continue;
      ent.duration -= dt * 1000;
      if (ent.duration <= 0) { this.ents.delete(ent.id); continue; }
      ent.tickAcc = (ent.tickAcc ?? 0) + dt * 1000;
      if (ent.tickAcc >= (ent.tickEvery ?? 500)) {
        ent.tickAcc = 0;
        if (ent.kind === 'zone') {
          for (const other of this.combatables()) {
            if (other.team === ent.team || other.dead) continue;
            if (Math.hypot(other.x - ent.x, other.y - ent.y) < ent.radius + other.radius) {
              this.applyDamage(other, ent.dps * (ent.tickEvery / 1000), this.ents.get(ent.owner));
            }
          }
          const owner = this.ents.get(ent.owner);
          if (owner && !owner.dead && Math.hypot(owner.x - ent.x, owner.y - ent.y) < ent.radius + owner.radius) {
            owner.speedUntil = this.now + 600;
            owner.speedMult = ent.selfSpeed ?? 1.25;
          }
        } else if (ent.kind === 'drone') {
          for (const other of this.combatables()) {
            if (other.team !== ent.team || other.dead || other.kind === 'turret') continue;
            if (Math.hypot(other.x - ent.x, other.y - ent.y) < ent.radius + other.radius) {
              this.applyDamage(other, -ent.healPerSec * (ent.tickEvery / 1000), this.ents.get(ent.owner), true);
            }
          }
        }
      }
    }
    // ball (strikeball) handled by mode
  }

  stepHazards(dt) {
    for (const ent of this.combatables()) {
      if (ent.kind !== 'player' && ent.kind !== 'bot' && ent.kind !== 'boss') continue;
      const t = (Math.floor(ent.y / 64) >= 0 && Math.floor(ent.y / 64) < this.map.height &&
        Math.floor(ent.x / 64) >= 0 && Math.floor(ent.x / 64) < this.map.width)
        ? this.map.grid[Math.floor(ent.y / 64)][Math.floor(ent.x / 64)] : 0;
      if (t === 5) this.applyDamage(ent, TILE_PROPS[5].dps * dt, null, false, true);
    }
  }

  // ---------- combat ----------
  applyDamage(target, amount, source, isHeal = false, isHazard = false) {
    if (this.status !== 'running') return;
    if (target.dead && !isHeal) return;
    if (isHeal) {
      if (target.kind === 'turret' || target.kind === 'boss') return;
      target.hp = Math.min(target.maxHp, target.hp + amount);
      if (source) source.stats.heals += amount;
      return;
    }
    if (target.kind === 'turret') {
      target.hp -= amount;
      return;
    }
    if (target.kind === 'boss') {
      target.hp -= amount;
      if (source) { source.stats.damage += amount; this.addSuperCharge(source, amount); }
      this.mode.onBossDamage?.(this, target, amount);
      if (target.hp <= 0) target.hp = 0;
      return;
    }
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount <= 0) return;
    target.hp -= amount;
    target.lastDamagedAt = this.now;
    if (source && source.id !== target.id) {
      source.stats.damage += amount;
      // attacker passives
      if (source.fighter?.passive?.type === 'speed_on_hit') {
        source.speedUntil = this.now + source.fighter.passive.duration;
        source.speedMult = source.fighter.passive.mult;
      }
      this.addSuperCharge(source, amount);
    }
    if (target.hp <= 0) {
      target.hp = 0;
      this.kill(target, source, isHazard);
    }
  }

  addSuperCharge(ent, dmg) {
    if (!ent.fighter?.super || ent.kind === 'boss') return;
    const mult = this.modifiers.energy_mult ?? 1;
    ent.superCharge = Math.min(1, ent.superCharge + (dmg * mult) / ent.fighter.super.charge);
  }

  kill(victim, killer, isHazard = false) {
    victim.dead = true;
    victim.respawnAt = this.now + GAME.RESPAWN_MS;
    victim.deaths = (victim.deaths ?? 0) + 1;
    victim.stats.deaths++;
    victim.shield = 0;
    this.fx({ k: 'death', x: victim.x, y: victim.y, id: victim.id });
    if (killer && killer.id !== victim.id && killer.kind !== 'boss') {
      killer.stats.kills++;
      killer.kills = (killer.kills ?? 0) + 1;
    }
    this.mode.onKill?.(this, killer, victim, isHazard);
  }

  respawn(ent) {
    const sp = this.spawnPointFor(ent.team);
    ent.x = sp.x; ent.y = sp.y;
    ent.hp = ent.maxHp;
    ent.dead = false;
    ent.ammo = ent.maxAmmo;
    ent.superCharge = Math.min(ent.superCharge, 1);
    ent.stunUntil = 0;
    ent.carrying = 0;
    ent.hasBall = false;
    this.fx({ k: 'respawn', x: ent.x, y: ent.y, id: ent.id });
  }

  // ---------- supers & abilities ----------
  useSuper(ent) {
    if (ent.dead || ent.superCharge < 1 || ent.fighter.super.special === undefined) return;
    const sup = ent.fighter.super;
    ent.superCharge = 0;
    ent.stats.supers = (ent.stats.supers ?? 0) + 1;
    const angle = ent.angle;
    switch (sup.special) {
      case 'zone': {
        this.ents.set(`z_${ent.id}_${this.tickCount}`, {
          id: `z_${ent.id}_${this.tickCount}`, kind: 'zone', owner: ent.id, team: ent.team,
          x: ent.x, y: ent.y, radius: sup.zone.radius, dps: sup.zone.dps,
          duration: sup.zone.duration, tickEvery: sup.zone.tick, selfSpeed: sup.zone.selfSpeed,
        });
        this.fx({ k: 'zone', x: ent.x, y: ent.y, r: sup.zone.radius, c: sup.color });
        break;
      }
      case 'reveal': {
        ent.pierceNext = 1;
        for (const other of this.ents.values()) {
          if (other.kind !== 'player' && other.kind !== 'bot') continue;
          if (other.team === ent.team) continue;
          other.revealUntil = this.now + sup.reveal.duration;
        }
        this.fx({ k: 'reveal', x: ent.x, y: ent.y, r: 400, c: sup.color });
        break;
      }
      case 'shockwave': {
        for (const other of this.combatables()) {
          if (other.team === ent.team || other.id === ent.id || other.dead) continue;
          const d = Math.hypot(other.x - ent.x, other.y - ent.y);
          if (d > sup.wave.radius) continue;
          if (other.kind === 'player' || other.kind === 'bot') {
            this.applyDamage(other, sup.wave.damage, ent);
            other.stunUntil = this.now + sup.wave.stun;
            // knockback away
            const a = Math.atan2(other.y - ent.y, other.x - ent.x);
            moveCircle(this.map, other, Math.cos(a) * sup.wave.knockback, Math.sin(a) * sup.wave.knockback, other.radius);
          } else if (other.kind === 'turret') {
            other.hp -= sup.wave.damage;
          }
        }
        this.fx({ k: 'wave', x: ent.x, y: ent.y, r: sup.wave.radius, c: sup.color });
        break;
      }
      case 'dash': {
        this.dash(ent, sup.dash.distance, sup.dash.duration);
        ent.buffNextDamageMult = sup.dash.buff?.nextDamageMult ?? 1.2;
        this.fx({ k: 'dash', x: ent.x, y: ent.y, id: ent.id, c: sup.color });
        break;
      }
      case 'turret': {
        const tid = `t_${ent.id}_${this.tickCount}`;
        this.ents.set(tid, {
          id: tid, kind: 'turret', owner: ent.id, team: ent.team, name: 'Turret',
          x: ent.x + Math.cos(angle) * 40, y: ent.y + Math.sin(angle) * 40,
          hp: sup.turret.hp, maxHp: sup.turret.hp, radius: 18,
          turret: sup.turret, fighterId: 'patch',
        });
        this.fx({ k: 'turret', x: ent.x, y: ent.y, c: sup.color });
        break;
      }
      case 'drone': {
        const did = `d_${ent.id}_${this.tickCount}`;
        this.ents.set(did, {
          id: did, kind: 'drone', owner: ent.id, team: ent.team,
          x: ent.x, y: ent.y, radius: sup.drone.radius,
          healPerSec: sup.drone.healPerSec, duration: sup.drone.duration,
          tickEvery: 500,
        });
        this.fx({ k: 'drone', x: ent.x, y: ent.y, r: sup.drone.radius, c: sup.color });
        break;
      }
      default: break;
    }
  }

  dash(ent, distance, duration) {
    const a = ent.angle;
    const dx = Math.cos(a) * distance, dy = Math.sin(a) * distance;
    const steps = 8;
    const perStep = duration / steps;
    // fast but collision-safe: apply in sub-steps immediately
    for (let i = 0; i < steps; i++) {
      const moved = moveCircle(this.map, ent, dx / steps, dy / steps, ent.radius);
      if (moved) break; // hit a portal — stop early
    }
  }

  useAbility(ent) {
    if (ent.dead || !ent.fighter.ability) return;
    if (ent.abilityUses <= 0) return;
    if (this.now - ent.lastAbilityAt < ent.fighter.ability.cooldown) return;
    const ab = ent.fighter.ability;
    ent.abilityUses--;
    ent.lastAbilityAt = this.now;
    switch (ab.type) {
      case 'reload': ent.ammo = Math.min(ent.maxAmmo, ent.ammo + ab.amount); break;
      case 'dash': this.dash(ent, ab.distance, ab.duration); this.fx({ k: 'dash', x: ent.x, y: ent.y, id: ent.id, c: '#fff' }); break;
      case 'shield':
        ent.shield = Math.max(ent.shield, ab.amount);
        ent.shieldUntil = this.now + ab.duration;
        this.fx({ k: 'shield', id: ent.id, c: '#9be7ff' });
        if (ab.aoe) {
          for (const other of this.combatables()) {
            if (other.team !== ent.team || other.id === ent.id || other.dead) continue;
            if (Math.hypot(other.x - ent.x, other.y - ent.y) < ab.aoe) {
              other.shield = Math.max(other.shield, ab.amount);
              other.shieldUntil = this.now + ab.duration;
            }
          }
        }
        break;
      case 'heal':
        ent.hp = Math.min(ent.maxHp, ent.hp + ab.amount);
        if (ab.healTurret) {
          for (const other of this.ents.values()) {
            if (other.kind === 'turret' && other.owner === ent.id) other.hp = other.maxHp;
          }
        }
        this.fx({ k: 'heal', id: ent.id, c: '#4ade80' });
        break;
      case 'buff': ent.buffNextDamageMult = ab.buff?.nextDamageMult ?? 1.3; break;
      default: break;
    }
  }

  // ---------- crates ----------
  damageCrate(tx, ty, dmg, ownerId) {
    const key = `${tx},${ty}`;
    const hp = this.crates.get(key) ?? 2000;
    const next = hp - dmg;
    if (next <= 0) {
      this.crates.delete(key);
      this.map.grid[ty][tx] = 0;
      this.fx({ k: 'crate', x: (tx + 0.5) * 64, y: (ty + 0.5) * 64 });
    } else {
      this.crates.set(key, next);
    }
  }

  // ---------- fx / snapshots ----------
  fx(ev) { if (this.fxBuffer.length < 80) this.fxBuffer.push(ev); }

  shouldSendSnapshot() {
    // 90% of the period so the 50ms tick grid never drops a frame (15Hz target at 20Hz ticks)
    return (this.now - this.lastSnapshotAt) >= (1000 / GAME.SNAPSHOT_RATE) * 0.9;
  }

  snapshot() {
    this.lastSnapshotAt = this.now;
    const ents = [];
    for (const e of this.ents.values()) {
      if (e.kind === 'turret') {
        ents.push({ id: e.id, kind: 'turret', x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), maxHp: e.maxHp, team: e.team });
      } else if (e.kind === 'zone' || e.kind === 'drone') {
        ents.push({ id: e.id, kind: e.kind, x: Math.round(e.x), y: Math.round(e.y), r: e.radius, team: e.team });
      } else if (e.kind === 'boss') {
        ents.push({ id: e.id, kind: 'boss', x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), maxHp: e.maxHp, team: e.team });
      } else {
        ents.push({
          id: e.id, kind: e.kind, f: e.fighterId, n: e.name, team: e.team,
          x: Math.round(e.x), y: Math.round(e.y), a: Math.round(e.angle * 100) / 100,
          hp: Math.round(e.hp), mhp: e.maxHp, sh: Math.round(e.shield),
          d: e.dead ? 1 : 0, am: Math.round(e.ammo * 10) / 10, ama: e.maxAmmo,
          sc: Math.round(e.superCharge * 100) / 100, cr: e.carrying ?? 0, ball: e.hasBall ? 1 : 0,
          bot: e.kind === 'bot' ? 1 : 0, dc: e.disconnected ? 1 : 0,
          ab: e.abilityUses,
        });
      }
    }
    return {
      t: 'snap', tick: this.tickCount, st: this.status, tl: Math.max(0, Math.round(this.timeLeft)),
      cd: this.status === 'countdown' ? Math.max(0, Math.round(this.countdown)) : null,
      sA: this.score.A, sB: this.score.B,
      ents, projs: this.projectiles.map(p => ({
        id: p.id, k: p.kind, x: Math.round(p.x), y: Math.round(p.y), c: p.color,
        h: p.arcH !== undefined ? Math.round(p.arcH) : null,
      })),
      picks: this.pickups.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) })),
      zones: this.zones.map(z => ({ id: z.id, x: z.x, y: z.y, owner: z.owner, prog: Math.round(z.prog * 10) / 10 })),
      ball: this.modeState.ball ? { x: Math.round(this.modeState.ball.x), y: Math.round(this.modeState.ball.y), holder: this.modeState.ball.holderId ?? null } : null,
      safe: this.safeRadius ? { x: this.safeRadius.x, y: this.safeRadius.y, r: Math.round(this.safeRadius.r) } : null,
      hud: this.mode.hud?.(this) ?? null,
    };
  }

  // ---------- end ----------
  finish(winnerTeam) {
    if (this.status === 'ended') return;
    this.status = 'ended';
    // star player on winning side
    const players = [...this.ents.values()].filter(e => e.kind === 'player' || e.kind === 'bot');
    let star = null, bestScore = -1;
    for (const p of players) {
      if (winnerTeam && p.team !== winnerTeam) continue;
      const s = (p.stats.kills * 100) + (p.stats.objectives * 50) + p.stats.damage / 10;
      if (s > bestScore) { bestScore = s; star = p.id; }
    }
    const won = (p) => winnerTeam === 'draw' ? false : (p.team === winnerTeam);
    this.results = {
      roomId: this.id, mode: this.modeId, map: this.map.id, ranked: this.ranked,
      event: this.event ? { id: this.event.id, name: this.event.name } : null,
      winner: winnerTeam ?? null,
      durationMs: this.startedAt ? this.now - this.startedAt : this.modeDef.timer,
      players: players.map(p => ({
        userId: p.userId, name: p.name, team: p.team, fighter: p.fighterId, bot: p.kind === 'bot',
        kills: p.stats.kills, deaths: p.stats.deaths, damage: Math.round(p.stats.damage),
        objectives: p.stats.objectives, heals: Math.round(p.stats.heals ?? 0), supers: p.stats.supers ?? 0,
        won: won(p), starPlayer: p.id === star,
      })),
    };
    this.onFinish?.(this, this.results);
  }
}
