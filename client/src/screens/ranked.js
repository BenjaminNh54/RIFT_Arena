// RIFT ARENA — Ranked screen (league badge, RP, queue ranked, leaderboard)
import { h, toast, fmt } from '../components/ui.js';
import { icon } from '../components/icons.js';
import {api,errText} from '../network/api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { MODE_MAP } from '/shared/definitions/modes.js';

export function renderRanked(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Mode Classé' }),
    h('span', { class: 'sub', text: 'Bots désactivés · matchmaking par rating' })));
  const body = h('div', { class: 'dim small', text: 'Chargement…' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/ranked'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';
  body.classList.remove('dim', 'small');

  // hero
  const hero = h('div', { class: 'panel rank-hero' });
  const badge = h('div', { class: 'rank-badge', html: leagueBadge(data.league) });
  const info = h('div', { class: 'rank-info' },
    h('div', { class: 'rank-league', style: { color: data.league.color }, text: data.league.name }),
    h('div', { class: 'rank-div', text: `Division ${data.league.division} · ${fmt(data.rp)} RP` }),
    h('div', { class: 'rank-progress' },
      h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((data.league.divProgress ?? 0) * 100)}%` } })),
      h('div', { class: 'faint small', style: { marginTop: '6px' }, text: data.season ? `${data.season.name} — saison en cours` : 'Aucune saison active' })),
    h('button', {
      class: 'btn play', style: { marginTop: '16px' }, html: `${icon('play')} FILE CLASSÉE`,
      onClick: () => queueRanked(data),
    }),
    h('div', { class: 'faint small', style: { marginTop: '8px' } }, 'Victoires : +25 RP · Défaites : -18 RP (protection après 3 défaites)'));
  hero.append(badge, info);
  body.append(hero);

  // my stats
  if (data.me) {
    body.append(h('div', { class: 'panel', style: { marginTop: '12px' } },
      h('div', { class: 'panel-title', html: `${icon('ranked')} Ta saison` }),
      h('div', { class: 'grid cols-4' },
        statBox(fmt(data.me.rp ?? 0), 'RP'),
        statBox(`${data.me.wins ?? 0}`, 'Victoires'),
        statBox(`${data.me.losses ?? 0}`, 'Défaites'),
        statBox(fmt(data.me.peak ?? 0), 'Peak RP'))));
  }

  // leaderboard
  const lb = h('div', { class: 'panel', style: { marginTop: '12px' } });
  lb.append(h('div', { class: 'panel-title', html: `${icon('crown')} Classement global` }));
  if (!data.leaderboard.length) lb.append(h('div', { class: 'empty', text: 'Sois le premier à grimper !' }));
  else {
    data.leaderboard.forEach((r, i) => {
      lb.append(h('div', { class: `lb-row ${r.username === state.profile?.username ? 'me' : ''}` },
        h('b', { text: `#${i + 1}` }),
        h('span', { text: r.username }),
        h('span', { class: 'dim small mono', text: `${r.wins}V / ${r.losses}D` }),
        h('b', { class: 'mono', text: `${fmt(r.rp)} RP` })));
    });
  }
  body.append(lb);
}

function statBox(v, label) {
  return h('div', { class: 'pstat' }, h('b', { text: v }), h('span', { text: label }));
}

function leagueBadge(l) {
  const c = l.color ?? '#8fa0c9';
  return `<svg viewBox="0 0 100 100">
    <defs><linearGradient id="lg${l.id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c}" stop-opacity="0.9"/><stop offset="1" stop-color="#0a0f1e"/>
    </linearGradient></defs>
    <polygon points="50,4 92,26 92,62 50,96 8,62 8,26" fill="url(#lg${l.id})" stroke="${c}" stroke-width="3"/>
    <path d="M50 22 L64 44 L50 38 L36 44 Z" fill="#0a0f1e" opacity="0.65"/>
    <circle cx="50" cy="52" r="10" fill="#0a0f1e" opacity="0.65"/>
  </svg>`;
}

let rankQueueOv = null;
function queueRanked(data) {
  if (rankQueueOv) return;
  // ranked queue picks mode in a modal
  const body = h('div', { class: 'grid cols-2' });
  for (const [id, def] of Object.entries(MODE_MAP)) {
    if (!def.ranked) continue;
    body.append(h('div', {
      class: 'card clickable', onClick: () => { m.close(); startRankedQueue(id); },
    }, h('b', { text: def.name }), h('div', { class: 'dim small', style: { marginTop: '4px' }, text: def.desc })));
  }
  const m = modal({ title: 'File classée — choisir un mode', body, actions: [{ label: 'Fermer', kind: 'ghost' }] });
}

function startRankedQueue(mode) {
  try {
    api.post('/api/queue', { mode, ranked: true }).catch((e) => toast(errText(e), 'error'));
    toast(`File classée ${MODE_MAP[mode].name} rejointe`, 'success');
    // reuse lobby-style overlay
    const ov = h('div', { class: 'mm-overlay' },
      h('div', { class: 'mm-ring', html: icon('refresh') }),
      h('div', { class: 'mm-status', text: 'Recherche classée…' }),
      h('div', { class: 'mm-eta', text: 'Bots désactivés en classé — le matchmaking attend de vrais joueurs' }),
      h('button', { class: 'btn danger', text: 'Annuler', onClick: () => {
        api.del('/api/queue').catch(() => {});
        ov.remove(); rankQueueOv = null;
      } }));
    document.getElementById('overlays').append(ov);
    rankQueueOv = ov;
  } catch (e) { toast(errText(e), 'error'); }
}
