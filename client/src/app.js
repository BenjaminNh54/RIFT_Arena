// RIFT ARENA — app bootstrap: splash, auth session, SPA shell (topbar + sidebar/bottom nav), realtime wiring
import { state, settings, isMobileLayout, setToken, isStaff } from './state.js';
import { api, errText, connectWs, disconnectWs, onWs } from './network/api.js';
import { initRouter, navigate, registerScreen, currentScreen } from './router.js';
import { h, toast, modal } from './components/ui.js';
import { icon as svgStr } from './components/icons.js';

import { renderAuth } from './screens/auth.js';
import { renderLobby } from './screens/lobby.js';
import { renderCollection, renderFighterDetail } from './screens/collection.js';
import { renderRoad } from './screens/road.js';
import { renderRanked } from './screens/ranked.js';
import { renderPass } from './screens/pass.js';
import { renderMissions } from './screens/missions.js';
import { renderEvents } from './screens/events.js';
import { renderClan } from './screens/clan.js';
import { renderFriends } from './screens/friends.js';
import { renderProfile } from './screens/profile.js';
import { renderShop } from './screens/shop.js';
import { renderNews } from './screens/news.js';
import { renderMaps } from './screens/maps.js';
import { renderEditor } from './editor/editor.js';
import { renderSettings } from './screens/settings.js';
import { renderAdmin } from './screens/admin.js';
import { launchMatchClient } from './game/client.js';

const NAV = [
  { id: 'lobby', label: 'Lobby', icon: 'play' },
  { id: 'collection', label: 'Persos', icon: 'fighters' },
  { id: 'road', label: 'Route TR', icon: 'trophy' },
  { id: 'ranked', label: 'Classé', icon: 'ranked' },
  { id: 'pass', label: 'Pass', icon: 'pass' },
  { id: 'missions', label: 'Missions', icon: 'missions' },
  { id: 'events', label: 'Events', icon: 'events' },
  { id: 'clan', label: 'Clan', icon: 'clan' },
  { id: 'friends', label: 'Amis', icon: 'friends' },
  { id: 'maps', label: 'Maps', icon: 'maps' },
  { id: 'editor', label: 'Créer', icon: 'editor' },
  { id: 'shop', label: 'Boutique', icon: 'shop' },
  { id: 'news', label: 'News', icon: 'news' },
  { id: 'settings', label: 'Options', icon: 'settings' },
];
const MOBILE_NAV = ['lobby', 'collection', 'events', 'clan', 'friends', 'shop'];

let shell = null;

async function boot() {
  const app = document.getElementById('app');
  initRouter(app);

  registerScreen('auth', { render: renderAuth });
  registerScreen('lobby', { render: renderLobby });
  registerScreen('collection', { render: (el, params) => params.fighter ? renderFighterDetail(el, params.fighter) : renderCollection(el) });
  registerScreen('road', { render: renderRoad });
  registerScreen('ranked', { render: renderRanked });
  registerScreen('pass', { render: renderPass });
  registerScreen('missions', { render: renderMissions });
  registerScreen('events', { render: renderEvents });
  registerScreen('clan', { render: renderClan });
  registerScreen('friends', { render: renderFriends });
  registerScreen('profile', { render: renderProfile });
  registerScreen('shop', { render: renderShop });
  registerScreen('news', { render: renderNews });
  registerScreen('maps', { render: renderMaps });
  registerScreen('editor', { render: renderEditor });
  registerScreen('settings', { render: renderSettings });
  registerScreen('admin', { render: renderAdmin });

  // load catalog
  try { state.catalog = await api.get('/api/game/data'); }
  catch { /* offline — auth screen still loads */ }

  // restore session
  if (state.token) {
    try {
      const { profile } = await api.get('/api/me');
      state.profile = profile;
      connectWs();
    } catch {
      setToken(null);
      state.profile = null;
    }
  }

  document.getElementById('boot')?.classList.add('done');
  setTimeout(() => document.getElementById('boot')?.remove(), 400);

  if (state.profile) buildShell();
  else navigate('auth');
}

// ---------- shell ----------
export function buildShell() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  shell = h('div', { class: 'app-shell' });
  shell.append(buildTopbar());
  const body = h('div', { class: 'app-body' });
  const sidebar = h('nav', { class: 'sidebar', id: 'sidebar' });
  const content = h('div', { class: 'content', id: 'screen-root' });
  body.append(sidebar, content);
  shell.append(body);
  shell.append(buildBottomNav());
  app.append(shell, h('div', { class: 'rift-bg', style: { position: 'absolute', zIndex: -1 } }));

  // re-point the router into the shell's screen root — without this, navigate()
  // keeps rendering into #app and WIPES the freshly built shell
  initRouter(content);

  refreshNav();
  navigate('lobby');
  if (isStaff()) {
    // staff shortcut entry exists in settings; nothing forced here
  }
}

function navEl(item, mobile = false) {
  const b = h('button', {
    class: `nav-item ${mobile ? 'm-nav' : 's-nav'}`,
    html: `${svgStr(item.icon)}<span>${item.label}</span>`,
    onClick: () => navigate(item.id),
  });
  b.dataset.target = item.id;
  return b;
}

