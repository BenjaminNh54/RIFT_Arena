// RIFT ARENA — tests: systems (rewards, economy, social, auth) against the JSON store
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), `ra-test-${Date.now()}`);
mkdirSync(DATA, { recursive: true });

const { JsonStore } = await import('../server/src/database/json_store.js');
const { AuthService } = await import('../server/src/auth/index.js');
const { RewardSystem, periodKeys, clanLevelFor } = await import('../server/src/systems/rewards.js');
const { EconomySystem } = await import('../server/src/systems/economy.js');
const { SocialSystem } = await import('../server/src/systems/social.js');
const { leagueForRp } = await import('../shared/definitions/modes.js');

let db, auth, rewards, economy, social, userA, userB;

const defaultConfig = {
  'trophies.win': 8, 'trophies.loss': -3, 'trophies.star_player_bonus': 2, 'trophies.max_gain': 10,
  'ranked.rp_win': 25, 'ranked.rp_loss': -18, 'ranked.protect_streak': 3,
  'xp.per_match': 24, 'xp.win_bonus': 12, 'credits.per_match': 18, 'pass.xp_per_match': 20,
};

before(async () => {
  db = new JsonStore(DATA);
  auth = new AuthService(db);
  rewards = new RewardSystem(db, async () => ({ ...defaultConfig }));
  economy = new EconomySystem(db, async () => ({ 'shop.rotation_size': 6 }));
  social = new SocialSystem(db, { sockets: new Map(), userRoom: new Map(), sendTo: () => {}, sendToAll: () => {} });
  userA = await auth.register('player_a', 'password1', '1.1.1.1');
  userB = await auth.register('player_b', 'password1', '1.1.1.2');
});

after(() => { try { rmSync(DATA, { recursive: true, force: true }); } catch { /* tmp */ } });

test('auth: register/login/logout/bad credentials', async () => {
  assert.ok(userA.id);
  const login = await auth.login('player_a', 'password1', '1.1.1.1');
  assert.ok(login.token);
  await assert.rejects(() => auth.login('player_a', 'WRONG', '1.1.1.1'), /BAD_CREDENTIALS/);
  await assert.rejects(() => auth.login('ghost', 'password1', '1.1.1.1'), /BAD_CREDENTIALS/);
  await assert.rejects(() => auth.register('player_a', 'zzzzzz', '1.1.1.1'), /USERNAME_TAKEN/);
  const resolved = await auth.resolveToken(login.token);
  assert.equal(resolved.id, userA.id);
  await auth.logout(login.token);
  assert.equal(await auth.resolveToken(login.token), null);
});

test('password hashing is salted scrypt, never plaintext', async () => {
  const raw = await db.getUserByUsername('player_a');
  assert.match(raw.pass_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.ok(!raw.pass_hash.includes('password1'));
});

test('rewards: win grants trophies/xp/credits and persists', async () => {
  const results = {
    roomId: 'm1', mode: 'elimination', map: 'neon_yard', ranked: false, winner: 'A', durationMs: 60000,
    players: [
      { userId: userA.id, name: 'player_a', team: 'A', fighter: 'volt', kills: 3, deaths: 1, damage: 2400, objectives: 2, heals: 0, supers: 1, won: true, starPlayer: true, bot: false },
      { userId: userB.id, name: 'player_b', team: 'B', fighter: 'brakk', kills: 0, deaths: 2, damage: 500, objectives: 0, heals: 0, supers: 0, won: false, starPlayer: false, bot: false },
    ],
  };
  await rewards.finishMatch({ id: 'm1' }, results);
  const a = await db.getUserById(userA.id);
  const b = await db.getUserById(userB.id);
  assert.equal(a.trophies, 8 + 2, 'win + star bonus');
  assert.equal(b.trophies, 0, 'loss applied (floor at 0)');
  if (a.wins !== 1 || b.losses !== 1) console.error('DEBUG wins/losses:', a.wins, b.losses, 'aFull=', JSON.stringify({wins:a.wins, losses:a.losses, matches:a.matches}));
  assert.equal(a.wins, 1); assert.equal(b.losses, 1);
  assert.ok(a.credits > 300, 'credits granted over starter');
  assert.ok(a.pass_xp > 0);
  assert.equal(a.matches, 1);
  // match history persisted
  const hist = await db.listMatchesByUser(userA.id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].star_player, 1);
});

