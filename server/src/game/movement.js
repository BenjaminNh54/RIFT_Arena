// RIFT ARENA — server movement: tile collision (circle vs solid tiles), portals, hazards
import { TILE_PROPS } from '../../../shared/constants.js';

export function tileAt(map, tx, ty) {
  if (ty < 0 || ty >= map.height || tx < 0 || tx >= map.width) return 1; // out of bounds = wall
  return map.grid[ty][tx];
}

export function isSolidTile(map, tx, ty, forProjectile = false) {
  const t = tileAt(map, tx, ty);
  const p = TILE_PROPS[t];
  if (!p) return true;
  if (forProjectile) return p.blocksShot;
  return p.solid;
}

// Move a circle entity by (dx, dy) with axis-separated collision resolution.
// Returns actual applied movement and portal event.
export function moveCircle(map, ent, dx, dy, r = null) {
  const radius = r ?? ent.radius;
  let nx = ent.x + dx;
  let ny = ent.y;
  const portalPairs = map.portalPairs ?? [];
  let portal = null;

  // X axis
  if (circleHitsTiles(map, nx, ent.y, radius)) {
    nx = ent.x;
  }
  // Y axis
  let ty2 = ent.y + dy;
  if (circleHitsTiles(map, nx, ty2, radius)) {
    ty2 = ent.y;
  }
  ent.x = nx; ent.y = ty2;

  // Portal check (center tile)
  const tx = Math.floor(ent.x / 64), tyy = Math.floor(ent.y / 64);
  if (tileAt(map, tx, tyy) === 6) {
    for (const [a, b] of portalPairs) {
      if (a[0] === tx && a[1] === tyy && (!ent.portalCd || Date.now() > ent.portalCd)) {
        ent.x = (b[0] + 0.5) * 64; ent.y = (b[1] + 0.5) * 64;
        ent.portalCd = Date.now() + 1200;
        portal = b;
        break;
      }
      if (b[0] === tx && b[1] === tyy && (!ent.portalCd || Date.now() > ent.portalCd)) {
        ent.x = (a[0] + 0.5) * 64; ent.y = (a[1] + 0.5) * 64;
        ent.portalCd = Date.now() + 1200;
        portal = a;
        break;
      }
    }
  }
  return portal;
}

function circleHitsTiles(map, x, y, r) {
  const minTx = Math.floor((x - r) / 64), maxTx = Math.floor((x + r) / 64);
  const minTy = Math.floor((y - r) / 64), maxTy = Math.floor((y + r) / 64);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isSolidTile(map, tx, ty)) continue;
      // circle vs AABB
      const cx = Math.max(tx * 64, Math.min(x, tx * 64 + 64));
      const cy = Math.max(ty * 64, Math.min(y, ty * 64 + 64));
      const ddx = x - cx, ddy = y - cy;
      if (ddx * ddx + ddy * ddy < r * r) return true;
    }
  }
  return false;
}

// Straight-line raycast for projectiles/line of sight: blocked by walls & crates
export function lineBlocked(map, x0, y0, x1, y1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 16);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    if (isSolidTile(map, Math.floor(x / 64), Math.floor(y / 64), true)) return true;
  }
  return false;
}

// Find a random free tile point near [x,y] (used for spawns, crystal drops)
export function freePointNear(map, tx, ty, r = 24) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = (tx + Math.random() * 1.2 - 0.6) * 64;
    const y = (ty + Math.random() * 1.2 - 0.6) * 64;
    if (!circleHitsTiles(map, clampToMap(map, x), clampToMap(map, y), r)) {
      return { x: clampToMap(map, x), y: clampToMap(map, y) };
    }
  }
  return { x: (tx + 0.5) * 64, y: (ty + 0.5) * 64 };
}

function clampToMap(map, v, pad = 32) {
  return Math.max(pad, Math.min(map.width * 64 - pad, v));
}
