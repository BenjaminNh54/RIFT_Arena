// RIFT ARENA — matchmaking: per-mode queues, rating windows, bot fill (normal only), parties
import { randomUUID } from 'node:crypto';
import { FIGHTER_MAP, BOT_NAMES } from '../../../shared/definitions/fighters.js';
import { MAPS_READY } from '../../../shared/definitions/maps.js';
import { MODE_MAP } from '../../../shared/definitions/modes.js';

export class Matchmaker {
  constructor(roomManager, config) {
    this.rm = roomManager;
    this.config = config;
    this.queues = new Map(); // `${mode}:${ranked ? 1 : 0}` -> Map<userId, entry>
    setInterval(() => this.process(), 1000).unref();
    this.usedBotNames = new Set();
  }

  queueKey(mode, ranked) { return `${mode}:${ranked ? 1 : 0}`; }

  async join(user, { mode, ranked = false, partyId = null, event = null }) {
    if (!MODE_MAP[mode]) throw new Error('UNKNOWN_MODE');
    if (this.rm.userRoom?.has(user.id)) {
      const active = this.rm.roomOf(user.id);
      if (active && active.status === 'ended') {
        // salle déjà terminée (nettoyage imminente): libère le joueur tout de suite
        this.rm.userRoom.delete(user.id);
      } else if (active && (active.status === 'running' || active.status === 'countdown')) {
        // refresh/reconnexion en pleine partie: re-pousse match_found pour rebrancher le client
        const ent = active.ents.get(`p_${user.id}`);
        console.log('[mm] RECONNEXION re-proposee ->', active.id, active.status);
        this.rm.sendTo(user.id, {
          t: 'match_found', roomId: active.id, mode: active.modeId, map: active.map.id,
          ranked: active.ranked, team: ent?.team ?? 'A',
          event: active.event ? { id: active.event.id, name: active.event.name } : null,
        });
        return { position: 0, queueSize: 0, timeoutMs: 0, reconnecting: true };
      } else {
        throw new Error('ALREADY_IN_MATCH');
      }
    }
    // one queue per player: joining a queue leaves every other one
    for (const q of this.queues.values()) q.delete(user.id);
    const key = this.queueKey(mode, ranked);
    if (!this.queues.has(key)) this.queues.set(key, new Map());
    const q = this.queues.get(key);
    const cfg = await this.config();
    const entry = {
      userId: user.id, name: user.username, fighterId: user.selectedFighter ?? 'volt',
      trophies: user.trophies, rp: user._rp ?? 0, partyId, event,
      joinedAt: q.get(user.id)?.joinedAt ?? Date.now(), // re-click does not reset the wait timer
      rankMode: ranked, map: user.selectedMap ?? null,
    };
    q.set(user.id, entry);
    // merge whole party
    return { position: this.positionOf(key, user.id), queueSize: q.size, timeoutMs: cfg['matchmaking.timeout_ms'] ?? 20000 };
  }

