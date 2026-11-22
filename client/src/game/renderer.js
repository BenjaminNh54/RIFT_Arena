// RIFT ARENA — game renderer: procedural tile textures, vector entities, camera, effects
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';
import { TILE } from '/shared/constants.js';

const THEME = {
  neon:    { floor: ['#141c3a', '#18224a'], wall: '#2a3a7a', wallTop: '#4a5ab8', crate: '#7a5a2a', bush: '#1e9a5a', water: '#123a8a', hazard: '#c22a2a', portal: '#8a3adf', grid: 'rgba(80,110,255,0.08)' },
  dust:    { floor: ['#3a2a1a', '#43301f'], wall: '#7a5a34', wallTop: '#9a7a48', crate: '#5a4a2a', bush: '#5a7a2a', water: '#2a5a6a', hazard: '#b34a1a', portal: '#8a3adf', grid: 'rgba(255,220,150,0.05)' },
  moss:    { floor: ['#1a2a1a', '#203324'], wall: '#3a5a3a', wallTop: '#5a7a52', crate: '#5a4a2a', bush: '#2a9a4a', water: '#1a4a5a', hazard: '#b34a1a', portal: '#8a3adf', grid: 'rgba(120,255,150,0.05)' },
  core:    { floor: ['#101828', '#141d33'], wall: '#2a3a5a', wallTop: '#4a5a8a', crate: '#5a4a2a', bush: '#2a7a5a', water: '#1a3a5a', hazard: '#c22a2a', portal: '#8a3adf', grid: 'rgba(80,140,255,0.07)' },
  frost:   { floor: ['#1a2a3a', '#20334a'], wall: '#4a6a8a', wallTop: '#6a8aaa', crate: '#5a5a4a', bush: '#2a7a5a', water: '#3a7a9a', hazard: '#c22a2a', portal: '#8a3adf', grid: 'rgba(150,220,255,0.06)' },
  ember:   { floor: ['#2a1a1a', '#332020'], wall: '#5a3a2a', wallTop: '#7a523a', crate: '#6a4a2a', bush: '#3a5a2a', water: '#5a1a1a', hazard: '#ff4a1a', portal: '#8a3adf', grid: 'rgba(255,120,60,0.05)' },
  sky:     { floor: ['#2a3a5a', '#31425f'], wall: '#5a6a8a', wallTop: '#7a8aaa', crate: '#6a5a3a', bush: '#3a7a4a', water: '#3a6a9a', hazard: '#c22a2a', portal: '#9a4aff', grid: 'rgba(200,220,255,0.06)' },
  factory: { floor: ['#1a2226', '#202a2f'], wall: '#3a4a4a', wallTop: '#55686a', crate: '#5a4a2a', bush: '#2a6a3a', water: '#2a4a5a', hazard: '#b32a1a', portal: '#8a3adf', grid: 'rgba(120,180,180,0.06)' },
};

