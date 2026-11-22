// RIFT ARENA — social systems: friends, parties, clans, chat (shared by REST API + WebSocket)
import { CLAN_CONFIG } from '../../../shared/game-config/defaults.js';
import { sanitizeText, validateClanTag, validateClanName } from '../../../shared/validators/index.js';
import { rateLimit } from '../security/index.js';
import { periodKeys } from './rewards.js';

const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'salope', 'putain', 'connard', 'enculé', 'ntm', 'tg'];
export function filterText(text) {
  let out = sanitizeText(text, 240);
  for (const w of BAD_WORDS) out = out.replace(new RegExp(w, 'gi'), '*'.repeat(w.length));
  return out;
}

export class SocialSystem {
  constructor(db, roomManager) {
    this.db = db;
    this.rm = roomManager;
    // userId -> partyId (live state)
    this.userParty = new Map();
    this.parties = new Map(); // partyId -> {id, leaderId, members:Set, mode, ready:Set}
  }

  presenceOf(userId) {
    const online = this.rm.sockets.has(userId) && this.rm.sockets.get(userId).size > 0;
    const inMatch = this.rm.userRoom.has(userId);
    return online ? (inMatch ? 'in_match' : 'online') : 'offline';
  }

  // ---------- friends ----------
  async searchUsers(query, excludeId) {
    const q = String(query).toLowerCase();
    const rows = await this.db.listUsers({ q, limit: 20 });
    return rows.filter(u => u.id !== excludeId).map(u => ({
      id: u.id, username: u.username, trophies: u.trophies, level: u.level, presence: this.presenceOf(u.id),
    }));
  }
  async sendFriendRequest(fromId, toUsername) {
    const to = await this.db.getUserByUsername(toUsername);
    if (!to) throw new Error('USER_NOT_FOUND');
    if (to.id === fromId) throw new Error('CANNOT_ADD_SELF');
    const existing = await this.db.getFriendRow(fromId, to.id);
    if (existing) throw new Error('ALREADY_FRIENDS');
    const blocked = await this.db.getFriends(fromId);
    if (blocked.some(f => f.friendId === to.id && f.blockedBy === to.id)) throw new Error('BLOCKED');
    await this.db.addFriendRequest(fromId, to.id);
    this.notify(to.id, { t: 'friend_request', from: fromId, name: (await this.db.getUserById(fromId))?.username });
    return { ok: true };
  }
  async resolveFriendRequest(userId, fromId, accept) {
    const reqs = await this.db.listFriendRequests(userId);
    if (!reqs.some(r => r.from === fromId)) throw new Error('NO_REQUEST');
    await this.db.deleteFriendRequest(fromId, userId);
    if (accept) {
      await this.db.addFriend(userId, fromId);
      this.notify(fromId, { t: 'friend_accept', name: (await this.db.getUserById(userId))?.username });
    }
    return { ok: true };
  }
  async removeFriend(userId, friendId) {
    await this.db.removeFriend(userId, friendId);
    return { ok: true };
  }
  async blockUser(userId, targetId) {
    await this.db.setFriendBlock(userId, targetId, userId);
    this.notify(targetId, { t: 'blocked', by: userId });
    return { ok: true };
  }
  async unblockUser(userId, targetId) {
    await this.db.setFriendBlock(userId, targetId, null);
    return { ok: true };
  }
  async friendsList(userId) {
    const rows = await this.db.getFriends(userId);
    const out = [];
    for (const r of rows) {
      const u = await this.db.getUserById(r.friendId);
      if (!u) continue;
      out.push({
        id: u.id, username: u.username, trophies: u.trophies, level: u.level,
        presence: this.presenceOf(u.id), blockedBy: r.blockedBy,
        clan: (await this.db.getClanMembership(u.id))?.clanId ?? null,
      });
    }
    return out;
  }
  async incomingRequests(userId) {
    const reqs = await this.db.listFriendRequests(userId);
    const out = [];
    for (const r of reqs) {
      const u = await this.db.getUserById(r.from);
      if (u) out.push({ from: r.from, username: u.username, trophies: u.trophies, at: r.at });
    }
    return out;
  }