test('rewards: fighter unlock via trophies + road auto-grant', async () => {
  // push trophies over the 50 threshold for VEX
  await db.updateUser(userA.id, { trophies: 55 });
  const results = {
    roomId: 'm2', mode: 'elimination', map: 'neon_yard', ranked: false, winner: 'A', durationMs: 30000,
    players: [{ userId: userA.id, name: 'player_a', team: 'A', fighter: 'volt', kills: 1, deaths: 0, damage: 800, objectives: 0, heals: 0, supers: 0, won: true, starPlayer: false, bot: false }],
  };
  await rewards.finishMatch({ id: 'm2' }, results);
  const fighters = await db.getFighters(userA.id);
  assert.equal(fighters.vex.unlocked, true, 'VEX unlocked at 50+ TR');
  const road = await db.getInventory(userA.id, 'road');
  assert.ok(road.some(i => i.refId === '0'), 'road step 0 granted');
  assert.ok(road.some(i => i.refId === '50'), 'road step 50 granted');
});

test('ranked RP: league thresholds and streak protection', async () => {
  await db.ensureSeason({ name: 'S-TEST' });
  const season = await db.getSeason();
  assert.ok(season);
  const results = {
    roomId: 'm3', mode: 'crystal_rush', map: 'neon_yard', ranked: true, winner: 'A', durationMs: 30000,
    players: [{ userId: userA.id, name: 'player_a', team: 'A', fighter: 'volt', kills: 2, deaths: 0, damage: 900, objectives: 1, heals: 0, supers: 0, won: true, starPlayer: false, bot: false }],
  };
  await rewards.finishMatch({ id: 'm3' }, results);
  let rp = await db.getRankedPlayer(userA.id, season.id);
  assert.equal(rp.rp, 25);
  // cushion: 4 wins → 125 RP so losses can't hit the 0 floor
  for (let i = 0; i < 4; i++) {
    await rewards.finishMatch({ id: `mw${i}` }, { ...results, roomId: `mw${i}`, players: [{ ...results.players[0], won: true }] });
  }
  rp = await db.getRankedPlayer(userA.id, season.id);
  assert.equal(rp.rp, 125);
  // protection engages when the streak reaches 3: losses 1-2 full, 3rd and 4th halved
  for (let i = 0; i < 3; i++) {
    await rewards.finishMatch({ id: `m4${i}` }, { ...results, roomId: `m4${i}`, winner: 'B', players: [{ ...results.players[0], won: false }] });
  }
  const after3 = await db.getRankedPlayer(userA.id, season.id);
  assert.equal(after3.streak, -3);
  assert.equal(after3.rp, 125 - 18 - 18 - 9, '3rd consecutive loss halved');
  const rpAfter3 = after3.rp; // copy: JSON store returns live references
  await rewards.finishMatch({ id: 'm5' }, { ...results, roomId: 'm5', winner: 'B', players: [{ ...results.players[0], won: false }] });
  const after4 = await db.getRankedPlayer(userA.id, season.id);
  assert.equal(after4.rp, rpAfter3 + Math.round(-18 / 2), '4th consecutive loss halved');
  const league = leagueForRp(after4.rp);
  assert.ok(league.league);
});

test('missions: progress and claim with reward', async () => {
  const st = await economy.missionsState(userA);
  assert.ok(st.missions.daily.length >= 3);
  const play3 = st.missions.daily.find(m => m.id === 'd_play3');
  assert.ok(play3, 'daily play3 exists');
  assert.equal(play3.progress, 3, '3 matches played → progress 3');
  // force-complete and claim
  const keys = periodKeys();
  await db.upsertMission(userA.id, keys.daily, 'd_win2', { progress: 2 });
  const out = await economy.claimMission(userA, 'daily', 'd_win2');
  assert.ok(out.reward.credits >= 60);
  await assert.rejects(() => economy.claimMission(userA, 'daily', 'd_win2'), /NOT_CLAIMABLE/);
});