export class Renderer {
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.theme = THEME[map.theme] ?? THEME.neon;
    this.quality = opts.quality ?? 'high';
    this.tileCache = null;
    this.effects = []; // client-side visual effects {x,y,type,born,color}
    this.buildTileCache();
  }

  buildTileCache() {
    // bake the whole static map into an offscreen canvas (tiles don't change except crates)
    const m = this.map;
    const off = document.createElement('canvas');
    off.width = m.width * TILE; off.height = m.height * TILE;
    const c = off.getContext('2d');
    const t = this.theme;
    // floor base with subtle checker + grid
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        c.fillStyle = t.floor[(x + y) % 2];
        c.fillRect(x * TILE, y * TILE, TILE, TILE);
        c.strokeStyle = t.grid;
        c.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
        // floor rivets / decor dots
        if (this.quality !== 'low' && (x * 7 + y * 13) % 11 === 0) {
          c.fillStyle = 'rgba(255,255,255,0.045)';
          c.beginPath(); c.arc(x * TILE + TILE * 0.7, y * TILE + TILE * 0.3, 3, 0, 7); c.fill();
        }
      }
    }
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const tile = m.grid[y][x];
        const px = x * TILE, py = y * TILE;
        if (tile === TILE.WALL) {
          c.fillStyle = t.wall; c.fillRect(px, py, TILE, TILE);
          c.fillStyle = t.wallTop; c.fillRect(px, py, TILE, 10);
          c.strokeStyle = 'rgba(0,0,0,0.4)'; c.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
          // panel lines
          c.fillStyle = 'rgba(0,0,0,0.25)';
          c.fillRect(px + TILE / 2 - 1, py + 10, 2, TILE - 10);
        } else if (tile === TILE.WATER) {
          c.fillStyle = t.water; c.fillRect(px, py, TILE, TILE);
          c.fillStyle = 'rgba(255,255,255,0.1)';
          for (let i = 0; i < 3; i++) c.fillRect(px + 6 + i * 20, py + 12 + ((x + y + i) % 3) * 14, 12, 3);
        } else if (tile === TILE.HAZARD) {
          const g = c.createRadialGradient(px + TILE / 2, py + TILE / 2, 4, px + TILE / 2, py + TILE / 2, TILE * 0.7);
          g.addColorStop(0, t.hazard); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.fillRect(px, py, TILE, TILE);
        } else if (tile === TILE.PORTAL) {
          c.fillStyle = t.portal;
          c.beginPath(); c.ellipse(px + TILE / 2, py + TILE / 2, TILE * 0.3, TILE * 0.42, 0, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.5)';
          c.beginPath(); c.ellipse(px + TILE / 2, py + TILE / 2, TILE * 0.12, TILE * 0.24, 0, 0, 7); c.fill();
        }
      }
    }
    this.tileCache = off;
  }

  addEffect(fx) {
    if (this.effects.length > 90) this.effects.shift();
    this.effects.push({ ...fx, born: performance.now() });
  }

  draw(camera, state, now, localId) {
    const { ctx } = this;
    const cam = camera;
    ctx.save();
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.translate(cam.w / 2, cam.h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const m = this.map;
    ctx.imageSmoothingEnabled = false;

    // static tiles
    ctx.drawImage(this.tileCache, 0, 0);

    // crates (dynamic — destroyed at runtime) & bushes
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const tile = m.grid[y][x];
        const px = x * TILE, py = y * TILE;
        if (tile === TILE.CRATE) {
          const t = this.theme;
          ctx.fillStyle = t.crate; ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
          ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
          ctx.beginPath(); ctx.moveTo(px + 3, py + 3); ctx.lineTo(px + TILE - 3, py + TILE - 3);
          ctx.moveTo(px + TILE - 3, py + 3); ctx.lineTo(px + 3, py + TILE - 3); ctx.stroke();
        } else if (tile === TILE.BUSH) {
          const t = this.theme;
          ctx.fillStyle = t.bush;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(px + 20, py + 22, 16, 0, 7);
          ctx.arc(px + 44, py + 26, 14, 0, 7);
          ctx.arc(px + 32, py + 44, 15, 0, 7);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    // safe zone (last core)
    if (state.safe) {
      ctx.strokeStyle = 'rgba(255,80,80,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.arc(state.safe.x, state.safe.y, state.safe.r, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,60,60,0.07)';
      ctx.fillRect(0, 0, m.width * TILE, m.height * TILE);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(state.safe.x, state.safe.y, state.safe.r, 0, 7); ctx.fill();
      ctx.restore();
    }

    // domination zones
    for (const z of state.zones ?? []) {
      const col = z.owner === 'A' ? '#3fa9ff' : z.owner === 'B' ? '#ff4d6d' : '#8fa0c9';
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(z.x, z.y, 115, 0, 7); ctx.stroke();
      ctx.globalAlpha = 0.12; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(z.x, z.y, 115, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = '900 26px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(z.id.toUpperCase(), z.x, z.y - 8);
    }

    // goals (strikeball)
    const goals = m.objectives?.goalA ? [[m.objectives.goalA, 'A'], [m.objectives.goalB, 'B']] : [];
    for (const [[gx, gy], team] of goals) {
      ctx.fillStyle = team === 'A' ? 'rgba(63,169,255,0.3)' : 'rgba(255,77,109,0.3)';
      ctx.fillRect(gx * TILE, gy * TILE - 40, TILE, TILE + 80);
      ctx.strokeStyle = team === 'A' ? '#3fa9ff' : '#ff4d6d';
      ctx.lineWidth = 3;
      ctx.strokeRect(gx * TILE, gy * TILE - 40, TILE, TILE + 80);
    }

    // crystal pickups
    for (const p of state.picks ?? []) {
      const bob = Math.sin(now / 300 + p.id.length) * 4;
      ctx.fillStyle = '#35e0ff';
      ctx.shadowColor = '#35e0ff'; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 16 + bob);
      ctx.lineTo(p.x + 12, p.y + bob);
      ctx.lineTo(p.x, p.y + 16 + bob);
      ctx.lineTo(p.x - 12, p.y + bob);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // zone entities (surge field / guardian drone)
    for (const e of state.ents ?? []) {
      if (e.kind === 'zone') {
        const col = e.team === 'A' ? '#35e0ff' : e.team === 'B' ? '#ff5d5d' : '#35e0ff';
        ctx.fillStyle = col; ctx.globalAlpha = 0.15 + Math.sin(now / 200) * 0.05;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.kind === 'drone') {
        ctx.strokeStyle = '#4ade80'; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.stroke();
        ctx.fillStyle = '#4ade80';
        ctx.beginPath(); ctx.arc(e.x, e.y, 10 + Math.sin(now / 150) * 2, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // projectiles
    for (const p of state.projs ?? []) {
      ctx.fillStyle = p.c ?? '#fff';
      if (p.k === 'lob') {
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(p.x, p.y - (p.h ?? 0), 8, 0, 7); ctx.fill();
        ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (p.k === 'homing') {
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill();
        ctx.shadowColor = p.c; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.shadowColor = p.c; ctx.shadowBlur = this.quality === 'low' ? 0 : 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ball
    if (state.ball) {
      const b = state.ball;
      ctx.fillStyle = '#facc15';
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#0008'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, 7); ctx.stroke();
    }

    // fighters (from interpolated snapshot)
    for (const e of state.ents ?? []) {
      if (e.kind === 'player' || e.kind === 'bot') this.drawFighter(e, now, localId, ctx);
      else if (e.kind === 'turret') {
        const col = e.team === 'A' ? '#3fa9ff' : e.team === 'B' ? '#ff4d6d' : '#facc15';
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(e.x - 14, e.y - 10, 28, 24);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(e.x, e.y - 14, 10, 0, 7); ctx.fill();
        ctx.fillStyle = '#0006';
        ctx.fillRect(e.x - 10, e.y + 8, 20, 4);
        // hp bar
        healthBar(ctx, e.x, e.y - 30, 40, e.hp / e.maxHp, col);
      }
    }

    // boss
    const boss = (state.ents ?? []).find(e => e.kind === 'boss');
    if (boss) {
      ctx.fillStyle = '#1a1f2e';
      ctx.beginPath(); ctx.arc(boss.x, boss.y, 34, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ff5d3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, 34, 0, 7); ctx.stroke();
      // eyes
      ctx.fillStyle = '#ff5d3a';
      ctx.beginPath(); ctx.arc(boss.x - 12, boss.y - 8, 6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(boss.x + 12, boss.y - 8, 6, 0, 7); ctx.fill();
    }

    // client-side effects
    this.drawEffects(ctx, now);

    ctx.restore();
  }

  drawFighter(e, now, localId, ctx) {
    const def = FIGHTER_MAP[e.f ?? 'volt'] ?? FIGHTER_MAP.volt;
    const teamCol = e.team === 'A' ? '#3fa9ff' : e.team === 'B' ? '#ff4d6d' : '#c77dff';
    const isLocal = e.id === localId;

    // hidden in bush: draw only silhouette if enemy inside bush and no reveal
    ctx.save();
    ctx.translate(e.x, e.y);

    // dead: respawn marker
    if (e.d) {
      ctx.globalAlpha = 0.25;
    }

    // body via shared portrait shapes (small scale)
    const s = 0.52;
    ctx.scale(s, s);
    ctx.rotate(0); // bodies face camera; weapon shows aim
    drawBody(ctx, def, now, e);
    ctx.restore();

    // aim line (local only)
    if (isLocal && !e.d) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.a) * def.attack.range * 0.8, e.y + Math.sin(e.a) * def.attack.range * 0.8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // team ring
    ctx.strokeStyle = teamCol;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y + 26, 18, 0, 7);
    ctx.stroke();

    // name + hp
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const name = `${e.bot ? 'BOT ' : ''}${e.n ?? ''}`;
    const tw = ctx.measureText(name).width + 8;
    ctx.fillRect(e.x - tw / 2, e.y - 58, tw, 14);
    ctx.fillStyle = e.team === 'A' ? '#9fd4ff' : e.team === 'B' ? '#ffb3c0' : '#d8c2ff';
    ctx.fillText(name, e.x, e.y - 47);
    healthBar(ctx, e.x, e.y - 40, 44, e.hp / e.mhp, e.team === 'A' ? '#3fa9ff' : '#ff4d6d');
    if (e.sh > 0) {
      ctx.fillStyle = '#9be7ff';
      ctx.fillRect(e.x - 22, e.y - 36, 44 * Math.min(1, e.sh / 1200), 3);
    }
    // crystals carried
    if (e.cr) {
      ctx.fillStyle = '#35e0ff';
      ctx.font = '900 12px system-ui';
      ctx.fillText('◆ ' + e.cr, e.x, e.y + 46);
    }
    // ball holder marker
    if (e.ball) {
      ctx.fillStyle = '#facc15';
      ctx.beginPath(); ctx.arc(e.x, e.y + 40, 7, 0, 7); ctx.fill();
    }
    // reveal outline
    if (isLocal) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y + 4, 26, 0, 7); ctx.stroke();
    }
    if (e.d) ctx.globalAlpha = 1;
  }

  drawEffects(ctx, now) {
    const alive = [];
    for (const fx of this.effects) {
      const age = (now - fx.born) / 1000;
      const dur = fx.k === 'boom' || fx.k === 'wave' ? 0.5 : 0.35;
      if (age > dur) continue;
      alive.push(fx);
      const k = age / dur;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      switch (fx.k) {
        case 'hit':
          ctx.fillStyle = fx.c ?? '#fff';
          for (let i = 0; i < 5; i++) {
            const a = i / 5 * 7 + age * 8;
            ctx.fillRect(fx.x + Math.cos(a) * (6 + k * 18), fx.y + Math.sin(a) * (6 + k * 18), 4, 4);
          }
          break;
        case 'boom': case 'wave': {
          ctx.strokeStyle = fx.c ?? '#f97316';
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, (fx.r ?? 60) * k, 0, 7); ctx.stroke();
          ctx.globalAlpha = (1 - k) * 0.4;
          ctx.fillStyle = fx.c ?? '#f97316';
          ctx.beginPath(); ctx.arc(fx.x, fx.y, (fx.r ?? 60) * k * 0.8, 0, 7); ctx.fill();
          break;
        }
        case 'slash':
          ctx.strokeStyle = fx.c ?? '#fff';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(fx.x, fx.y, fx.r * 0.7, fx.a - 0.9, fx.a + 0.9);
          ctx.stroke();
          break;
        case 'shot':
          ctx.fillStyle = fx.c ?? '#fff';
          ctx.beginPath(); ctx.arc(fx.x + Math.cos(fx.a) * 20, fx.y + Math.sin(fx.a) * 20, 5, 0, 7); ctx.fill();
          break;
        case 'death':
          ctx.strokeStyle = '#ff5d5d';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, 10 + k * 36, 0, 7); ctx.stroke();
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * 7;
            ctx.fillStyle = '#ff5d5d';
            ctx.fillRect(fx.x + Math.cos(a) * (10 + k * 40) - 3, fx.y + Math.sin(a) * (10 + k * 40) - 3, 6, 6);
          }
          break;
        case 'respawn':
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, 30 - k * 20, 0, 7); ctx.stroke();
          break;
        case 'reveal':
          ctx.strokeStyle = fx.c ?? '#c084fc';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.arc(fx.x, fx.y, (fx.r ?? 300) * k, 0, 7); ctx.stroke();
          ctx.setLineDash([]);
          break;
        case 'pickup':
          ctx.fillStyle = '#35e0ff';
          ctx.font = '900 14px system-ui';
          ctx.fillText('+1', fx.x - 8, fx.y - k * 24);
          break;
        case 'shield':
          ctx.strokeStyle = '#9be7ff'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(fx.x, fx.y, 30, 0, 7); ctx.stroke();
          break;
        case 'heal':
          ctx.fillStyle = '#4ade80';
          ctx.font = '900 13px system-ui';
          ctx.fillText('+', fx.x, fx.y - k * 20);
          break;
        case 'goal':
          ctx.font = '900 30px system-ui';
          ctx.fillStyle = fx.team === 'A' ? '#3fa9ff' : '#ff4d6d';
          ctx.fillText('BUT !', fx.x - 40, fx.y - k * 40);
          break;
        default: break;
      }
      ctx.restore();
    }
    this.effects = alive;
  }
}

function healthBar(ctx, x, y, w, pct, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 7);
  ctx.fillStyle = pct > 0.5 ? color : pct > 0.25 ? '#fbbf24' : '#ff5d5d';
  ctx.fillRect(x - w / 2, y, w * Math.max(0, pct), 5);
}

// stylized in-game body (smaller than portrait, oriented weapon)
function drawBody(ctx, def, now, e) {
  const c = { body: def.body, accent: def.accent, dark: def.dark };
  const bob = Math.sin(now / 240 + (e.x ?? 0)) * 1.5;
  ctx.save();
  ctx.translate(0, bob);

  // legs
  ctx.fillStyle = c.dark;
  ctx.fillRect(-13, 26, 10, 22);
  ctx.fillRect(3, 26, 10, 22);
  // torso
  ctx.fillStyle = c.body;
  roundRect(ctx, -20, -8, 40, 38, 8);
  // accent chest
  ctx.fillStyle = c.accent;
  roundRect(ctx, -9, 0, 18, 16, 5);
  // head
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.arc(0, -24, 15, 0, 7); ctx.fill();
  ctx.fillStyle = c.accent;
  ctx.fillRect(-14, -30, 28, 6);

  // weapon oriented to aim
  ctx.save();
  ctx.rotate(e.a ?? 0);
  ctx.fillStyle = c.dark;
  ctx.fillRect(14, -4, 24, 8);
  ctx.fillStyle = c.accent;
  ctx.fillRect(34, -3, 6, 6);
  ctx.restore();

  ctx.restore();
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
