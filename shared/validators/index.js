// RIFT ARENA — shared validators (server-enforced; editor uses them client-side too)

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,16}$/;
const CLAN_TAG_RE = /^[a-zA-Z0-9]{2,5}$/;
const CLAN_NAME_RE = /^[a-zA-Z0-9 _-]{3,20}$/;

export function validateUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u.trim());
}

export function validatePassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 72;
}

export function validateClanTag(t) {
  return typeof t === 'string' && CLAN_TAG_RE.test(t.trim());
}
export function validateClanName(n) {
  return typeof n === 'string' && CLAN_NAME_RE.test(n.trim());
}

// Deep-validate a community map before save/publish (no code execution — pure data)
export function validateMapData(map, maxW = 64, maxH = 48) {
  const errors = [];
  if (!map || typeof map !== 'object') return ['map must be an object'];
  if (typeof map.name !== 'string' || map.name.trim().length < 3 || map.name.length > 32) errors.push('name: 3-32 chars');
  if (!Array.isArray(map.grid) || map.grid.length < 8 || map.grid.length > maxH) errors.push(`grid height must be 8-${maxH}`);
  if (errors.length) return errors;
  const w = map.grid[0].length;
  if (w < 8 || w > maxW) errors.push(`grid width must be 8-${maxW}`);
  let spawns = 0;
  const portals = [];
  for (let y = 0; y < map.grid.length; y++) {
    const row = map.grid[y];
    if (!Array.isArray(row) || row.length !== w) { errors.push(`row ${y} width mismatch`); break; }
    for (let x = 0; x < w; x++) {
      const t = row[x] | 0;
      if (t < 0 || t > 6) { errors.push(`tile ${x},${y} out of range`); }
      if (t === 6) portals.push([x, y]);
    }
  }
  const spawnsArr = Array.isArray(map.spawns) ? map.spawns : [];
  for (const s of spawnsArr) {
    if (!Array.isArray(s) || s.length !== 2) { errors.push('spawn point must be [x,y]'); break; }
    const [x, y] = s;
    if (x < 0 || y < 0 || x >= w || y >= map.grid.length) { errors.push('spawn out of bounds'); break; }
    if ((map.grid[y][x] | 0) === 1) { errors.push('spawn inside a wall'); break; }
    spawns++;
  }
  if (spawns < 2) errors.push('at least 2 spawn points required');
  if (portals.length % 2 !== 0) errors.push('portals must come in pairs');
  return errors;
}

// Compress/expand map grid to a compact string for DB storage (RLE-ish per row)
export function encodeGrid(grid) {
  return grid.map(row => {
    let out = '', run = 1;
    for (let i = 0; i < row.length; i++) {
      if (i + 1 < row.length && row[i + 1] === row[i]) run++;
      else { out += row[i].toString(36) + (run > 1 ? run.toString(36) : '') + ','; run = 1; }
    }
    return out.replace(/,$/, '');
  }).join('|');
}
export function decodeGrid(str, width) {
  if (typeof str !== 'string') return null;
  const rows = str.split('|');
  return rows.map(r => {
    const out = [];
    for (const seg of r.split(',')) {
      if (!seg) continue;
      const t = parseInt(seg[0], 36);
      const run = seg.length > 1 ? parseInt(seg.slice(1), 36) : 1;
      if (Number.isNaN(t) || Number.isNaN(run) || run < 1 || run > 999) return null;
      for (let i = 0; i < run; i++) out.push(t);
    }
    return out;
  });
}

// Event config validation (admin Event Builder) — whitelist only
export function validateEventConfig(ev) {
  const errors = [];
  if (!ev) return ['event required'];
  if (typeof ev.name !== 'string' || ev.name.trim().length < 3 || ev.name.length > 40) errors.push('name: 3-40 chars');
  if (ev.desc !== undefined && (typeof ev.desc !== 'string' || ev.desc.length > 400)) errors.push('desc: max 400 chars');
  const mods = ev.modifiers ?? {};
  if (typeof mods !== 'object' || Array.isArray(mods)) errors.push('modifiers must be an object');
  else {
    for (const [k, v] of Object.entries(mods)) {
      if (!['speed_mult', 'damage_mult', 'cooldown_mult', 'energy_mult'].includes(k)) {
        if (['no_bushes', 'same_fighter', 'mini_fighters', 'no_obstacles', 'double_ammo', 'regen'].includes(k)) {
          if (typeof v !== 'boolean') errors.push(`modifier ${k} must be boolean`);
        } else errors.push(`unknown modifier ${k}`);
      } else {
        if (typeof v !== 'number' || v < 0.25 || v > 3) errors.push(`modifier ${k} must be 0.25-3`);
      }
    }
  }
  if (ev.startAt && !(ev.startAt instanceof Date) && Number.isNaN(Date.parse(ev.startAt))) errors.push('startAt invalid date');
  if (ev.endAt && !(ev.endAt instanceof Date) && Number.isNaN(Date.parse(ev.endAt))) errors.push('endAt invalid date');
  if (ev.startAt && ev.endAt && Date.parse(ev.endAt) <= Date.parse(ev.startAt)) errors.push('endAt must be after startAt');
  return errors;
}

export function sanitizeText(s, maxLen = 300) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen);
}

// Community-map objectives: strict whitelisted shape, ints in bounds, no extra keys.
// Returns a cleaned objectives object, {} for empty, or null when malformed.
export function validateObjectives(obj, w, h) {
  if (obj === undefined || obj === null) return {};
  if (typeof obj !== 'object' || Array.isArray(obj)) return null;
  const pt = (v) => Array.isArray(v) && v.length === 2
    && Number.isInteger(v[0]) && Number.isInteger(v[1])
    && v[0] >= 0 && v[1] >= 0 && v[0] < w && v[1] < h ? [v[0], v[1]] : null;
  const out = {};
  if (obj.crystals !== undefined) {
    if (!Array.isArray(obj.crystals) || obj.crystals.length > 12) return null;
    const arr = obj.crystals.map(pt);
    if (arr.some(p => p === null)) return null;
    out.crystals = arr;
  }
  if (obj.ball !== undefined) { const p = pt(obj.ball); if (!p) return null; out.ball = p; }
  if (obj.goalA !== undefined) { const p = pt(obj.goalA); if (!p) return null; out.goalA = p; }
  if (obj.goalB !== undefined) { const p = pt(obj.goalB); if (!p) return null; out.goalB = p; }
  if (obj.zones !== undefined) {
    if (typeof obj.zones !== 'object' || Array.isArray(obj.zones)) return null;
    out.zones = {};
    for (const k of ['A', 'B', 'C']) {
      if (obj.zones[k] !== undefined) { const p = pt(obj.zones[k]); if (!p) return null; out.zones[k] = p; }
    }
  }
  const allowed = new Set(['crystals', 'ball', 'goalA', 'goalB', 'zones']);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) return null; // unknown keys rejected
  return out;
}
