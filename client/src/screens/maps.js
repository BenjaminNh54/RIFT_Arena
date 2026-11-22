// RIFT ARENA — map browser (official + community), preview renderer, like/report
import { h, toast, fmt, modal } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state } from '../state.js';
import { MAPS_READY, MAP_MAP } from '/shared/definitions/maps.js';
import { navigate } from '../router.js';

export function renderMaps(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Maps' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn violet', html: `${icon('editor')} Créer une map`, onClick: () => navigate('editor') })));

  const tabs = h('div', { class: 'tabs' });
  const body = h('div', {});
  wrap.append(tabs, body);
  el.append(wrap);
  const defs = [['official', 'Officielles'], ['community', 'Communauté'], ['mine', 'Mes maps']];
  const btns = defs.map(([id, label]) => h('button', { class: 'tab', text: label, onClick: () => select(id) }));
  btns.forEach(b => tabs.append(b));
  select('official');

  function select(id) {
    btns.forEach((b, i) => b.classList.toggle('active', defs[i][0] === id));
    body.innerHTML = '';
    if (id === 'official') renderOfficial(body);
    else loadCommunity(body, id === 'mine');
  }
}

function renderOfficial(body) {
  const grid = h('div', { class: 'grid cols-3' });
  for (const m of MAPS_READY) {
    const card = h('div', { class: 'map-card' });
    const cv = h('canvas');
    card.append(cv, h('div', { class: 'mc-info' },
      h('div', { class: 'mc-name', text: m.name }),
      h('div', { class: 'mc-meta', text: `${m.width}x${m.height} · ${m.modes.length} modes` })));
    card.onclick = () => previewMap(MAP_MAP[m.id]);
    grid.append(card);
    drawMini(cv, m.grid, m.theme);
  }
  body.append(grid);
}

async function loadCommunity(body, mine) {
  body.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  try {
    const { maps } = await api.get(`/api/maps?${mine ? 'mine=1' : 'status=published'}`);
    body.innerHTML = '';
    if (!maps.length) {
      body.append(h('div', { class: 'empty', html: `${icon('maps')}<div>${mine ? 'Tu n\'as pas encore publié de map — ouvre l\'éditeur !' : 'Aucune map communautaire publiée pour l\'instant.'}</div>` }));
      return;
    }
    const grid = h('div', { class: 'grid cols-3' });
    for (const m of maps) {
      const card = h('div', { class: 'map-card' });
      const cv = h('canvas');
      card.append(cv, h('div', { class: 'mc-info' },
        h('div', { class: 'mc-name', text: m.name ?? 'Sans titre' }),
        h('div', { class: 'mc-meta' },
          h('span', { text: `par ${m.author_name ?? 'anonyme'}` }),
          h('span', { text: `${m.status}` }),
          h('span', { html: `${icon('like')} ${m.likes ?? 0}` }),
          m.featured ? h('span', { class: 'badge gold', text: 'FEATURED' }) : null)));
      card.onclick = () => openCommunityMap(m);
      grid.append(card);
      // decode grid
      import('/shared/validators/index.js').then(({ decodeGrid }) => {
        const grid2 = decodeGrid(m.grid ?? '', m.width);
        if (grid2) drawMini(cv, grid2, m.theme);
        else drawMini(cv, null, m.theme);
      });
    }
    body.append(grid);
  } catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'empty', text: 'Hors ligne.' })); }
}

