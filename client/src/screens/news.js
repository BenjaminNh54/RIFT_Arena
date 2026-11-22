// RIFT ARENA — news feed
import { h, modal, timeLeft } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api } from '../network/api.js';

export function renderNews(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Nouveautés' }),
    h('span', { class: 'sub', text: 'Patchs, combattants, events — par TB_games' })));
  const body = h('div', { class: 'grid cols-2' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/news'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';
  if (!data.news.length) { body.append(h('div', { class: 'empty', text: 'Aucune publication.' })); return; }
  for (const n of data.news) {
    const card = h('div', { class: 'news-card clickable', onClick: () => open(n) },
      h('div', { class: 'row' },
        h('span', { class: 'badge ' + badgeKind(n.category), text: n.category }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'faint small', text: new Date(n.date).toLocaleDateString('fr-FR') })),
      h('h3', { style: { marginTop: '8px' }, text: n.title }),
      h('p', { style: { marginTop: '6px' }, text: n.body.length > 160 ? n.body.slice(0, 160) + '…' : n.body }),
      h('div', { class: 'faint small', style: { marginTop: '8px' }, text: `par ${n.author ?? 'TB_games'}` }));
    body.append(card);
  }
}

function badgeKind(cat) {
  return { Update: 'violet', Patch: 'gray', Combattant: 'green', Event: 'gold', Maintenance: 'red', Annonce: '', Concours: 'violet', Map: '', Modes: '' }[cat] ?? '';
}

function open(n) {
  modal({
    title: n.title,
    body: h('div', {},
      h('div', { class: 'row' }, h('span', { class: 'badge ' + badgeKind(n.category), text: n.category }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'faint small', text: `${new Date(n.date).toLocaleString('fr-FR')} · ${n.author ?? 'TB_games'}` })),
      h('p', { style: { marginTop: '12px', lineHeight: 1.7, fontSize: '14px' }, text: n.body })),
    actions: [{ label: 'Fermer', kind: 'primary' }],
  });
}
