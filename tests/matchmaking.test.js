// RIFT ARENA — tests: matchmaking (queues, bot fill, team balance) + live HTTP/WS integration
import { test } from 'node:test';
import assert from 'node:assert/strict';

// matchmaking unit — real RoomManager + Matchmaker against a temp JSON store
const DATA = (await import('node:os')).tmpdir() + `/ra-mm-${Date.now()}`;
(await import('node:fs')).mkdirSync(DATA, { recursive: true });
const { JsonStore } = await import('../server/src/database/json_store.js');
const { RoomManager } = await import('../server/src/game/rooms.js');
const { Matchmaker } = await import('../server/src/matchmaking/index.js');
const { RewardSystem } = await import('../server/src/systems/rewards.js');

const db = new JsonStore(DATA);
const rooms = new RoomManager(db, new RewardSystem(db, async () => ({})), async () => ({ 'matchmaking.timeout_ms': 20000 }));
const mm = new Matchmaker(rooms, async () => ({}));

test('matchmaking: solo queue fills with bots and starts a match', async () => {
  const user = { id: 'mm-user-1', username: 'MMUser', trophies: 120, selectedFighter: 'volt' };
  await mm.join(user, { mode: 'crystal_rush', ranked: false });
  assert.equal(mm.size('crystal_rush', false), 1);
  // simulate 9s wait → bot fill allowed
  const q = mm.queues.get('crystal_rush:0');
  for (const e of q.values()) e.joinedAt = Date.now() - 9000;
  mm.process();
  assert.equal(q.size, 0, 'queue drained');
  assert.equal(rooms.rooms.size, 1, 'room created');
  const room = [...rooms.rooms.values()][0];
  assert.equal(room.modeId, 'crystal_rush');
  const humans = room.humans();
  assert.equal(humans.length, 1);
  const bots = [...room.ents.values()].filter(e => e.kind === 'bot');
  assert.equal(bots.length, 5, '3v3 filled with 5 bots');
  assert.equal(room.status, 'countdown', 'match started');
  assert.ok(bots.every(b => b.name.startsWith('BOT')), 'bots clearly labeled');
  // bots never in ranked: engine room flag check
  assert.equal(room.ranked, false);
});

test('matchmaking: full human lobby needs no bots', async () => {
  for (let i = 0; i < 6; i++) {
    await mm.join({ id: `h${i}`, username: `Human${i}`, trophies: 100 + i * 10, selectedFighter: 'volt' }, { mode: 'elimination', ranked: false });
  }
  mm.process();
  const room = [...rooms.rooms.values()].find(r => r.modeId === 'elimination');
  assert.ok(room, 'room created');
  const bots = [...room.ents.values()].filter(e => e.kind === 'bot');
  assert.equal(bots.length, 0, 'no bots needed');
  const teams = { A: 0, B: 0 };
  for (const e of room.humans()) teams[e.team]++;
  assert.deepEqual(teams, { A: 3, B: 3 }, 'balanced 3v3');
});

test('matchmaking: FFA spawns 8 fighters', async () => {
  for (let i = 0; i < 8; i++) {
    await mm.join({ id: `f${i}`, username: `FFA${i}`, trophies: 50, selectedFighter: 'volt' }, { mode: 'last_core', ranked: false });
  }
  mm.process();
  const room = [...rooms.rooms.values()].find(r => r.modeId === 'last_core');
  assert.ok(room);
  assert.equal(room.ents.size, 8);
  assert.ok(room.status === 'countdown' || room.status === 'running');
});

test('matchmaking: ranked queue waits (no bot fill)', async () => {
  const user = { id: 'rk1', username: 'RankedUser', trophies: 500, selectedFighter: 'volt' };
  await mm.join(user, { mode: 'elimination', ranked: true });
  const q = mm.queues.get('elimination:1');
  for (const e of q.values()) e.joinedAt = Date.now() - 60000;
  mm.process();
  assert.equal(q.size, 1, 'ranked queue does NOT fill with bots');
  mm.cancel(user.id);
});