  // ---------- party ----------
  createParty(user) {
    const existing = this.userParty.get(user.id);
    if (existing) return this.parties.get(existing);
    const id = 'pt_' + Math.random().toString(36).slice(2, 9);
    const party = { id, leaderId: user.id, members: new Set([user.id]), mode: null, ready: new Set([user.id]) };
    this.parties.set(id, party);
    this.userParty.set(user.id, id);
    this.db.createParty?.({ id, leaderId: user.id }); // persistence best-effort
    return party;
  }
  partyOf(userId) {
    const id = this.userParty.get(userId);
    return id ? this.parties.get(id) ?? null : null;
  }
  async inviteToParty(user, targetId) {
    const party = this.partyOf(user.id);
    if (!party || party.leaderId !== user.id) throw new Error('NOT_LEADER');
    this.notify(targetId, {
      t: 'party_invite', partyId: party.id,
      name: (await this.db.getUserById(user.id))?.username,
    });
    return { ok: true };
  }
  joinParty(userId, partyId) {
    const party = this.parties.get(partyId);
    if (!party) throw new Error('PARTY_NOT_FOUND');
    if (party.members.size >= 5) throw new Error('PARTY_FULL');
    // leave old
    const old = this.partyOf(userId);
    if (old) this.leaveParty(userId);
    party.members.add(userId);
    this.userParty.set(userId, partyId);
    this.partyPush(party);
    return party;
  }
  leaveParty(userId) {
    const party = this.partyOf(userId);
    if (!party) return;
    party.members.delete(userId);
    this.userParty.delete(userId);
    if (party.members.size === 0) {
      this.parties.delete(party.id);
      this.db.deleteParty?.(party.id);
    } else {
      if (party.leaderId === userId) party.leaderId = [...party.members][0];
      this.partyPush(party);
    }
  }
  kickFromParty(leaderId, targetId) {
    const party = this.partyOf(leaderId);
    if (!party || party.leaderId !== leaderId) throw new Error('NOT_LEADER');
    if (!party.members.has(targetId)) throw new Error('NOT_IN_PARTY');
    this.leaveParty(targetId);
    this.notify(targetId, { t: 'party_kicked' });
  }
  setPartyMode(userId, mode) {
    const party = this.partyOf(userId);
    if (!party || party.leaderId !== userId) throw new Error('NOT_LEADER');
    party.mode = mode;
    this.partyPush(party);
    return party;
  }
  partyPush(party) {
    for (const m of party.members) {
      this.notify(m, {
        t: 'party_update',
        party: { id: party.id, leaderId: party.leaderId, mode: party.mode, members: [...party.members] },
      });
    }
  }
  partyMembers(userId) {
    const party = this.partyOf(userId);
    return party ? [...party.members] : [];
  }

