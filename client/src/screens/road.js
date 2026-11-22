// RIFT ARENA — Trophy Road (Route des TR)
import { h, modal, toast, fmt, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state } from '../state.js';

const REWARD_LABEL = {
  credits: (r) => `${r.amount} crédits`,
  rift_tokens: (r) => `${r.amount} jetons`,
  fighter: (r) => `Combattant ${r.id.toUpperCase()}`,
  skin: (r) => `Skin ${r.id}`,
  title: (r) => `Titre ${r.id}`,
  banner: (r) => `Bannière ${r.id}`,
  chest: (r) => `Coffre ${r.id} x${r.amount ?? 1}`,
  avatar: (r) => `Avatar ${r.id}`,
  effect: (r) => `Effet ${r.id}`,
  emote: (r) => `Emote ${r.id}`,
};
const REWARD_ICON = { credits: 'coin', rift_tokens: 'token', fighter: 'fighters', skin: 'star', title: 'crown', banner: 'flag', chest: 'pass', avatar: 'profile', effect: 'bolt', emote: 'chat' };

export function renderRoad(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Route des TR' }),
    pill('trophies', state.profile?.trophies ?? 0)));

  const body = h('div', { class: 'dim small', text: 'Chargement…' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/road'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';
  body.classList.remove('dim', 'small');

  const cur = data.trophies;
  const next = data.steps.find(s => s.at > cur);
  body.append(h('div', { class: 'panel road-progress' },
    h('div', { class: 'row' },
      h('b', { text: `${fmt(cur)} TR` }),
      h('span', { class: 'spacer' }),
      h('span', { class: 'dim small', text: next ? `Prochaine récompense à ${fmt(next.at)} TR : ${next.label}` : 'Route complète — bravo !' })),
    h('div', { class: 'bar', style: { marginTop: '8px' } },
      h('i', { style: { width: next ? `${Math.min(100, (cur / next.at) * 100)}%` : '100%' } })),
  ));

  // history
  if (data.history?.length) {
    const hist = h('div', { class: 'panel', style: { marginTop: '12px' } });
    hist.append(h('div', { class: 'panel-title', html: `${icon('clock')} Historique récent` }));
    for (const h2 of data.history.slice(0, 8)) {
      hist.append(h('div', { class: 'stat-row' },
        h('span', { class: 'dim small', text: h2.reason?.replace(':', ' — ') ?? '' }),
        h('b', { class: 'mono', style: { color: h2.amount >= 0 ? 'var(--green)' : 'var(--red)' }, text: `${h2.amount >= 0 ? '+' : ''}${h2.amount} TR` })));
    }
    body.append(hist);
  }

  // horizontal timeline
  const track = h('div', { class: 'road-track' });
  for (const s of data.steps) {
    const done = cur >= s.at;
    const isNext = next && s.at === next.at;
    const step = h('div', { class: `road-step ${done ? 'done' : ''} ${isNext ? 'next' : ''}` },
      h('div', { class: 'road-link' }),
      h('div', { class: 'node', html: icon(done ? 'check' : REWARD_ICON[s.reward.type] ?? 'star') }),
      h('div', { class: 'at', text: `${fmt(s.at)} TR` }),
      h('div', { class: 'lbl', text: s.label }),
      h('button', {
        class: `btn small ${done ? '' : 'ghost'}`,
        text: done ? 'Reçu' : isNext ? 'En approche' : 'Verrouillé',
        disabled: !done,
        onClick: () => showReward(s),
      }),
    );
    track.append(step);
  }
  body.append(track);
}

function showReward(s) {
  modal({
    title: `Palier ${fmt(s.at)} TR`,
    body: h('div', { class: 'reward-pop' },
      h('div', { class: 'rp-icon', html: icon(REWARD_ICON[s.reward.type] ?? 'star') }),
      h('h3', { text: s.label }),
      h('p', { class: 'dim small', style: { marginTop: '6px' }, text: REWARD_LABEL[s.reward.type]?.(s.reward) ?? '' }),
      h('p', { class: 'faint small', style: { marginTop: '10px' } }, 'Les récompenses de palier sont accordées automatiquement quand tu atteins le seuil.')),
    actions: [{ label: 'Fermer', kind: 'primary' }],
  });
}
