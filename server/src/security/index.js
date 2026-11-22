// RIFT ARENA — security primitives: password hashing (scrypt), session tokens, rate limits
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch { return false; }
}

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// --- Rate limiting (per key, sliding window) ---
const buckets = new Map();

export function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { hits: [], last: t }; buckets.set(key, b); }
  b.hits = b.hits.filter(h => t - h < windowMs);
  if (b.hits.length >= limit) return false;
  b.hits.push(t);
  return true;
}

// Periodic cleanup so the map never grows unbounded
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) {
    b.hits = b.hits.filter(h => t - h < 60000);
    if (b.hits.length === 0 && t - b.last > 120000) buckets.delete(k);
  }
}, 60000).unref();

// --- Simple HTML escape (chat is rendered as textContent client-side, this is defense in depth) ---
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- WebSocket message validation ---
export function checkWsMessage(msg, { maxTextLen = 240 } = {}) {
  if (!msg || typeof msg !== 'object') return null;
  const t = msg.t;
  if (typeof t !== 'string' || t.length > 24) return null;
  return { t, ...msg };
}
