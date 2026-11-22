// RIFT ARENA — client state: session, settings (localStorage), live profile cache

const LS_TOKEN = 'ra_token';
const LS_SETTINGS = 'ra_settings';

export const state = {
  token: localStorage.getItem(LS_TOKEN) ?? null,
  profile: null,          // /api/me payload
  catalog: null,          // /api/game/data payload
  ws: null,
  connected: false,
  inQueue: null,          // {mode, ranked}
  party: null,
  notifications: [],      // realtime pings (friend requests, invites, announcements)
  unread: 0,
  lastAnnouncement: null,
};

export const defaultSettings = {
  master: 0.8, music: 0.6, sfx: 0.9, mute: false,
  fpsCap: 60, graphics: 'auto', shake: true, particles: true,
  aimAssist: true, autoAim: false, autoAttack: false,
  forceLayout: 'auto', // auto | mobile | desktop
  keybinds: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', attack: 'mouse0', ability: 'mouse2', super: 'Space', interact: 'KeyE' },
  joystickSide: 'left', hudScale: 1,
  privacy: 'public',
};

export function settings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}') }; }
  catch { return { ...defaultSettings }; }
}
export function saveSettings(patch) {
  const merged = { ...settings(), ...patch };
  localStorage.setItem(LS_SETTINGS, JSON.stringify(merged));
  return merged;
}

export function setToken(t) {
  state.token = t;
  if (t) localStorage.setItem(LS_TOKEN, t);
  else localStorage.removeItem(LS_TOKEN);
}

export function isMobileLayout() {
  const s = settings();
  if (s.forceLayout === 'mobile') return true;
  if (s.forceLayout === 'desktop') return false;
  return window.matchMedia('(max-width: 860px)').matches || ('ontouchstart' in window && window.innerWidth < 1024);
}

export function role() { return state.profile?.role ?? 'player'; }
export function isStaff() { return ['ADMIN', 'MODERATOR', 'HELPER'].includes(role()); }
export function isAdmin() { return role() === 'ADMIN'; }
