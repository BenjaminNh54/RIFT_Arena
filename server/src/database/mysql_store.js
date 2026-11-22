// RIFT ARENA — MySQL store (Alwaysdata / Render). Same DAO contract as JsonStore.
// Strong relational tables for auth/social/match data; JSON columns for document-like config.
import mysql from 'mysql2/promise';

// MySQL DATETIME column format, UTC-based (ISO-8601 'Z' strings are rejected by strict mode)
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Any ISO-8601 string parameter (with Z/offset) → 'YYYY-MM-DD HH:MM:SS' in UTC.
// Applied to every pool parameter so callers may keep passing Date.toISOString().
function sqlParam(v) {
  if (v === undefined) return null; // strict MySQL refuses undefined bind params
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v); // JSON columns
  return v;
}
const mapParams = (params) => Array.isArray(params) ? params.map(sqlParam) : params;
// mysql2 auto-parses JSON columns into JS objects — accept objects AND strings.
function jparse(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}


export class MysqlStore {
  constructor(pool) {
    this.pool = pool;
    this.kind = 'mysql';
  }

  async ping() { await this.pool.query('SELECT 1'); }

  static async connect(cfg) {
    const pool = mysql.createPool({
      host: cfg.MYSQL_HOST,
      port: cfg.MYSQL_PORT,
      user: cfg.MYSQL_USER,
      password: cfg.MYSQL_PASSWORD,
      database: cfg.MYSQL_DATABASE,
      charset: 'utf8mb4_unicode_ci', // same collation as the schema tables (FK consistency)
      timezone: 'Z',                 // read/write Date objects in UTC
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      namedPlaceholders: false,
    });
    // mysql2 has no `sessionVariables` option (that is mysqljs) — set the session
    // timezone on each new pooled connection instead, so NOW() comparisons in SQL
    // stay consistent with the UTC datetimes we store.
    if (pool.pool && typeof pool.pool.on === 'function') {
      pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
    }
    await pool.query('SELECT 1'); // fail fast if unreachable
    return new MysqlStore(pool);
  }

  id() { return crypto.randomUUID(); }

  // ALL statements go through these: datetime strings normalized to MySQL DATETIME
  // (UTC) and JS objects/arrays serialized for JSON columns — strict MySQL refuses
  // "[object Object]"-style params that the JSON store silently accepted.
  _execute(sql, params) {
    return this.pool.execute(sql, params !== undefined ? mapParams(params) : params);
  }
  _query(sql, params) {
    return this.pool.query(sql, params !== undefined ? mapParams(params) : params);
  }