  positionOf(key, userId) {
    const q = this.queues.get(key);
    if (!q?.has(userId)) return 0;
    const order = [...q.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    return order.findIndex(e => e.userId === userId) + 1;
  }

  // real per-player queue state — consumed by GET /api/queue/state
  stateOf(userId) {
    for (const [key, q] of this.queues) {
      const e = q.get(userId);
      if (!e) continue;
      const [mode, rankedStr] = key.split(':');
      return {
        inQueue: true, mode, ranked: rankedStr === '1',
        position: this.positionOf(key, userId), queueSize: q.size,
        partyId: e.partyId ?? null,
        event: e.event ? { id: e.event.id, name: e.event.name } : null,
        waitMs: Date.now() - e.joinedAt,
      };
    }
    return { inQueue: false, mode: null, ranked: false, position: 0, queueSize: 0, partyId: null, event: null, waitMs: 0 };
  }

  cancel(userId) {
    for (const q of this.queues.values()) q.delete(userId);
  }

  size(mode, ranked) { return this.queues.get(this.queueKey(mode, ranked))?.size ?? 0; }

  // pick map for mode: user-preferred official map or random compatible
  pickMap(mode, preferred = null) {
    const compatible = MAPS_READY.filter(m => m.modes.includes(mode));
    if (preferred) {
      const p = compatible.find(m => m.id === preferred);
      if (p) return p;
    }
    return compatible[Math.floor(Math.random() * compatible.length)] ?? MAPS_READY[0];
  }

  process() {
    for (const [key, q] of this.queues) {
      if (q.size === 0) continue;
      const [mode, rankedStr] = key.split(':');
      const ranked = rankedStr === '1';
      const def = MODE_MAP[mode];
      const teamSize = def.teamSize ?? 3;
      const need = def.type === 'ffa' ? (def.players ?? 8) : def.type === 'coop' ? teamSize : teamSize * 2;
      const now = Date.now();
      // grow rating window with wait time
      const entries = [...q.values()].sort((a, b) => (ranked ? a.rp - b.rp : a.trophies - b.trophies));

      // group parties first
      const parties = new Map();
      const singles = [];
      for (const e of entries) {
        if (e.partyId) {
          if (!parties.has(e.partyId)) parties.set(e.partyId, []);
          parties.get(e.partyId).push(e);
        } else singles.push(e);
      }

      // ranked: rating window anchored on the longest-waiting player, widens 25 RP/s,
      // unlimited after 25s — a real match eventually forms without bots (applied BEFORE assembly)
      if (ranked) {
        const byWait = [...entries].sort((a, b) => a.joinedAt - b.joinedAt);
        const anchorRp = byWait[0]?.rp ?? 0;
        const eligible = (e) => (now - e.joinedAt) > 25000
          || Math.abs(e.rp - anchorRp) <= 250 + Math.floor((now - e.joinedAt) / 1000) * 25;
        for (const [pid, list] of [...parties]) {
          if (!list.every(eligible)) parties.delete(pid);
        }
        for (let i = singles.length - 1; i >= 0; i--) if (!eligible(singles[i])) singles.splice(i, 1);
      }

      // try to assemble `need` humans
      const group = [];
      for (const [, list] of parties) {
        if (group.length + list.length <= need) group.push(...list);
      }
      for (const e of singles) {
        if (group.length >= need) break;
        group.push(e);
      }

      const enough = group.length >= need;
      const oldestWait = group.length ? Math.min(...group.map(e => now - e.joinedAt)) : 0;
      const canFillBots = !ranked && def.type !== 'ffa';
      const waitOver = oldestWait > 8000; // after 8s, allow bot fill in normal queue

      if (!enough && !(canFillBots && waitOver && group.length > 0)) continue;

      const selected = group.slice(0, need);
      for (const e of selected) q.delete(e.userId);
      this.spawnMatch(mode, ranked, def, selected, need);
    }
  }

  spawnMatch(mode, ranked, def, humans, need) {
    const roomId = randomUUID().slice(0, 8);
    const map = this.pickMap(mode, humans.find(h => h.map)?.map);
    const room = this.rm.createRoom({
      id: roomId, mode, map, ranked,
      modifiers: humans[0]?.event?.modifiers ?? {},
      event: humans[0]?.event ?? null,
    });

    // team assignment: parties stay together, singles are rating-snake-drafted around them
    const teamSize = def.teamSize ?? 3;
    let sideA = [], sideB = [];
    if (def.type === 'ffa') {
      humans.forEach((h, i) => sideA.push({ ...h, team: `F${i}` }));
    } else if (def.type === 'coop') {
      humans.forEach(h => sideA.push({ ...h, team: 'A' }));
    } else {
      // 1) whole parties onto one side (largest first)
      const parties = new Map();
      const singles = [];
      for (const h of humans) {
        if (h.partyId) {
          if (!parties.has(h.partyId)) parties.set(h.partyId, []);
          parties.get(h.partyId).push(h);
        } else singles.push(h);
      }
      const partyGroups = [...parties.values()].sort((a, b) => b.length - a.length);
      for (const g of partyGroups) {
        const side = sideA.length <= sideB.length ? sideA : sideB;
        for (const h of g) {
          if (side.length < teamSize) side.push({ ...h, team: side === sideA ? 'A' : 'B' });
          else singles.push(h);
        }
      }
      // 2) singles: snake draft onto the emptier side
      const sorted = singles.sort((a, b) => (ranked ? a.rp - b.rp : a.trophies - b.trophies));
      for (const h of sorted) {
        if (sideA.length <= sideB.length && sideA.length < teamSize) sideA.push({ ...h, team: 'A' });
        else if (sideB.length < teamSize) sideB.push({ ...h, team: 'B' });
        else if (sideA.length < teamSize) sideA.push({ ...h, team: 'A' });
      }
    }

    const placed = [...sideA, ...sideB];
    for (const h of placed) {
      const ent = room.addHuman(h.userId, h.name, h.team, h.fighterId);
      this.rm.userRoom.set(h.userId, roomId);
      console.log('[mm] NOUVELLE SALLE ->', roomId);
      this.rm.sendTo(h.userId, {
        t: 'match_found', roomId, mode, map: map.id, ranked, team: h.team,
        event: h.event ? { id: h.event.id, name: h.event.name } : null,
      });
    }

    // bot fill for normals (never ranked; bots clearly labeled)
    if (def.type !== 'ffa' && !ranked) {
      const fillA = def.type === 'coop' ? 0 : teamSize - sideA.length;
      const fillB = def.type === 'coop' ? 0 : teamSize - sideB.length;
      for (let i = 0; i < fillA; i++) room.addBot(this.botName(), 'A', this.randomFighter());
      for (let i = 0; i < fillB; i++) room.addBot(this.botName(), 'B', this.randomFighter());
    }
    if (def.type === 'ffa') {
      const fill = (def.players ?? 8) - placed.length;
      for (let i = 0; i < fill; i++) {
        const team = `F${placed.length + i}`;
        room.addBot(this.botName(), team, this.randomFighter());
      }
    }
    if (def.type === 'coop') {
      // coop: fill to 3 humans total with bots if needed
      const fill = teamSize - placed.length;
      for (let i = 0; i < fill; i++) room.addBot(this.botName(), 'A', this.randomFighter());
    }

    this.rm.startMatch(room);
  }

  botName() {
    let name;
    let tries = 0;
    do {
      name = 'BOT ' + BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + (tries > 8 ? `-${Math.floor(Math.random() * 99)}` : '');
      tries++;
    } while (this.usedBotNames.has(name) && tries < 20);
    this.usedBotNames.add(name);
    return name;
  }

  randomFighter() {
    const ids = Object.keys(FIGHTER_MAP);
    return ids[Math.floor(Math.random() * ids.length)];
  }
}
