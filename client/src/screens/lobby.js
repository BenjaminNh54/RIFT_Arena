// RIFT ARENA — lobby: hero fighter, PLAY, mode select, missions/events/friends previews, matchmaking overlay
import { h, modal, toast, pill, fmt, timeLeft, drawFighter, confirmBox } from '../components/ui.js';
import { icon } from '../components/icons.js';
import {api,errText,onWs,disconnectWs} from '../network/api.js';
import { state, isMobileLayout } from '../state.js';
import { refreshProfile } from '../app.js';
import { navigate } from '../router.js';
import { MODE_MAP } from '/shared/definitions/modes.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';

let queueOverlay = null;
let selectedMode = localStorage.getItem('ra_mode') ?? 'crystal_rush';

export function renderLobby(el) {
  document.title = 'RIFT ARENA';
  const p = state.profile;
  const grid = h('div', { class: 'lobby-grid' });

  // ---------- hero ----------
  const hero = h('div', { class: 'lobby-hero' });
  hero.append(h('div', { class: 'hero-stage' }));
  const cv = h('canvas', { class: 'hero-canvas' });
  hero.append(cv, h('div', { class: 'hero-info' },
    h('div', { class: 'fighter-name', text: selectedFighter()?.name ?? 'VOLT' }),
    h('div', { class: 'fighter-class', text: `${selectedFighter()?.clazz ?? ''} · ${selectedRarity()}` }),
  ));
  const bottom = h('div', { class: 'hero-bottom' });

  // mode selector + switch fighter
  const switchRow = h('div', { class: 'hero-switch' });
  switchRow.append(h('button', { class: 'btn small', html: `${icon('fighters')} Changer`, onClick: () => navigate('collection') }));
  const modeBtn = h('div', { class: 'hero-mode', onClick: openModeSelect });
  renderModeBtn(modeBtn);
  switchRow.append(modeBtn);

  const playBtn = h('button', { class: 'btn play', html: `${icon('play')} JOUER`, onClick: startQueue });
  bottom.append(switchRow, playBtn);
  const metaRow = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } });
  metaRow.append(pill('trophies', p.trophies), h('span', { class: 'badge gray', text: selectedMapLabel() }));
  bottom.append(metaRow);
  hero.append(bottom);
  grid.append(hero);

  // ---------- side panels ----------
  const side = h('div', { class: 'lobby-side' });

  // season / pass progress
  side.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-title', html: `${icon('pass')} Pass de saison` }),
    h('div', { class: 'row' }, h('b', { text: `Palier ${passTier()}` }), h('span', { class: 'spacer' }), h('span', { class: 'dim small', text: `${fmt(p.pass_xp ?? 0)} XP` })),
    h('div', { class: 'bar', style: { marginTop: '8px' } }, h('i', { style: { width: `${passProgress()}%` } })),
    h('button', { class: 'btn small ghost', style: { marginTop: '10px' }, text: 'Ouvrir le Pass', onClick: () => navigate('pass') }),
  ));

  // active event
  const evPanel = h('div', { class: 'panel' });
  evPanel.append(h('div', { class: 'panel-title', html: `${icon('events')} Event en cours` }));
  const evBody = h('div', { text: 'Chargement…', class: 'dim small' });
  evPanel.append(evBody);
  loadActiveEvent(evBody);
  side.append(evPanel);

  // missions preview
  const miPanel = h('div', { class: 'panel' });
  miPanel.append(h('div', { class: 'panel-title', html: `${icon('missions')} Missions du jour` }));
  const miBody = h('div', { class: 'mission-mini' });
  miPanel.append(miBody, h('button', { class: 'btn small ghost', style: { marginTop: '8px' }, text: 'Toutes les missions', onClick: () => navigate('missions') }));
  loadMissionsPreview(miBody);
  side.append(miPanel);

  // friends online
  const frPanel = h('div', { class: 'panel' });
  frPanel.append(h('div', { class: 'panel-title', html: `${icon('friends')} Amis en ligne` }));
  const frBody = h('div', {});
  frPanel.append(frBody, h('button', { class: 'btn small ghost', style: { marginTop: '8px' }, text: 'Ouvrir les amis', onClick: () => navigate('friends') }));
  loadFriendsPreview(frBody);
  side.append(frPanel);

  // clan mini
  const clanPanel = h('div', { class: 'panel' });
  if (p.clan) {
    clanPanel.append(h('div', { class: 'panel-title', html: `${icon('clan')} Mon clan` }),
      h('div', { class: 'row' }, h('span', { class: 'clan-tag', text: p.clan.tag }), h('b', { text: p.clan.name }), h('span', { class: 'spacer' }), h('span', { class: 'dim small', text: `Niv ${p.clan.level}` })));
  } else {
    clanPanel.append(h('div', { class: 'panel-title', html: `${icon('clan')} Clan` }),
      h('div', { class: 'dim small', text: 'Rejoins un clan pour jouer en équipe et gagner des récompenses.' }),
      h('button', { class: 'btn small', style: { marginTop: '8px' }, text: 'Découvrir les clans', onClick: () => navigate('clan') }));
  }
  side.append(clanPanel);

  // news mini
  const newsPanel = h('div', { class: 'panel' });
  newsPanel.append(h('div', { class: 'panel-title', html: `${icon('news')} Nouveautés` }));
  loadNewsPreview(newsPanel);
  side.append(newsPanel);

  grid.append(side);
  el.append(grid);

  // animate hero fighter
  let raf; let t0 = performance.now();
  const fighter = selectedFighter();
  function loop(t) {
    const ctx = cv.getContext('2d');
    const w = cv.width = cv.clientWidth * devicePixelRatio;
    const hh = cv.height = cv.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, hh);
    if (fighter) {
      const bob = Math.sin((t - t0) / 700) * 8;
      drawFighter(cv, fighter, { size: Math.min(w, hh) * 0.62 });
      // idle float via CSS-ish transform on next draw: cheaper to just redraw with offset
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  el._cleanup = () => cancelAnimationFrame(raf);

  // matchmaking result handler
  onWs('match_found', () => closeQueueOverlay());
}

