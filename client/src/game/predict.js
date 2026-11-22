// RIFT ARENA — client-side movement prediction (mirrors server collision rules)
import { TILE_PROPS } from '/shared/constants.js';

function tileAt(map, tx, ty) {
  if (ty < 0 || ty >= map.height || tx < 0 || tx >= map.width) return 1;
  return map.grid[ty]?.[tx] ?? 1;
}

function circleHitsTiles(map, x, y, r) {
  const minTx = Math.floor((x - r) / 64), maxTx = Math.floor((x + r) / 64);
  const minTy = Math.floor((y - r) / 64), maxTy = Math.floor((y + r) / 64);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const t = tileAt(map, tx, ty);
      if (!TILE_PROPS[t]?.solid) continue;
      const cx = Math.max(tx * 64, Math.min(x, tx * 64 + 64));
      const cy = Math.max(ty * 64, Math.min(y, ty * 64 + 64));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

export function moveCircleClient(map, ent, dx, dy, r) {
  let nx = ent.x + dx;
  if (circleHitsTiles(map, nx, ent.y, r)) nx = ent.x;
  let ny = ent.y + dy;
  if (circleHitsTiles(map, nx, ny, r)) ny = ent.y;
  ent.x = Math.max(r, Math.min(map.width * 64 - r, nx));
  ent.y = Math.max(r, Math.min(map.height * 64 - r, ny));
}