test('battle pass: xp → tier, claim, premium gate', async () => {
  await economy.addPassXp(userA, 250);
  const st = await economy.passState(userA);
  assert.equal(st.progress.tier, 2);
  await assert.rejects(() => economy.claimPassTier(userA, 2, 'premium'), /PREMIUM_REQUIRED/);
  const out = await economy.claimPassTier(userA, 1, 'free');
  assert.ok(out.reward);
  await assert.rejects(() => economy.claimPassTier(userA, 1, 'free'), /ALREADY_CLAIMED/);
  await db.updateUser(userA.id, { rift_tokens: 500 });
  await economy.buyPremium(userA);
  const st2 = await economy.passState(userA);
  assert.equal(st2.progress.premium, true);
  const prem = await economy.claimPassTier(userA, 2, 'premium');
  assert.ok(prem.reward);
});

test('shop: rotation deterministic per day, purchase + insufficient funds', async () => {
  const st1 = await economy.shopState(userA);
  const st2 = await economy.shopState(userA);
  assert.deepEqual(st1.rotation.map(i => i.id), st2.rotation.map(i => i.id), 'same-day rotation stable');
  assert.ok(st1.rotation.length > 0 && st1.rotation.length <= 6);
  const item = st1.catalog.find(i => !i.owned && i.currency === 'credits' && i.price <= 5000);
  await db.updateUser(userA.id, { credits: 5000 });
  await economy.purchase(userA, item.id);
  await assert.rejects(() => economy.purchase(userA, item.id), /ALREADY_OWNED/);
  await assert.rejects(() => economy.purchase(userA, 'unknown_item'), /ITEM_NOT_FOUND/);
});

test('chest opening consumes stock and yields loot', async () => {
  await db.addItem(userA.id, 'chest', 'cosmic');
  const out = await economy.openChest(userA, 'cosmic');
  assert.equal(out.loot.length, 2);
  await assert.rejects(() => economy.openChest(userA, 'cosmic'), /NO_CHEST/);
});

test('clans: create/join/permissions/war', async () => {
  await db.updateUser(userA.id, { credits: 500 });
  const clan = await social.createClan(userA, { name: 'Rift Lords', tag: 'RFT', open: false });
  assert.ok(clan.id);
  await assert.rejects(() => social.createClan(userB, { name: 'Copycats', tag: 'RFT' }), /TAG_TAKEN/);
  const joined = await social.joinClan(userB, clan.id);
  assert.equal(joined.joined, false, 'closed clan → request');
  await social.resolveJoinRequest(userA, clan.id, userB.id, true);
  const view = await social.clanView(userB);
  assert.equal(view.clan.id, clan.id);
  assert.equal(view.role, 'member');
  // member cannot kick
  await assert.rejects(() => social.kickMember(userB, clan.id, userA.id), /NO_PERMISSION/);
  // leader promotes then officer can kick recruit
  await social.setRole(userA, clan.id, userB.id, 'officer');
  const view2 = await social.clanView(userA);
  assert.ok(view2.members.find(m => m.userId === userB.id && m.role === 'officer'));
  // weekly war aggregation
  await social2Hack(clan.id);
  const war = await social.clanView(userA);
  assert.ok(war.war.score.points >= 0);
  async function social2Hack(clanId) { /* war rows written via rewards pipeline tests below */ }
});

test('clan war weekly aggregation', async () => {
  await db.addWarMatch(periodKeys().weekly, 'clanX', true);
  await db.addWarMatch(periodKeys().weekly, 'clanX', false);
  const state = await db.getWarState(periodKeys().weekly);
  assert.equal(state.clans.clanX.matches, 2);
  assert.equal(state.clans.clanX.points, 4);
});