function buildTopbar() {
  const s = settings();
  const bar = h('header', { class: 'topbar' });
  const prof = state.profile;
  bar.append(h('div', {
    class: 'logo', html: `${svgStr('bolt')}<span>RIFT <span class="accent">ARENA</span></span>`,
  }));
  const chip = h('div', { class: 'profile-chip', onClick: () => navigate('profile', { name: prof.username }) });
  const avatar = h('div', { class: 'avatar', text: (prof.username ?? '?').slice(0, 2).toUpperCase() });
  chip.append(avatar, h('div', {},
    h('div', { class: 'pname' }, prof.username ?? ''),
    h('div', { class: 'psub' }, `${(prof.trophies ?? 0).toLocaleString('fr-FR')} TR · Niv ${prof.level ?? 1}`),
  ));
  bar.append(chip);
  bar.append(h('span', { class: 'spacer' }));

  const wallets = h('div', { class: 'row', id: 'wallet-row', style: { gap: '8px' } });
  wallets.append(h('span', { class: 'pill credits', html: `${svgStr('coin')}<b class="mono" id="w-credits">${(prof.credits ?? 0).toLocaleString('fr-FR')}</b>` }));
  wallets.append(h('span', { class: 'pill tokens', html: `${svgStr('token')}<b class="mono" id="w-tokens">${(prof.rift_tokens ?? 0).toLocaleString('fr-FR')}</b>` }));
  bar.append(wallets);

  const notifBtn = h('button', { class: 'iconbtn', html: svgStr('bell'), id: 'notif-btn', onClick: openNotifications, style: { position: 'relative' } });
  notifBtn.append(h('span', { class: 'dot hidden', id: 'notif-dot' }));
  bar.append(notifBtn);

  bar.append(h('button', { class: 'iconbtn', html: svgStr('settings'), onClick: () => navigate('settings') }));
  bar.append(h('button', {
    class: 'iconbtn', html: svgStr('logout'),
    title: 'Déconnexion',
    onClick: async () => {
      try { await api.post('/api/auth/logout'); } catch { /* offline */ }
      setToken(null);
      disconnectWs();
      state.profile = null;
      document.getElementById('app').innerHTML = '';
      navigate('auth');
    },
  }));
  return bar;
}

function buildBottomNav() {
  const nav = h('nav', { class: 'bottom-nav' });
  const inner = h('div', { class: 'bn-inner' });
  for (const id of MOBILE_NAV) {
    const item = NAV.find(n => n.id === id);
    if (item) inner.append(navEl(item, true));
  }
  const item = NAV.find(n => n.id === 'missions');
  inner.append(navEl(item, true));
  nav.append(inner);
  return nav;
}

export function refreshNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.target === currentScreen());
  });
}

export function updateWallets() {
  const p = state.profile;
  if (!p) return;
  document.getElementById('w-credits') && (document.getElementById('w-credits').textContent = (p.credits ?? 0).toLocaleString('fr-FR'));
  document.getElementById('w-tokens') && (document.getElementById('w-tokens').textContent = (p.rift_tokens ?? 0).toLocaleString('fr-FR'));
}

export async function refreshProfile() {
  try {
    const { profile } = await api.get('/api/me');
    state.profile = profile;
    updateWallets();
  } catch { /* offline */ }
}

// ---------- notifications ----------
function openNotifications() {
  state.unread = 0;
  document.getElementById('notif-dot')?.classList.add('hidden');
  const list = h('div', { class: 'scroll-y', style: { maxHeight: '320px' } });
  if (state.notifications.length === 0) {
    list.append(h('div', { class: 'empty' }, 'Aucune notification.'));
  }
  for (const n of [...state.notifications].reverse()) {
    list.append(h('div', { class: 'notif-item' }, h('span', { class: 'dim small', text: new Date(n.at).toLocaleTimeString('fr-FR') }), h('span', { text: n.text })));
  }
  modal({ title: 'Notifications', body: list, actions: [{ label: 'OK', kind: 'primary' }] });
}

function pushNotification(text) {
  state.notifications.push({ text, at: Date.now() });
  if (state.notifications.length > 40) state.notifications.shift();
  state.unread++;
  document.getElementById('notif-dot')?.classList.remove('hidden');
  toast(text);
}

// ---------- realtime wiring ----------
onWs('hello', () => { state.connected = true; });
onWs('chat', (m) => {
  if (m.channel === 'global') toast(`[Global] ${m.username}: ${m.text.slice(0, 60)}`);
});
onWs('friend_request', (m) => pushNotification(`Demande d'ami de ${m.name}`));
onWs('friend_accept', (m) => pushNotification(`${m.name} a accepté ta demande d'ami`));
onWs('party_invite', (m) => {
  modal({
    title: 'Invitation groupe',
    body: h('p', { text: `${m.name} t'invite dans son groupe.` }),
    actions: [
      { label: 'Refuser', kind: 'ghost' },
      {
        label: 'Rejoindre', kind: 'primary', onClick: async (close) => {
          close();
          try {
            await api.post('/api/party', { action: 'join', partyId: m.partyId });
            toast('Groupe rejoint', 'success');
            navigate('friends');
          } catch (e) { toast(errText(e), 'error'); }
        },
      },
    ],
  });
});
onWs('party_update', (m) => { state.party = m.party; });
onWs('party_kicked', () => { state.party = null; pushNotification('Tu as été exclu du groupe'); });
onWs('clan_kicked', () => pushNotification('Tu as été exclu du clan'));
onWs('clan_request', () => pushNotification('Nouvelle demande d\'adhésion au clan'));
onWs('clan_joined', () => pushNotification('Ta demande a été acceptée'));
onWs('clan_update', () => { if (currentScreen() === 'clan') navigate('clan', {}, { force: true }); });
onWs('announcement', (m) => pushNotification(`[Annonce] ${m.text}`));
onWs('blocked', () => pushNotification('Un joueur t\'a bloqué'));
onWs('match_found', () => { /* handled by lobby queue overlay */ });
onWs('error', (m) => { if (m.code && m.code !== 'AUTH_REQUIRED' && m.code !== 'UNKNOWN_MSG') toast(m.code, 'error'); });

// match launch: central handler — the lobby overlay triggers this
onWs('match_found', (m) => {
  launchMatchClient(m);
});
export { pushNotification };

boot();