async function openCommunityMap(m) {
  try {
    const { map } = await api.get(`/api/maps/${m.id}`);
    const { decodeGrid } = await import('/shared/validators/index.js');
    const grid = decodeGrid(map.grid ?? '', map.width) ?? [];
    const bodyEl = h('div', {},
      h('div', { class: 'row' },
        h('b', { text: map.name }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'faint small', text: `par ${map.authorName ?? map.author_name ?? '?'}` })),
      h('canvas', { style: { width: '100%', marginTop: '10px', imageRendering: 'pixelated', border: '1px solid var(--line)' } }),
      h('div', { class: 'dim small', style: { marginTop: '8px' } }, map.desc ?? ''),
    );
    const cv = bodyEl.querySelector('canvas');
    drawMini(cv, grid, map.theme, 12);
    modal({
      title: 'Map communautaire',
      body: bodyEl,
      actions: [
        { label: 'Signaler', kind: 'ghost', onClick: async (close) => {
          try { await api.post(`/api/maps/${map.id}/report`, { reason: 'inapproprié' }); toast('Signalement transmis', 'success'); close(); }
          catch (e) { toast(errText(e), 'error'); }
        } },
        { label: 'J\'aime', kind: '', onClick: async (close) => {
          try { await api.post(`/api/maps/${map.id}/like`); toast('Merci pour ton like !', 'success'); close(); }
          catch (e) { toast(errText(e), 'error'); }
        } },
        { label: 'Fermer', kind: 'primary' },
      ],
    });
  } catch (e) { toast(errText(e), 'error'); }
}

function previewMap(m) {
  modal({
    title: m.name,
    body: h('div', {},
      h('canvas', { style: { width: '100%', imageRendering: 'pixelated', border: '1px solid var(--line)' } }),
      h('p', { class: 'dim small', style: { marginTop: '10px' } }, m.desc ?? ''),
      h('div', { class: 'row wrap', style: { marginTop: '8px', gap: '6px' } },
        m.modes.map(mo => h('span', { class: 'badge', text: mo })))),
    actions: [{ label: 'Fermer', kind: 'primary' }],
  });
  const cv = document.querySelector('.modal-body canvas');
  if (cv) drawMini(cv, m.grid, m.theme, 14);
}

// mini map renderer: theme-tinted tiles
const THEME_COLORS = {
  neon: { 0: '#141c3a', 1: '#3a4a8a', 2: '#7a5a2a', 3: '#1e7a4a', 4: '#1a4a8a', 5: '#8a2a2a', 6: '#7a3adf' },
  dust: { 0: '#3a2a1a', 1: '#8a6a3a', 2: '#5a4a2a', 3: '#4a6a2a', 4: '#2a5a6a', 5: '#8a3a1a', 6: '#7a3adf' },
  moss: { 0: '#1a2a1a', 1: '#3a5a3a', 2: '#5a4a2a', 3: '#2a7a3a', 4: '#1a4a5a', 5: '#8a3a1a', 6: '#7a3adf' },
  core: { 0: '#101828', 1: '#2a3a5a', 2: '#5a4a2a', 3: '#2a6a4a', 4: '#1a3a5a', 5: '#8a2a2a', 6: '#7a3adf' },
  frost: { 0: '#1a2a3a', 1: '#4a6a8a', 2: '#5a5a4a', 3: '#2a6a4a', 4: '#3a7a9a', 5: '#8a2a2a', 6: '#7a3adf' },
  ember: { 0: '#2a1a1a', 1: '#5a3a2a', 2: '#6a4a2a', 3: '#3a5a2a', 4: '#5a1a1a', 5: '#ff4a1a', 6: '#7a3adf' },
  sky: { 0: '#2a3a5a', 1: '#5a6a8a', 2: '#6a5a3a', 3: '#3a7a4a', 4: '#3a6a9a', 5: '#8a3a2a', 6: '#9a4aff' },
  factory: { 0: '#1a2226', 1: '#3a4a4a', 2: '#5a4a2a', 3: '#2a6a3a', 4: '#2a4a5a', 5: '#8a2a1a', 6: '#7a3adf' },
};

export function drawMini(canvas, grid, theme, px = 6) {
  if (!grid) { canvas.width = 60; canvas.height = 40; return; }
  const w = grid[0]?.length ?? 0, hh = grid.length;
  canvas.width = w * px; canvas.height = hh * px;
  const ctx = canvas.getContext('2d');
  const colors = THEME_COLORS[theme] ?? THEME_COLORS.neon;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = colors[grid[y][x]] ?? colors[0];
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
}
