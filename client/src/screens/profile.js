// RIFT ARENA — profile screen (own or public), match history, cosmetics
import { h, toast, fmt, pill, modal } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state, refreshProfile, saveSettings } from '../state.js';
import { navigate } from '../router.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';

const BANNERS = {
  banner_ion: 'linear-gradient(120deg, #0e7490, #35e0ff)',
  banner_nebula: 'linear-gradient(120deg, #6d28d9, #a86bff)',
  banner_rift: 'linear-gradient(120deg, #b45309, #f97316)',
  banner_ion_default: 'linear-gradient(120deg, var(--cyan-deep), var(--violet))',
};

export function renderProfile(el, params = {}) {
  const wrap = h('div', { class: 'screen-pad' });
  el.append(wrap);
  const name = params.name ?? state.profile?.username;
  load(wrap, name);
}

async function load(wrap, name) {
  let data;
  try { data = await api.get(`/api/users/${encodeURIComponent(name)}`); }
  catch (e) { wrap.append(h('div', { class: 'empty', text: errText(e) })); return; }
  const p = data.profile;
  wrap.innerHTML = '';
  const isSelf = data.isSelf || p.username === state.profile?.username;

  // banner
  const banner = h('div', { class: 'profile-banner', style: { background: BANNERS[p.banner] ?? BANNERS.banner_ion_default } },
    h('div', { class: 'pb-inner' }));
  wrap.append(banner);

  // head
  const head = h('div', { class: 'profile-head' },
    h('div', { class: 'avatar', text: p.username.slice(0, 2).toUpperCase() }),
    h('div', {},
      h('h2', { text: p.username }),
      h('div', { class: 'row', style: { marginTop: '4px' } },
        p.title ? h('span', { class: 'badge gold', text: p.title }) : null,
        p.clan ? h('span', { class: 'clan-tag', text: `[${p.clan.tag}] ${p.clan.name}` }) : null,
        p.privacy === 'private' ? h('span', { class: 'badge gray', text: 'profil privé' }) : null)));
  wrap.append(head);

  if (p.privacy === 'private' && !isSelf) {
    wrap.append(h('div', { class: 'empty', style: { marginTop: '30px' }, text: 'Ce joueur a un profil privé.' }));
    return;
  }

  // stats
  wrap.append(h('div', { class: 'profile-stats' },
    stat(fmt(p.trophies), 'Trophées'),
    stat(`Niv ${p.level}`, 'Joueur'),
    stat(fmt(p.matches), 'Matchs'),
    stat(`${p.matches ? Math.round(p.wins / Math.max(1, p.matches) * 100) : 0}%`, 'Victoires'),
    stat(fmt(p.kills), 'Éliminations'),
    stat(`${Math.floor((p.playtime_s ?? 0) / 60)}min`, 'Temps de jeu')));

  // top fighters
  if (p.topFighters?.length) {
    wrap.append(h('div', { class: 'section-title', html: `${icon('fighters')} Meilleurs combattants` }));
    const row = h('div', { class: 'row wrap' });
    for (const f of p.topFighters) {
      const def = FIGHTER_MAP[f.id];
      if (!def) continue;
      row.append(h('div', { class: 'card', style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: '140px' } },
        h('span', { style: { width: '18px', height: '18px', background: def.body, clipPath: 'polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)' } }),
        h('div', {}, h('b', { text: def.name }), h('div', { class: 'faint small', text: `${fmt(f.trophies)} TR · niv ${f.level}` }))));
    }
    wrap.append(row);
  }

  // actions
  if (!isSelf) {
    wrap.append(h('div', { class: 'row', style: { marginTop: '16px' } },
      h('button', { class: 'btn primary', text: 'Ajouter ami', onClick: async () => {
        try { await api.post('/api/friends/request', { username: p.username }); toast('Demande envoyée', 'success'); }
        catch (e) { toast(errText(e), 'error'); }
      } }),
      h('button', { class: 'btn ghost', text: 'Signaler', onClick: async () => {
        const reason = prompt2('Raison du signalement :', async (text) => {
          try { await api.post('/api/report', { kind: 'player', targetId: p.id, targetName: p.username, reason: text }); toast('Signalement envoyé aux modérateurs', 'success'); }
          catch (e) { toast(errText(e), 'error'); }
        });
      } })));
  } else {
    // own profile: cosmetics + privacy
    wrap.append(h('div', { class: 'section-title', html: `${icon('star')} Personnalisation` }));
    const inv = state.profile?.inventory ?? [];
    const titles = inv.filter(i => i.kind === 'title').map(i => i.refId);
    const banners = inv.filter(i => i.kind === 'banner').map(i => i.refId);
    const availBanners = ['banner_ion', 'banner_nebula', 'banner_rift'].filter(b => banners.includes(b));
    const panel = h('div', { class: 'panel', style: { maxWidth: '520px' } });
    if (titles.length) {
      const sel = h('select', { onChange: apply },
        h('option', { value: '' }, '— aucun titre —'),
        titles.map(t => h('option', { value: t, ...(p.title === t ? { selected: true } : {}) }, t)));
      panel.append(h('div', { class: 'form-row' }, h('label', { text: 'Titre affiché' }), sel));
    }
    if (availBanners.length) {
      const sel = h('select', { onChange: apply },
        h('option', { value: '' }, '— bannière par défaut —'),
        availBanners.map(b => h('option', { value: b, ...(p.banner === b ? { selected: true } : {}) }, b)));
      panel.append(h('div', { class: 'form-row' }, h('label', { text: 'Bannière' }), sel));
    }
    const privSel = h('select', { onChange: apply2 },
      h('option', { value: 'public' }, 'Profil public'),
      h('option', { value: 'private', ...(p.privacy === 'private' ? { selected: true } : {}) }, 'Profil privé'));
    panel.append(h('div', { class: 'form-row' }, h('label', { text: 'Confidentialité' }), privSel));
    wrap.append(panel);
  }

  // match history
  if (data.matches?.length) {
    wrap.append(h('div', { class: 'section-title', html: `${icon('clock')} Historique des matchs` }));
    const panel = h('div', { class: 'panel' });
    for (const m of data.matches) {
      const fdef = FIGHTER_MAP[m.fighter];
      panel.append(h('div', { class: 'stat-row' },
        h('span', { class: 'dim small', text: new Date(m.at).toLocaleString('fr-FR') }),
        h('span', { class: 'badge ' + (m.won ? 'green' : 'red'), text: m.won ? 'V' : 'D' }),
        h('span', { text: fdef?.name ?? m.fighter }),
        h('span', { class: 'faint small', text: m.mode }),
        h('b', { class: 'mono', text: `${m.kills}/${m.deaths}` }),
        m.starPlayer ? h('span', { class: 'badge gold', text: 'MVP' }) : null,
        h('b', { class: 'mono', style: { color: m.trophiesDelta >= 0 ? 'var(--green)' : 'var(--red)' }, text: `${m.trophiesDelta >= 0 ? '+' : ''}${m.trophiesDelta} TR` })));
    }
    wrap.append(panel);
  }

  async function apply() {
    const selects = wrap.querySelectorAll('select');
    const body = {};
    const [t, b] = selects;
    if (t && t.dataset) body.title = t.value;
    if (b) body.banner = b.value;
    // simpler: read each known field
    body.title = wrap.querySelector('select')?.value ?? '';
    const bannerSel = wrap.querySelectorAll('select')[1];
    if (bannerSel) body.banner = bannerSel.value;
    try {
      const { profile } = await api.post('/api/me/cosmetics', body);
      state.profile = { ...state.profile, ...profile };
      toast('Profil mis à jour', 'success');
    } catch (e) { toast(errText(e), 'error'); }
  }
  async function apply2(e) {
    try { await api.post('/api/me/cosmetics', { privacy: e.target.value }); toast('Confidentialité mise à jour', 'success'); }
    catch (e2) { toast(errText(e2), 'error'); }
  }
}

function prompt2(title, cb) {
  const input = h('input', { placeholder: 'Raison (max 200)', maxlength: 200, style: { width: '100%' } });
  const m = modal({
    title, body: input,
    actions: [
      { label: 'Annuler', kind: 'ghost' },
      { label: 'Envoyer', kind: 'primary', onClick: (close) => { cb(input.value); close(); } },
    ],
  });
  return m;
}

function stat(v, label) {
  return h('div', { class: 'pstat' }, h('b', { text: v }), h('span', { text: label }));
}
