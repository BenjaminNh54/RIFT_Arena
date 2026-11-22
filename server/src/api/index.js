// RIFT ARENA — REST API: auth, profile, progression, shop, social, maps, admin surface
import { CONFIG } from '../config/index.js';
import { rateLimit } from '../security/index.js';
import { validateMapData, validateObjectives, sanitizeText } from '../../../shared/validators/index.js';
import { FIGHTERS, FIGHTER_MAP } from '../../../shared/definitions/fighters.js';
import { MAPS_READY } from '../../../shared/definitions/maps.js';
import { MODES } from '../../../shared/definitions/modes.js';
import { TROPHY_ROAD, BATTLE_PASS } from '../../../shared/game-config/defaults.js';
import { leagueForRp } from '../../../shared/definitions/modes.js';
import { randomUUID } from 'node:crypto';

const COOKIE = 'ra_session';

function parseCookies(req) {
  const header = req.headers.cookie ?? '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function tokenFrom(req) {
  const cookies = parseCookies(req);
  if (cookies[COOKIE]) return cookies[COOKIE];
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function setSessionCookie(res, token, expiresAt) {
  const exp = new Date(expiresAt).toUTCString();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Expires=${exp}${CONFIG.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// CSRF defense: state-changing requests must be same-origin or XHR-marked
function csrfOk(req) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch { return false; }
  }
  // non-browser clients (tests) send no Origin — require the XHR marker
  return req.headers['x-requested-with'] === 'rift-arena';
}

export function createApi(ctx) {
  const { auth, db, social, economy, rewards, matchmaker, rooms, admin, getConfig } = ctx;

  return async function handleApi(req, res, pathname) {
    const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '0').split(',')[0].trim();
    const method = req.method;
    let body = {};
    if (method === 'POST' || method === 'PUT') {
      body = await readBody(req, 64000);
    }

    // ---- public: catalog ----
    if (method === 'GET' && pathname === '/api/game/data') {
      return json(res, 200, {
        fighters: FIGHTERS, maps: MAPS_READY.map(m => ({
          id: m.id, name: m.name, theme: m.theme, desc: m.desc, width: m.width, height: m.height,
          modes: m.modes, official: m.official,
        })),
        modes: MODES, trophyRoad: TROPHY_ROAD, passMeta: {
          tiers: BATTLE_PASS.tiers, xpPerTier: BATTLE_PASS.xpPerTier, name: BATTLE_PASS.name,
          premiumPrice: BATTLE_PASS.premiumPrice, season: BATTLE_PASS.season,
        },
        serverTime: Date.now(),
      });
    }

    // ---- auth ----
    if (pathname === '/api/auth/register' && method === 'POST') {
      if (!rateLimit(`reg:${ip}`, parseInt(process.env.RATE_LIMIT_REGISTER ?? '8', 10), 600000)) return json(res, 429, { error: 'RATE_LIMIT' });
      if (!csrfOk(req)) return json(res, 403, { error: 'CSRF' });
      try {
        const user = await auth.register(body.username, body.password, ip, body.adminCode);
        const { token, expiresAt } = await issueSession(auth, user, db);
        setSessionCookie(res, token, expiresAt);
        return json(res, 200, { ok: true, token, profile: await auth.profile(user) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      if (!rateLimit(`login:${ip}`, 15, 60000)) return json(res, 429, { error: 'RATE_LIMIT' });
      if (!csrfOk(req)) return json(res, 403, { error: 'CSRF' });
      try {
        const { user, token, expiresAt } = await auth.login(body.username, body.password, ip);
        setSessionCookie(res, token, expiresAt);
        return json(res, 200, { ok: true, token, profile: await auth.profile(user) });
      } catch (e) {
        const banned = e.message.startsWith('BANNED');
        return json(res, banned ? 403 : 401, { error: banned ? e.message : e.message });
      }
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      await auth.logout(tokenFrom(req));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/admin-upgrade' && method === 'POST') {
      if (!csrfOk(req)) return json(res, 403, { error: 'CSRF' });
      try {
        const user = await auth.adminUpgrade(body.username, body.password, body.adminCode, ip);
        return json(res, 200, { ok: true, role: user.role });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/auth/bootstrap-admin' && method === 'POST') {
      if (!csrfOk(req)) return json(res, 403, { error: 'CSRF' });
      try {
        const user = await auth.bootstrapAdmin(body.username, body.password, body.bootstrapKey, ip);
        return json(res, 200, { ok: true, role: user.role });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // ---- everything below requires auth ----
    const token = tokenFrom(req);
    const user = await auth.resolveToken(token);
    if (!user) return json(res, 401, { error: 'AUTH_REQUIRED' });
    if (!csrfOk(req)) return json(res, 403, { error: 'CSRF' });

    const sanctions = await db.activeSanctions(user.id);
    if (sanctions.some(s => s.type === 'ban')) return json(res, 403, { error: 'BANNED' });

    const cfg = await getConfig();
    if (cfg['maintenance'] && user.role === 'player') {
      return json(res, 503, { error: 'MAINTENANCE' });
    }

    // ---- me / profile ----
    if (method === 'GET' && pathname === '/api/me') {
      return json(res, 200, { profile: await auth.profile(user) });
    }
    if (pathname === '/api/me/select' && method === 'POST') {
      const fid = String(body.fighterId ?? '');
      const owned = await db.getFighters(user.id);
      if (!owned[fid]?.unlocked) return json(res, 400, { error: 'NOT_OWNED' });
      await db.updateUser(user.id, { selected_fighter: fid });
      return json(res, 200, { ok: true, selected: fid });
    }
    if (pathname === '/api/me/cosmetics' && method === 'POST') {
      const patch = {};
      if (typeof body.avatar === 'string' && body.avatar.length < 40) patch.avatar = sanitizeText(body.avatar, 40);
      if (typeof body.banner === 'string' && body.banner.length < 40) patch.banner = sanitizeText(body.banner, 40);
      if (typeof body.title === 'string' && body.title.length < 40) {
        const owned = await db.hasItem(user.id, 'title', body.title);
        if (!owned) return json(res, 400, { error: 'TITLE_NOT_OWNED' });
        patch.title = sanitizeText(body.title, 40);
      }
      if (body.privacy === 'public' || body.privacy === 'private') patch.privacy = body.privacy;
      if (typeof body.favorite_fighter === 'string' && FIGHTER_MAP[body.favorite_fighter]) patch.favorite_fighter = body.favorite_fighter;
      if (body.skinId && typeof body.skinId === 'string') {
        // per-fighter equipped skin
        const [fid] = body.skinId.split('/');
        if (await db.hasItem(user.id, 'skin', body.skinId.split('/')[1])) {
          patch.favorite_fighter = fid;
        }
      }
      await db.updateUser(user.id, patch);
      return json(res, 200, { profile: await auth.profile(await db.getUserById(user.id)) });
    }

    // ---- fighters collection ----
    if (method === 'GET' && pathname === '/api/fighters') {
      const owned = await db.getFighters(user.id);
      const skins = (await db.getInventory(user.id, 'skin')).map(s => s.refId);
      return json(res, 200, {
        fighters: FIGHTERS.map(f => ({
          ...f,
          owned: !!owned[f.id]?.unlocked,
          trophies: owned[f.id]?.trophies ?? 0,
          xp: owned[f.id]?.xp ?? 0,
          level: owned[f.id]?.level ?? 1,
          selected: user.selected_fighter === f.id,
          ownedSkins: f.skins.filter(s => skins.includes(s.id)).map(s => s.id),
        })),
      });
    }

    // ---- matchmaking ----
    if (pathname === '/api/queue' && method === 'POST') {
      if (!rateLimit(`q:${user.id}`, 10, 30000)) return json(res, 429, { error: 'RATE_LIMIT' });
      try {
        const party = social.partyOf(user.id);
        if (party && party.leaderId !== user.id && party.mode) {
          body.mode = party.mode; // party leader decides
        }
        const res2 = await matchmaker.join(user, {
          mode: String(body.mode ?? 'crystal_rush'),
          ranked: !!body.ranked,
          partyId: party?.id ?? null,
          event: body.eventId ? { id: body.eventId, name: body.eventName, modifiers: body.modifiers ?? {}, map: body.map ?? null } : null,
        });
        return json(res, 200, { ok: true, ...res2 });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (pathname === '/api/queue' && method === 'DELETE') {
      matchmaker.cancel(user.id);
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && pathname === '/api/queue/state') {
      // real per-player state from the matchmaker — never a queue-wide approximation
      const qs = matchmaker.stateOf(user.id);
      return json(res, 200, {
        ...qs,
        inRoom: rooms.roomOf(user.id)?.id ?? null,
        sizes: Object.fromEntries(MODES.map(m => [m.id, matchmaker.size(m.id, false)])),
      });
    }

    // ---- trophy road ----
    if (method === 'GET' && pathname === '/api/road') {
      const claimed = (await db.getInventory(user.id, 'road')).map(i => i.refId);
      return json(res, 200, {
        trophies: user.trophies,
        steps: TROPHY_ROAD.map(s => ({ ...s, claimed: claimed.includes(String(s.at)) })),
        history: await db.getTrophyLog(user.id, 20),
      });
    }

    // ---- ranked ----
    if (method === 'GET' && pathname === '/api/ranked') {
      const season = await db.getSeason();
      const rp = (season ? (await db.getRankedPlayer(user.id, season.id))?.rp : 0) ?? 0;
      const league = leagueForRp(rp);
      const top = season ? await db.topRanked(season.id, 25) : [];
      return json(res, 200, {
        season: season ? { id: season.id, name: season.name, endsAt: season.endsAt } : null,
        rp, league: { id: league.league.id, name: league.league.name, color: league.league.color, division: league.division, divProgress: league.divProgress },
        leaderboard: top.map(r => ({ username: r.username, rp: r.rp, wins: r.wins, losses: r.losses })),
        me: await db.getRankedPlayer(user.id, season?.id ?? 'none'),
      });
    }

    // ---- missions / pass / shop / chests ----
    if (method === 'GET' && pathname === '/api/missions') {
      return json(res, 200, await economy.missionsState(user));
    }
    if (pathname === '/api/missions/claim' && method === 'POST') {
      try {
        const out = await economy.claimMission(user, String(body.period), String(body.id));
        return json(res, 200, { ok: true, ...out, wallets: await economy.refWallet(user.id) });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (method === 'GET' && pathname === '/api/pass') {
      return json(res, 200, await economy.passState(user));
    }
    if (pathname === '/api/pass/claim' && method === 'POST') {
      try {
        const out = await economy.claimPassTier(user, parseInt(body.tier, 10), body.track === 'premium' ? 'premium' : 'free');
        return json(res, 200, { ok: true, ...out });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/pass/premium' && method === 'POST') {
      try { return json(res, 200, await economy.buyPremium(user)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (method === 'GET' && pathname === '/api/shop') {
      return json(res, 200, await economy.shopState(user));
    }
    if (pathname === '/api/shop/buy' && method === 'POST') {
      try { return json(res, 200, await economy.purchase(user, String(body.itemId))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/shop/chest' && method === 'POST') {
      try { return json(res, 200, await economy.openChest(user, String(body.chestId))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- events / news ----
    if (method === 'GET' && pathname === '/api/events') {
      const events = (await db.listEvents()).filter(e => e.status !== 'archived');
      const t = Date.now();
      const enriched = [];
      for (const ev of events) {
        const live = ev.status === 'active' && (!ev.endAt || new Date(ev.endAt).getTime() > t) && (!ev.startAt || new Date(ev.startAt).getTime() <= t);
        const prog = await db.getEventProgress(user.id, ev.id);
        enriched.push({ ...ev, live, myProgress: prog?.progress ?? 0, myClaimed: prog?.claimed ?? false });
      }
      return json(res, 200, { events: enriched });
    }
    if (pathname.startsWith('/api/events/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const ev = await db.getEvent(id);
      if (!ev) return json(res, 404, { error: 'NOT_FOUND' });
      const prog = await db.getEventProgress(user.id, ev.id);
      return json(res, 200, { event: { ...ev, myProgress: prog?.progress ?? 0, myClaimed: prog?.claimed ?? false } });
    }
    if (pathname === '/api/events/claim' && method === 'POST') {
      const ev = await db.getEvent(String(body.eventId));
      if (!ev) return json(res, 404, { error: 'NOT_FOUND' });
      const prog = await db.getEventProgress(user.id, ev.id);
      if (!prog || prog.claimed) return json(res, 400, { error: 'NOT_CLAIMABLE' });
      if (prog.progress < (ev.mission?.target ?? 1)) return json(res, 400, { error: 'INCOMPLETE' });
      await db.incrEventProgress(user.id, ev.id, { claimed: true });
      // reward: {credits} | {rift_tokens} | {title}
      const u = await db.getUserById(user.id);
      const r = ev.reward ?? {};
      if (r.credits) await db.updateUser(user.id, { credits: u.credits + r.credits });
      if (r.rift_tokens) await db.updateUser(user.id, { rift_tokens: u.rift_tokens + r.rift_tokens });
      if (r.title) await db.addItem(user.id, 'title', r.title);
      return json(res, 200, { ok: true, reward: r });
    }
    if (method === 'GET' && pathname === '/api/news') {
      return json(res, 200, { news: await db.listNews({ publishedOnly: true }) });
    }

    // ---- social: friends ----
    if (method === 'GET' && pathname === '/api/friends') {
      return json(res, 200, {
        friends: await social.friendsList(user.id),
        requests: await social.incomingRequests(user.id),
        presence: social.presenceOf(user.id),
      });
    }
    if (pathname === '/api/friends/request' && method === 'POST') {
      try { return json(res, 200, await social.sendFriendRequest(user.id, String(body.username))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/friends/resolve' && method === 'POST') {
      try { return json(res, 200, await social.resolveFriendRequest(user.id, String(body.from), !!body.accept)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/friends/remove' && method === 'POST') {
      return json(res, 200, await social.removeFriend(user.id, String(body.userId)));
    }
    if (pathname === '/api/friends/block' && method === 'POST') {
      return json(res, 200, await social.blockUser(user.id, String(body.userId)));
    }
    if (pathname === '/api/friends/unblock' && method === 'POST') {
      return json(res, 200, await social.unblockUser(user.id, String(body.userId)));
    }
    if (method === 'GET' && pathname === '/api/users/search') {
      const q = String(req.url.split('q=')[1] ?? '').replace(/[^\w-]/g, '');
      return json(res, 200, { users: q.length >= 2 ? await social.searchUsers(q, user.id) : [] });
    }

    // ---- party ----
    if (pathname === '/api/party' && method === 'POST') {
      const action = String(body.action ?? '');
      try {
        switch (action) {
          case 'create': {
            const party = social.createParty(user);
            return json(res, 200, { ok: true, party: partyView(social, party) });
          }
          case 'invite': {
            await social.inviteToParty(user, String(body.userId));
            return json(res, 200, { ok: true });
          }
          case 'join': {
            const party = social.joinParty(user.id, String(body.partyId));
            return json(res, 200, { ok: true, party: partyView(social, party) });
          }
          case 'leave': {
            social.leaveParty(user.id);
            return json(res, 200, { ok: true });
          }
          case 'kick': {
            social.kickFromParty(user.id, String(body.userId));
            return json(res, 200, { ok: true });
          }
          case 'mode': {
            const party = social.setPartyMode(user.id, String(body.mode));
            return json(res, 200, { ok: true, party: partyView(social, party) });
          }
          default: return json(res, 400, { error: 'BAD_ACTION' });
        }
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (method === 'GET' && pathname === '/api/party') {
      const party = social.partyOf(user.id);
      return json(res, 200, { party: party ? partyView(social, party) : null });
    }

    // ---- clans ----
    if (method === 'GET' && pathname === '/api/clans/mine') {
      return json(res, 200, await social.clanView(user));
    }
    if (method === 'GET' && pathname === '/api/clans/top') {
      return json(res, 200, { clans: await social.clanLeaderboard() });
    }
    if (pathname === '/api/clans/search' && method === 'GET') {
      const q = decodeURIComponent((req.url.split('q=')[1] ?? '').split('&')[0]);
      return json(res, 200, { clans: q.length >= 2 ? await social.searchClans(q) : [] });
    }
    if (pathname === '/api/clans' && method === 'POST') {
      try {
        const clan = await social.createClan(user, { name: body.name, tag: body.tag, desc: body.desc, open: body.open });
        return json(res, 200, { ok: true, clan });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/clans/join' && method === 'POST') {
      try { return json(res, 200, await social.joinClan(user, String(body.clanId))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/clans/leave' && method === 'POST') {
      try { return json(res, 200, await social.leaveClan(user)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/clans/kick' && method === 'POST') {
      try { return json(res, 200, await social.kickMember(user, String(body.clanId), String(body.userId))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/clans/role' && method === 'POST') {
      try { return json(res, 200, await social.setRole(user, String(body.clanId), String(body.userId), String(body.role))); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (pathname === '/api/clans/requests/resolve' && method === 'POST') {
      try {
        return json(res, 200, await social.resolveJoinRequest(user, String(body.clanId), String(body.userId), !!body.accept));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- chat history ----
    if (pathname.startsWith('/api/chat/') && method === 'GET') {
      const [, , , channel, channelId = ''] = pathname.split('/');
      if (!['global', 'clan', 'party', 'private'].includes(channel)) return json(res, 400, { error: 'BAD_CHANNEL' });
      return json(res, 200, { messages: await social.chatHistory(channel, channelId) });
    }

    // ---- public profiles & match history ----
    if (pathname.startsWith('/api/users/') && method === 'GET') {
      const username = decodeURIComponent(pathname.split('/')[3]);
      const target = await db.getUserByUsername(username);
      if (!target) return json(res, 404, { error: 'NOT_FOUND' });
      const isSelf = target.id === user.id;
      if (target.privacy === 'private' && !isSelf && user.role === 'player') {
        return json(res, 200, { profile: { id: target.id, username: target.username, trophies: target.trophies, level: target.level, avatar: target.avatar, banner: target.banner, title: target.title, privacy: 'private', clan: (await db.getClanMembership(target.id)) ? { name: (await db.getClan((await db.getClanMembership(target.id)).clanId))?.name } : null } });
      }
      const membership = await db.getClanMembership(target.id);
      const clan = membership ? await db.getClan(membership.clanId) : null;
      const fighters = await db.getFighters(target.id);
      const topFighters = Object.entries(fighters).filter(([, v]) => v.unlocked).sort((a, b) => b[1].trophies - a[1].trophies).slice(0, 5);
      return json(res, 200, {
        profile: {
          id: target.id, username: target.username, trophies: target.trophies, level: target.level,
          xp: target.xp, avatar: target.avatar, banner: target.banner, title: target.title,
          matches: target.matches, wins: target.wins, losses: target.losses, kills: target.kills,
          playtime_s: target.playtime_s, favorite_fighter: target.favorite_fighter,
          privacy: target.privacy, clan: clan ? { id: clan.id, name: clan.name, tag: clan.tag } : null,
          topFighters: topFighters.map(([fid, v]) => ({ id: fid, trophies: v.trophies, level: v.level })),
        },
        matches: (await db.listMatchesByUser(target.id, 15)).map(m => ({
          mode: m.mode, map: m.map, fighter: m.fighter, kills: m.kills, deaths: m.deaths,
          damage: m.damage, won: !!m.won, trophiesDelta: m.trophies_delta, starPlayer: !!m.star_player, at: m.created_at,
        })),
        isSelf,
      });
    }
    if (method === 'GET' && pathname === '/api/matches/mine') {
      return json(res, 200, { matches: (await db.listMatchesByUser(user.id, 25)).map(m => ({
        mode: m.mode, map: m.map, fighter: m.fighter, kills: m.kills, deaths: m.deaths,
        damage: m.damage, won: !!m.won, trophiesDelta: m.trophies_delta, starPlayer: !!m.star_player, at: m.created_at,
      })) });
    }

    // ---- community maps ----
    if (pathname === '/api/maps' && method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const status = url.searchParams.get('status');
      const mine = url.searchParams.get('mine') === '1';
      const sort = url.searchParams.get('sort') ?? 'recent';
      const rows = await db.listMaps({
        status: mine ? null : (status ?? 'published'),
        authorId: mine ? user.id : null,
        sort,
        limit: 60,
      });
      return json(res, 200, { maps: rows });
    }
    if (pathname === '/api/maps' && method === 'POST') {
      if (!rateLimit(`map:${user.id}`, 12, 3600000)) return json(res, 429, { error: 'RATE_LIMIT' });
      const action = String(body.action ?? 'save');
      const map = body.map ?? {};
      const errors = validateMapData({
        name: map.name, grid: map.grid, spawns: map.spawns,
      });
      if (errors.length) return json(res, 400, { error: 'INVALID_MAP', errors });
      // ownership: an existing map id may only be overwritten by its author (or an ADMIN) —
      // a client cannot hijack someone else's map by posting its id
      const w = map.grid[0].length, hGrid = map.grid.length;
      let existing = null;
      if (map.id && typeof map.id === 'string' && map.id.length <= 40) existing = await db.getMap(map.id);
      if (existing && existing.authorId !== user.id && user.role !== 'ADMIN') {
        return json(res, 403, { error: 'NOT_YOUR_MAP' });
      }
      const obj = validateObjectives(map.objectives, w, hGrid);
      if (obj === null && map.objectives) return json(res, 400, { error: 'INVALID_OBJECTIVES' });
      // status: author edits keep the current status; explicit publish goes back to moderation
      let status = action === 'publish' ? 'pending' : 'draft';
      if (existing && action !== 'publish') status = existing.status === 'published' ? 'published' : existing.status;
      const doc = {
        id: existing ? existing.id : randomUUID(),
        name: sanitizeText(map.name, 32),
        desc: sanitizeText(map.desc ?? '', 200),
        theme: ['neon', 'dust', 'moss', 'core', 'frost', 'ember', 'sky', 'factory'].includes(map.theme) ? map.theme : 'neon',
        width: w, height: hGrid,
        grid: map.grid, spawns: map.spawns.slice(0, 16),
        modes: Array.isArray(map.modes) ? map.modes.filter(m => typeof m === 'string').slice(0, 6) : ['elimination'],
        objectives: obj ?? {},
        authorId: existing ? existing.authorId : user.id, // ownership is never reassigned by an id post
        authorName: existing ? existing.authorName : user.username,
        status,
        version: (existing?.version ?? 0) + 1,
      };
      const saved = await db.saveMap(doc);
      return json(res, 200, { ok: true, map: saved });
    }
    if (pathname.startsWith('/api/maps/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const map = await db.getMap(id);
      if (!map) return json(res, 404, { error: 'NOT_FOUND' });
      return json(res, 200, { map });
    }
    if (pathname.startsWith('/api/maps/') && pathname.endsWith('/like') && method === 'POST') {
      const id = pathname.split('/')[3];
      if (!rateLimit(`like:${user.id}`, 10, 3600000)) return json(res, 429, { error: 'RATE_LIMIT' });
      if (!await db.getMap(id)) return json(res, 404, { error: 'NOT_FOUND' });
      await db.likeMap(id);
      return json(res, 200, { ok: true });
    }
    if (pathname.startsWith('/api/maps/') && pathname.endsWith('/report') && method === 'POST') {
      const id = pathname.split('/')[3];
      const map = await db.getMap(id);
      if (!map) return json(res, 404, { error: 'NOT_FOUND' });
      await db.createReport({ id: randomUUID(), kind: 'map', targetId: id, byId: user.id, byName: user.username, reason: sanitizeText(body.reason ?? '', 200) });
      return json(res, 200, { ok: true });
    }

    // ---- reports (players can report) ----
    if (pathname === '/api/report' && method === 'POST') {
      if (!rateLimit(`rep:${user.id}`, 5, 3600000)) return json(res, 429, { error: 'RATE_LIMIT' });
      await db.createReport({
        id: randomUUID(), kind: sanitizeText(body.kind ?? 'player', 12),
        targetId: sanitizeText(body.targetId ?? '', 64), targetName: sanitizeText(body.targetName ?? '', 32),
        byId: user.id, byName: user.username, reason: sanitizeText(body.reason ?? '', 200),
      });
      return json(res, 200, { ok: true });
    }

    // ---- admin ----
    if (pathname.startsWith('/api/admin')) {
      return admin.handle(req, res, pathname, user, body, json, csrfOk);
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  };
}

async function issueSession(auth, user, db) {
  const { newSessionToken, hashToken } = await import('../security/index.js');
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await db.saveSession({ tokenHash: hashToken(token), userId: user.id, expiresAt });
  return { token, expiresAt };
}

function readBody(req, maxLen) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > maxLen) { resolve({}); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function partyView(social, party) {
  return { id: party.id, leaderId: party.leaderId, mode: party.mode, members: [...party.members] };
}