  // ---------- clans ----------
  async createClan(user, { name, tag, desc, open }) {
    const cfg = CLAN_CONFIG;
    if (!validateClanName(name)) throw new Error('CLAN_NAME_INVALID');
    if (!validateClanTag(tag)) throw new Error('CLAN_TAG_INVALID');
    if (await this.db.getClanMembership(user.id)) throw new Error('ALREADY_IN_CLAN');
    if (await this.db.getClanByTag(tag)) throw new Error('TAG_TAKEN');
    if (user.credits < cfg.createCost) throw new Error('NOT_ENOUGH_CREDITS');
    await this.db.updateUser(user.id, { credits: user.credits - cfg.createCost });
    const clan = await this.db.createClan({ name: sanitizeText(name, 20), tag, desc: sanitizeText(desc ?? '', 120), open: open !== false, leaderId: user.id, trophies: user.trophies });
    await this.db.addClanMember({ clanId: clan.id, userId: user.id, role: 'leader' });
    return clan;
  }
  async joinClan(user, clanId) {
    const clan = await this.db.getClan(clanId);
    if (!clan) throw new Error('CLAN_NOT_FOUND');
    if (await this.db.getClanMembership(user.id)) throw new Error('ALREADY_IN_CLAN');
    const members = await this.db.listClanMembers(clanId);
    if (members.length >= CLAN_CONFIG.maxMembers) throw new Error('CLAN_FULL');
    if (clan.open) {
      await this.db.addClanMember({ clanId, userId: user.id, role: 'member' });
      this.clanPush(clanId, { t: 'clan_update' });
    } else {
      await this.db.addJoinRequest(clanId, user.id);
      const leaderMsg = { t: 'clan_request', userId: user.id, name: user.username, clanId };
      const leader = clan.leaderId;
      if (leader) this.notify(leader, leaderMsg);
    }
    return { ok: true, joined: clan.open };
  }
  async leaveClan(user) {
    const membership = await this.db.getClanMembership(user.id);
    if (!membership) throw new Error('NOT_IN_CLAN');
    const clan = await this.db.getClan(membership.clanId);
    await this.db.removeClanMember(membership.clanId, user.id);
    if (clan && clan.leaderId === user.id) {
      const rest = await this.db.listClanMembers(clan.id);
      if (rest.length) {
        const nextLeader = rest.find(m => m.role === 'coleader') ?? rest[0];
        await this.db.updateClan(clan.id, { leaderId: nextLeader.userId });
        await this.db.updateClanMemberRole(clan.id, nextLeader.userId, 'leader');
      } else {
        await this.db.updateClan(clan.id, { leaderId: null });
      }
    }
    this.clanPush(membership.clanId, { t: 'clan_update' });
    return { ok: true };
  }
  async kickMember(actor, clanId, targetId) {
    const membership = await this.db.getClanMembership(actor.id);
    if (!membership || membership.clanId !== clanId) throw new Error('NOT_IN_CLAN');
    if (!['leader', 'coleader', 'officer'].includes(membership.role)) throw new Error('NO_PERMISSION');
    const target = await this.db.getClanMember(clanId, targetId);
    if (!target) throw new Error('NOT_MEMBER');
    if (target.role === 'leader') throw new Error('NO_PERMISSION');
    if (membership.role === 'officer' && ['coleader', 'officer'].includes(target.role)) throw new Error('NO_PERMISSION');
    await this.db.removeClanMember(clanId, targetId);
    this.notify(targetId, { t: 'clan_kicked', clanId });
    this.clanPush(clanId, { t: 'clan_update' });
    return { ok: true };
  }
  async setRole(actor, clanId, targetId, role) {
    const membership = await this.db.getClanMembership(actor.id);
    if (!membership || membership.clanId !== clanId) throw new Error('NOT_IN_CLAN');
    if (!['leader', 'coleader'].includes(membership.role)) throw new Error('NO_PERMISSION');
    if (!['coleader', 'officer', 'member', 'recruit'].includes(role)) throw new Error('BAD_ROLE');
    const target = await this.db.getClanMember(clanId, targetId);
    if (!target || target.role === 'leader') throw new Error('NOT_MEMBER');
    await this.db.updateClanMemberRole(clanId, targetId, role);
    this.clanPush(clanId, { t: 'clan_update' });
    return { ok: true };
  }
  async resolveJoinRequest(actor, clanId, userId, accept) {
    const membership = await this.db.getClanMembership(actor.id);
    if (!membership || membership.clanId !== clanId) throw new Error('NOT_IN_CLAN');
    if (!['leader', 'coleader', 'officer'].includes(membership.role)) throw new Error('NO_PERMISSION');
    await this.db.deleteJoinRequest(clanId, userId);
    if (accept) {
      const members = await this.db.listClanMembers(clanId);
      if (members.length >= CLAN_CONFIG.maxMembers) throw new Error('CLAN_FULL');
      await this.db.addClanMember({ clanId, userId, role: 'member' });
      this.notify(userId, { t: 'clan_joined', clanId });
      this.clanPush(clanId, { t: 'clan_update' });
    }
    return { ok: true };
  }
  async clanView(user) {
    const membership = await this.db.getClanMembership(user.id);
    if (!membership) return { clan: null };
    const clan = await this.db.getClan(membership.clanId);
    const members = await this.db.listClanMembers(membership.clanId);
    const detailed = [];
    for (const m of members) {
      const u = await this.db.getUserById(m.userId);
      if (u) detailed.push({
        userId: m.userId, username: u.username, trophies: u.trophies, role: m.role,
        presence: this.presenceOf(m.userId), joinedAt: m.joinedAt,
      });
    }
    detailed.sort((a, b) => b.trophies - a.trophies);
    const requests = ['leader', 'coleader', 'officer'].includes(membership.role)
      ? await this.db.listJoinRequests(membership.clanId) : [];
    const reqUsers = [];
    for (const r of requests) {
      const u = await this.db.getUserById(r.userId);
      if (u) reqUsers.push({ userId: r.userId, username: u.username, trophies: u.trophies });
    }
    const war = await this.db.getWarState(periodKeys().weekly);
    return {
      clan, role: membership.role, members: detailed, joinRequests: reqUsers,
      war: { week: war.week, score: war.clans[membership.clanId] ?? { matches: 0, wins: 0, points: 0 } },
    };
  }
  async clanLeaderboard() {
    const clans = await this.db.listClans();
    const out = [];
    for (const c of clans.slice(0, 50)) {
      const members = await this.db.listClanMembers(c.id);
      out.push({ id: c.id, name: c.name, tag: c.tag, trophies: c.trophies, level: c.level, xp: c.xp, members: members.length });
    }
    return out;
  }
  async searchClans(q) {
    const clans = await this.db.listClans();
    const ql = q.toLowerCase();
    return clans.filter(c => c.name.toLowerCase().includes(ql) || c.tag.toLowerCase().includes(ql)).slice(0, 20)
      .map(c => ({ id: c.id, name: c.name, tag: c.tag, level: c.level, trophies: c.trophies, open: c.open }));
  }
  clanPush(clanId, msg) {
    // broadcast to clan member sockets
    this.db.listClanMembers?.(clanId)?.then?.(async (members) => {
      for (const m of members) this.notify(m.userId, msg);
    }) ?? null;
  }

  // ---------- chat ----------
  async chatMessage(user, { channel, channelId, text }) {
    const cfgMs = 1200;
    if (!rateLimit(`chat:${user.id}`, 1, cfgMs)) throw new Error('CHAT_RATE');
    if (user.muted_until && new Date(user.muted_until).getTime() > Date.now()) throw new Error('MUTED');
    const clean = filterText(text);
    if (!clean) throw new Error('EMPTY');
    const msg = { channel, channelId: channelId ?? '', userId: user.id, username: user.username, text: clean, createdAt: new Date().toISOString() };
    await this.db.saveMessage(msg);
    return msg;
  }
  async chatHistory(channel, channelId) {
    return this.db.getMessages(channel, channelId, 40);
  }

  // ---------- notifications ----------
  notify(userId, msg) {
    this.rm.sendTo(userId, msg);
  }
}