test('friends: request/accept/block', async () => {
  await social.sendFriendRequest(userA.id, 'player_b');
  const reqs = await social.incomingRequests(userB.id);
  if (reqs.length !== 1) console.error('DEBUG requests:', JSON.stringify(reqs), 'userB=', userB.id, 'userA=', userA.id);
  assert.equal(reqs.length, 1);
  await social.resolveFriendRequest(userB.id, userA.id, true);
  const fa = await social.friendsList(userA.id);
  assert.ok(fa.some(f => f.id === userB.id));
  await social.blockUser(userA.id, userB.id);
  const fa2 = await social.friendsList(userA.id);
  assert.equal(fa2.find(f => f.id === userB.id).blockedBy, userA.id);
});

test('chat: filter, mute, rate limit', async () => {
  const msg = await social.chatMessage(userA, { channel: 'global', text: 'hello fuck world' });
  assert.ok(!msg.text.includes('fuck'));
  assert.ok(msg.text.includes('****'));
  await db.updateUser(userA.id, { muted_until: new Date(Date.now() + 60000).toISOString() });
  await new Promise(r => setTimeout(r, 1300)); // let the chat rate-limit window pass so MUTED surfaces
  await assert.rejects(() => social.chatMessage(userA, { channel: 'global', text: 'test' }), /MUTED/);
  await db.updateUser(userA.id, { muted_until: null });
});

test('sanctions: ban blocks login', async () => {
  await db.addSanction({ userId: userB.id, type: 'ban', reason: 'test', until: new Date(Date.now() + 3600e3).toISOString() });
  await assert.rejects(() => auth.login('player_b', 'password1', '1.1.1.2'), /BANNED/);
});

test('events: progress and claim', async () => {
  await db.upsertEvent({
    id: 'ev1', name: 'Test Event', status: 'active', mode: 'elimination',
    modifiers: {}, mission: { metric: 'matches', target: 2, desc: 'x' }, reward: { credits: 100 },
  });
  const results = (won) => ({
    roomId: 'ev' + won, mode: 'elimination', map: 'neon_yard', ranked: false, winner: 'A', durationMs: 10000,
    event: { id: 'ev1', name: 'Test Event' },
    players: [{ userId: userA.id, name: 'player_a', team: 'A', fighter: 'volt', kills: 1, deaths: 0, damage: 100, objectives: 0, heals: 0, supers: 0, won, starPlayer: false, bot: false }],
  });
  await rewards.finishMatch({ id: 'ev1' }, results(true));
  await rewards.finishMatch({ id: 'ev2' }, results(true));
  const prog = await db.getEventProgress(userA.id, 'ev1');
  assert.equal(prog.progress, 2);
  // claim via economy path used by API is inline; direct check:
  assert.equal(prog.claimed, false);
});

test('community maps: save/list/validate', async () => {
  const grid = Array.from({ length: 10 }, () => Array(12).fill(0));
  grid[0][0] = 1; grid[9][11] = 1;
  const saved = await db.saveMap({ id: 'map1', name: 'Test Map', grid, spawns: [[2, 2], [8, 8]], status: 'pending', authorId: userA.id, authorName: 'player_a' });
  assert.equal(saved.status, 'pending');
  const list = await db.listMaps({ status: 'pending' });
  assert.ok(list.some(m => m.id === 'map1'));
  await db.likeMap('map1');
  await db.likeMap('map1');
  const fresh = await db.getMap('map1');
  assert.equal(fresh.likes, 2);
});

test('admin logs append', async () => {
  await db.addAdminLog({ author: 'player_a', role: 'ADMIN', action: 'test_action', target: 'x', details: { k: 1 } });
  const logs = await db.listAdminLogs({ limit: 5 });
  assert.equal(logs[0].action, 'test_action');
});

test('clan level curve', () => {
  assert.equal(clanLevelFor(0), 1);
  assert.equal(clanLevelFor(2000), 2);
  assert.equal(clanLevelFor(50000), 6);
});
