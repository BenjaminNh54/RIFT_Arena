// RIFT ARENA — REST API client + WebSocket with auto-reconnect
import { state } from '../state.js';

async function request(method, path, body = null) {
  const headers = { 'X-Requested-With': 'rift-arena' };
  if (body) headers['Content-Type'] = 'application/json';
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401) { state.profile = null; }
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  del: (p) => request('DELETE', p),
};

const ERROR_FR = {
  USERNAME_INVALID: 'Nom invalide : 3-16 caractères (lettres, chiffres, _ -)',
  PASSWORD_INVALID: 'Mot de passe trop court (6 minimum)',
  USERNAME_TAKEN: 'Ce nom est déjà pris',
  BAD_CREDENTIALS: 'Identifiants incorrects',
  RATE_LIMIT: 'Trop de tentatives — réessaie dans quelques minutes',
  AUTH_REQUIRED: 'Connexion requise',
  NOT_OWNED: 'Combattant non débloqué',
  NOT_ENOUGH: 'Fonds insuffisants',
  NOT_ENOUGH_CREDITS: 'Crédits insuffisants',
  ALREADY_OWNED: 'Déjà possédé',
  ALREADY_FRIENDS: 'Déjà ami',
  CANNOT_ADD_SELF: 'Impossible de s\'ajouter soi-même',
  USER_NOT_FOUND: 'Joueur introuvable',
  NO_REQUEST: 'Aucune demande',
  PARTY_NOT_FOUND: 'Groupe introuvable',
  PARTY_FULL: 'Groupe complet',
  NOT_LEADER: 'Réservé au chef de groupe',
  CLAN_NOT_FOUND: 'Clan introuvable',
  CLAN_NAME_INVALID: 'Nom de clan invalide (3-20)',
  CLAN_TAG_INVALID: 'Tag invalide (2-5 lettres/chiffres)',
  TAG_TAKEN: 'Tag déjà utilisé',
  ALREADY_IN_CLAN: 'Déjà dans un clan',
  CLAN_FULL: 'Clan complet',
  NO_PERMISSION: 'Permission refusée',
  NOT_IN_CLAN: 'Pas dans un clan',
  TIER_LOCKED: 'Palier verrouillé',
  ALREADY_CLAIMED: 'Déjà réclamé',
  PREMIUM_REQUIRED: 'Pass Premium requis',
  INCOMPLETE: 'Objectif incomplet',
  NOT_CLAIMABLE: 'Non réclamable',
  CHEST_NOT_FOUND: 'Coffre inconnu',
  NO_CHEST: 'Aucun coffre',
  ITEM_NOT_FOUND: 'Objet introuvable',
  BANNED: 'Compte banni',
  MUTED: 'Réduit au silence',
  TITLE_NOT_OWNED: 'Titre non possédé',
  MAINTENANCE: 'Serveur en maintenance',
  CONFIRM_REQUIRED: 'Confirmation requise',
  CANNOT_SANCTION_STAFF: 'Impossible de sanctionner un membre du staff',
  INVALID_MAP: 'Map invalide',
};

export function errText(e) {
  const code = e?.code ?? e?.message ?? '';
  if (ERROR_FR[code]) return ERROR_FR[code];
  if (code.startsWith('BANNED:')) return 'Compte banni : ' + code.slice(7);
  return code || 'Erreur réseau';
}

// ---------- WebSocket (auto-reconnect, exponential backoff) ----------
const wsHandlers = new Map(); // t -> Set(fn)

export function onWs(type, fn) {
  if (!wsHandlers.has(type)) wsHandlers.set(type, new Set());
  wsHandlers.get(type).add(fn);
  return () => wsHandlers.get(type)?.delete(fn);
}
export function wsSend(msg) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(msg));
}

let retry = 0;
let reconnectTimer = null;

export function connectWs() {
  if (!state.token) return;
  clearTimeout(reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ t: 'auth', token: state.token }));
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const set = wsHandlers.get(msg.t);
    if (set) for (const fn of set) { try { fn(msg); } catch (e) { console.error('[ws handler]', e); } }
  };
  ws.onclose = () => {
    state.connected = false;
    if (!state.token) return;
    const delay = Math.min(10000, 600 * Math.pow(2, retry++));
    reconnectTimer = setTimeout(connectWs, delay);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
}

export function disconnectWs() {
  state.token = null;
  try { state.ws?.close(); } catch { /* noop */ }
}
