// RIFT ARENA — economy: shop, rotations, chests, battle pass, missions claim
import { SHOP_CATALOG, CHESTS, BATTLE_PASS, TITLES } from '../../../shared/game-config/defaults.js';
import { FIGHTER_MAP } from '../../../shared/definitions/fighters.js';
import { MISSION_TEMPLATES } from '../../../shared/game-config/defaults.js';
import { periodKeys } from './rewards.js';

export class EconomySystem {
  constructor(db, config) { this.db = db; this.getConfig = config; }

  // ---------- shop ----------
  async shopState(user) {
    const cfg = await this.getConfig();
    const items = await this.ensureCatalog();
    const rotation = await this.dailyRotation(items, cfg['shop.rotation_size'] ?? 6);
    const owned = new Set((await this.db.getInventory(user.id)).map(i => `${i.kind}::${i.refId}`));
    return {
      rotation: rotation.map(i => ({ ...i, owned: owned.has(`${i.kind}::${i.ref}`) })),
      catalog: items.filter(i => !rotation.includes(i)).map(i => ({ ...i, owned: owned.has(`${i.kind}::${i.ref}`) })),
      wallets: { credits: user.credits, rift_tokens: user.rift_tokens },
    };
  }

  async ensureCatalog() {
    const existing = await this.db.listShopItems();
    if (existing.length === 0) {
      for (const item of SHOP_CATALOG) await this.db.upsertShopItem(item);
      return SHOP_CATALOG;
    }
    return existing;
  }

  async dailyRotation(items, size) {
    const dayKey = new Date().toISOString().slice(0, 10);
    let ids = await this.db.getRotation(dayKey);
    if (!ids) {
      // deterministic daily shuffle by date hash
      const seed = [...dayKey].reduce((a, c) => a + c.charCodeAt(0), 0);
      const pool = [...items];
      const rot = [];
      let i = seed % pool.length;
      while (rot.length < Math.min(size, pool.length)) {
        rot.push(pool.splice(i % pool.length, 1)[0]);
        i += 3;
      }
      ids = rot.map(r => r.id);
      await this.db.saveRotation(dayKey, ids);
    }
    return ids.map(id => items.find(it => it.id === id)).filter(Boolean);
  }