test('party members queue together', async () => {
  await mm.join({ id: 'pl', username: 'PartyLeader', trophies: 10, selectedFighter: 'volt' }, { mode: 'domination', ranked: false, partyId: 'pt1' });
  await mm.join({ id: 'pm', username: 'PartyMate', trophies: 20, selectedFighter: 'volt' }, { mode: 'domination', ranked: false, partyId: 'pt1' });
  const q = mm.queues.get('domination:0');
  for (const e of q.values()) e.joinedAt = Date.now() - 9000;
  mm.process();
  const room = [...rooms.rooms.values()].find(r => r.modeId === 'domination');
  assert.ok(room);
  const mates = room.humans().filter(h => ['pl', 'pm'].includes(h.userId));
  assert.equal(mates.length, 2);
  assert.equal(mates[0].team, mates[1].team, 'party shares a team');
});

// ---------- live server integration (HTTP + WebSocket over the network) ----------
test('integration: boot server, register, login, catalog, ws auth, chat', { timeout: 30000 }, async (t) => {
  const { spawn } = await import('node:child_process');
  const port = 3777;
  const dataDir = (await import('node:os')).tmpdir() + `/ra-live-${Date.now()}`;
  const child = spawn(process.execPath, ['server/src/index.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: 'test', ADMIN_BOOTSTRAP_KEY: 'test-bootstrap-key-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } child.stdout?.destroy(); child.stderr?.destroy(); });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) return resolve(); }
      catch { /* not up yet */ }
      if (Date.now() - t0 > 15000) return reject(new Error('server did not boot'));
      setTimeout(poll, 300);
    };
    poll();
  });

  const base = `http://127.0.0.1:${port}`;
  const XH = { 'X-Requested-With': 'rift-arena', 'Content-Type': 'application/json' };

  // register two players
  const reg1 = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_a', password: 'passw0rd' }) });
  assert.equal(reg1.status, 200, 'register A');
  const reg1d = await reg1.json();
  assert.ok(reg1d.token);
  const reg2 = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_b', password: 'passw0rd' }) });
  assert.equal(reg2.status, 200);

  // bad login
  const bad = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_a', password: 'nope' }) });
  assert.equal(bad.status, 401);

  // catalog (public)
  const cat = await fetch(`${base}/api/game/data`);
  const catd = await cat.json();
  assert.equal(catd.fighters.length, 6);
  assert.equal(catd.maps.length, 8);

  // me (bearer token)
  const me = await fetch(`${base}/api/me`, { headers: { ...XH, Authorization: `Bearer ${reg1d.token}` } });
  assert.equal(me.status, 200);
  const meD = await me.json();
  assert.equal(meD.profile.username, 'live_a');

  // CSRF: POST without header/origin rejected
  const csrfless = await fetch(`${base}/api/me/select`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ fighterId: 'volt' }) });
  assert.equal(csrfless.status, 403, 'CSRF protection active');

  // select fighter (owned volt)
  const sel = await fetch(`${base}/api/me/select`, { method: 'POST', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ fighterId: 'volt' }) });
  assert.equal(sel.status, 200);

  // not owned fighter rejected
  const sel2 = await fetch(`${base}/api/me/select`, { method: 'POST', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ fighterId: 'patch' }) });
  assert.equal(sel2.status, 400);

  // WebSocket auth handshake + chat rate limit
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const messages = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise(r => setTimeout(r, 150));
  ws.send(JSON.stringify({ t: 'auth', token: reg1d.token }));
  await new Promise(r => setTimeout(r, 300));
  assert.ok(messages.some(m => m.t === 'hello'), 'ws auth handshake ok');
  // chat: accepted, then rate limited after the 6th message inside 5s (spaced above the 60 msg/s socket guard)
  for (let i = 0; i < 7; i++) {
    ws.send(JSON.stringify({ t: 'chat', channel: 'global', text: `msg ${i}` }));
    await new Promise(r => setTimeout(r, 30));
  }
  await new Promise(r => setTimeout(r, 400));
  assert.ok(messages.some(m => m.t === 'chat_ok'), 'chat accepted');
  assert.ok(messages.some(m => m.t === 'chat_error' && m.code === 'RATE'), 'chat rate limited');
  // queue: REST is the single authoritative path (WS join removed server-side)
  const q1 = await fetch(`${base}/api/queue`, { method: 'POST', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ mode: 'elimination', ranked: false }) });
  assert.equal(q1.status, 200, 'queue join');
  const q1d = await q1.json();
  assert.ok(q1d.ok && q1d.position >= 1, 'queue ack with position');
  const qs = await fetch(`${base}/api/queue/state`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  const qsd = await qs.json();
  assert.equal(qsd.inQueue, true, 'state reports the real per-player queue');
  assert.equal(qsd.mode, 'elimination');
  assert.equal(qsd.ranked, false);
  // duplicate join on another mode leaves only ONE queue entry
  const q2 = await fetch(`${base}/api/queue`, { method: 'POST', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ mode: 'crystal_rush', ranked: false }) });
  assert.equal(q2.status, 200);
  const qs2 = await fetch(`${base}/api/queue/state`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  const qsd2 = await qs2.json();
  assert.equal(qsd2.mode, 'crystal_rush', 're-join switches queue (single queue per player)');
  const elimSize = qsd2.sizes.elimination;
  assert.equal(elimSize, 0, 'old queue emptied — no dual queue');
  // cancel removes from every queue
  const qc = await fetch(`${base}/api/queue`, { method: 'DELETE', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` } });
  assert.equal(qc.status, 200);
  const qs3 = await fetch(`${base}/api/queue/state`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  assert.equal((await qs3.json()).inQueue, false, 'cancel really empties the queues');
  ws.close();

  // maps API: save a community map (valid), then list
  const grid = Array.from({ length: 10 }, () => Array(12).fill(0));
  const mapSave = await fetch(`${base}/api/maps`, { method: 'POST', headers: { ...XH, Authorization: `Bearer ${reg1d.token}` }, body: JSON.stringify({ action: 'publish', map: { name: 'Live Map', grid, spawns: [[2, 2], [8, 8]] } }) });
  assert.equal(mapSave.status, 200, 'map saved');
  const mapList = await fetch(`${base}/api/maps?status=pending`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  const mapListD = await mapList.json();
  assert.ok(mapListD.maps.some(m => m.name === 'Live Map'));

  // events + news seeded by boot
  const events = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  const evD = await events.json();
  assert.ok(evD.events.length >= 5, 'events seeded');
  const news = await fetch(`${base}/api/news`, { headers: { Authorization: `Bearer ${reg1d.token}` } });
  assert.ok((await news.json()).news.length >= 3, 'news seeded');

  // unauthenticated API blocked
  const unauth = await fetch(`${base}/api/me`);
  assert.equal(unauth.status, 401);

  // no-shell admin bootstrap: wrong key refused, right key promotes, second call refuses
  const badKey = await fetch(`${base}/api/auth/bootstrap-admin`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_a', password: 'passw0rd', bootstrapKey: 'wrong' }) });
  assert.equal(badKey.status, 400, 'wrong bootstrap key refused');
  const boot = await fetch(`${base}/api/auth/bootstrap-admin`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_a', password: 'passw0rd', bootstrapKey: 'test-bootstrap-key-123' }) });
  assert.equal(boot.status, 200, 'bootstrap ok');
  const bootD = await boot.json();
  assert.equal(bootD.role, 'ADMIN');
  const boot2 = await fetch(`${base}/api/auth/bootstrap-admin`, { method: 'POST', headers: XH, body: JSON.stringify({ username: 'live_b', password: 'passw0rd', bootstrapKey: 'test-bootstrap-key-123' }) });
  assert.equal(boot2.status, 400, 'bootstrap refused once an admin exists');
  // the admin dashboard now answers for live_a
  const dash = await fetch(`${base}/api/admin/dashboard`, { headers: { ...XH, Authorization: `Bearer ${reg1d.token}` } });
  assert.equal(dash.status, 200, 'admin dashboard accessible');
  const dashD = await dash.json();
  assert.equal(dashD.server.db, 'json');

  child.kill('SIGTERM');
  await new Promise(r => { child.on('exit', r); setTimeout(r, 3000); });
});
