// RIFT ARENA — auth: register, login, sessions, sanctions, admin bootstrap
import { getStore } from '../database/index.js';
import { hashPassword, verifyPassword, newSessionToken, hashToken, rateLimit } from '../security/index.js';
import { validateUsername, validatePassword, sanitizeText } from '../../../shared/validators/index.js';
import { GAME } from '../../../shared/constants.js';
import { STARTING_WALLET } from '../../../shared/game-config/defaults.js';
import { FIGHTER_MAP } from '../../../shared/definitions/fighters.js';
import { randomUUID } from 'node:crypto';

export class AuthService {
  constructor(db) { this.db = db; }

  // Code admin (variable ADMIN_CODE, valeur par défaut documentée). N'importe quel compte
  // connaissant ce code devient ADMIN — c'est la clé du propriétaire, pas un secret utilisateur.
  static adminCodeMatches(code) {
    return !!code && code === (process.env.ADMIN_CODE ?? 'RIFT-ADMIN-2026');
  }

  async register(username, password, ip, adminCode) {
    // default: 5 registrations / 10 min / IP (load tests override via env)
    const limit = parseInt(process.env.RATE_LIMIT_REGISTER ?? '5', 10);
    if (!rateLimit(`register:${ip}`, limit, 10 * 60000)) throw new Error('RATE_LIMIT');
    if (!validateUsername(username)) throw new Error('USERNAME_INVALID');
    if (!validatePassword(password)) throw new Error('PASSWORD_INVALID');
    const existing = await this.db.getUserByUsername(username);
    if (existing) throw new Error('USERNAME_TAKEN');
    const user = await this.db.createUser({
      id: randomUUID(), username: sanitizeText(username, 16),
      passHash: hashPassword(password),
      role: this.constructor.adminCodeMatches(adminCode) ? 'ADMIN' : undefined,
      credits: STARTING_WALLET.credits, rift_tokens: STARTING_WALLET.rift_tokens,
    });
    // Starters own VOLT
    await this.db.unlockFighter(user.id, 'volt');
    return user;
  }

  async login(username, password, ip) {
    if (!rateLimit(`login:${ip}`, 10, 60000)) throw new Error('RATE_LIMIT');
    const user = await this.db.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.pass_hash)) {
      // Burn identical time whether user exists or not
      if (user) verifyPassword(password, hashPassword('timing-equalizer'));
      throw new Error('BAD_CREDENTIALS');
    }
    const sanctions = await this.db.activeSanctions(user.id);
    const ban = sanctions.find(s => s.type === 'ban');
    if (ban) throw new Error(`BANNED:${ban.reason ?? 'violation'}`);
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + GAME.SESSION_DAYS * 86400 * 1000).toISOString();
    await this.db.saveSession({ tokenHash: hashToken(token), userId: user.id, expiresAt });
    await this.db.updateUser(user.id, { last_seen: new Date().toISOString() });
    return { user, token, expiresAt };
  }

  async resolveToken(token) {
    if (!token) return null;
    const s = await this.db.getSession(hashToken(token));
    if (!s) return null;
    return this.db.getUserById(s.userId);
  }

  async logout(token) {
    if (!token) return;
    await this.db.deleteSession(hashToken(token));
  }

  // Promotion ADMIN d'un compte existant via le code admin (credentials vérifiés).
  // Contrairement au bootstrap first-admin, fonctionne même si un admin existe déjà:
  // le code est l'autorité du propriétaire.
  async adminUpgrade(username, password, adminCode, ip) {
    if (!rateLimit(`upgrade:${ip}`, 3, 10 * 60000)) throw new Error('RATE_LIMIT');
    if (!this.constructor.adminCodeMatches(adminCode)) throw new Error('INVALID_CODE');
    const user = await this.db.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.pass_hash)) throw new Error('BAD_CREDENTIALS');
    if (user.role !== 'ADMIN') await this.db.updateUser(user.id, { role: 'ADMIN' });
    return this.db.getUserById(user.id);
  }

  // Admin bootstrap: requires ADMIN_BOOTSTRAP_KEY from env. Cannot be done by choosing a username.
  async bootstrapAdmin(username, password, bootstrapKey, ip) {
    if (!rateLimit(`bootstrap:${ip}`, 3, 10 * 60000)) throw new Error('RATE_LIMIT');
    if (!bootstrapKey) throw new Error('INVALID_KEY');
    if (bootstrapKey !== (process.env.ADMIN_BOOTSTRAP_KEY ?? '')) throw new Error('INVALID_KEY');
    const user = await this.db.getUserByUsername(username);
    if (!user) throw new Error('USER_NOT_FOUND');
    if (!verifyPassword(password, user.pass_hash)) throw new Error('BAD_CREDENTIALS');
    const admins = await this.db.listUsers({ q: '', limit: 1000 });
    const anyAdmin = admins.some(u => u.role === 'ADMIN');
    if (anyAdmin) throw new Error('ADMIN_EXISTS'); // first-admin only
    await this.db.updateUser(user.id, { role: 'ADMIN' });
    return this.db.getUserById(user.id);
  }

  // Player profile payload (safe fields only)
  async profile(user) {
    const fighters = await this.db.getFighters(user.id);
    const inventory = await this.db.getInventory(user.id);
    const membership = await this.db.getClanMembership(user.id);
    const clan = membership ? await this.db.getClan(membership.clanId) : null;
    const season = await this.db.getSeason();
    const ranked = season ? await this.db.getRankedPlayer(user.id, season.id) : null;
    return {
      id: user.id, username: user.username, role: user.role,
      trophies: user.trophies, xp: user.xp, level: user.level,
      avatar: user.avatar, banner: user.banner, title: user.title, privacy: user.privacy,
      credits: user.credits, rift_tokens: user.rift_tokens, pass_xp: user.pass_xp,
      matches: user.matches, wins: user.wins, losses: user.losses, kills: user.kills,
      playtime_s: user.playtime_s, favorite_fighter: user.favorite_fighter,
      fighters, inventory, clan, season, ranked,
      mutedUntil: user.muted_until, bannedUntil: user.banned_until,
    };
  }

  static starterFighters() { return Object.values(FIGHTER_MAP).filter(f => f.unlock?.type === 'default').map(f => f.id); }
}
