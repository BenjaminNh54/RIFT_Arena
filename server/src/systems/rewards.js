// RIFT ARENA — server-side rewards pipeline. The client never decides its own rewards.
import { leagueForRp } from '../../../shared/definitions/modes.js';
import { TROPHY_ROAD, MISSION_TEMPLATES } from '../../../shared/game-config/defaults.js';
import { FIGHTER_MAP } from '../../../shared/definitions/fighters.js';

const nowIso = () => new Date().toISOString();

function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - start) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export function periodKeys(d = new Date()) {
  const day = d.toISOString().slice(0, 10);
  return { daily: day, weekly: weekKey(d), seasonal: 'S1' };
}

export class RewardSystem {
  constructor(db, config) { this.db = db; this.getConfig = config; }

  async finishMatch(room, results) {
    const cfg = await this.getConfig();
    const rewardsByUser = new Map();
    const clanmatesInRoom = new Set();

    // who shares a clan in this match?
    const memberships = new Map();
    for (const p of results.players) {
      if (!p.userId || p.bot) continue;
      const m = await this.db.getClanMembership(p.userId);
      if (m) memberships.set(p.userId, m.clanId);
    }
    const clanCounts = {};
    for (const clanId of memberships.values()) clanCounts[clanId] = (clanCounts[clanId] ?? 0) + 1;
    for (const uid of memberships.keys()) {
      if (clanCounts[memberships.get(uid)] > 1) clanmatesInRoom.add(uid);
    }

    for (const p of results.players) {
      if (!p.userId || p.bot) continue;
      const user = await this.db.getUserById(p.userId);
      if (!user) continue;
      const rw = { trophies: 0, xp: 0, credits: 0, passXp: 0, rp: 0, unlocked: [], road: [], starPlayer: p.starPlayer };

      const won = p.won;
      const draw = results.winner === 'draw' || results.winner === null;

      // --- trophies ---
      if (results.mode === 'last_core') {
        const placement = placementOf(results, p);
        rw.trophies = placement === 1 ? (cfg['trophies.win'] + 2) : placement <= 4 ? 3 : cfg['trophies.loss'];
      } else {
        rw.trophies = draw ? 1 : won ? cfg['trophies.win'] : cfg['trophies.loss'];
        if (p.starPlayer) rw.trophies += cfg['trophies.star_player_bonus'];
      }
      rw.trophies = Math.max(-20, Math.min(cfg['trophies.max_gain'] + 4, rw.trophies));

      // --- xp / credits / pass xp ---
      rw.xp = cfg['xp.per_match'] + (won ? cfg['xp.win_bonus'] : 0);
      rw.credits = cfg['credits.per_match'] + (won ? 8 : 0);
      rw.passXp = cfg['pass.xp_per_match'] + (won ? 10 : 0);
      if (results.event) rw.passXp += 15; // event bonus

      // --- ranked RP ---
      if (results.ranked) {
        const season = await this.db.getSeason();
        if (season) {
          const prev = await this.db.getRankedPlayer(user.id, season.id) ?? { rp: 0, wins: 0, losses: 0, streak: 0, peak: 0 };
          let delta;
          if (results.mode === 'last_core') {
            const placement = placementOf(results, p);
            delta = placement === 1 ? 32 : placement <= 4 ? 10 : -(cfg['ranked.rp_loss']);
          } else {
            delta = draw ? 5 : won ? cfg['ranked.rp_win'] : cfg['ranked.rp_loss'];
          }
          const losingStreak = draw || won ? 0 : (prev.streak < 0 ? -prev.streak : 0) + 1;
          if (delta < 0 && losingStreak >= (cfg['ranked.protect_streak'] ?? 3)) delta = Math.round(delta / 2);
          const streak = delta < 0 ? -Math.max(1, losingStreak) : 0;
          const rp = Math.max(0, prev.rp + delta);
          const peak = Math.max(prev.peak ?? 0, rp);
          await this.db.upsertRankedPlayer(user.id, season.id, {
            rp, wins: prev.wins + (won ? 1 : 0), losses: prev.losses + (!won && !draw ? 1 : 0), streak, peak,
          });
          const before = leagueForRp(prev.rp), after = leagueForRp(rp);
          rw.rp = delta;
          rw.rpTotal = rp;
          if (after.league.id !== before.league.id) {
            rw.promoted = after.index > before.index;
            rw.demoted = after.index < before.index;
            rw.league = after.league.name;
          }
        }
      }

      // --- persist user row ---
      const newXp = user.xp + rw.xp;
      await this.db.updateUser(user.id, {
        trophies: Math.max(0, user.trophies + rw.trophies),
        xp: newXp,
        level: Math.min(100, 1 + Math.floor(newXp / 500)),
        credits: user.credits + rw.credits,
        pass_xp: user.pass_xp + rw.passXp,
        matches: user.matches + 1,
        wins: user.wins + (won ? 1 : 0),
        losses: user.losses + (!won && !draw ? 1 : 0),
        kills: user.kills + p.kills,
        playtime_s: user.playtime_s + Math.round(results.durationMs / 1000),
      });
      await this.db.addTrophyLog(user.id, rw.trophies, `${results.mode}:${won ? 'win' : draw ? 'draw' : 'loss'}`);

      // --- fighter progression ---
      const frow = (await this.db.getFighters(user.id))[p.fighter] ?? { unlocked: true, trophies: 0, xp: 0, level: 1 };
      const fTrophies = (frow.trophies ?? 0) + Math.max(0, rw.trophies);
      const fXp = (frow.xp ?? 0) + rw.xp;
      await this.db.setFighter(user.id, p.fighter, {
        unlocked: true, trophies: fTrophies, xp: fXp, level: Math.min(30, 1 + Math.floor(fXp / 300)),
      });
      if (!user.favorite_fighter) await this.db.updateUser(user.id, { favorite_fighter: p.fighter });

      // --- trophy unlocks + road (auto-granted, tracked in inventory) ---
      const newTrophies = Math.max(0, user.trophies + rw.trophies);
      for (const f of Object.values(FIGHTER_MAP)) {
        if (f.unlock?.type === 'trophies' && newTrophies >= f.unlock.value) {
          const owned = await this.db.getFighters(user.id);
          if (!owned[f.id]?.unlocked) {
            await this.db.unlockFighter(user.id, f.id);
            rw.unlocked.push(f.id);
          }
        }
      }
      for (const step of TROPHY_ROAD) {
        if (newTrophies >= step.at && !(await this.db.hasItem(user.id, 'road', String(step.at)))) {
          await this.db.addItem(user.id, 'road', String(step.at));
          await this.applyReward(user.id, step.reward);
          rw.road.push({ at: step.at, reward: step.reward });
        }
      }

      // --- missions ---
      await this.progressMissions(user, results, p, won, clanmatesInRoom.has(user.id));

      // --- events ---
      if (results.event) {
        await this.progressEvent(user, results, p, won);
      }

      // --- clan xp + weekly war ---
      const membership = memberships.get(user.id);
      if (membership) {
        const clan = await this.db.getClan(membership);
        if (clan) {
          const gain = (cfg.xp_clan ?? 12) + (won ? 8 : 0);
          const newXpClan = clan.xp + gain;
          const level = clanLevelFor(newXpClan);
          await this.db.updateClan(clan.id, { xp: newXpClan, level, trophies: Math.round(clan.trophies + Math.max(0, rw.trophies)) });
          await this.db.addWarMatch(weekKey(), clan.id, won);
        }
      }

      rewardsByUser.set(user.id, rw);
    }

    // attach rewards into results (sent to clients by RoomManager after this returns)
    for (const p of results.players) {
      if (p.userId && rewardsByUser.has(p.userId)) {
        p.rewards = rewardsByUser.get(p.userId);
      }
    }

    // --- persist match record ---
    const matchId = results.roomId;
    await this.db.recordMatch({
      id: matchId, mode: results.mode, map: results.map, ranked: results.ranked,
      winnerTeam: results.winner, durationMs: Math.round(results.durationMs), createdAt: nowIso(),
    });
    await this.db.recordMatchPlayers(results.players.filter(x => x.userId && !x.bot).map(p => ({
      matchId, userId: p.userId, username: p.name, mode: results.mode, team: p.team, fighter: p.fighter,
      kills: p.kills, deaths: p.deaths, damage: p.damage, objectives: p.objectives,
      won: p.won, trophiesDelta: p.rewards?.trophies ?? 0, starPlayer: p.starPlayer, createdAt: nowIso(),
    })));

    return results;
  }

