// RIFT ARENA — admin API: dashboard, moderation, content management, server controls.
// Every action is permission-checked server-side and written to admin_logs.
import { hasPerm, ADMIN_ROLES, CONFIG_KEYS, EVENT_MODIFIERS } from '../../../shared/constants.js';
import { validateEventConfig, sanitizeText } from '../../../shared/validators/index.js';
import { FIGHTERS } from '../../../shared/definitions/fighters.js';
import { MODES } from '../../../shared/definitions/modes.js';
import { MAPS_READY } from '../../../shared/definitions/maps.js';
import { randomUUID } from 'node:crypto';

export class AdminApi {
  constructor(ctx) {
    this.db = ctx.db;
    this.getConfig = ctx.getConfig;
    this.setConfig = null; // wired below via database module
    this.rooms = ctx.rooms;
    this.matchmaker = ctx.matchmaker;
    this.social = ctx.social;
    this.economy = ctx.economy;
    this.announce = ctx.announce;
  }

  async log(user, action, target, details, result = 'ok') {
    await this.db.addAdminLog({ author: user.username, role: user.role, action, target: target ?? '', details: details ?? {}, result });
  }

  can(user, perm) { return hasPerm(user.role, perm); }

  denied(res, json) { return json(res, 403, { error: 'NO_PERMISSION' }); }

