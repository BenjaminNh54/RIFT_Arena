// RIFT ARENA — missions (daily / weekly / seasonal) with claim
import { h, toast, fmt } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';

const PERIODS = [
  { id: 'daily', label: 'Quotidiennes' },
  { id: 'weekly', label: 'Hebdomadaires' },
  { id: 'seasonal', label: 'Saison' },
];
function rewText(r) {
  const parts = [];
  if (r.credits) parts.push(`${r.credits} crédits`);
  if (r.rift_tokens) parts.push(`${r.rift_tokens} jetons`);
  if (r.pass_xp) parts.push(`${r.pass_xp} XP Pass`);
  return parts.join(' + ') || '—';
}

export function renderMissions(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Missions' }),
    h('span', { class: 'sub', text: 'Renouvelées automatiquement — validées côté serveur' })));
  const tabsBar = h('div', { class: 'tabs' });
  const body = h('div', { class: 'grid cols-2' });
  wrap.append(tabsBar, body);
  el.append(wrap);
  let data = null;
  let period = 'daily';

  const btns = PERIODS.map(p => h('button', { class: 'tab', text: p.label, onClick: () => select(p.id) }));
  btns.forEach(b => tabsBar.append(b));
  select('daily');

  function select(id) {
    period = id;
    btns.forEach((b, i) => b.classList.toggle('active', PERIODS[i].id === id));
    render();
  }

  function render() {
    body.innerHTML = '';
    if (!data) { body.append(h('div', { class: 'dim small', text: 'Chargement…' })); return; }
    const list = data.missions[period] ?? [];
    if (!list.length) { body.append(h('div', { class: 'empty', text: 'Aucune mission pour cette période.' })); return; }
    for (const m of list) {
      const done = m.progress >= m.target;
      body.append(h('div', { class: `mission-card ${done ? 'done' : ''}` },
        h('div', { class: 'm-top' },
          h('div', { class: 'm-desc', text: m.desc }),
          h('span', { class: 'mono dim small', text: `${Math.min(m.progress, m.target)}/${m.target}` })),
        h('div', { class: `bar ${done ? 'green' : ''}` }, h('i', { style: { width: `${Math.min(100, m.progress / m.target * 100)}%` } })),
        h('div', { class: 'm-top', style: { marginTop: '4px' } },
          h('div', { class: 'm-reward', html: `${icon('coin')} ${rewText(m.reward)}` }),
          h('button', {
            class: `btn small ${m.claimed ? 'ghost' : done ? 'primary claim-pulse' : 'ghost'}`,
            text: m.claimed ? 'Reçu' : done ? 'Réclamer' : 'En cours',
            disabled: m.claimed || !done,
            onClick: async () => {
              try {
                await api.post('/api/missions/claim', { period, id: m.id });
                toast(`Récompense reçue : ${rewText(m.reward)}`, 'success');
                await refresh();
              } catch (e) { toast(errText(e), 'error'); }
            },
          })),
      ));
    }
  }

  async function refresh() {
    try { data = await api.get('/api/missions'); } catch { return; }
    render();
  }
  refresh();
}