  // ---------- users ----------
  async createUser(u) {
    const id = u.id ?? this.id();
    await this._execute(
      `INSERT INTO users (id, username, username_lower, pass_hash, role, avatar, banner, title, credits, rift_tokens, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, u.username, u.username.toLowerCase(), u.passHash, u.role ?? 'player',
        u.avatar ?? 'avatar_ion', u.banner ?? 'banner_ion', '', u.credits ?? 0, u.rift_tokens ?? 0, now()]);
    return this.getUserById(id);
  }
  async getUserByUsername(username) {
    const [rows] = await this._execute('SELECT * FROM users WHERE username_lower = ? LIMIT 1', [String(username).toLowerCase()]);
    return rows[0] ?? null;
  }
  async getUserById(id) {
    const [rows] = await this._execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }
  async updateUser(id, patch) {
    const allowed = ['username', 'role', 'trophies', 'xp', 'level', 'avatar', 'banner', 'title', 'credits',
      'rift_tokens', 'pass_xp', 'matches', 'wins', 'losses', 'kills', 'playtime_s', 'banned_until',
      'ban_reason', 'muted_until', 'privacy', 'favorite_fighter', 'last_seen'];
    const sets = [], vals = [];
    for (const k of allowed) if (k in patch) { sets.push(`${k} = ?`); vals.push(patch[k]); }
    if (!sets.length) return this.getUserById(id);
    if ('username' in patch) { sets.push('username_lower = ?'); vals.push(String(patch.username).toLowerCase()); }
    vals.push(id);
    await this._execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
    return this.getUserById(id);
  }
  async incrementUser(id, fields) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      sets.push(`${k} = GREATEST(0, ${k} + ?)`);
      vals.push(Math.round(v));
    }
    if (!sets.length) return this.getUserById(id);
    vals.push(id);
    await this._execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, vals);
    return this.getUserById(id);
  }
  async listUsers({ q = '', limit = 50, offset = 0 } = {}) {
    if (q) {
      const [rows] = await this._execute(
        'SELECT * FROM users WHERE username_lower LIKE ? ORDER BY trophies DESC LIMIT ? OFFSET ?',
        [`%${q.toLowerCase()}%`, String(limit), String(offset)]);
      return rows;
    }
    const [rows] = await this._execute('SELECT * FROM users ORDER BY trophies DESC LIMIT ? OFFSET ?', [String(limit), String(offset)]);
    return rows;
  }
  async countUsers() {
    const [rows] = await this._query('SELECT COUNT(*) AS n FROM users');
    return rows[0].n;
  }
  async addTrophyLog(userId, amount, reason) {
    await this._execute('INSERT INTO trophies_log (user_id, amount, reason, created_at) VALUES (?,?,?,?)',
      [userId, Math.round(amount), reason, now()]);
  }
  async getTrophyLog(userId, limit = 20) {
    const [rows] = await this._execute(
      'SELECT amount, reason, created_at AS at FROM trophies_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, String(limit)]);
    return rows;
  }

  // ---------- sessions ----------
  async saveSession({ tokenHash, userId, expiresAt }) {
    await this._execute('REPLACE INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)',
      [tokenHash, userId, expiresAt]);
  }
  async getSession(tokenHash) {
    const [rows] = await this._execute('SELECT user_id, expires_at FROM sessions WHERE token_hash = ? LIMIT 1', [tokenHash]);
    const s = rows[0];
    if (!s) return null;
    if (new Date(s.expires_at).getTime() < Date.now()) { await this.deleteSession(tokenHash); return null; }
    return { userId: s.user_id, expiresAt: s.expires_at };
  }
  async deleteSession(tokenHash) {
    await this._execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
  }

  // ---------- fighters ----------
  async getFighters(userId) {
    const [rows] = await this._execute('SELECT fighter_id, unlocked, trophies, xp, level FROM user_brawlers WHERE user_id = ?', [userId]);
    return Object.fromEntries(rows.map(r => [r.fighter_id, { unlocked: !!r.unlocked, trophies: r.trophies, xp: r.xp, level: r.level }]));
  }
  async setFighter(userId, fid, patch) {
    const cur = (await this.getFighters(userId))[fid] ?? { unlocked: false, trophies: 0, xp: 0, level: 1 };
    const next = { ...cur, ...patch };
    await this._execute(
      `INSERT INTO user_brawlers (user_id, fighter_id, unlocked, trophies, xp, level) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE unlocked = VALUES(unlocked), trophies = VALUES(trophies), xp = VALUES(xp), level = VALUES(level)`,
      [userId, fid, next.unlocked ? 1 : 0, next.trophies, next.xp, next.level]);
    return next;
  }
  async unlockFighter(userId, fid) { return this.setFighter(userId, fid, { unlocked: true }); }

  // ---------- inventory ----------
  async getInventory(userId, kind = null) {
    const sql = kind
      ? 'SELECT kind, ref_id, qty, acquired_at AS acquiredAt FROM user_inventory WHERE user_id = ? AND kind = ?'
      : 'SELECT kind, ref_id, qty, acquired_at AS acquiredAt FROM user_inventory WHERE user_id = ?';
    const [rows] = await this._execute(sql, kind ? [userId, kind] : [userId]);
    return rows;
  }
  async addItem(userId, kind, refId, qty = 1) {
    await this._execute(
      `INSERT INTO user_inventory (user_id, kind, ref_id, qty, acquired_at) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [userId, kind, refId, qty, now()]);
  }
  async hasItem(userId, kind, refId) {
    const [rows] = await this._execute('SELECT qty FROM user_inventory WHERE user_id = ? AND kind = ? AND ref_id = ? LIMIT 1', [userId, kind, refId]);
    return rows.length > 0 && rows[0].qty > 0;
  }
  async removeItem(userId, kind, refId, qty = 1) {
    await this._execute(
      'UPDATE user_inventory SET qty = qty - ? WHERE user_id = ? AND kind = ? AND ref_id = ? AND qty >= ?',
      [qty, userId, kind, refId, qty]);
    await this._execute('DELETE FROM user_inventory WHERE user_id = ? AND kind = ? AND ref_id = ? AND qty <= 0', [userId, kind, refId]);
  }

