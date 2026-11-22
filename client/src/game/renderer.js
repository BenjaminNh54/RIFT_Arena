// RIFT ARENA — game renderer: textures façon Brawl Stars (tuiles vivantes, murs 2.5D,
// ombres, dégâts flottants, buissons au-dessus des entités), effets, caméra
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';
import { GAME, TILE } from '/shared/constants.js';

const T = GAME.TILE;

// Palettes vives façon Brawl Stars: sol en deux tons + décor, murs à face claire, contour sombre
const THEME = {
  neon:    { floor: ['#5b5ea6', '#6a6db5'], decor: '#7a7dc9', wall: '#d5486b', wallSide: '#a63352', wallTop: '#e96587', bush: ['#2ea44f', '#43c96b'], water: '#3fa9f5', waterDeep: '#2a7fd4', hazard: ['#ff6a3d', '#c23a1d'], portal: '#a54aff', crate: '#e09a3e', crateDark: '#a86a24', outline: '#2a2438', seed: 'neon' },
  dust:    { floor: ['#c99a5b', '#b98a4b'], decor: '#d8ab6e', wall: '#c25a3a', wallSide: '#963f28', wallTop: '#e07a54', bush: ['#5a9a3a', '#74b551'], water: '#3fa9c9', waterDeep: '#2a7fa0', hazard: ['#ff7a3d', '#c24a1d'], portal: '#a54aff', crate: '#e0a34e', crateDark: '#a87328', outline: '#4a3418', seed: 'dust' },
  moss:    { floor: ['#5aa84e', '#4f9944'], decor: '#74c267', wall: '#8a6a3a', wallSide: '#6a4f2a', wallTop: '#ab8a50', bush: ['#2e8a44', '#43a85c'], water: '#3fb5c9', waterDeep: '#2a8aa0', hazard: ['#ff6a3d', '#c23a1d'], portal: '#a54aff', crate: '#dfa03e', crateDark: '#a76f24', outline: '#22391f', seed: 'moss' },
  core:    { floor: ['#4a5a8a', '#3f4f7d'], decor: '#5f709f', wall: '#4a6ad5', wallSide: '#3550a5', wallTop: '#6a8af0', bush: ['#2e8a5a', '#43a874'], water: '#3f7ff5', waterDeep: '#2a5fd4', hazard: ['#ff5a3d', '#c22a1d'], portal: '#c04aff', crate: '#c9a03e', crateDark: '#987324', outline: '#1c2438', seed: 'core' },
  frost:   { floor: ['#7ab5d9', '#6aa5c9'], decor: '#93cbe8', wall: '#5a7ab5', wallSide: '#425a8a', wallTop: '#7a9ad5', bush: ['#2e8a6a', '#43a884'], water: '#4ac9e8', waterDeep: '#2aa0c4', hazard: ['#ff7a5d', '#c24a3d'], portal: '#a54aff', crate: '#b5c9d9', crateDark: '#7f96a8', outline: '#1c3040', seed: 'frost' },
  ember:   { floor: ['#b5563a', '#a34a30'], decor: '#cc6c4a', wall: '#8a3a2a', wallSide: '#662a1e', wallTop: '#ab5240', bush: ['#8a6a2a', '#a88542'], water: '#ff8a4a', waterDeep: '#d4622a', hazard: ['#ffb03d', '#e06a1d'], portal: '#a54aff', crate: '#e0a34e', crateDark: '#a87328', outline: '#3a1c12', seed: 'ember' },
  sky:     { floor: ['#6a9ad5', '#5a8ac5'], decor: '#82b0e8', wall: '#c9d5e8', wallSide: '#9aa8c0', wallTop: '#e5edf8', bush: ['#3aa85a', '#55c374'], water: '#5ac9f5', waterDeep: '#38a0d4', hazard: ['#ff8a5d', '#c25a3d'], portal: '#a54aff', crate: '#e0b87a', crateDark: '#a88850', outline: '#22344a', seed: 'sky' },
  factory: { floor: ['#8a8a95', '#7d7d88'], decor: '#a0a0ab', wall: '#5a6a75', wallSide: '#42505a', wallTop: '#758896', bush: ['#3a8a4a', '#52a562'], water: '#4a9ab5', waterDeep: '#337590', hazard: ['#ff6a3d', '#c23a1d'], portal: '#a54aff', crate: '#c98a4a', crateDark: '#966030', outline: '#262a30', seed: 'factory' },
};