  async purchase(user, itemId) {
    const items = await this.ensureCatalog();
    const item = items.find(i => i.id === itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');
    const wallet = item.currency === 'credits' ? user.credits : user.rift_tokens;
    if (wallet < item.price) throw new Error('NOT_ENOUGH');
    if (await this.db.hasItem(user.id, item.kind, item.ref)) throw new Error('ALREADY_OWNED');
    const patch = item.currency === 'credits'
      ? { credits: user.credits - item.price }
      : { rift_tokens: user.rift_tokens - item.price };
    await this.db.updateUser(user.id, patch);
    await this.db.addItem(user.id, item.kind, item.ref);
    return { ok: true, wallets: await this.refWallet(user.id) };
  }

  async refWallet(userId) {
    const u = await this.db.getUserById(userId);
    return { credits: u.credits, rift_tokens: u.rift_tokens, pass_xp: u.pass_xp, trophies: u.trophies };
  }

  // ---------- chests ----------
  async openChest(user, chestId) {
    const def = CHESTS[chestId];
    if (!def) throw new Error('CHEST_NOT_FOUND');
    if (!(await this.db.hasItem(user.id, 'chest', chestId))) throw new Error('NO_CHEST');
    await this.db.removeItem(user.id, 'chest', chestId, 1);
    const total = def.pool.reduce((a, r) => a + r.weight, 0);
    const loot = [];
    for (let i = 0; i < def.rolls; i++) {
      let roll = Math.random() * total;
      for (const r of def.pool) {
        roll -= r.weight;
        if (roll <= 0) {
          loot.push(r);
          await this.applyLoot(user.id, r);
          break;
        }
      }
    }
    return { loot, wallets: await this.refWallet(user.id) };
  }
  async applyLoot(userId, loot) {
    const user = await this.db.getUserById(userId);
    if (!user) return;
    if (loot.kind === 'credits') await this.db.updateUser(userId, { credits: user.credits + loot.amount });
    else if (loot.kind === 'rift_tokens') await this.db.updateUser(userId, { rift_tokens: user.rift_tokens + loot.amount });
    else if (loot.kind === 'title') await this.db.addItem(userId, 'title', loot.id);
    else if (loot.kind === 'banner') await this.db.addItem(userId, 'banner', loot.id);
    else if (loot.kind === 'avatar') await this.db.addItem(userId, 'avatar', loot.id);
    else if (loot.kind === 'effect') await this.db.addItem(userId, 'effect', loot.id);
  }

  // ---------- battle pass ----------
  async ensurePass() { return this.db.ensurePass(BATTLE_PASS); }

  async passState(user) {
    const pass = await this.ensurePass();
    const prog = await this.db.getPassProgress(user.id, pass.id) ?? { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    const tiers = [];
    for (let i = 0; i < pass.tiers; i++) {
      const r = pass.rewards ? pass.rewards(i) : BATTLE_PASS.rewards(i);
      tiers.push({
        tier: r.tier,
        free: r.free, premium: r.premium,
        claimedFree: prog.claimedFree.includes(r.tier),
        claimedPremium: prog.claimedPremium.includes(r.tier),
      });
    }
    return {
      pass: { id: pass.id, name: pass.name, season: pass.season, tiers: pass.tiers, xpPerTier: pass.xpPerTier, premiumPrice: pass.premiumPrice },
      progress: { xp: prog.xp, tier: prog.tier, premium: prog.premium },
      tiers, wallets: { credits: user.credits, rift_tokens: user.rift_tokens },
    };
  }

  async addPassXp(user, amount) {
    const pass = await this.ensurePass();
    const prog = await this.db.getPassProgress(user.id, pass.id) ?? { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    const xp = prog.xp + amount;
    const tier = Math.min(pass.tiers, Math.floor(xp / pass.xpPerTier));
    return this.db.upsertPassProgress(user.id, pass.id, { xp, tier });
  }

  async claimPassTier(user, tier, track) {
    const pass = await this.ensurePass();
    const prog = await this.db.getPassProgress(user.id, pass.id) ?? { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    if (tier > prog.tier) throw new Error('TIER_LOCKED');
    const rewardDef = BATTLE_PASS.rewards(tier - 1);
    const claimedList = track === 'premium' ? prog.claimedPremium : prog.claimedFree;
    if (claimedList.includes(tier)) throw new Error('ALREADY_CLAIMED');
    if (track === 'premium' && !prog.premium) throw new Error('PREMIUM_REQUIRED');
    const reward = track === 'premium' ? rewardDef.premium : rewardDef.free;
    await this.applyReward(user.id, reward);
    if (track === 'premium') prog.claimedPremium.push(tier); else prog.claimedFree.push(tier);
    await this.db.upsertPassProgress(user.id, pass.id, {
      claimedFree: prog.claimedFree, claimedPremium: prog.claimedPremium,
    });
    return { reward };
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
  async buyPremium(user) {
    const pass = await this.ensurePass();
    const prog = await this.db.getPassProgress(user.id, pass.id) ?? { xp: 0, tier: 0, premium: false, claimedFree: [], claimedPremium: [] };
    if (prog.premium) throw new Error('ALREADY_PREMIUM');
    const price = pass.premiumPrice ?? BATTLE_PASS.premiumPrice;
    if (user.rift_tokens < price.amount) throw new Error('NOT_ENOUGH');
    await this.db.updateUser(user.id, { rift_tokens: user.rift_tokens - price.amount });
    await this.db.upsertPassProgress(user.id, pass.id, { premium: true });
    return { ok: true };
  }

  // ---------- missions ----------
  async missionsState(user) {
    const keys = periodKeys();
    const out = {};
    for (const [period, key] of Object.entries(keys)) {
      const rows = await this.db.getMissions(user.id, key);
      const templates = MISSION_TEMPLATES[period] ?? [];
      out[period] = templates.map(tpl => ({
        id: tpl.id, desc: tpl.desc, target: tpl.target, reward: tpl.reward,
        progress: rows[tpl.id]?.progress ?? 0,
        claimed: rows[tpl.id]?.claimed ?? false,
      }));
    }
    return { periods: keys, missions: out };
  }

  async claimMission(user, period, tplId) {
    const keys = periodKeys();
    const key = keys[period];
    if (!key) throw new Error('BAD_PERIOD');
    const tpl = (MISSION_TEMPLATES[period] ?? []).find(t => t.id === tplId);
    if (!tpl) throw new Error('BAD_MISSION');
    const rows = await this.db.getMissions(user.id, key);
    const row = rows[tplId];
    if (!row || row.claimed) throw new Error('NOT_CLAIMABLE');
    if (row.progress < tpl.target) throw new Error('INCOMPLETE');
    await this.db.upsertMission(user.id, key, tplId, { claimed: true });
    // reward
    const u = await this.db.getUserById(user.id);
    for (const [cur, amt] of Object.entries(tpl.reward)) {
      if (cur === 'credits') await this.db.updateUser(user.id, { credits: u.credits + amt });
      else if (cur === 'rift_tokens') await this.db.updateUser(user.id, { rift_tokens: u.rift_tokens + amt });
      else if (cur === 'pass_xp') await this.addPassXp(user, amt);
    }
    return { reward: tpl.reward };
  }

  // titles lookup
  titleName(id) { return TITLES[id] ?? id; }
}