  // ---------- missions ----------
  async getMissions(userId, periodKey) {
    const [rows] = await this._execute(
      'SELECT tpl_id, progress, claimed FROM user_missions WHERE user_id = ? AND period_key = ?', [userId, periodKey]);
    return Object.fromEntries(rows.map(r => [r.tpl_id, { progress: r.progress, claimed: !!r.claimed }]));
  }
  async upsertMission(userId, periodKey, tplId, patch) {
    const cur = (await this.getMissions(userId, periodKey))[tplId] ?? { progress: 0, claimed: false };
    const next = { ...cur, ...patch };
    await this._execute(
      `INSERT INTO user_missions (user_id, period_key, tpl_id, progress, claimed, created_at) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE progress = VALUES(progress), claimed = VALUES(claimed)`,
      [userId, periodKey, tplId, next.progress, next.claimed ? 1 : 0, now()]);
    return next;
  }

  // ---------- friends ----------
  async getFriendRow(a, b) {
    const [x, y] = a < b ? [a, b] : [b, a];
    const [rows] = await this._execute('SELECT * FROM friends WHERE user_a = ? AND user_b = ? LIMIT 1', [x, y]);
    return rows[0] ? { friendId: null, blockedBy: rows[0].blocked_by, since: rows[0].since, raw: rows[0] } : null;
  }
  async addFriend(a, b) {
    const [x, y] = a < b ? [a, b] : [b, a];
    await this._execute('REPLACE INTO friends (user_a, user_b, since) VALUES (?,?,?)', [x, y, now()]);
  }
  async removeFriend(a, b) {
    const [x, y] = a < b ? [a, b] : [b, a];
    await this._execute('DELETE FROM friends WHERE user_a = ? AND user_b = ?', [x, y]);
  }
  async setFriendBlock(a, b, blockedBy) {
    const [x, y] = a < b ? [a, b] : [b, a];
    await this._execute('UPDATE friends SET blocked_by = ? WHERE user_a = ? AND user_b = ?', [blockedBy, x, y]);
  }
  async getFriends(userId) {
    const [rows] = await this._execute(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS friendId, blocked_by, since
       FROM friends WHERE user_a = ? OR user_b = ?`, [userId, userId, userId]);
    return rows.map(r => ({ friendId: r.friendId, blockedBy: r.blocked_by, since: r.since }));
  }
  async addFriendRequest(from, to) {
    await this._execute('INSERT IGNORE INTO friend_requests (from_user, to_user, at) VALUES (?,?,?)', [from, to, now()]);
  }
  async listFriendRequests(userId) {
    const [rows] = await this._execute('SELECT from_user AS `from`, to_user AS `to`, at FROM friend_requests WHERE to_user = ?', [userId]);
    return rows;
  }
  async listSentFriendRequests(userId) {
    const [rows] = await this._execute('SELECT from_user AS `from`, to_user AS `to`, at FROM friend_requests WHERE from_user = ?', [userId]);
    return rows;
  }
  async deleteFriendRequest(from, to) {
    await this._execute('DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?', [from, to]);
  }

  // ---------- clans ----------
  async createClan(c) {
    const id = c.id ?? this.id();
    await this._execute(
      `INSERT INTO clans (id, name, tag, descr, logo, banner, level, xp, trophies, open, leader_id, created_at)
       VALUES (?,?,?,?,?,?,1,0,?,?,?,?)`,
      [id, c.name, c.tag.toUpperCase(), c.desc ?? '', c.logo ?? 'rift', c.banner ?? 'banner_rift',
        c.trophies ?? 0, c.open ? 1 : 0, c.leaderId, now()]);
    return this.getClan(id);
  }
  async getClan(id) {
    const [rows] = await this._execute('SELECT * FROM clans WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? this._clanOut(rows[0]) : null;
  }
  async getClanByTag(tag) {
    const [rows] = await this._execute('SELECT * FROM clans WHERE tag = ? LIMIT 1', [String(tag).toUpperCase()]);
    return rows[0] ? this._clanOut(rows[0]) : null;
  }
  _clanOut(r) {
    return { id: r.id, name: r.name, tag: r.tag, desc: r.descr, logo: r.logo, banner: r.banner,
      level: r.level, xp: r.xp, trophies: r.trophies, open: !!r.open, leaderId: r.leader_id, createdAt: r.created_at };
  }
  async updateClan(id, patch) {
    const map = { desc: 'descr', leaderId: 'leader_id' };
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = map[k] ?? k;
      if (!['name', 'tag', 'descr', 'logo', 'banner', 'level', 'xp', 'trophies', 'open', 'leader_id'].includes(col)) continue;
      sets.push(`${col} = ?`); vals.push(v);
    }
    if (!sets.length) return this.getClan(id);
    vals.push(id);
    await this._execute(`UPDATE clans SET ${sets.join(', ')} WHERE id = ?`, vals);
    return this.getClan(id);
  }
  async listClans() {
    const [rows] = await this._query('SELECT * FROM clans ORDER BY trophies DESC LIMIT 100');
    return rows.map(r => this._clanOut(r));
  }
  async addClanMember({ clanId, userId, role }) {
    await this._execute('REPLACE INTO clan_members (user_id, clan_id, role, joined_at) VALUES (?,?,?,?)', [userId, clanId, role, now()]);
  }
  async getClanMembership(userId) {
    const [rows] = await this._execute('SELECT clan_id, role, joined_at FROM clan_members WHERE user_id = ? LIMIT 1', [userId]);
    return rows[0] ? { clanId: rows[0].clan_id, role: rows[0].role, joinedAt: rows[0].joined_at } : null;
  }
  async getClanMember(clanId, userId) {
    const [rows] = await this._execute('SELECT role, joined_at FROM clan_members WHERE clan_id = ? AND user_id = ? LIMIT 1', [clanId, userId]);
    return rows[0] ? { clanId, userId, role: rows[0].role, joinedAt: rows[0].joined_at } : null;
  }
  async listClanMembers(clanId) {
    const [rows] = await this._execute('SELECT user_id, role, joined_at FROM clan_members WHERE clan_id = ?', [clanId]);
    return rows.map(r => ({ clanId, userId: r.user_id, role: r.role, joinedAt: r.joined_at }));
  }
  async updateClanMemberRole(clanId, userId, role) {
    await this._execute('UPDATE clan_members SET role = ? WHERE clan_id = ? AND user_id = ?', [role, clanId, userId]);
  }
  async removeClanMember(clanId, userId) {
    const [res] = await this._execute('DELETE FROM clan_members WHERE clan_id = ? AND user_id = ?', [clanId, userId]);
    return res.affectedRows > 0;
  }
  async addJoinRequest(clanId, userId) {
    await this._execute('INSERT IGNORE INTO clan_requests (clan_id, user_id, at) VALUES (?,?,?)', [clanId, userId, now()]);
  }
  async listJoinRequests(clanId) {
    const [rows] = await this._execute('SELECT user_id, at FROM clan_requests WHERE clan_id = ?', [clanId]);
    return rows.map(r => ({ clanId, userId: r.user_id, at: r.at }));
  }
  async deleteJoinRequest(clanId, userId) {
    await this._execute('DELETE FROM clan_requests WHERE clan_id = ? AND user_id = ?', [clanId, userId]);
  }

  // ---------- clan wars ----------
  async addWarMatch(weekKey, clanId, win) {
    await this._execute(
      `INSERT INTO clan_wars (week, clan_id, matches, wins, points) VALUES (?,?,1,?,?)
       ON DUPLICATE KEY UPDATE matches = matches + 1, wins = wins + VALUES(wins), points = points + VALUES(points)`,
      [weekKey, clanId, win ? 1 : 0, win ? 3 : 1]);
  }
  async getWarState(weekKey) {
    const [rows] = await this._execute('SELECT clan_id, matches, wins, points FROM clan_wars WHERE week = ?', [weekKey]);
    const clans = {};
    for (const r of rows) clans[r.clan_id] = { matches: r.matches, wins: r.wins, points: r.points };
    return { week: weekKey, clans };
  }

  // ---------- messages ----------
  async saveMessage(m) {
    await this._execute(
      'INSERT INTO messages (channel, channel_id, user_id, username, text, created_at) VALUES (?,?,?,?,?,?)',
      [m.channel, m.channelId ?? '', m.userId, m.username, m.text, m.createdAt ?? now()]);
  }
  async getMessages(channel, channelId, limit = 40) {
    const [rows] = await this._execute(
      `SELECT id, channel, channel_id, user_id, username, text, created_at AS createdAt FROM messages
       WHERE channel = ? AND channel_id = ? ORDER BY created_at DESC LIMIT ?`,
      [channel, channelId ?? '', String(limit)]);
    return rows.reverse();
  }

  // ---------- matches ----------
  async recordMatch(m) {
    await this._execute(
      'INSERT INTO game_matches (id, mode, map, ranked, winner_team, duration_ms, created_at) VALUES (?,?,?,?,?,?,?)',
      [m.id, m.mode, m.map, m.ranked ? 1 : 0, m.winnerTeam, m.durationMs, m.createdAt ?? now()]);
  }
  async recordMatchPlayers(rows) {
    if (!rows.length) return;
    const vals = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const flat = [];
    for (const r of rows) flat.push(r.matchId, r.userId, r.username, r.mode, r.team, r.fighter, r.kills, r.deaths,
      r.damage, r.objectives, r.won ? 1 : 0, r.trophiesDelta, r.starPlayer ? 1 : 0, r.createdAt ?? now());
    await this._execute(
      `INSERT INTO match_players (match_id, user_id, username, mode, team, fighter, kills, deaths, damage, objectives, won, trophies_delta, star_player, created_at)
       VALUES ${vals}`, flat);
  }
  async listMatchesByUser(userId, limit = 20) {
    const [rows] = await this._execute(
      'SELECT * FROM match_players WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, String(limit)]);
    return rows;
  }

  // ---------- ranked ----------
  async ensureSeason(s) {
    const [rows] = await this._execute('SELECT * FROM ranked_seasons WHERE ended_at IS NULL LIMIT 1');
    if (rows[0]) return this._seasonOut(rows[0]);
    const id = s.id ?? this.id();
    await this._execute(
      'INSERT INTO ranked_seasons (id, name, started_at, ends_at, reset_to) VALUES (?,?,NOW(),?,?)',
      [id, s.name, s.endsAt ?? null, s.resetTo ?? 'gold']);
    const [created] = await this._execute('SELECT * FROM ranked_seasons WHERE id = ?', [id]);
    return this._seasonOut(created[0]);
  }
  _seasonOut(r) {
    return { id: r.id, name: r.name, startedAt: r.started_at, endsAt: r.ends_at, endedAt: r.ended_at, resetTo: r.reset_to };
  }
  async getSeason() {
    const [rows] = await this._execute('SELECT * FROM ranked_seasons WHERE ended_at IS NULL LIMIT 1');
    return rows[0] ? this._seasonOut(rows[0]) : null;
  }
  async endSeason(id) {
    await this._execute('UPDATE ranked_seasons SET ended_at = NOW() WHERE id = ?', [id]);
  }
  async getRankedPlayer(userId, seasonId) {
    const [rows] = await this._execute('SELECT * FROM ranked_players WHERE season_id = ? AND user_id = ? LIMIT 1', [seasonId, userId]);
    return rows[0] ? this._rpOut(rows[0]) : null;
  }
  _rpOut(r) {
    return { userId: r.user_id, seasonId: r.season_id, rp: r.rp, wins: r.wins, losses: r.losses, streak: r.streak, peak: r.peak };
  }
  async upsertRankedPlayer(userId, seasonId, patch) {
    const cur = await this.getRankedPlayer(userId, seasonId) ?? { rp: 0, wins: 0, losses: 0, streak: 0, peak: 0 };
    const next = { ...cur, ...patch };
    await this._execute(
      `INSERT INTO ranked_players (season_id, user_id, rp, wins, losses, streak, peak, updated_at) VALUES (?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE rp = VALUES(rp), wins = VALUES(wins), losses = VALUES(losses), streak = VALUES(streak), peak = VALUES(peak)`,
      [seasonId, userId, next.rp, next.wins, next.losses, next.streak, next.peak]);
    return next;
  }
  async topRanked(seasonId, limit = 50) {
    const [rows] = await this._execute(
      'SELECT rp.*, u.username FROM ranked_players rp JOIN users u ON u.id = rp.user_id WHERE rp.season_id = ? ORDER BY rp.rp DESC LIMIT ?',
      [seasonId, String(limit)]);
    return rows;
  }

  // ---------- events (document JSON) ----------
  async listEvents() {
    const [rows] = await this._query('SELECT data FROM events ORDER BY priority DESC');
    return rows.map(r => jparse(r.data, {}));
  }
  async getEvent(id) {
    const [rows] = await this._execute('SELECT data FROM events WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? jparse(rows[0].data, {}) : null;
  }
  async upsertEvent(ev) {
    await this._execute(
      `INSERT INTO events (id, data, priority, status) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), priority = VALUES(priority), status = VALUES(status)`,
      [ev.id, JSON.stringify(ev), ev.priority ?? 0, ev.status ?? 'draft']);
    return ev;
  }
  async deleteEvent(id) { await this._execute('DELETE FROM events WHERE id = ?', [id]); }
  async getEventProgress(userId, eventId) {
    const [rows] = await this._execute('SELECT progress, claimed FROM event_progress WHERE event_id = ? AND user_id = ? LIMIT 1', [eventId, userId]);
    return rows[0] ? { userId, eventId, progress: rows[0].progress, claimed: !!rows[0].claimed } : null;
  }
  async incrEventProgress(userId, eventId, patch) {
    const cur = await this.getEventProgress(userId, eventId) ?? { progress: 0, claimed: false };
    const next = { ...cur, ...patch };
    await this._execute(
      `INSERT INTO event_progress (event_id, user_id, progress, claimed, updated_at) VALUES (?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE progress = VALUES(progress), claimed = VALUES(claimed)`,
      [eventId, userId, next.progress, next.claimed ? 1 : 0]);
    return { userId, eventId, ...next };
  }

  // ---------- battle pass ----------
  async getPass(passId) {
    const [rows] = await this._execute('SELECT data FROM battle_passes WHERE id = ? LIMIT 1', [passId]);
    return rows[0] ? jparse(rows[0].data, {}) : null;
  }
  async ensurePass(def) {
    const existing = await this.getPass(def.id);
    if (existing) return existing;
    await this._execute(
      'INSERT INTO battle_passes (id, data) VALUES (?,?)',
      [def.id, JSON.stringify({ ...def, rewards: undefined })]);
    return this.getPass(def.id);
  }
  async getPassProgress(userId, passId) {
    const [rows] = await this._execute('SELECT * FROM battle_pass_progress WHERE pass_id = ? AND user_id = ? LIMIT 1', [passId, userId]);
    if (!rows[0]) return null;
    const r = rows[0];
    return { userId, passId, xp: r.xp, tier: r.tier, premium: !!r.premium, claimedFree: jparse(r.claimed_free, []), claimedPremium: jparse(r.claimed_premium, []) };
  }
  async upsertPassProgress(userId, passId, patch) {
    const cur = await this.getPassProgress(userId, passId) ?? { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    const next = { ...cur, ...patch };
    await this._execute(
      `INSERT INTO battle_pass_progress (pass_id, user_id, xp, tier, premium, claimed_free, claimed_premium, updated_at)
       VALUES (?,?,?,?,?,?,?,NOW())
       ON DUPLICATE KEY UPDATE xp = VALUES(xp), tier = VALUES(tier), premium = VALUES(premium), claimed_free = VALUES(claimed_free), claimed_premium = VALUES(claimed_premium)`,
      [passId, userId, next.xp, next.tier, next.premium ? 1 : 0, JSON.stringify(next.claimedFree), JSON.stringify(next.claimedPremium)]);
    return { userId, passId, ...next };
  }

  // ---------- news ----------
  async listNews({ publishedOnly = true } = {}) {
    const sql = publishedOnly
      ? 'SELECT data FROM news WHERE published = 1 ORDER BY priority DESC, date DESC LIMIT 100'
      : 'SELECT data FROM news ORDER BY priority DESC, date DESC LIMIT 100';
    const [rows] = await this._query(sql);
    return rows.map(r => jparse(r.data, {}));
  }
  async getNews(id) {
    const [rows] = await this._execute('SELECT data FROM news WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? jparse(rows[0].data, {}) : null;
  }
  async upsertNews(n) {
    await this._execute(
      `INSERT INTO news (id, data, published, priority, date) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), published = VALUES(published), priority = VALUES(priority), date = VALUES(date)`,
      [n.id, JSON.stringify(n), n.published ? 1 : 0, n.priority ?? 0, n.date ?? now()]);
    return n;
  }
  async deleteNews(id) { await this._execute('DELETE FROM news WHERE id = ?', [id]); }

  // ---------- shop ----------
  async listShopItems() {
    const [rows] = await this._query('SELECT data FROM shop_items');
    return rows.map(r => jparse(r.data, {}));
  }
  async upsertShopItem(item) {
    await this._execute(
      `INSERT INTO shop_items (id, data) VALUES (?,?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [item.id, JSON.stringify(item)]);
    return item;
  }
  async deleteShopItem(id) { await this._execute('DELETE FROM shop_items WHERE id = ?', [id]); }
  async getRotation(dayKey) {
    const [rows] = await this._execute('SELECT item_ids FROM shop_rotations WHERE day_key = ? LIMIT 1', [dayKey]);
    return rows[0] ? jparse(rows[0].item_ids, []) : null;
  }
  async saveRotation(dayKey, itemIds) {
    await this._execute(
      `INSERT INTO shop_rotations (day_key, item_ids) VALUES (?,?) ON DUPLICATE KEY UPDATE item_ids = VALUES(item_ids)`,
      [dayKey, JSON.stringify(itemIds)]);
  }

  // ---------- reports ----------
  async createReport(r) {
    await this._execute('INSERT INTO reports (id, data, status, created_at) VALUES (?,?,?,?)',
      [r.id, JSON.stringify(r), 'open', now()]);
    return { ...r, status: 'open', createdAt: now() };
  }
  async listReports({ status = null } = {}) {
    const sql = status
      ? 'SELECT data FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT data FROM reports ORDER BY created_at DESC LIMIT 200';
    const [rows] = await this._execute(sql, status ? [status] : []);
    return rows.map(r => jparse(r.data, {}));
  }
  async updateReport(id, patch) {
    const cur = await this._execute('SELECT data FROM reports WHERE id = ? LIMIT 1', [id]).then(([r]) => r[0]);
    if (!cur) return null;
    const next = { ...jparse(cur.data, {}), ...patch };
    await this._execute('UPDATE reports SET data = ?, status = ? WHERE id = ?', [JSON.stringify(next), next.status ?? 'open', id]);
    return next;
  }

  // ---------- sanctions ----------
  async addSanction(s) {
    const id = s.id ?? this.id();
    await this._execute(
      'INSERT INTO sanctions (id, user_id, type, reason, by_id, until, status, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
      [id, s.userId, s.type, s.reason ?? '', s.by ?? null, s.until ?? null, 'active']);
    return { id, ...s, status: 'active' };
  }
  async activeSanctions(userId) {
    const [rows] = await this._execute(
      `SELECT id, user_id AS userId, type, reason, by_id AS \`by\`, until, status FROM sanctions
       WHERE user_id = ? AND status = 'active' AND (until IS NULL OR until > NOW())`, [userId]);
    return rows;
  }
  async updateSanction(id, patch) {
    const map = { status: 'status', until: 'until' };
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) if (map[k]) { sets.push(`${map[k]} = ?`); vals.push(v); }
    if (sets.length) { vals.push(id); await this._execute(`UPDATE sanctions SET ${sets.join(', ')} WHERE id = ?`, vals); }
    return { id, ...patch };
  }