  async applyReward(userId, reward) {
    const user = await this.db.getUserById(userId);
    if (!user) return;
    switch (reward.type) {
      case 'credits': await this.db.updateUser(userId, { credits: user.credits + reward.amount }); break;
      case 'rift_tokens': await this.db.updateUser(userId, { rift_tokens: user.rift_tokens + reward.amount }); break;
      case 'fighter': await this.db.unlockFighter(userId, reward.id); break;
      case 'skin': await this.db.addItem(userId, 'skin', reward.id); break;
      case 'banner': await this.db.addItem(userId, 'banner', reward.id); break;
      case 'avatar': await this.db.addItem(userId, 'avatar', reward.id); break;
      case 'title': await this.db.addItem(userId, 'title', reward.id); break;
      case 'effect': await this.db.addItem(userId, 'effect', reward.id); break;
      case 'emote': await this.db.addItem(userId, 'emote', reward.id); break;
      case 'chest': await this.db.addItem(userId, 'chest', reward.id, reward.amount ?? 1); break;
      default: break;
    }
  }

  async progressMissions(user, results, p, won, social) {
    const keys = periodKeys();
    const statsDelta = {
      matches: 1, wins: won ? 1 : 0, kills: p.kills, supers: p.supers ?? 0,
      objectives: p.objectives, social_matches: social ? 1 : 0, clan_matches: social ? 1 : 0,
      event_matches: results.event ? 1 : 0,
    };
    for (const [period, key] of Object.entries(keys)) {
      const existing = await this.db.getMissions(user.id, key);
      const templates = MISSION_TEMPLATES[period] ?? [];
      if (period === 'daily' || period === 'weekly') {
        for (const tpl of templates) {
          if (!existing[tpl.id]) {
            await this.db.upsertMission(user.id, key, tpl.id, { progress: 0, claimed: false });
            existing[tpl.id] = { progress: 0, claimed: false };
          }
        }
      }
      for (const tpl of templates) {
        const cur = existing[tpl.id];
        if (!cur || cur.claimed) continue;
        const inc = statsDelta[tpl.metric] ?? 0;
        if (inc <= 0) continue;
        const next = Math.min(tpl.target, cur.progress + inc);
        await this.db.upsertMission(user.id, key, tpl.id, { progress: next });
      }
      // modes_played special: count distinct modes
      for (const tpl of MISSION_TEMPLATES.weekly ?? []) {
        if (tpl.metric !== 'modes_played') continue;
        const cur = (await this.db.getMissions(user.id, key))[tpl.id];
        if (!cur || cur.claimed || cur.modesSeen?.includes(results.mode)) continue;
        const seen = [...(cur.modesSeen ?? []), results.mode];
        await this.db.upsertMission(user.id, key, tpl.id, { modesSeen: seen, progress: seen.length });
      }
    }
  }

