// RIFT ARENA — generate PWA icons (PNG 192/512) from the SVG logo
// Zero-dependency: renders the SVG using a tiny built-in rasterizer? No — uses canvas via node-canvas
// when available. Fallback: writes a placeholder PNG drawn with zlib (pure Node PNG encoder).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../client/assets/icons');
mkdirSync(OUT, { recursive: true });

// ---- pure-Node PNG encoder (RGBA, no deps) ----
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    rgba.copy(row, 1, y * width * 4, (y + 1) * width * 4);
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Draw the rift-triangle + bolt logo directly into a pixel buffer (anti-aliased-ish)
function drawLogo(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a + rgba[i + 3] / 255 * (1 - a);
    rgba[i] = Math.round(r * a + rgba[i] * (rgba[i + 3] / 255) * (1 - a) / Math.max(na, 0.0001) || r * a);
    rgba[i] = Math.round(r * (a / Math.max(na, 0.0001)));
    rgba[i + 1] = Math.round(g * (a / Math.max(na, 0.0001)));
    rgba[i + 2] = Math.round(b * (a / Math.max(na, 0.0001)));
    rgba[i + 3] = Math.round(na * 255);
  };
  const bg = (x, y) => {
    const t = (x + y) / (2 * size);
    return [
      Math.round(16 + 10 * (1 - t)),
      Math.round(23 + 8 * (1 - t)),
      Math.round(49 + 17 * (1 - t)),
    ];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = bg(x, y);
      put(x, y, r, g, b, 1);
    }
  }
  // helpers
  const s = size / 512;
  function strokeLine(x0, y0, x1, y1, w, color) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * s * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = (x0 + (x1 - x0) * t) * s, cy = (y0 + (y1 - y0) * t) * s;
      const rr = w * s / 2;
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= rr) put(cx + dx, cy + dy, color[0], color[1], color[2], Math.min(1, (rr - d) + 0.5));
      }
    }
  }
  function fillTri(p0, p1, p2, color) {
    // barycentric raster
    const minX = Math.min(p0[0], p1[0], p2[0]), maxX = Math.max(p0[0], p1[0], p2[0]);
    const minY = Math.min(p0[1], p1[1], p2[1]), maxY = Math.max(p0[1], p1[1], p2[1]);
    const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
    for (let y = minY * s; y <= maxY * s; y++) {
      for (let x = minX * s; x <= maxX * s; x++) {
        const P = [x / s, y / s];
        const d1 = sign(P, p0, p1), d2 = sign(P, p1, p2), d3 = sign(P, p2, p0);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) put(x, y, color[0], color[1], color[2], 0.35);
      }
    }
  }
  const cyan = [53, 224, 255], violet = [168, 107, 255];
  // outline triangle
  strokeLine(256, 88, 400, 372, 26, cyan);
  strokeLine(400, 372, 112, 372, 26, violet);
  strokeLine(112, 372, 256, 88, 26, cyan);
  fillTri([256, 176], [336, 332], [176, 332], [53, 224, 255]);
  // bolt
  const bolt = [[276, 208], [232, 292], [266, 292], [244, 360], [306, 264], [268, 264], [296, 208]];
  for (let i = 0; i < bolt.length; i++) {
    const a = bolt[i], b = bolt[(i + 1) % bolt.length];
    strokeLine(a[0], a[1], b[0], b[1], 20, cyan);
  }
  // thick bolt fill (scanline-ish): fill inner polygon rows
  for (let y = 208; y <= 360; y += 1) {
    for (let x = 220; x <= 310; x += 1) {
      // crude inside test: bolt is narrow — approximate with per-row spans
      const t = (y - 208) / 152;
      const cx = 268 - t * 24;
      const half = 22 - t * 8;
      if (Math.abs(x - cx) < half) put(x * s, y * s, 53, 224, 255, 0.9);
    }
  }
  return rgba;
}

for (const size of [192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, encodePNG(size, size, drawLogo(size)));
  console.log('wrote', file);
}
console.log('icons generated');
