// RIFT ARENA — shop (rotations, catalog, chests, purchase)
import { h, modal, toast, fmt, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state } from '../state.js';
import { refreshProfile } from '../app.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';

const KIND_FR = { skin: 'Skin', banner: 'Bannière', avatar: 'Avatar', title: 'Titre', effect: 'Effet', emote: 'Emote', chest: 'Coffre' };

export function renderShop(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Boutique' }),
    h('span', { class: 'sub', text: 'Cosmétique uniquement — aucun pay-to-win' }),
    h('span', { class: 'spacer' }),
    pill('credits', state.profile?.credits ?? 0),
    pill('tokens', state.profile?.rift_tokens ?? 0)));
  const body = h('div', {});
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/shop'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';

  // chests first
  const chestSection = h('div', { class: 'section-title', html: `${icon('pass')} Coffres` });
  body.append(chestSection);
  const chestRow = h('div', { class: 'grid cols-3' });
  const chestsOwned = (state.profile?.inventory ?? []).filter(i => i.kind === 'chest');
  chestRow.append(h('div', { class: 'shop-item' },
    h('div', { class: 'si-art', html: icon('pass'), style: { color: 'var(--gold)', fontSize: '40px' } }),
    h('div', { class: 'si-name', text: 'Ouvrir un coffre cosmétique' }),
    h('div', { class: 'si-kind', text: `${chestsOwned.length} coffre(s) en stock` }),
    h('button', { class: `btn ${chestsOwned.length ? 'primary' : 'ghost'}`, text: chestsOwned.length ? 'Ouvrir' : 'Aucun coffre', disabled: !chestsOwned.length, onClick: openChest })));
  body.append(chestRow);

  // daily rotation
  body.append(h('div', { class: 'section-title', html: `${icon('clock')} Rotation du jour` }));
  body.append(itemsGrid(data.rotation));

  // catalog
  body.append(h('div', { class: 'section-title', html: `${icon('shop')} Catalogue` }));
  body.append(itemsGrid(data.catalog));

  function itemsGrid(items) {
    const grid = h('div', { class: 'grid cols-4' });
    if (!items.length) grid.append(h('div', { class: 'empty', text: 'Rien ici pour le moment.' }));
    for (const it of items) {
      grid.append(shopItem(it, body));
    }
    return grid;
  }
}

function shopItem(it, body) {
  const art = artFor(it);
  const curIcon = it.currency === 'credits' ? 'coin' : 'token';
  return h('div', { class: `shop-item ${it.owned ? 'owned' : ''}` },
    h('div', { class: 'si-art', html: icon(art), style: { color: colorFor(it) } }),
    h('div', { class: 'si-name', text: nameFor(it) }),
    h('div', { class: 'si-kind', text: KIND_FR[it.kind] ?? it.kind }),
    h('div', { class: 'si-price', html: `${icon(curIcon)} <b class="mono">${fmt(it.price)}</b>` }),
    it.owned
      ? h('button', { class: 'btn small ghost', text: 'Possédé', disabled: true })
      : h('button', { class: 'btn small primary', text: 'Acheter', onClick: async () => {
        try {
          await api.post('/api/shop/buy', { itemId: it.id });
          toast(`Acheté : ${nameFor(it)}`, 'success');
          await refreshProfile();
          load(body);
        } catch (e) { toast(errText(e), 'error'); }
      } }));
}

function nameFor(it) {
  if (it.kind === 'skin') {
    const [fid, sid] = String(it.ref).split('/');
    const def = FIGHTER_MAP[fid];
    const skin = def?.skins.find(s => s.id === sid);
    return skin ? `${def.name} — ${skin.name}` : it.ref;
  }
  if (it.kind === 'title') return `« ${it.ref} »`;
  if (it.kind === 'chest') return 'Coffre cosmétique';
  return it.ref.replace(/^(banner|avatar|effect|emote)_/, '').replace(/_/g, ' ');
}
function artFor(it) {
  return { skin: 'star', banner: 'flag', avatar: 'profile', title: 'crown', effect: 'bolt', emote: 'chat', chest: 'pass' }[it.kind] ?? 'star';
}
function colorFor(it) {
  if (it.kind === 'skin') {
    const [fid] = String(it.ref).split('/');
    return FIGHTER_MAP[fid]?.body ?? 'var(--cyan)';
  }
  return 'var(--cyan)';
}

async function openChest() {
  try {
    const out = await api.post('/api/shop/chest', { chestId: 'cosmic' });
    const lootHtml = out.loot.map(l => {
      const label = l.kind === 'credits' ? `${l.amount} crédits` : l.kind === 'rift_tokens' ? `${l.amount} jetons` : l.id;
      return h('div', { class: 'reward-chip', html: `${icon(l.kind === 'credits' || l.kind === 'rift_tokens' ? 'coin' : 'star')} ${label}` });
    });
    modal({
      title: 'Coffre ouvert !',
      body: h('div', { class: 'reward-pop' },
        h('div', { class: 'rp-icon', html: icon('pass') }),
        h('div', { class: 'row', style: { justifyContent: 'center', flexWrap: 'wrap' } }, lootHtml)),
      actions: [{ label: 'Génial', kind: 'primary' }],
    });
    await refreshProfile();
  } catch (e) { toast(errText(e), 'error'); }
}