  async progressEvent(user, results, p, won) {
    const ev = await this.db.getEvent(results.event.id);
    if (!ev || ev.status !== 'active') return;
    const prog = await this.db.getEventProgress(user.id, ev.id) ?? { progress: 0, claimed: false };
    if (prog.claimed) return;
    const metric = ev.mission?.metric ?? 'matches';
    const inc = metric === 'matches' ? 1 : metric === 'wins' ? (won ? 1 : 0)
      : metric === 'kills' ? p.kills : metric === 'objectives' ? p.objectives
      : metric === 'clan_matches' ? 0 : 0;
    if (inc <= 0) return;
    const target = ev.mission?.target ?? 3;
    await this.db.incrEventProgress(user.id, ev.id, { progress: Math.min(target, prog.progress + inc) });
  }
}

export function placementOf(results, p) {
  // placement by damage+kills among all players (approximation of survival order for FFA)
  const all = [...results.players].sort((a, b) => (b.kills - a.kills) || (b.damage - a.damage));
  return all.findIndex(x => (p.userId && x.userId === p.userId) || (!p.userId && x.name === p.name)) + 1;
}

export function clanLevelFor(xp, levels = null) {
  const table = levels ?? [
    [1, 0], [2, 2000], [3, 6000], [4, 14000], [5, 26000], [6, 44000], [7, 68000], [8, 98000], [9, 134000], [10, 176000],
  ];
  let level = 1;
  for (const [lv, min] of table) if (xp >= min) level = lv;
  return level;
}