// hash déterministe par tuile (décor stable entre les frames)
function tileHash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263) ^ 5;
  for (let i = 0; i < seed.length; i++) h = (h ^ seed.charCodeAt(i)) * 16777619;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

function roundRectPath(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.theme = THEME[map.theme] ?? THEME.neon;
    this.quality = opts.quality ?? 'high';
    this.tileCache = null;
    this.effects = []; // effets client {x,y,k,born,color,...}
    this.dmgNumbers = []; // dégâts flottants {x,y,v,born}
    this.buildTileCache();
  }

  // ---------- textures statiques (sol, murs, eau, pièges, portails, spawns) ----------
  buildTileCache() {
    const m = this.map;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round((m.width ?? 0) * T));
    off.height = Math.max(1, Math.round((m.height ?? 0) * T));
    const c = off.getContext('2d');
    const t = this.theme;

    // fond hors-map: nuit + grille de points
    c.fillStyle = '#141226';
    c.fillRect(0, 0, off.width, off.height);

    // --- sol façon Brawl Stars: damier + variations par tuile ---
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const px = x * T, py = y * T;
        const h = tileHash(x, y, t.seed);
        // base en damier
        c.fillStyle = t.floor[(x + y) % 2];
        c.fillRect(px, py, T, T);
        // grande tache de couleur alternée (herbe/terre claire) sur 1 tuile sur 5
        if (h % 5 === 0) {
          c.fillStyle = t.decor;
          c.globalAlpha = 0.35;
          c.beginPath();
          c.ellipse(px + T * 0.5, py + T * 0.5, T * 0.42, T * 0.34, (h % 7) * 0.4, 0, 7);
          c.fill();
          c.globalAlpha = 1;
        }
        // speckles de terre
        if (this.quality !== 'low') {
          c.fillStyle = 'rgba(0,0,0,0.10)';
          for (let i = 0; i < 3; i++) {
            const sx = px + (h * (i + 3) % T), sy = py + (h * (i + 7) % T);
            c.fillRect(sx, sy, 4, 3);
          }
          c.fillStyle = 'rgba(255,255,255,0.13)';
          for (let i = 0; i < 2; i++) {
            const sx = px + (h * (i + 11) % T), sy = py + (h * (i + 5) % T);
            c.fillRect(sx, sy, 3, 2);
          }
        }
        // joints de dalles façon BS (bord intérieur légèrement foncé)
        c.strokeStyle = 'rgba(0,0,0,0.10)';
        c.lineWidth = 1.5;
        c.strokeRect(px + 0.75, py + 0.75, T - 1.5, T - 1.5);
      }
    }

    // --- tuiles spéciales (sous les murs: eau, pièges, portails) ---
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const tile = m.grid[y]?.[x];
        const px = x * T, py = y * T;
        if (tile === TILE.WATER) {
          c.fillStyle = t.waterDeep;
          c.fillRect(px, py, T, T);
          c.fillStyle = t.water;
          c.fillRect(px + 2, py + 2, T - 4, T - 4);
          // vaguelettes claires
          c.fillStyle = 'rgba(255,255,255,0.30)';
          for (let i = 0; i < 2; i++) {
            const wy = py + 14 + ((x * 3 + y * 7 + i) % 3) * 18;
            c.fillRect(px + 8 + ((x + y + i) % 2) * 14, wy, 22, 4);
          }
          c.strokeStyle = 'rgba(0,0,0,0.22)';
          c.lineWidth = 2;
          c.strokeRect(px + 1, py + 1, T - 2, T - 2);
        } else if (tile === TILE.HAZARD) {
          c.fillStyle = t.hazard[1];
          c.fillRect(px, py, T, T);
          const g = c.createRadialGradient(px + T / 2, py + T / 2, 4, px + T / 2, py + T / 2, T * 0.7);
          g.addColorStop(0, t.hazard[0]); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g;
          c.fillRect(px, py, T, T);
          // pointes de lave
          c.fillStyle = t.hazard[0];
          for (let i = 0; i < 3; i++) {
            const bx = px + 10 + i * 18;
            c.beginPath();
            c.moveTo(bx, py + T - 10);
            c.lineTo(bx + 6, py + 16 + (i % 2) * 8);
            c.lineTo(bx + 12, py + T - 10);
            c.closePath(); c.fill();
          }
          c.strokeStyle = 'rgba(0,0,0,0.3)';
          c.lineWidth = 2;
          c.strokeRect(px + 1, py + 1, T - 2, T - 2);
        } else if (tile === TILE.PORTAL) {
          c.fillStyle = t.portal;
          c.globalAlpha = 0.85;
          c.beginPath(); c.ellipse(px + T / 2, py + T / 2, T * 0.36, T * 0.46, 0, 0, 7); c.fill();
          c.globalAlpha = 1;
          const g = c.createRadialGradient(px + T / 2, py + T / 2, 2, px + T / 2, py + T / 2, T * 0.4);
          g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = g;
          c.beginPath(); c.ellipse(px + T / 2, py + T / 2, T * 0.3, T * 0.4, 0, 0, 7); c.fill();
          c.strokeStyle = 'rgba(255,255,255,0.55)';
          c.lineWidth = 2.5;
          c.beginPath(); c.ellipse(px + T / 2, py + T / 2, T * 0.28, T * 0.38, 0.6, 0.5, 4.2); c.stroke();
        }
      }
    }

    // --- zones d'apparition (pad coloré par équipe, façon BS) ---
    const spawnZones = [['A', '#3fa9ff'], ['B', '#ff4d6d'], ['FFA', '#c77dff']];
    for (const [team, col] of spawnZones) {
      for (const [sx, sy] of (m.spawns?.[team] ?? [])) {
        const cx = (sx + 0.5) * T, cy = (sy + 0.5) * T;
        c.fillStyle = col;
        c.globalAlpha = 0.20;
        c.beginPath(); c.arc(cx, cy, T * 0.62, 0, 7); c.fill();
        c.globalAlpha = 0.45;
        c.strokeStyle = col; c.lineWidth = 3;
        c.beginPath(); c.arc(cx, cy, T * 0.62, 0, 7); c.stroke();
        c.globalAlpha = 1;
      }
    }

    // --- murs 2.5D façon BS: face avant sombre + face supérieure claire + contour ---
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (m.grid[y]?.[x] !== TILE.WALL) continue;
        const px = x * T, py = y * T;
        // face avant (ombre du bloc)
        c.fillStyle = t.wallSide;
        c.fillRect(px, py + T * 0.30, T, T * 0.70);
        // face supérieure (bloc en surélévation)
        c.fillStyle = t.wall;
        roundRectPath(c, px + 1, py + 1, T - 2, T * 0.66, 8);
        c.fill();
        c.fillStyle = t.wallTop;
        roundRectPath(c, px + 5, py + 5, T - 10, T * 0.42, 6);
        c.fill();
        // reflet
        c.fillStyle = 'rgba(255,255,255,0.30)';
        c.fillRect(px + 8, py + 9, T - 26, 5);
        // contour sombre
        c.strokeStyle = t.outline;
        c.lineWidth = 2.5;
        roundRectPath(c, px + 1, py + 1, T - 2, T - 2, 8);
        c.stroke();
      }
    }

    this.tileCache = off;
  }

  addEffect(fx) {
    if (this.effects.length > 120) this.effects.shift();
    this.effects.push({ ...fx, born: performance.now() });
    if (fx.k === 'dmg' && Number.isFinite(fx.v)) {
      this.dmgNumbers.push({ x: fx.x, y: fx.y, v: fx.v, born: performance.now() });
      if (this.dmgNumbers.length > 40) this.dmgNumbers.shift();
    }
  }

  draw(camera, state, now, localId) {
    const { ctx } = this;
    const cam = camera;
    ctx.save();
    ctx.fillStyle = '#141226';
    ctx.fillRect(0, 0, cam.w, cam.h);
    ctx.translate(cam.w / 2, cam.h / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    const m = this.map;
    ctx.imageSmoothingEnabled = false;

    // tuiles statiques
    if (this.tileCache && this.tileCache.width > 0 && this.tileCache.height > 0) {
      ctx.drawImage(this.tileCache, 0, 0);
    }

    // caisses dynamiques (détruisibles) — bois façon BS
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (m.grid[y]?.[x] === TILE.CRATE) this.drawCrate(ctx, x, y);
      }
    }

    // zone sûre (last core)
    if (state.safe) {
      ctx.strokeStyle = 'rgba(255,80,80,0.8)';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.arc(state.safe.x, state.safe.y, state.safe.r, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,60,60,0.07)';
      ctx.fillRect(0, 0, m.width * T, m.height * T);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(state.safe.x, state.safe.y, state.safe.r, 0, 7); ctx.fill();
      ctx.restore();
    }

    // zones de domination
    for (const z of state.zones ?? []) {
      const col = z.owner === 'A' ? '#3fa9ff' : z.owner === 'B' ? '#ff4d6d' : '#8fa0c9';
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(z.x, z.y, 115, 0, 7); ctx.stroke();
      ctx.globalAlpha = 0.14; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(z.x, z.y, 115, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = '900 26px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(z.id.toUpperCase(), z.x, z.y - 8);
    }

    // buts (strikeball)
    const goals = m.objectives?.goalA ? [[m.objectives.goalA, 'A'], [m.objectives.goalB, 'B']] : [];
    for (const [[gx, gy], team] of goals) {
      ctx.fillStyle = team === 'A' ? 'rgba(63,169,255,0.3)' : 'rgba(255,77,109,0.3)';
      ctx.fillRect(gx * T, gy * T - 40, T, T + 80);
      ctx.strokeStyle = team === 'A' ? '#3fa9ff' : '#ff4d6d';
      ctx.lineWidth = 3;
      ctx.strokeRect(gx * T, gy * T - 40, T, T + 80);
    }

    // cristaux
    for (const p of state.picks ?? []) {
      const bob = Math.sin(now / 300 + p.id.length) * 4;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 12, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#35e0ff';
      ctx.shadowColor = '#35e0ff'; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 16 + bob);
      ctx.lineTo(p.x + 12, p.y + bob);
      ctx.lineTo(p.x, p.y + 16 + bob);
      ctx.lineTo(p.x - 12, p.y + bob);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 16 + bob); ctx.lineTo(p.x + 12, p.y + bob); ctx.lineTo(p.x, p.y + 16 + bob); ctx.lineTo(p.x - 12, p.y + bob);
      ctx.closePath(); ctx.stroke();
    }

    // entités de zone (champ surge / drone soigneur)
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

    // ballon
    if (state.ball) {
      const b = state.ball;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 12, 13, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#0008'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14, 0, 7); ctx.stroke();
    }

    // tourelles + boss (sous les combattants)
    for (const e of state.ents ?? []) {
      if (e.kind === 'turret') {
        const col = e.team === 'A' ? '#3fa9ff' : e.team === 'B' ? '#ff4d6d' : '#facc15';
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(e.x, e.y + 14, 20, 8, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(e.x - 14, e.y - 10, 28, 24);
        ctx.strokeStyle = '#0009'; ctx.lineWidth = 2;
        ctx.strokeRect(e.x - 14, e.y - 10, 28, 24);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(e.x, e.y - 14, 10, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath(); ctx.arc(e.x - 3, e.y - 17, 4, 0, 7); ctx.fill();
        healthBar(ctx, e.x, e.y - 30, 40, e.hp / e.maxHp, col);
      }
    }
    const boss = (state.ents ?? []).find(e => e.kind === 'boss');
    if (boss) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(boss.x, boss.y + 26, 34, 12, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#1a1f2e';
      ctx.beginPath(); ctx.arc(boss.x, boss.y, 34, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ff5d3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, 34, 0, 7); ctx.stroke();
      ctx.fillStyle = '#ff5d3a';
      ctx.beginPath(); ctx.arc(boss.x - 12, boss.y - 8, 6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(boss.x + 12, boss.y - 8, 6, 0, 7); ctx.fill();
    }

    // combattants (les buissons passent ensuite PAR-DESSUS: on s'y cache comme dans BS)
    for (const e of state.ents ?? []) {
      if (e.kind === 'player' || e.kind === 'bot') this.drawFighter(e, now, localId, ctx);
    }

    // buissons PAR-DESSUS les combattants (feuillage qui cache)
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (m.grid[y]?.[x] === TILE.BUSH) this.drawBush(ctx, x, y, now);
      }
    }

    // effets + dégâts flottants
    this.drawEffects(ctx, now);
    this.drawDmgNumbers(ctx, now);

    ctx.restore();
  }

  drawCrate(ctx, x, y) {
    const t = this.theme;
    const px = x * T, py = y * T;
    const g = 4; // marge
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(px + T / 2, py + T - 6, T * 0.40, 7, 0, 0, 7); ctx.fill();
    // caisse bois
    ctx.fillStyle = t.crate;
    roundRectPath(ctx, px + g, py + g, T - g * 2, T - g * 2 - 4, 6);
    ctx.fill();
    // croisillons
    ctx.strokeStyle = t.crateDark;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px + g + 6, py + g + 6); ctx.lineTo(px + T - g - 6, py + T - g - 10);
    ctx.moveTo(px + T - g - 6, py + g + 6); ctx.lineTo(px + g + 6, py + T - g - 10);
    ctx.stroke();
    // bordure claire haut + contour sombre
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px + g + 3, py + g + 3); ctx.lineTo(px + T - g - 3, py + g + 3); ctx.stroke();
    ctx.strokeStyle = t.outline;
    ctx.lineWidth = 2.5;
    roundRectPath(ctx, px + g, py + g, T - g * 2, T - g * 2 - 4, 6);
    ctx.stroke();
    // clous
    ctx.fillStyle = t.outline;
    for (const [nx, ny] of [[g + 8, g + 8], [T - g - 8, g + 8], [g + 8, T - g - 12], [T - g - 8, T - g - 12]]) {
      ctx.beginPath(); ctx.arc(px + nx, py + ny, 2.5, 0, 7); ctx.fill();
    }
  }

  drawBush(ctx, x, y, now) {
    const [c1, c2] = this.theme.bush;
    const px = x * T, py = y * T;
    const sway = Math.sin(now / 900 + x * 1.7 + y * 2.3) * 2;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.translate(sway, 0);
    // ombre au sol
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(px + T / 2, py + T - 10, T * 0.42, 9, 0, 0, 7); ctx.fill();
    // amas de feuillage (2 tons + reflets)
    ctx.fillStyle = c1;
    for (const [ox, oy, r] of [[20, 30, 17], [42, 26, 15], [32, 46, 16], [48, 44, 13], [14, 46, 12]]) {
      ctx.beginPath(); ctx.arc(px + ox, py + oy, r, 0, 7); ctx.fill();
    }
    ctx.fillStyle = c2;
    for (const [ox, oy, r] of [[26, 24, 12], [44, 34, 11], [24, 40, 10]]) {
      ctx.beginPath(); ctx.arc(px + ox, py + oy, r, 0, 7); ctx.fill();
    }
    // reflets clairs
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const [ox, oy] of [[24, 20], [46, 30]]) {
      ctx.beginPath(); ctx.arc(px + ox, py + oy, 4, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  drawDmgNumbers(ctx, now) {
    const alive = [];
    for (const d of this.dmgNumbers) {
      const age = (now - d.born) / 1000;
      if (age > 0.8) continue;
      alive.push(d);
      const k = age / 0.8;
      const size = 15 - k * 3;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `900 ${size}px system-ui`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.fillStyle = '#ffe14d';
      const y = d.y - k * 34;
      ctx.strokeText(`-${d.v}`, d.x, y);
      ctx.fillText(`-${d.v}`, d.x, y);
      ctx.restore();
    }
    this.dmgNumbers = alive;
  }

  drawFighter(e, now, localId, ctx) {
    const def = FIGHTER_MAP[e.f ?? 'volt'] ?? FIGHTER_MAP.volt;
    const teamCol = e.team === 'A' ? '#3fa9ff' : e.team === 'B' ? '#ff4d6d' : '#c77dff';
    const isLocal = e.id === localId;
    const alpha = e.d ? 0.25 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    // ombre elliptique au sol (façon BS)
    if (!e.d) {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 26, 20, 8, 0, 0, 7);
      ctx.fill();
    }

    // anneau d'équipe sous les pieds
    ctx.strokeStyle = teamCol;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 26, 18, 8, 0, 0, 7);
    ctx.stroke();
    if (isLocal && !e.d) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 26, 22, 10, 0, 0, 7);
      ctx.stroke();
    }

    // corps (portrait simplifié, orienté arme vers la visée)
    ctx.save();
    ctx.translate(e.x, e.y);
    const s = 0.56;
    ctx.scale(s, s);
    drawBody(ctx, def, now, e, isLocal);
    ctx.restore();

    // ligne de visée (local uniquement)
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

    // nom + barre de vie au-dessus
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    const name = `${e.bot ? 'BOT ' : ''}${e.n ?? ''}`;
    const tw = ctx.measureText(name).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); roundRectPath(ctx, e.x - tw / 2, e.y - 62, tw, 14, 4); ctx.fill();
    ctx.fillStyle = e.team === 'A' ? '#9fd4ff' : e.team === 'B' ? '#ffb3c0' : '#d8c2ff';
    ctx.fillText(name, e.x, e.y - 51);
    healthBar(ctx, e.x, e.y - 44, 46, e.hp / e.mhp, e.team === 'A' ? '#3fa9ff' : '#ff4d6d');
    if (e.sh > 0) {
      ctx.fillStyle = '#9be7ff';
      ctx.fillRect(e.x - 23, e.y - 40, 46 * Math.min(1, e.sh / 1200), 3);
    }
    // cristaux portés
    if (e.cr) {
      ctx.fillStyle = '#35e0ff';
      ctx.font = '900 12px system-ui';
      ctx.fillText('◆ ' + e.cr, e.x, e.y + 46);
    }
    // porteur du ballon
    if (e.ball) {
      ctx.fillStyle = '#facc15';
      ctx.beginPath(); ctx.arc(e.x, e.y + 40, 7, 0, 7); ctx.fill();
    }
    ctx.restore();
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
  // capsule façon BS: fond sombre arrondi + remplissage coloré + contour
  const hh = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  roundRectPath(ctx, x - w / 2 - 1.5, y - 1.5, w + 3, hh + 3, 5);
  ctx.fill();
  ctx.fillStyle = pct > 0.5 ? color : pct > 0.25 ? '#fbbf24' : '#ff5d5d';
  if (pct > 0) {
    roundRectPath(ctx, x - w / 2, y, w * Math.max(0, Math.min(1, pct)), hh, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRectPath(ctx, x - w / 2 + 2, y + 1.5, Math.max(0, w * Math.max(0, Math.min(1, pct)) - 4), 2.5, 2);
    ctx.fill();
  }
}

