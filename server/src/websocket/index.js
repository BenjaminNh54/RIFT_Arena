// RIFT ARENA — WebSocket gateway: auth handshake, rate limits, routing to rooms/chat/queue
import { rateLimit, checkWsMessage } from '../security/index.js';

export function attachGateway(wss, { auth, db, rooms, social, matchmaker, getConfig }) {
  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.authed = false;
    ws.user = null;
    ws._lastMsg = 0;

    ws.on('pong', () => { ws.isAlive = true; });

    // heartbeat: detect dead connections
    ws._hb = setInterval(() => {
      if (!ws.isAlive) { try { ws.terminate(); } catch { /* gone */ } return; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* gone */ }
    }, 15000);
    ws.on('close', () => {
      clearInterval(ws._hb);
      if (ws.user) {
        rooms.detachSocket(ws.user.id, ws);
        // last socket gone → drop the player from every matchmaking queue (no ghost queue)
        if (!(rooms.sockets.get(ws.user.id)?.size > 0)) matchmaker.cancel(ws.user.id);
      }
    });
    ws.on('error', () => { clearInterval(ws._hb); });

    ws.send(JSON.stringify({ t: 'welcome' }));

    ws.on('message', async (raw) => {
      ws.isAlive = true;
      // global rate limit: 60 msg/s per socket
      const nowMs = Date.now();
      if (nowMs - ws._lastMsg < 16) return; // >60/s → drop silently
      ws._lastMsg = nowMs;

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      msg = checkWsMessage(msg);
      if (!msg) return;

      // --- auth handshake required first ---
      if (!ws.authed) {
        if (msg.t !== 'auth' || typeof msg.token !== 'string') {
          ws.send(JSON.stringify({ t: 'error', code: 'AUTH_REQUIRED' }));
          if (msg.t !== 'auth') return;
        }
        const user = await auth.resolveToken(msg.token);
        if (!user) { ws.send(JSON.stringify({ t: 'error', code: 'AUTH_INVALID' })); ws.close(); return; }
        const sanctions = await Promise.resolve(db.activeSanctions(user.id)).catch(() => []);
        if (sanctions.some(s => s.type === 'ban')) { ws.close(); return; }
        ws.user = user;
        ws.authed = true;
        rooms.attachSocket(user.id, ws);
        ws.send(JSON.stringify({ t: 'hello', userId: user.id, name: user.username }));
        return;
      }

      const user = ws.user;

      try {
        switch (msg.t) {
          case 'ping': ws.send(JSON.stringify({ t: 'pong', srv: Date.now() })); break;

          case 'in': {
            // gameplay input — routed to the user's active room
            const room = rooms.roomOf(user.id);
            if (room && (room.status === 'running' || room.status === 'countdown')) {
              room.setInput(user.id, msg);
            }
            break;
          }

          // NOTE: queue join/cancel intentionally NOT accepted over WebSocket.
          // REST (POST/DELETE /api/queue) is the single authoritative matchmaking path.

          case 'chat': {
            if (!rateLimit(`wschat:${user.id}`, 6, 5000)) {
              ws.send(JSON.stringify({ t: 'chat_error', code: 'RATE' }));
              return;
            }
            const channel = ['global', 'clan', 'party', 'private'].includes(msg.channel) ? msg.channel : null;
            if (!channel) return;
            let targetId = null;
            if (channel === 'clan') {
              const membership = await db.getClanMembership(user.id);
              if (!membership) return;
              targetId = membership.clanId;
            }
            if (channel === 'party') {
              const party = social.partyOf(user.id);
              if (!party) return;
              targetId = party.id;
            }
            if (channel === 'private') {
              targetId = String(msg.to ?? '');
              if (!targetId) return;
            }
            const m = await social.chatMessage(user, { channel, channelId: targetId, text: msg.text });
            ws.send(JSON.stringify({ t: 'chat_ok' }));
            await deliverChat(social, rooms, m, user, targetId);
            break;
          }

          case 'emote': {
            // gameplay emotes go to the room only
            const room = rooms.roomOf(user.id);
            if (room && typeof msg.emote === 'string' && msg.emote.length <= 16) {
              rooms.broadcast(room, { t: 'emote', id: user.id, emote: msg.emote.slice(0, 16) });
            }
            break;
          }

          case 'leave_room': {
            rooms.leaveRoom(user.id);
            // quitter une partie annule aussi toute file d'attente résiduelle:
            // sinon un match fantôme démarrait et re-lançait le jeu via match_found
            matchmaker.cancel(user.id);
            break;
          }

          case 'select_fighter': {
            const fid = String(msg.fighterId ?? '');
            const owned = await db.getFighters(user.id);
            if (owned[fid]?.unlocked) {
              await db.updateUser(user.id, { selected_fighter: fid });
              user.selectedFighter = fid;
              ws.send(JSON.stringify({ t: 'selected', fighterId: fid }));
            }
            break;
          }

          default:
            ws.send(JSON.stringify({ t: 'error', code: 'UNKNOWN_MSG' }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ t: 'error', code: e.message?.slice(0, 48) ?? 'SERVER_ERROR' }));
      }
    });
  });

  // sweep dead sockets
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) continue;
    }
  }, 30000);
  hb.unref();
}

async function deliverChat(social, rooms, m, user, targetId) {
  const payload = { t: 'chat', ...m };
  if (m.channel === 'global') {
    for (const [, set] of rooms.sockets) for (const ws of set) { try { ws.send(JSON.stringify(payload)); } catch { /* gone */ } }
  } else if (m.channel === 'clan') {
    const members = await db.listClanMembers(targetId);
    for (const mem of members) rooms.sendTo(mem.userId, payload);
  } else if (m.channel === 'party') {
    const party = social.parties.get(targetId);
    if (party) for (const mem of party.members) rooms.sendTo(mem, payload);
  } else if (m.channel === 'private') {
    rooms.sendTo(targetId, payload);
    rooms.sendTo(user.id, payload);
  }
}
