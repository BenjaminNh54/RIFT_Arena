// RIFT ARENA — room manager: central game loop, snapshot broadcast, match completion
import { GAME } from '../../../shared/constants.js';
import { GameRoom } from './engine.js';
import { runBots } from './bots.js';

const nowMs = () => Date.now();

export class RoomManager {
  constructor(db, systems, config) {
    this.db = db;
    this.systems = systems;
    this.config = config;
    this.rooms = new Map();          // roomId -> room
    this.sockets = new Map();        // userId -> Set<ws> (all sockets of a user)
    this.userRoom = new Map();       // userId -> roomId (reconnection support)
    this.resultsOf = new Map();      // roomId -> results (for late-arriving clients)
    setInterval(() => this.loop(), GAME.TICK_MS).unref();
    // cleanup stale ended rooms
    setInterval(() => this.sweep(), 5000).unref();
    this._sweepAt = new Map();
  }

  createRoom(opts) {
    const room = new GameRoom({
      ...opts,
      config: this.config,
      onFinish: (r, results) => this.onFinish(r, results),
    });
    this.rooms.set(room.id, room);
    return room;
  }

  attachSocket(userId, ws) {
    if (!this.sockets.has(userId)) this.sockets.set(userId, new Set());
    this.sockets.get(userId).add(ws);
    ws._userId = userId;
    // reconnection: if the user belongs to a live room, rebind and welcome again
    const roomId = this.userRoom.get(userId);
    if (roomId && this.rooms.has(roomId)) {
      const room = this.rooms.get(roomId);
      const ent = room.ents.get(`p_${userId}`);
      if (ent) ent.disconnected = false;
      ws.send(JSON.stringify({ t: 'joined', roomId, mode: room.modeId, map: room.map.id, status: room.status }));
      if (this.resultsOf.has(roomId) && room.status === 'ended') {
        ws.send(JSON.stringify({ t: 'end', results: this.resultsOf.get(roomId) }));
      }
    }
  }

  detachSocket(userId, ws) {
    this.sockets.get(userId)?.delete(ws);
    const room = this.roomOf(userId);
    if (room) {
      const ent = room.ents.get(`p_${userId}`);
      if (ent && this.sockets.get(userId)?.size === 0) ent.disconnected = true;
    }
  }

  roomOf(userId) {
    const roomId = this.userRoom.get(userId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  sendTo(userId, msg) {
    const set = this.sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) { try { ws.send(data); } catch { /* dropped */ } }
  }

  broadcast(room, msg) {
    const data = JSON.stringify(msg);
    for (const ent of room.ents.values()) {
      if (ent.kind !== 'player' || !ent.userId) continue;
      const set = this.sockets.get(ent.userId);
      if (!set) continue;
      for (const ws of set) { try { ws.send(data); } catch { /* dropped */ } }
    }
  }

  startMatch(room) {
    if (room.status !== 'lobby') return;
    room.status = 'countdown';
    room.countdown = 3200;
    this.broadcast(room, { t: 'start', map: room.map.id, mode: room.modeId, ranked: room.ranked });
  }

  loop() {
    for (const room of this.rooms.values()) {
      try {
        if (room.status === 'running' || room.status === 'countdown') {
          if (room.status === 'running') runBots(room);
          room.tick();
          if (room.status === 'ended') continue;
          if (room.shouldSendSnapshot()) this.broadcast(room, room.snapshot());
          if (room.fxBuffer.length) {
            this.broadcast(room, { t: 'fx', list: room.fxBuffer.splice(0, room.fxBuffer.length) });
          }
        }
      } catch (e) {
        console.error(`[room ${room.id}] tick error:`, e);
        // fail loud in dev, but never kill the loop
      }
    }
  }

  async onFinish(room, results) {
    this.resultsOf.set(room.id, results);
    try {
      await this.systems.finishMatch(room, results);
    } catch (e) {
      console.error('[rooms] finishMatch failed:', e);
    }
    this.broadcast(room, { t: 'end', results });
    this._sweepAt.set(room.id, nowMs() + 12000);
  }

  sweep() {
    const t = nowMs();
    for (const room of this.rooms.values()) {
      // drop rooms with no humans that never started
      if (room.status === 'lobby' && room.humanCount === 0 && (this._sweepAt.get(room.id) ?? t) <= t) {
        this.rooms.delete(room.id);
        this._sweepAt.delete(room.id);
        continue;
      }
      // une partie sans aucun humain (déconnexions/abandons) se termine proprement:
      // sinon les bots jouaient jusqu'au bout du timer et le joueur restait verrouillé
      // (ALREADY_IN_MATCH) jusqu'à la fin naturelle du match
      if ((room.status === 'running' || room.status === 'countdown') && room.humanCount === 0) {
        try { room.finish(null); } catch { /* déjà finie */ }
        continue;
      }
      const deadline = this._sweepAt.get(room.id);
      if (room.status === 'ended' && deadline && t > deadline) {
        this.rooms.delete(room.id);
        this._sweepAt.delete(room.id);
        this.resultsOf.delete(room.id);
        for (const [uid, rid] of this.userRoom) if (rid === room.id) this.userRoom.delete(uid);
      }
    }
  }

  leaveRoom(userId) {
    const room = this.roomOf(userId);
    if (!room) return;
    const ent = room.ents.get(`p_${userId}`);
    if (ent) ent.disconnected = true;
    this.userRoom.delete(userId);
    if (room.status === 'lobby') {
      room.ents.delete(`p_${userId}`);
      room.humanCount--;
    } else if (room.status === 'running' || room.status === 'countdown') {
      // abandon/reconnexion pendant une partie: le joueur part vraiment —
      // sinon humanCount restait à son niveau et la room tournait avec un fantôme
      room.humanCount = Math.max(0, room.humanCount - 1);
    }
    if (room.humanCount === 0 && room.status !== 'running') {
      room.status = 'ended';
      this.rooms.delete(room.id);
    }
  }
}
