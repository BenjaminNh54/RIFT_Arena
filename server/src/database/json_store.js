// RIFT ARENA — JSON file store (zero-config local dev + tests)
// Implements the same DAO contract as mysql_store.js. Data lives in DATA_DIR/store.json.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

export class JsonStore {
  constructor(dataDir) {
    this.file = join(dataDir, 'store.json');
    this.data = null;
    this.flushTimer = null;
    this.load();
  }

  load() {
    mkdirSync(dirname(this.file), { recursive: true });
    if (existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
      catch { this.data = null; }
    }
    if (!this.data) this.data = this.empty();
  }

  empty() {
    return {
      users: {}, sessions: {}, trophies_log: {}, fighters: {}, inventory: {},
      missions: {}, friends: {}, friend_requests: {}, clans: {}, clan_members: {},
      clan_requests: {}, clan_wars: {}, messages: [], matches: [], match_players: [],
      ranked_seasons: {}, ranked_players: {}, events: {}, event_progress: {},
      passes: {}, pass_progress: {}, news: {}, shop_items: {}, shop_rotations: {},
      reports: {}, sanctions: {}, admin_logs: [], game_config: {}, maps: {}, parties: {},
    };
  }

  flush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try { writeFileSync(this.file, JSON.stringify(this.data)); }
      catch (e) { console.error('[store] flush failed:', e.message); }
    }, 250);
  }
  flushNow() { if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; } writeFileSync(this.file, JSON.stringify(this.data)); }

  id() { return randomUUID(); }

  // ---------- users ----------
  createUser(u) {
    const id = u.id ?? this.id();
    this.data.users[id] = {
      id, username: u.username, username_lower: u.username.toLowerCase(),
      pass_hash: u.passHash, role: u.role ?? 'player',
      trophies: 0, xp: 0, level: 1, avatar: u.avatar ?? 'avatar_ion', banner: u.banner ?? 'banner_ion',
      title: '', credits: u.credits ?? 0, rift_tokens: u.rift_tokens ?? 0, pass_xp: 0,
      matches: 0, wins: 0, losses: 0, kills: 0, playtime_s: 0,
      banned_until: null, ban_reason: null, muted_until: null,
      privacy: 'public', favorite_fighter: null, created_at: now(), last_seen: now(),
    };
    this.flush();
    return this.data.users[id];
  }
  getUserByUsername(username) {
    const l = String(username).toLowerCase();
    return Object.values(this.data.users).find(u => u.username_lower === l) ?? null;
  }
  getUserById(id) { return this.data.users[id] ?? null; }
  updateUser(id, patch) {
    const u = this.data.users[id];
    if (!u) return null;
    Object.assign(u, patch, patch.username ? { username_lower: patch.username.toLowerCase() } : {});
    this.flush();
    return u;
  }
  incrementUser(id, fields) {
    const u = this.data.users[id];
    if (!u) return null;
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      u[k] = Math.max(0, (u[k] ?? 0) + v);
    }
    this.flush();
    return u;
  }
  listUsers({ q = '', limit = 50, offset = 0 } = {}) {
    let rows = Object.values(this.data.users);
    if (q) rows = rows.filter(u => u.username_lower.includes(q.toLowerCase()));
    rows.sort((a, b) => b.trophies - a.trophies);
    return rows.slice(offset, offset + limit);
  }
  countUsers() { return Object.keys(this.data.users).length; }
  addTrophyLog(userId, amount, reason) {
    (this.data.trophies_log[userId] ??= []).push({ amount, reason, at: now() });
    if (this.data.trophies_log[userId].length > 200) this.data.trophies_log[userId].shift();
    this.flush();
  }
  getTrophyLog(userId, limit = 20) {
    return (this.data.trophies_log[userId] ?? []).slice(-limit).reverse();
  }

  // ---------- sessions ----------
  saveSession({ tokenHash, userId, expiresAt }) {
    this.data.sessions[tokenHash] = { userId, expiresAt };
    this.flush();
  }
  getSession(tokenHash) {
    const s = this.data.sessions[tokenHash];
    if (!s) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) { delete this.data.sessions[tokenHash]; this.flush(); return null; }
    return s;
  }
  deleteSession(tokenHash) { delete this.data.sessions[tokenHash]; this.flush(); }

  // ---------- fighters ----------
  getFighters(userId) { return this.data.fighters[userId] ?? {}; }
  setFighter(userId, fid, patch) {
    const map = (this.data.fighters[userId] ??= {});
    map[fid] = { unlocked: false, trophies: 0, xp: 0, level: 1, ...(map[fid] ?? {}), ...patch };
    this.flush();
    return map[fid];
  }
  unlockFighter(userId, fid) { return this.setFighter(userId, fid, { unlocked: true }); }

  // ---------- inventory ----------
  invKey(kind, refId) { return `${kind}::${refId}`; }
  getInventory(userId, kind = null) {
    const items = this.data.inventory[userId] ?? {};
    return Object.entries(items)
      .filter(([, v]) => !kind || v.kind === kind)
      .map(([k, v]) => ({ key: k, ...v }));
  }
  addItem(userId, kind, refId, qty = 1) {
    const items = (this.data.inventory[userId] ??= {});
    const key = this.invKey(kind, refId);
    if (items[key]) items[key].qty += qty;
    else items[key] = { kind, refId, qty, acquiredAt: now() };
    this.flush();
  }
  hasItem(userId, kind, refId) {
    return Boolean(this.data.inventory[userId]?.[this.invKey(kind, refId)]);
  }
  removeItem(userId, kind, refId, qty = 1) {
    const items = this.data.inventory[userId];
    const key = this.invKey(kind, refId);
    if (!items?.[key]) return false;
    items[key].qty -= qty;
    if (items[key].qty <= 0) delete items[key];
    this.flush();
    return true;
  }

  // ---------- missions ----------
  getMissions(userId, periodKey) { return this.data.missions[userId]?.[periodKey] ?? {}; }
  upsertMission(userId, periodKey, tplId, patch) {
    ((this.data.missions[userId] ??= {})[periodKey] ??= {});
    const m = this.data.missions[userId][periodKey][tplId] ?? { progress: 0, claimed: false, createdAt: now() };
    Object.assign(m, patch);
    this.data.missions[userId][periodKey][tplId] = m;
    this.flush();
    return m;
  }

  // ---------- friends ----------
  friendsKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  getFriendRow(a, b) { return this.data.friends[this.friendsKey(a, b)] ?? null; }
  addFriend(a, b) {
    this.data.friends[this.friendsKey(a, b)] = { a: a < b ? a : b, b: a < b ? b : a, blockedBy: null, since: now() };
    this.flush();
  }
  removeFriend(a, b) { delete this.data.friends[this.friendsKey(a, b)]; this.flush(); }
  setFriendBlock(a, b, blockedBy) {
    const row = this.data.friends[this.friendsKey(a, b)];
    if (row) { row.blockedBy = blockedBy; this.flush(); }
  }
  getFriends(userId) {
    return Object.values(this.data.friends)
      .filter(f => f.a === userId || f.b === userId)
      .map(f => ({ friendId: f.a === userId ? f.b : f.a, blockedBy: f.blockedBy, since: f.since }));
  }
  addFriendRequest(from, to) {
    this.data.friend_requests[`${from}|${to}`] = { from, to, at: now() };
    this.flush();
  }
  listFriendRequests(userId) {
    return Object.values(this.data.friend_requests).filter(r => r.to === userId);
  }
  listSentFriendRequests(userId) {
    return Object.values(this.data.friend_requests).filter(r => r.from === userId);
  }
  deleteFriendRequest(from, to) { delete this.data.friend_requests[`${from}|${to}`]; this.flush(); }

  // ---------- clans ----------
  createClan(c) {
    const id = c.id ?? this.id();
    this.data.clans[id] = {
      id, name: c.name, tag: c.tag.toUpperCase(), desc: c.desc ?? '', logo: c.logo ?? 'rift',
      banner: c.banner ?? 'banner_rift', level: 1, xp: 0, trophies: c.trophies ?? 0,
      open: c.open ?? true, createdAt: now(), leaderId: c.leaderId,
    };
    this.flush();
    return this.data.clans[id];
  }
  getClan(id) { return this.data.clans[id] ?? null; }
  getClanByTag(tag) {
    const t = String(tag).toUpperCase();
    return Object.values(this.data.clans).find(c => c.tag === t) ?? null;
  }
  updateClan(id, patch) {
    const c = this.data.clans[id];
    if (!c) return null;
    Object.assign(c, patch);
    this.flush();
    return c;
  }
  listClans() { return Object.values(this.data.clans).sort((a, b) => b.trophies - a.trophies); }
  addClanMember({ clanId, userId, role }) {
    this.data.clan_members[userId] = { clanId, userId, role, joinedAt: now() };
    this.flush();
  }
  getClanMembership(userId) { return this.data.clan_members[userId] ?? null; }
  getClanMember(clanId, userId) {
    const m = this.data.clan_members[userId];
    return m && m.clanId === clanId ? m : null;
  }
  listClanMembers(clanId) {
    return Object.values(this.data.clan_members).filter(m => m.clanId === clanId);
  }
  updateClanMemberRole(clanId, userId, role) {
    const m = this.data.clan_members[userId];
    if (m && m.clanId === clanId) { m.role = role; this.flush(); }
  }
  removeClanMember(clanId, userId) {
    const m = this.data.clan_members[userId];
    if (m && m.clanId === clanId) { delete this.data.clan_members[userId]; this.flush(); return true; }
    return false;
  }
  addJoinRequest(clanId, userId) {
    this.data.clan_requests[`${clanId}|${userId}`] = { clanId, userId, at: now() };
    this.flush();
  }
  listJoinRequests(clanId) {
    return Object.values(this.data.clan_requests).filter(r => r.clanId === clanId);
  }
  deleteJoinRequest(clanId, userId) { delete this.data.clan_requests[`${clanId}|${userId}`]; this.flush(); }

  // ---------- clan wars (weekly aggregate) ----------
  addWarMatch(weekKey, clanId, win) {
    const war = (this.data.clan_wars[weekKey] ??= { week: weekKey, clans: {} });
    const c = (war.clans[clanId] ??= { matches: 0, wins: 0, points: 0 });
    c.matches++; if (win) c.wins++;
    c.points += win ? 3 : 1;
    this.flush();
  }
  getWarState(weekKey) { return this.data.clan_wars[weekKey] ?? { week: weekKey, clans: {} }; }

  // ---------- messages ----------
  saveMessage(m) {
    this.data.messages.push({ id: this.id(), ...m, createdAt: m.createdAt ?? now() });
    if (this.data.messages.length > 4000) this.data.messages.splice(0, this.data.messages.length - 4000);
    this.flush();
  }
  getMessages(channel, channelId, limit = 40) {
    return this.data.messages
      .filter(m => m.channel === channel && (m.channelId ?? '') === (channelId ?? ''))
      .slice(-limit);
  }

  // ---------- matches ----------
  recordMatch(m) {
    this.data.matches.push({ ...m });
    if (this.data.matches.length > 2000) this.data.matches.shift();
    this.flush();
  }
  recordMatchPlayers(rows) {
    // normalize to the same row shape as the MySQL store (snake_case columns)
    this.data.match_players.push(...rows.map(r => ({
      match_id: r.matchId, user_id: r.userId, username: r.username, mode: r.mode,
      team: r.team, fighter: r.fighter, kills: r.kills, deaths: r.deaths,
      damage: r.damage, objectives: r.objectives, won: r.won ? 1 : 0,
      trophies_delta: r.trophiesDelta, star_player: r.starPlayer ? 1 : 0, created_at: r.createdAt ?? now(),
    })));
    if (this.data.match_players.length > 12000) this.data.match_players.splice(0, this.data.match_players.length - 12000);
    this.flush();
  }
  listMatchesByUser(userId, limit = 20) {
    return this.data.match_players.filter(r => r.user_id === userId).slice(-limit).reverse();
  }

  // ---------- ranked ----------
  ensureSeason(s) {
    const existing = Object.values(this.data.ranked_seasons).find(x => !x.endedAt);
    if (existing) return existing;
    const id = s.id ?? this.id();
    this.data.ranked_seasons[id] = { id, name: s.name, startedAt: s.startedAt ?? now(), endsAt: s.endsAt ?? null, endedAt: null, resetTo: s.resetTo ?? 'gold' };
    this.flush();
    return this.data.ranked_seasons[id];
  }
  getSeason() { return Object.values(this.data.ranked_seasons).find(x => !x.endedAt) ?? null; }
  endSeason(id) { const s = this.data.ranked_seasons[id]; if (s) { s.endedAt = now(); this.flush(); } }
  getRankedPlayer(userId, seasonId) {
    return this.data.ranked_players[`${seasonId}|${userId}`] ?? null;
  }
  upsertRankedPlayer(userId, seasonId, patch) {
    const key = `${seasonId}|${userId}`;
    const p = this.data.ranked_players[key] ?? { userId, seasonId, rp: 0, wins: 0, losses: 0, streak: 0, peak: 0, updatedAt: now() };
    Object.assign(p, patch, { updatedAt: now() });
    this.data.ranked_players[key] = p;
    this.flush();
    return p;
  }
  topRanked(seasonId, limit = 50) {
    return Object.values(this.data.ranked_players)
      .filter(p => p.seasonId === seasonId)
      .sort((a, b) => b.rp - a.rp)
      .slice(0, limit);
  }

  // ---------- events ----------
  listEvents() { return Object.values(this.data.events).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)); }
  getEvent(id) { return this.data.events[id] ?? null; }
  upsertEvent(ev) { this.data.events[ev.id] = { ...ev }; this.flush(); return this.data.events[ev.id]; }
  deleteEvent(id) { delete this.data.events[id]; this.flush(); }
  getEventProgress(userId, eventId) { return this.data.event_progress[`${eventId}|${userId}`] ?? null; }
  incrEventProgress(userId, eventId, patch) {
    const key = `${eventId}|${userId}`;
    const p = this.data.event_progress[key] ?? { userId, eventId, progress: 0, claimed: false, updatedAt: now() };
    Object.assign(p, patch, { updatedAt: now() });
    this.data.event_progress[key] = p;
    this.flush();
    return p;
  }

  // ---------- battle pass ----------
  getPass(passId) { return this.data.passes[passId] ?? null; }
  ensurePass(def) {
    if (this.data.passes[def.id]) return this.data.passes[def.id];
    this.data.passes[def.id] = {
      id: def.id, season: def.season, name: def.name, tiers: def.tiers,
      xpPerTier: def.xpPerTier, premiumPrice: def.premiumPrice, rewards: def.rewards, active: true,
    };
    this.flush();
    return this.data.passes[def.id];
  }
  getPassProgress(userId, passId) { return this.data.pass_progress[`${passId}|${userId}`] ?? null; }
  upsertPassProgress(userId, passId, patch) {
    const key = `${passId}|${userId}`;
    const p = this.data.pass_progress[key] ?? { userId, passId, xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    Object.assign(p, patch);
    this.data.pass_progress[key] = p;
    this.flush();
    return p;
  }

  // ---------- news ----------
  listNews({ publishedOnly = true } = {}) {
    return Object.values(this.data.news)
      .filter(n => !publishedOnly || n.published)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.date ?? '').localeCompare(a.date ?? ''));
  }
  getNews(id) { return this.data.news[id] ?? null; }
  upsertNews(n) { this.data.news[n.id] = { ...n }; this.flush(); return this.data.news[n.id]; }
  deleteNews(id) { delete this.data.news[id]; this.flush(); }

  // ---------- shop ----------
  listShopItems() { return Object.values(this.data.shop_items); }
  upsertShopItem(item) { this.data.shop_items[item.id] = { ...item }; this.flush(); return this.data.shop_items[item.id]; }
  deleteShopItem(id) { delete this.data.shop_items[id]; this.flush(); }
  getRotation(dayKey) { return this.data.shop_rotations[dayKey] ?? null; }
  saveRotation(dayKey, itemIds) { this.data.shop_rotations[dayKey] = itemIds; this.flush(); }

  // ---------- reports ----------
  createReport(r) { this.data.reports[r.id] = { ...r, status: 'open', createdAt: now() }; this.flush(); return this.data.reports[r.id]; }
  listReports({ status = null } = {}) {
    return Object.values(this.data.reports)
      .filter(r => !status || r.status === status)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }
  updateReport(id, patch) {
    const r = this.data.reports[id];
    if (!r) return null;
    Object.assign(r, patch);
    this.flush();
    return r;
  }

  // ---------- sanctions ----------
  addSanction(s) {
    const id = s.id ?? this.id();
    this.data.sanctions[id] = { id, ...s, createdAt: now() };
    this.flush();
    return this.data.sanctions[id];
  }
  activeSanctions(userId) {
    const t = Date.now();
    return Object.values(this.data.sanctions).filter(s =>
      s.userId === userId &&
      (s.until === null || new Date(s.until).getTime() > t) &&
      (s.status ?? 'active') === 'active');
  }
  updateSanction(id, patch) {
    const s = this.data.sanctions[id];
    if (!s) return null;
    Object.assign(s, patch);
    this.flush();
    return s;
  }

  // ---------- admin logs ----------
  addAdminLog(log) { this.data.admin_logs.push({ ...log, at: now() }); if (this.data.admin_logs.length > 3000) this.data.admin_logs.shift(); this.flush(); }
  listAdminLogs({ limit = 100 } = {}) { return [...this.data.admin_logs].reverse().slice(0, limit); }

  // ---------- game config ----------
  getAllConfig() { return { ...this.data.game_config }; }
  setConfig(key, value) { this.data.game_config[key] = value; this.flush(); }
  deleteConfig(key) { delete this.data.game_config[key]; this.flush(); }

  // ---------- community maps ----------
  saveMap(m) {
    this.data.maps[m.id] = { likes: 0, plays: 0, status: 'draft', version: 1, createdAt: now(), updatedAt: now(), ...m };
    this.flush();
    return this.data.maps[m.id];
  }
  getMap(id) { return this.data.maps[id] ?? null; }
  listMaps({ status = null, authorId = null, sort = 'recent', limit = 50 } = {}) {
    let rows = Object.values(this.data.maps);
    if (status) rows = rows.filter(m => m.status === status);
    if (authorId) rows = rows.filter(m => m.authorId === authorId);
    if (sort === 'popular') rows.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
    else if (sort === 'plays') rows.sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0));
    else rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return rows.slice(0, limit);
  }
  updateMap(id, patch) {
    const m = this.data.maps[id];
    if (!m) return null;
    Object.assign(m, patch, { updatedAt: now() });
    this.flush();
    return m;
  }
  likeMap(id) { const m = this.data.maps[id]; if (m) { m.likes = (m.likes ?? 0) + 1; this.flush(); } }

  // ---------- parties (persistent state; live state in matchmaking memory) ----------
  createParty(p) { this.data.parties[p.id] = { id: p.id, leaderId: p.leaderId, mode: p.mode ?? null, createdAt: now() }; this.flush(); }
  updateParty(id, patch) { const p = this.data.parties[id]; if (p) { Object.assign(p, patch); this.flush(); } return p; }
  getParty(id) { return this.data.parties[id] ?? null; }
  deleteParty(id) { delete this.data.parties[id]; this.flush(); }
  addPartyMember(partyId, userId) {
    const p = this.data.parties[partyId];
    if (p) { (p.members ??= {})[userId] = { joinedAt: now() }; this.flush(); }
  }
  removePartyMember(partyId, userId) {
    const p = this.data.parties[partyId];
    if (p?.members) { delete p.members[userId]; this.flush(); }
  }
  listPartyMembers(partyId) { return Object.keys(this.data.parties[partyId]?.members ?? {}); }
}