  // ---------- admin logs ----------
  async addAdminLog(log) {
    await this._execute('INSERT INTO admin_logs (author, role, action, target, details, result, at) VALUES (?,?,?,?,?,?,NOW())',
      [log.author, log.role, log.action, log.target ?? '', JSON.stringify(log.details ?? {}), log.result ?? 'ok']);
  }
  async listAdminLogs({ limit = 100 } = {}) {
    const [rows] = await this._execute(
      `SELECT author, role, action, target, details, result, at FROM admin_logs ORDER BY at DESC LIMIT ?`, [String(limit)]);
    return rows.map(r => ({ ...r, details: jparse(r.details, {}) }));
  }

  // ---------- game config ----------
  async getAllConfig() {
    const [rows] = await this._query('SELECT k, v FROM game_config');
    return Object.fromEntries(rows.map(r => [r.k, r.v]));
  }
  async setConfig(key, value) {
    await this._execute('REPLACE INTO game_config (k, v) VALUES (?,?)', [key, JSON.stringify(value)]);
  }
  async deleteConfig(key) { await this._execute('DELETE FROM game_config WHERE k = ?', [key]); }

  // ---------- community maps ----------
  async saveMap(m) {
    await this._execute(
      `INSERT INTO maps (id, author_id, author_name, status, likes, plays, created_at, updated_at, data)
       VALUES (?,?,?,?,?,0,NOW(),NOW(),?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), status = VALUES(status), updated_at = NOW()`,
      [m.id, m.authorId, m.authorName ?? '', m.status ?? 'draft', m.likes ?? 0, JSON.stringify(m)]);
    return this.getMap(m.id);
  }
  async getMap(id) {
    const [rows] = await this._execute('SELECT data FROM maps WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? jparse(rows[0].data, {}) : null;
  }
  async listMaps({ status = null, authorId = null, sort = 'recent', limit = 50 } = {}) {
    let sql = 'SELECT id, author_id, author_name, status, likes, plays, created_at, updated_at FROM maps';
    const wheres = [], vals = [];
    if (status) { wheres.push('status = ?'); vals.push(status); }
    if (authorId) { wheres.push('author_id = ?'); vals.push(authorId); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += sort === 'popular' ? ' ORDER BY likes DESC' : ' ORDER BY created_at DESC';
    sql += ' LIMIT ?';
    vals.push(String(limit));
    const [rows] = await this._execute(sql, vals);
    return rows;
  }
  async updateMap(id, patch) {
    const allowed = { status: 'status', name: null, desc: null, grid: null, spawns: null, modes: null };
    const sets = [], vals = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (!(k in patch)) continue;
      if (col === null) { // document fields — rewrite data JSON
        const cur = await this.getMap(id);
        if (cur) {
          const next = { ...cur, ...patch, updatedAt: now() };
          await this._execute('UPDATE maps SET data = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), id]);
          return next;
        }
        return null;
      }
      sets.push(`${col} = ?`); vals.push(patch[k]);
    }
    if (sets.length) { vals.push(id); await this._execute(`UPDATE maps SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals); }
    return this.getMap(id);
  }
  async likeMap(id) { await this._execute('UPDATE maps SET likes = likes + 1 WHERE id = ?', [id]); }

  // ---------- parties ----------
  async createParty(p) {
    await this._execute('INSERT INTO parties (id, leader_id, mode, created_at) VALUES (?,?,?,NOW())', [p.id, p.leaderId, p.mode ?? null]);
    return p;
  }
  async updateParty(id, patch) {
    const allowed = ['leader_id', 'mode'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    if (sets.length) { vals.push(id); await this._execute(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`, vals); }
    return this.getParty(id);
  }
  async getParty(id) {
    const [rows] = await this._execute('SELECT id, leader_id, mode, created_at FROM parties WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? { id: rows[0].id, leaderId: rows[0].leader_id, mode: rows[0].mode, createdAt: rows[0].created_at } : null;
  }
  async deleteParty(id) {
    await this._execute('DELETE FROM party_members WHERE party_id = ?', [id]);
    await this._execute('DELETE FROM parties WHERE id = ?', [id]);
  }
  async addPartyMember(partyId, userId) {
    await this._execute('INSERT IGNORE INTO party_members (party_id, user_id, joined_at) VALUES (?,?,NOW())', [partyId, userId]);
  }
  async removePartyMember(partyId, userId) {
    await this._execute('DELETE FROM party_members WHERE party_id = ? AND user_id = ?', [partyId, userId]);
  }
  async listPartyMembers(partyId) {
    const [rows] = await this._execute('SELECT user_id FROM party_members WHERE party_id = ?', [partyId]);
    return rows.map(r => r.user_id);
  }
}