// corps stylisé avec contours sombres façon Brawl Stars
function drawBody(ctx, def, now, e, isLocal = false) {
  const c = { body: def.body, accent: def.accent, dark: def.dark };
  const bob = Math.sin(now / 240 + (e.x ?? 0)) * 1.5;
  ctx.save();
  ctx.translate(0, bob);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20,18,38,0.9)';
  ctx.lineJoin = 'round';

  // jambes
  ctx.fillStyle = c.dark;
  roundRectPath(ctx, -13, 26, 10, 22, 4); ctx.fill(); ctx.stroke();
  roundRectPath(ctx, 3, 26, 10, 22, 4); ctx.fill(); ctx.stroke();
  // torse
  ctx.fillStyle = c.body;
  roundRectPath(ctx, -20, -8, 40, 38, 9); ctx.fill(); ctx.stroke();
  // plastron
  ctx.fillStyle = c.accent;
  roundRectPath(ctx, -9, 0, 18, 16, 5); ctx.fill();
  // tête
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.arc(0, -24, 15, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.accent;
  roundRectPath(ctx, -14, -32, 28, 7, 3); ctx.fill();
  // yeux (lisibles, façon BS)
  if (!isLocal) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-5, -22, 3.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -22, 3.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath(); ctx.arc(-4, -22, 1.6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(6, -22, 1.6, 0, 7); ctx.fill();
  }

  // arme orientée vers la visée
  ctx.save();
  ctx.rotate(e.a ?? 0);
  ctx.fillStyle = c.dark;
  roundRectPath(ctx, 14, -4, 24, 8, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.accent;
  roundRectPath(ctx, 34, -3, 7, 6, 2); ctx.fill(); ctx.stroke();
  ctx.restore();

  ctx.restore();
}