function selectedFighter() {
  const id = state.profile?.fighters ? Object.keys(state.profile.fighters).find(f => state.profile.fighters[f].unlocked && (state.profile.selected_fighter === f)) : null;
  const fid = id ?? Object.keys(state.profile?.fighters ?? {}).find(f => state.profile.fighters[f].unlocked) ?? 'volt';
  return FIGHTER_MAP[fid] ?? FIGHTER_MAP.volt;
}
function selectedRarity() {
  const r = selectedFighter()?.rarity;
  return { starter: 'Starter', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire' }[r] ?? '';
}
function passTier() { return Math.min(30, Math.floor((state.profile?.pass_xp ?? 0) / 120) + 1); }
function passProgress() { return Math.min(100, ((state.profile?.pass_xp ?? 0) % 120) / 120 * 100); }

function renderModeBtn(btn) {
  const def = MODE_MAP[selectedMode];
  btn.innerHTML = '';
  btn.append(h('div', {},
    h('div', { class: 'm-name', text: def?.name ?? selectedMode }),
    h('div', { class: 'm-sub', text: def ? `${def.type === 'ffa' ? '8 joueurs' : def.type === 'coop' ? 'Co-op' : `${def.teamSize}v${def.teamSize}`}` : '' }),
  ), h('span', { class: 'chev', html: icon('select') }));
}

function selectedMapLabel() {
  const def = MODE_MAP[selectedMode];
  return def ? def.desc.slice(0, 34) + '…' : '';
}

function openModeSelect() {
  const body = h('div', { class: 'grid cols-2' });
  for (const [id, def] of Object.entries(MODE_MAP)) {
    body.append(h('div', {
      class: 'card clickable',
      onClick: () => {
        selectedMode = id;
        localStorage.setItem('ra_mode', id);
        renderModeBtn(document.querySelector('.hero-mode'));
        m.close();
      },
    },
    h('div', { class: 'row' }, h('b', { text: def.name }), h('span', { class: 'spacer' }),
      h('span', { class: 'badge ' + (def.ranked ? 'violet' : 'gray'), text: def.ranked ? 'Classé dispo' : 'Normal' })),
    h('div', { class: 'dim small', style: { marginTop: '6px' }, text: def.desc })));
  }
  const m = modal({ title: 'Choisir un mode', body, actions: [{ label: 'Fermer', kind: 'ghost' }] });
}

// ---------- matchmaking ----------
async function startQueue() {
  const ranked = false; // ranked queue lives in the Ranked screen
  if (queueOverlay) return;
  try {
    const res = await api.post('/api/queue', { mode: selectedMode, ranked });
    openQueueOverlay(res.timeoutMs ?? 20000);
  } catch (e) {
    toast(errText(e), 'error');
  }
}

function openQueueOverlay(timeoutMs) {
  const t0 = Date.now();
  const count = h('div', { class: 'mm-count', text: '0s' });
  const ov = h('div', { class: 'mm-overlay' },
    h('div', { class: 'mm-ring', html: icon('refresh') }),
    h('div', { class: 'mm-status', text: 'Recherche de joueurs…' }),
    h('div', { class: 'mm-eta', text: `${MODE_MAP[selectedMode]?.name ?? ''} — les bots rejoignent après 8s en file normale` }),
    count,
    h('button', { class: 'btn danger', text: 'Annuler', onClick: cancel }),
  );
  document.getElementById('overlays').append(ov);
  queueOverlay = ov;
  const iv = setInterval(() => { count.textContent = `${Math.floor((Date.now() - t0) / 1000)}s`; }, 500);
  function cancel() {
    clearInterval(iv);
    api.del('/api/queue').catch(() => {});
    closeQueueOverlay();
    toast('Recherche annulée');
  }
  ov._cancel = cancel;
}

function closeQueueOverlay() {
  queueOverlay?.remove();
  queueOverlay = null;
}

// ---------- data loaders ----------
async function loadActiveEvent(body) {
  try {
    const { events } = await api.get('/api/events');
    const active = events.filter(e => e.live).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (!active) { body.textContent = 'Aucun event actif — reviens bientôt.'; body.classList.add('dim'); return; }
    body.innerHTML = '';
    body.append(h('div', {
      class: 'event-mini',
      onClick: () => navigate('events'),
    },
    h('div', { class: 'ev-color', style: { background: active.accent ?? 'var(--violet)' }, html: icon('events') }),
    h('div', { style: { flex: 1 } },
      h('div', {}, h('b', { text: active.name }), h('span', { class: 'spacer' }),
        h('span', { class: 'event-countdown', style: { color: active.accent }, text: timeLeft(active.endAt) })),
      h('div', { class: 'dim small', text: `${MODE_MAP[active.mode]?.name ?? active.mode} · récompense garantie` })),
    ));
  } catch { body.textContent = 'Indisponible hors ligne.'; }
}

async function loadMissionsPreview(body) {
  try {
    const { missions } = await api.get('/api/missions');
    const daily = (missions.daily ?? []).filter(m => !m.claimed).slice(0, 3);
    body.innerHTML = '';
    for (const m of daily) {
      body.append(h('div', { class: 'mission-line' },
        h('div', { class: 'm-top' }, h('span', { text: m.desc }), h('span', { class: 'dim small mono', text: `${m.progress}/${m.target}` })),
        h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, m.progress / m.target * 100)}%` } })),
      ));
    }
    if (!daily.length) body.append(h('div', { class: 'dim small', text: 'Toutes tes missions du jour sont terminées.' }));
  } catch { body.append(h('div', { class: 'dim small', text: 'Indisponible hors ligne.' })); }
}

async function loadFriendsPreview(body) {
  try {
    const { friends } = await api.get('/api/friends');
    const online = friends.filter(f => f.presence !== 'offline' && !f.blockedBy);
    body.innerHTML = '';
    if (!friends.length) { body.append(h('div', { class: 'dim small', text: 'Ajoute des amis depuis le menu Amis.' })); return; }
    for (const f of online.slice(0, 4)) {
      body.append(h('div', { class: 'friend-row', onClick: () => navigate('friends') },
        h('span', { class: `presence ${f.presence}` }),
        h('span', { text: f.username }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'faint small', text: f.presence === 'in_match' ? 'en match' : 'en ligne' }),
      ));
    }
    if (!online.length) body.append(h('div', { class: 'dim small', text: `${friends.length} ami(s) — aucun en ligne.` }));
  } catch { /* offline */ }
}

async function loadNewsPreview(panel) {
  try {
    const { news } = await api.get('/api/news');
    const first = news[0];
    if (!first) return;
    const body = h('div', { class: 'clickable', onClick: () => navigate('news') },
      h('div', { class: 'row' }, h('b', { text: first.title }), h('span', { class: 'spacer' }), h('span', { class: 'badge', text: first.category })),
      h('div', { class: 'dim small', style: { marginTop: '6px' }, text: first.body.slice(0, 120) + '…' }));
    panel.append(body);
  } catch { /* offline */ }
}