  async handle(req, res, pathname, user, body, json, csrfOk) {
    // role gate: only ADMIN / MODERATOR / HELPER
    if (!ADMIN_ROLES[user.role]) return this.denied(res, json);
    const method = req.method;
    const parts = pathname.split('/').slice(3); // after /api/admin

    try {
      // ---------- dashboard ----------
      if (method === 'GET' && parts[0] === 'dashboard') {
        if (!this.can(user, 'players.view')) return this.denied(res, json);
        const cfg = await this.getConfig();
        const totalAccounts = await this.db.countUsers();
        const recent = await this.db.listUsers({ limit: 8 });
        const queueSizes = {};
        for (const m of MODES) queueSizes[m.id] = this.matchmaker.size(m.id, false) + this.matchmaker.size(m.id, true);
        let matchesRunning = 0, humansInRooms = 0;
        for (const room of this.rooms.rooms.values()) {
          if (room.status === 'running' || room.status === 'countdown') matchesRunning++;
          humansInRooms += room.humans().length;
        }
        const connected = [...this.rooms.sockets.entries()].filter(([, set]) => set.size > 0).length;
        const openReports = (await this.db.listReports({ status: 'open' })).length;
        const events = (await this.db.listEvents()).filter(e => e.status === 'active').length;
        return json(res, 200, {
          connected, totalAccounts, matchesRunning, humansInRooms, queueSizes,
          eventsActive: events, openReports,
          recentUsers: recent.map(u => ({ id: u.id, username: u.username, trophies: u.trophies, role: u.role, createdAt: u.created_at ?? u.createdAt })),
          server: {
            maintenance: !!cfg['maintenance'],
            uptime: process.uptime(), memory: Math.round(process.memoryUsage().heapUsed / 1048576),
            node: process.version, db: this.db.kind ?? 'json',
          },
          config: cfg,
        });
      }

      // ---------- players ----------
      if (parts[0] === 'players') {
        if (!this.can(user, 'players.view')) return this.denied(res, json);
        if (method === 'GET' && parts.length === 1) {
          const q = decodeURIComponent((req.url.split('q=')[1] ?? '').split('&')[0]);
          const rows = await this.db.listUsers({ q, limit: 60 });
          return json(res, 200, { players: rows.map(pubUser) });
        }
        if (method === 'GET' && parts.length === 2) {
          const target = await this.db.getUserById(parts[1]);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          const sanctions = await this.db.activeSanctions(target.id);
          const history = await this.db.listMatchesByUser(target.id, 10);
          const fighters = await this.db.getFighters(target.id);
          return json(res, 200, { player: { ...pubUser(target), fighters }, sanctions, history });
        }
        if (method === 'POST' && parts[1] === 'ban') {
          if (!this.can(user, 'tempban')) return this.denied(res, json);
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          if (target.role !== 'player') return json(res, 403, { error: 'CANNOT_SANCTION_STAFF' });
          if (!body.confirm) return json(res, 400, { error: 'CONFIRM_REQUIRED' });
          const days = body.days ?? 0; // 0 = permanent (ADMIN only)
          if (days === 0 && !this.can(user, '*')) return this.denied(res, json);
          const until = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
          const s = await this.db.addSanction({ userId: target.id, type: 'ban', reason: sanitizeText(body.reason ?? '', 120), by: user.id, until });
          await this.log(user, `ban.${days > 0 ? 'temp' : 'perm'}`, target.username, { reason: body.reason, days });
          return json(res, 200, { ok: true, sanction: s });
        }
        if (method === 'POST' && parts[1] === 'unban') {
          if (!this.can(user, 'unban.own')) return this.denied(res, json);
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          const sanctions = await this.db.activeSanctions(target.id);
          for (const s of sanctions.filter(x => x.type === 'ban' && (this.can(user, '*') || x.by === user.id))) {
            await this.db.updateSanction(s.id, { status: 'revoked' });
          }
          await this.log(user, 'unban', target.username, {});
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'mute') {
          if (!this.can(user, 'mute')) return this.denied(res, json);
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          if (target.role !== 'player') return json(res, 403, { error: 'CANNOT_SANCTION_STAFF' });
          const minutes = Math.max(1, Math.min(43200, parseInt(body.minutes ?? 30, 10)));
          const until = new Date(Date.now() + minutes * 60000).toISOString();
          await this.db.addSanction({ userId: target.id, type: 'mute', reason: sanitizeText(body.reason ?? '', 120), by: user.id, until });
          await this.db.updateUser(target.id, { muted_until: until });
          await this.log(user, 'mute', target.username, { minutes, reason: body.reason });
          return json(res, 200, { ok: true, until });
        }
        if (method === 'POST' && parts[1] === 'unmute') {
          if (!this.can(user, 'mute')) return this.denied(res, json);
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          await this.db.updateUser(target.id, { muted_until: null });
          await this.log(user, 'unmute', target.username, {});
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'role') {
          if (!this.can(user, '*')) return this.denied(res, json);
          const role = String(body.role ?? '');
          if (!['player', ...Object.keys(ADMIN_ROLES)].includes(role)) return json(res, 400, { error: 'BAD_ROLE' });
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          if (target.id === user.id && role !== 'ADMIN') return json(res, 400, { error: 'CANNOT_DEMOTE_SELF' });
          await this.db.updateUser(target.id, { role });
          await this.log(user, 'set_role', target.username, { role });
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'reset') {
          if (!this.can(user, '*')) return this.denied(res, json);
          if (!body.confirm) return json(res, 400, { error: 'CONFIRM_REQUIRED' });
          const target = await this.db.getUserById(body.userId);
          if (!target) return json(res, 404, { error: 'NOT_FOUND' });
          await this.db.updateUser(target.id, { trophies: 0, xp: 0, level: 1, credits: 300, rift_tokens: 50 });
          await this.log(user, 'reset_progression', target.username, {});
          return json(res, 200, { ok: true });
        }
      }

      // ---------- reports ----------
      if (parts[0] === 'reports') {
        if (!this.can(user, 'reports.view')) return this.denied(res, json);
        if (method === 'GET') {
          const status = decodeURIComponent((req.url.split('status=')[1] ?? '').split('&')[0]) || null;
          return json(res, 200, { reports: await this.db.listReports({ status }) });
        }
        if (method === 'POST' && parts[1] === 'resolve') {
          if (!this.can(user, 'reports.resolve')) return this.denied(res, json);
          const rep = await this.db.updateReport(body.id, { status: 'resolved', resolution: sanitizeText(body.resolution ?? '', 200), resolvedBy: user.username });
          if (!rep) return json(res, 404, { error: 'NOT_FOUND' });
          await this.log(user, 'report_resolve', rep.targetName ?? rep.targetId, { resolution: body.resolution });
          return json(res, 200, { ok: true });
        }
      }

      // ---------- logs ----------
      if (parts[0] === 'logs' && method === 'GET') {
        if (!this.can(user, 'logs.view')) return this.denied(res, json);
        return json(res, 200, { logs: await this.db.listAdminLogs({ limit: 120 }) });
      }

      // ---------- matches ----------
      if (parts[0] === 'matches' && method === 'GET') {
        if (!this.can(user, 'matches.view')) return this.denied(res, json);
        const live = [...this.rooms.rooms.values()].filter(r => r.status === 'running' || r.status === 'countdown')
          .map(r => ({ id: r.id, mode: r.modeId, map: r.map.id, ranked: r.ranked, players: r.humans().length, bots: [...r.ents.values()].length - r.humans().length, status: r.status }));
        return json(res, 200, { live });
      }

      // ---------- config ----------
      if (parts[0] === 'config') {
        if (!this.can(user, '*')) return this.denied(res, json);
        if (method === 'GET') return json(res, 200, { config: await this.getConfig(), keys: CONFIG_KEYS });
        if (method === 'POST' && parts[1] === 'set') {
          const key = String(body.key ?? '');
          if (!CONFIG_KEYS.includes(key)) return json(res, 400, { error: 'BAD_KEY' });
          const value = body.value;
          if (typeof value === 'boolean') { /* ok */ }
          else if (typeof value !== 'number' || !Number.isFinite(value)) return json(res, 400, { error: 'BAD_VALUE' });
          await this.db.setConfig(key, value);
          await this.log(user, 'config_set', key, { value });
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'delete') {
          const key = String(body.key ?? '');
          if (!CONFIG_KEYS.includes(key)) return json(res, 400, { error: 'BAD_KEY' });
          await this.db.deleteConfig(key);
          await this.log(user, 'config_delete', key, {});
          return json(res, 200, { ok: true });
        }
      }

      // ---------- events builder ----------
      if (parts[0] === 'events') {
        if (!this.can(user, '*') && !this.can(user, 'news.view')) return this.denied(res, json);
        if (method === 'GET' && parts.length === 1) {
          return json(res, 200, { events: await this.db.listEvents() });
        }
        if (method === 'POST' && parts.length === 1) {
          if (!this.can(user, '*')) return this.denied(res, json);
          const ev = body.event ?? {};
          ev.id = ev.id ?? randomUUID();
          const errors = validateEventConfig(ev);
          if (errors.length) return json(res, 400, { error: 'INVALID_EVENT', errors });
          await this.db.upsertEvent(normalizeEvent(ev));
          await this.log(user, 'event_save', ev.name, { status: ev.status });
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'delete') {
          if (!this.can(user, '*')) return this.denied(res, json);
          await this.db.deleteEvent(String(body.id));
          await this.log(user, 'event_delete', String(body.id), {});
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'status') {
          if (!this.can(user, '*')) return this.denied(res, json);
          const status = String(body.status ?? '');
          if (!['draft', 'scheduled', 'active', 'paused', 'archived'].includes(status)) return json(res, 400, { error: 'BAD_STATUS' });
          const ev = await this.db.getEvent(String(body.id));
          if (!ev) return json(res, 404, { error: 'NOT_FOUND' });
          ev.status = status;
          await this.db.upsertEvent(ev);
          await this.log(user, 'event_status', ev.name, { status });
          return json(res, 200, { ok: true });
        }
      }

      // ---------- news ----------
      if (parts[0] === 'news') {
        if (!this.can(user, '*')) return this.denied(res, json);
        if (method === 'GET' && parts.length === 1) {
          return json(res, 200, { news: await this.db.listNews({ publishedOnly: false }) });
        }
        if (method === 'POST' && parts.length === 1) {
          const n = body.news ?? {};
          n.id = n.id ?? randomUUID();
          n.title = sanitizeText(n.title ?? '', 80);
          n.body = sanitizeText(n.body ?? '', 4000);
          n.category = ['Update', 'Patch', 'Combattant', 'Event', 'Maintenance', 'Annonce', 'Concours', 'Map', 'Modes'].includes(n.category) ? n.category : 'Annonce';
          n.priority = Math.max(0, Math.min(10, parseInt(n.priority ?? 5, 10) || 5));
          n.date = new Date().toISOString();
          n.published = !!n.published;
          n.author = user.username;
          if (!n.title || !n.body) return json(res, 400, { error: 'TITLE_AND_BODY_REQUIRED' });
          await this.db.upsertNews(n);
          await this.log(user, 'news_save', n.title, { published: n.published });
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'delete') {
          await this.db.deleteNews(String(body.id));
          await this.log(user, 'news_delete', String(body.id), {});
          return json(res, 200, { ok: true });
        }
      }

      // ---------- maps moderation ----------
      if (parts[0] === 'maps') {
        if (!this.can(user, '*')) return this.denied(res, json);
        if (method === 'GET' && parts.length === 1) {
          const status = decodeURIComponent((req.url.split('status=')[1] ?? '').split('&')[0]) || null;
          return json(res, 200, { maps: await this.db.listMaps({ status, limit: 100 }) });
        }
        if (method === 'POST' && parts[1] === 'validate') {
          const map = await this.db.getMap(String(body.id));
          if (!map) return json(res, 404, { error: 'NOT_FOUND' });
          const accept = !!body.accept;
          await this.db.updateMap(map.id, { status: accept ? 'published' : 'rejected' });
          await this.log(user, accept ? 'map_accept' : 'map_reject', map.name, {});
          return json(res, 200, { ok: true });
        }
        if (method === 'POST' && parts[1] === 'feature') {
          const map = await this.db.getMap(String(body.id));
          if (!map) return json(res, 404, { error: 'NOT_FOUND' });
          await this.db.updateMap(map.id, { status: 'published', featured: !!body.featured });
          await this.log(user, 'map_feature', map.name, { featured: !!body.featured });
          return json(res, 200, { ok: true });
        }
      }

      // ---------- fighters balance ----------
      if (parts[0] === 'fighters') {
        if (!this.can(user, '*')) return this.denied(res, json);
        if (method === 'GET') {
          const cfg = await this.getConfig();
          return json(res, 200, { fighters: FIGHTERS, overrides: cfg['fighters.overrides'] ?? {} });
        }
        if (method === 'POST' && parts[1] === 'override') {
          const fid = String(body.fighterId ?? '');
          if (!FIGHTERS.some(f => f.id === fid)) return json(res, 400, { error: 'BAD_FIGHTER' });
          const cfg = await this.getConfig();
          const overrides = { ...(cfg['fighters.overrides'] ?? {}) };
          const patch = {};
          for (const k of ['hpMult', 'damageMult', 'speedMult', 'reloadMult']) {
            if (typeof body[k] === 'number' && body[k] >= 0.5 && body[k] <= 2) patch[k] = body[k];
          }
          if (!Object.keys(patch).length) return json(res, 400, { error: 'NO_CHANGES' });
          overrides[fid] = { ...(overrides[fid] ?? {}), ...patch };
          await this.db.setConfig('fighters.overrides', overrides);
          await this.log(user, 'fighter_override', fid, patch);
          return json(res, 200, { ok: true, overrides });
        }
        if (method === 'POST' && parts[1] === 'clear') {
          const cfg = await this.getConfig();
          const overrides = { ...(cfg['fighters.overrides'] ?? {}) };
          delete overrides[String(body.fighterId)];
          await this.db.setConfig('fighters.overrides', overrides);
          await this.log(user, 'fighter_override_clear', String(body.fighterId), {});
          return json(res, 200, { ok: true });
        }
      }

      // ---------- server controls ----------
      if (parts[0] === 'server' && method === 'POST') {
        if (!this.can(user, '*')) return this.denied(res, json);
        const action = String(body.action ?? '');
        switch (action) {
          case 'maintenance': {
            await this.db.setConfig('maintenance', !!body.on);
            await this.log(user, 'maintenance', '', { on: !!body.on });
            return json(res, 200, { ok: true, maintenance: !!body.on });
          }
          case 'announce': {
            const text = sanitizeText(body.text ?? '', 200);
            if (!text) return json(res, 400, { error: 'TEXT_REQUIRED' });
            this.announce?.({ t: 'announcement', text, at: Date.now(), by: user.username });
            await this.log(user, 'announce', '', { text });
            return json(res, 200, { ok: true });
          }
          case 'toggle_mode': {
            const modeId = String(body.mode ?? '');
            if (!MODES.some(m => m.id === modeId)) return json(res, 400, { error: 'BAD_MODE' });
            const cfg = await this.getConfig();
            const disabled = { ...(cfg['modes.disabled'] ?? {}) };
            if (body.off) disabled[modeId] = true; else delete disabled[modeId];
            await this.db.setConfig('modes.disabled', disabled);
            await this.log(user, 'mode_toggle', modeId, { off: !!body.off });
            return json(res, 200, { ok: true });
          }
          case 'toggle_map': {
            const mapId = String(body.map ?? '');
            if (!MAPS_READY.some(m => m.id === mapId)) return json(res, 400, { error: 'BAD_MAP' });
            const cfg = await this.getConfig();
            const disabled = { ...(cfg['maps.disabled'] ?? {}) };
            if (body.off) disabled[mapId] = true; else delete disabled[mapId];
            await this.db.setConfig('maps.disabled', disabled);
            await this.log(user, 'map_toggle', mapId, { off: !!body.off });
            return json(res, 200, { ok: true });
          }
          case 'end_season': {
            const season = await this.db.getSeason();
            if (season) {
              await this.db.endSeason(season.id);
              await this.log(user, 'season_end', season.name, {});
            }
            const s2 = await this.db.ensureSeason({ id: randomUUID(), name: `Season ${new Date().toISOString().slice(0, 10)}` });
            return json(res, 200, { ok: true, season: s2 });
          }
          default: return json(res, 400, { error: 'BAD_ACTION' });
        }
      }

      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (e) {
      console.error('[admin]', e);
      return json(res, 500, { error: 'ADMIN_ERROR' });
    }
  }
}

function pubUser(u) {
  return {
    id: u.id, username: u.username, role: u.role, trophies: u.trophies, level: u.level,
    credits: u.credits, rift_tokens: u.rift_tokens, matches: u.matches, wins: u.wins,
    banned_until: u.banned_until ?? null, muted_until: u.muted_until ?? null,
    created_at: u.created_at ?? u.createdAt, last_seen: u.last_seen,
  };
}

function normalizeEvent(ev) {
  return {
    id: ev.id, name: ev.name, desc: ev.desc ?? '',
    status: ['draft', 'scheduled', 'active', 'paused', 'archived'].includes(ev.status) ? ev.status : 'draft',
    mode: ev.mode ?? 'crystal_rush', map: ev.map ?? null,
    modifiers: ev.modifiers ?? {},
    mission: ev.mission && typeof ev.mission === 'object' ? { metric: String(ev.mission.metric ?? 'matches'), target: Math.max(1, parseInt(ev.mission.target ?? 3, 10)), desc: sanitizeText(ev.mission.desc ?? '', 120) } : null,
    reward: ev.reward && typeof ev.reward === 'object' ? ev.reward : {},
    priority: Math.max(0, Math.min(10, parseInt(ev.priority ?? 5, 10) || 5)),
    banner: typeof ev.banner === 'string' ? ev.banner.slice(0, 9) : '#2f4a5a',
    accent: typeof ev.accent === 'string' ? ev.accent.slice(0, 9) : '#38bdf8',
    startAt: ev.startAt ?? null, endAt: ev.endAt ?? null,
  };
}
