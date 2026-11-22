// RIFT ARENA — admin panel: dashboard, players, reports, logs, config, events builder, news, maps, fighters, server controls
import { h, toast, fmt, modal, confirmBox, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state, isAdmin } from '../state.js';
import { navigate } from '../router.js';
import { FIGHTERS } from '/shared/definitions/fighters.js';
import { MODES } from '/shared/definitions/modes.js';
import { MAPS_READY } from '/shared/definitions/maps.js';
import { EVENT_MODIFIERS } from '/shared/constants.js';

const TABS = [
  ['dashboard', 'Tableau de bord', 'ranked'],
  ['players', 'Joueurs', 'profile'],
  ['reports', 'Signalements', 'report'],
  ['events', 'Events', 'events'],
  ['news', 'News', 'news'],
  ['maps', 'Maps', 'maps'],
  ['fighters', 'Combattants', 'fighters'],
  ['config', 'Config', 'settings'],
  ['server', 'Serveur', 'bolt'],
  ['logs', 'Logs', 'clock'],
];

export function renderAdmin(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Panel Admin' }),
    h('span', { class: 'badge ' + (isAdmin() ? 'gold' : 'gray'), text: state.profile?.role ?? '' }),
    h('span', { class: 'sub', text: 'Permissions vérifiées côté serveur' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small ghost', html: `${icon('back')} Retour`, onClick: () => navigate('lobby') })));

  const tabsBar = h('div', { class: 'tabs' });
  const body = h('div', {});
  wrap.append(tabsBar, body);
  el.append(wrap);

  const btns = [];
  for (const [id, label, ic] of TABS) {
    const b = h('button', { class: 'tab', html: `${icon(ic)} ${label}`, onClick: () => select(id) });
    b._id = id;
    btns.push(b);
    tabsBar.append(b);
  }
  select('dashboard');

  function select(id) {
    if (!isAdmin() && ['events', 'config', 'fighters', 'server'].includes(id)) {
      body.innerHTML = '';
      body.append(h('div', { class: 'empty', html: `${icon('lock')}<div>Réservé au rôle ADMIN.</div>` }));
      btns.forEach(b => b.classList.toggle('active', b._id === id));
      return;
    }
    btns.forEach(b => b.classList.toggle('active', b._id === id));
    body.innerHTML = '';
    const views = { dashboard: viewDashboard, players: viewPlayers, reports: viewReports, events: viewEvents, news: viewNews, maps: viewMaps, fighters: viewFighters, config: viewConfig, server: viewServer, logs: viewLogs };
    views[id]?.(body);
  }
}

// ---------- dashboard ----------
async function viewDashboard(body) {
  body.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  let d;
  try { d = await api.get('/api/admin/dashboard'); } catch (e) { body.innerHTML = ''; body.append(h('div', { class: 'empty', text: errText(e) })); return; }
  body.innerHTML = '';
  body.append(h('div', { class: 'admin-grid' },
    stat(d.connected, 'Connectés', d.connected > 0 ? 'ok' : ''),
    stat(d.totalAccounts, 'Comptes', ''),
    stat(d.matchesRunning, 'Matchs live', d.matchesRunning > 0 ? 'ok' : ''),
    stat(d.humansInRooms, 'Joueurs en match', ''),
    stat(d.openReports, 'Signalements ouverts', d.openReports > 0 ? 'warn' : 'ok'),
    stat(d.eventsActive, 'Events actifs', ''),
    stat(Math.round(d.server.uptime / 60) + 'min', 'Uptime', 'ok'),
    stat(d.server.memory + 'Mo', 'Mémoire', '')));
  body.append(h('div', { class: 'row', style: { marginTop: '12px', flexWrap: 'wrap', gap: '8px' } },
    h('span', { class: 'badge gray', text: `Node ${d.server.node}` }),
    h('span', { class: 'badge ' + (d.server.db === 'mysql' ? 'green' : 'violet'), text: `DB: ${d.server.db}` }),
    d.server.maintenance ? h('span', { class: 'badge red', text: 'MAINTENANCE ACTIVE' }) : h('span', { class: 'badge green', text: 'serveur nominal' })));

  // recent users
  const panel = h('div', { class: 'panel', style: { marginTop: '14px' } });
  panel.append(h('div', { class: 'panel-title', html: `${icon('profile')} Derniers comptes` }));
  for (const u of d.recentUsers) {
    panel.append(h('div', { class: 'stat-row' },
      h('b', { text: u.username }),
      h('span', { class: 'badge gray', text: u.role }),
      h('span', { class: 'spacer' }),
      h('span', { class: 'mono', text: `${fmt(u.trophies)} TR` })));
  }
  body.append(panel);

  // queues
  const q = h('div', { class: 'panel', style: { marginTop: '14px' } });
  q.append(h('div', { class: 'panel-title', html: `${icon('play')} Files de matchmaking` }));
  for (const [mode, n] of Object.entries(d.queueSizes)) {
    q.append(h('div', { class: 'stat-row' }, h('span', { text: mode }), h('b', { class: 'mono', text: String(n) })));
  }
  body.append(q);
}

function stat(v, label, cls = '') {
  return h('div', { class: `adm-stat ${cls}` }, h('b', { text: String(v) }), h('span', { text: label }));
}

// ---------- players ----------
function viewPlayers(body) {
  const input = h('input', { placeholder: 'Rechercher un joueur…', style: { flex: 1 } });
  const results = h('div', {});
  const doSearch = async () => {
    results.innerHTML = '';
    const { players } = await api.get(`/api/admin/players?q=${encodeURIComponent(input.value)}`);
    const table = h('table', { class: 'adm-table' });
    table.append(h('tr', {}, ['Joueur', 'Rôle', 'TR', 'Niveau', 'Matchs', 'Statut', 'Actions'].map(x => h('th', { text: x }))));
    for (const p of players) {
      const tr = h('tr', {},
        h('td', {}, h('b', { text: p.username })),
        h('td', { text: p.role }),
        h('td', { class: 'mono', text: fmt(p.trophies) }),
        h('td', { text: String(p.level) }),
        h('td', { text: String(p.matches) }),
        h('td', {}, p.banned_until ? h('span', { class: 'badge red', text: 'banni' }) : p.muted_until ? h('span', { class: 'badge gold', text: 'muted' }) : h('span', { class: 'badge green', text: 'ok' })),
        h('td', {},
          h('button', { class: 'btn small ghost', text: 'Détail', onClick: () => playerDetail(p) }),
          !p.banned_until ? h('button', { class: 'btn small danger', text: 'Ban', onClick: () => banModal(p) }) : h('button', { class: 'btn small', text: 'Unban', onClick: async () => {
            try { await api.post('/api/admin/players/unban', { userId: p.id }); toast('Débanni'); doSearch(); } catch (e) { toast(errText(e), 'error'); }
          } }),
          p.muted_until ? h('button', { class: 'btn small', text: 'Unmute', onClick: async () => {
            try { await api.post('/api/admin/players/unmute', { userId: p.id }); toast('Unmuted'); doSearch(); } catch (e) { toast(errText(e), 'error'); }
          } }) : h('button', { class: 'btn small', text: 'Mute', onClick: () => muteModal(p) }),
          isAdmin() ? h('button', { class: 'btn small violet', text: 'Rôle', onClick: () => roleModal(p) }) : null,
        ));
      table.append(tr);
    }
    results.append(h('div', { class: 'table-scroll' }, table));
  };
  body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, input,
    h('button', { class: 'btn primary', html: icon('search'), onClick: doSearch })), results);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  doSearch();

  function banModal(p) {
    const days = h('input', { type: 'number', min: 1, placeholder: 'Jours (vide = permanent)', style: { width: '100%' } });
    const reason = h('input', { placeholder: 'Motif', style: { width: '100%' } });
    modal({
      title: `Bannir ${p.username}`,
      body: h('div', {}, h('div', { class: 'form-row' }, h('label', { text: 'Durée' }), days), h('div', { class: 'form-row' }, h('label', { text: 'Motif' }), reason),
        h('p', { class: 'faint small' }, 'Le ban permanent est réservé aux admins. Une confirmation est demandée.')),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: 'Bannir', kind: 'danger', onClick: async (close) => {
          confirmBox('Confirmer le ban', `${p.username} sera banni ${days.value ? days.value + ' jours' : 'permanemment (admin)'}.`, async () => {
            try {
              await api.post('/api/admin/players/ban', { userId: p.id, days: parseInt(days.value, 10) || 0, reason: reason.value, confirm: true });
              toast(`${p.username} banni`, 'success'); close(); doSearch();
            } catch (e) { toast(errText(e), 'error'); }
          });
        } },
      ],
    });
  }
  function muteModal(p) {
    const minutes = h('input', { type: 'number', value: 30, min: 1, style: { width: '100%' } });
    modal({
      title: `Mute ${p.username}`,
      body: h('div', { class: 'form-row' }, h('label', { text: 'Durée (minutes)' }), minutes),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: 'Mute', kind: 'danger', onClick: async (close) => {
          try { await api.post('/api/admin/players/mute', { userId: p.id, minutes: parseInt(minutes.value, 10) || 30 }); toast('Muted'); close(); doSearch(); }
          catch (e) { toast(errText(e), 'error'); }
        } },
      ],
    });
  }
  function roleModal(p) {
    const body2 = h('div', { class: 'row wrap' });
    for (const r of ['player', 'HELPER', 'MODERATOR', 'ADMIN']) {
      body2.append(h('button', { class: 'btn small', text: r, onClick: async () => {
        confirmBox('Changer le rôle', `${p.username} deviendra ${r}.`, async () => {
          try { await api.post('/api/admin/players/role', { userId: p.id, role: r }); toast('Rôle modifié', 'success'); mo.close(); doSearch(); }
          catch (e) { toast(errText(e), 'error'); }
        }, { danger: false });
      } }));
    }
    const mo = modal({ title: `Rôle de ${p.username}`, body: body2, actions: [{ label: 'Fermer', kind: 'ghost' }] });
  }
}

async function playerDetail(p) {
  try {
    const { player, sanctions, history } = await api.get(`/api/admin/players/${p.id}`);
    const body2 = h('div', {},
      h('div', { class: 'grid cols-4' },
        stat(fmt(player.trophies), 'TR'), stat(player.level, 'Niveau'), stat(player.matches, 'Matchs'), stat(fmt(player.credits), 'Crédits')),
      h('div', { class: 'section-title', text: 'Sanctions actives' }));
    if (!sanctions.length) body2.append(h('div', { class: 'faint small', text: 'Aucune.' }));
    for (const s of sanctions) body2.append(h('div', { class: 'stat-row' }, h('b', { text: s.type }), h('span', { class: 'dim small', text: s.reason ?? '' }), h('span', { class: 'faint small', text: s.until ?? 'permanent' })));
    body2.append(h('div', { class: 'section-title', text: 'Derniers matchs' }));
    for (const m of history.slice(0, 8)) {
      body2.append(h('div', { class: 'stat-row' },
        h('span', { class: 'dim small', text: m.mode }),
        h('b', { class: 'mono', text: `${m.kills}/${m.deaths}` }),
        m.won ? h('span', { class: 'badge green', text: 'V' }) : h('span', { class: 'badge red', text: 'D' })));
    }
    modal({ title: `${player.username} (${player.role})`, body: body2, actions: [{ label: 'Fermer', kind: 'primary' }], wide: true });
  } catch (e) { toast(errText(e), 'error'); }
}

// ---------- reports ----------
async function viewReports(body) {
  body.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  const { reports } = await api.get('/api/admin/reports');
  body.innerHTML = '';
  if (!reports.length) { body.append(h('div', { class: 'empty', text: 'Aucun signalement.' })); return; }
  for (const r of reports) {
    body.append(h('div', { class: 'list-row' },
      h('span', { class: 'badge ' + (r.status === 'open' ? 'gold' : 'gray'), text: r.status }),
      h('div', { style: { flex: 1 } },
        h('b', { text: `${r.kind}: ${r.targetName ?? r.targetId ?? '?'}` }),
        h('div', { class: 'faint small', text: `${r.reason ?? ''} — par ${r.byName ?? r.byId ?? '?'}` })),
      r.status === 'open' ? h('button', { class: 'btn small primary', text: 'Résoudre', onClick: async () => {
        try { await api.post('/api/admin/reports/resolve', { id: r.id, resolution: 'traité par ' + state.profile.username }); toast('Signalement résolu'); viewReports(body); }
        catch (e) { toast(errText(e), 'error'); }
      } }) : null));
  }
}

// ---------- events builder ----------
async function viewEvents(body) {
  const list = h('div', {});
  body.append(
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('h3', { text: 'Event Builder' }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', html: `${icon('plus')} Nouvel event`, onClick: () => builder(null) })),
    list);
  refresh();

  async function refresh() {
    const { events } = await api.get('/api/admin/events');
    list.innerHTML = '';
    for (const ev of events) {
      list.append(h('div', { class: 'list-row' },
        h('span', { class: 'badge ' + ({ active: 'green', scheduled: 'violet', draft: 'gray', paused: 'gold', archived: 'gray' }[ev.status] ?? ''), text: ev.status }),
        h('b', { text: ev.name }),
        h('span', { class: 'faint small', text: ev.mode }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', text: 'Éditer', onClick: () => builder(ev) }),
        h('button', { class: 'btn small ' + (ev.status === 'active' ? '' : 'primary'), text: ev.status === 'active' ? 'Mettre en pause' : 'Activer', onClick: async () => {
          try {
            await api.post('/api/admin/events/status', { id: ev.id, status: ev.status === 'active' ? 'paused' : 'active' });
            toast('Statut mis à jour'); refresh();
          } catch (e) { toast(errText(e), 'error'); }
        } }),
        h('button', { class: 'btn small ghost', text: 'Dupliquer', onClick: () => builder({ ...ev, id: null, name: ev.name + ' (copie)', status: 'draft' }) }),
        h('button', { class: 'btn small danger', text: 'Supprimer', onClick: () => {
          confirmBox('Supprimer l\'event', `Supprimer « ${ev.name} » ?`, async () => {
            try { await api.post('/api/admin/events/delete', { id: ev.id }); toast('Supprimé'); refresh(); }
            catch (e) { toast(errText(e), 'error'); }
          });
        } })));
    }
    if (!events.length) list.append(h('div', { class: 'empty', text: 'Aucun event — crée le premier.' }));
  }

  function builder(ev) {
    const isNew = !ev?.id;
    ev = ev ?? { name: '', desc: '', mode: 'crystal_rush', map: null, modifiers: {}, status: 'draft', priority: 5, mission: { metric: 'matches', target: 3, desc: 'Jouer 3 matchs' }, reward: { credits: 200 }, banner: '#2f4a5a', accent: '#38bdf8', startAt: null, endAt: null };
    const name = h('input', { value: ev.name ?? '', placeholder: 'Nom de l\'event', maxlength: 40, style: { width: '100%' } });
    const desc = h('textarea', { placeholder: 'Description (max 400)', maxlength: 400, style: { width: '100%', minHeight: '60px' } });
    desc.value = ev.desc ?? '';
    const mode = h('select', { style: { width: '100%' } }, MODES.map(m => h('option', { value: m.id, ...(ev.mode === m.id ? { selected: true } : {}) }, m.name)));
    const map = h('select', { style: { width: '100%' } }, h('option', { value: '' }, '— rotation aléatoire —'),
      MAPS_READY.map(m => h('option', { value: m.id, ...(ev.map === m.id ? { selected: true } : {}) }, m.name)));
    const status = h('select', { style: { width: '100%' } }, ['draft', 'scheduled', 'active', 'paused', 'archived'].map(s2 => h('option', { value: s2, ...(ev.status === s2 ? { selected: true } : {}) }, s2)));
    const prio = h('input', { type: 'number', min: 0, max: 10, value: ev.priority ?? 5, style: { width: '100%' } });
    const start = h('input', { type: 'datetime-local', style: { width: '100%' }, value: ev.startAt ? new Date(ev.startAt).toISOString().slice(0, 16) : '' });
    const end = h('input', { type: 'datetime-local', style: { width: '100%' }, value: ev.endAt ? new Date(ev.endAt).toISOString().slice(0, 16) : '' });

    // modifiers
    const mods = h('div', { class: 'row wrap', style: { gap: '6px' } });
    const NUMMODS = ['speed_mult', 'damage_mult', 'cooldown_mult', 'energy_mult'];
    const BOOLMODS = EVENT_MODIFIERS.filter(x => !NUMMODS.includes(x));
    for (const m of NUMMODS) {
      const inp = h('input', { type: 'number', step: 0.1, min: 0.25, max: 3, value: ev.modifiers?.[m] ?? 1, style: { width: '70px' } });
      mods.append(h('label', { class: 'mod-chip' }, m, inp));
      inp.dataset.mod = m;
    }
    for (const m of BOOLMODS) {
      const cb = h('input', { type: 'checkbox', checked: !!ev.modifiers?.[m] });
      cb.dataset.modBool = m;
      mods.append(h('label', { class: 'mod-chip' }, cb, h('span', { text: m })));
    }
    // mission
    const mMetric = h('select', { style: { width: '100%' } }, ['matches', 'wins', 'kills', 'objectives', 'clan_matches', 'maps_published'].map(x => h('option', { value: x, ...(ev.mission?.metric === x ? { selected: true } : {}) }, x)));
    const mTarget = h('input', { type: 'number', min: 1, value: ev.mission?.target ?? 3, style: { width: '100%' } });
    const mDesc = h('input', { value: ev.mission?.desc ?? '', placeholder: 'Description de l\'objectif', style: { width: '100%' } });
    // reward
    const rCredits = h('input', { type: 'number', min: 0, value: ev.reward?.credits ?? 0, style: { width: '100%' } });
    const rTokens = h('input', { type: 'number', min: 0, value: ev.reward?.rift_tokens ?? 0, style: { width: '100%' } });
    const rTitle = h('input', { value: ev.reward?.title ?? '', placeholder: 'Titre (optionnel)', style: { width: '100%' } });

    modal({
      title: isNew ? 'Créer un event' : `Éditer : ${ev.name}`,
      wide: true,
      body: h('div', { class: 'event-builder-form' },
        h('div', { class: 'form-row' }, h('label', { text: 'Nom' }), name),
        h('div', { class: 'form-row' }, h('label', { text: 'Statut' }), status),
        h('div', { class: 'form-row full' }, h('label', { text: 'Description' }), desc),
        h('div', { class: 'form-row' }, h('label', { text: 'Mode' }), mode),
        h('div', { class: 'form-row' }, h('label', { text: 'Map (optionnel)' }), map),
        h('div', { class: 'form-row' }, h('label', { text: 'Début' }), start),
        h('div', { class: 'form-row' }, h('label', { text: 'Fin' }), end),
        h('div', { class: 'form-row full' }, h('label', { text: 'Modificateurs (moteur validé, aucun script)' }), mods),
        h('div', { class: 'form-row' }, h('label', { text: 'Métrique mission' }), mMetric),
        h('div', { class: 'form-row' }, h('label', { text: 'Cible mission' }), mTarget),
        h('div', { class: 'form-row full' }, h('label', { text: 'Description mission' }), mDesc),
        h('div', { class: 'form-row' }, h('label', { text: 'Récompense crédits' }), rCredits),
        h('div', { class: 'form-row' }, h('label', { text: 'Récompense jetons' }), rTokens),
        h('div', { class: 'form-row' }, h('label', { text: 'Récompense titre' }), rTitle),
        h('div', { class: 'form-row' }, h('label', { text: 'Priorité (0-10)' }), prio),
      ),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: 'Enregistrer', kind: 'primary', onClick: async (close) => {
          const modifiers = {};
          for (const inp of mods.querySelectorAll('input[data-mod]')) {
            const v = parseFloat(inp.value);
            if (v && v !== 1) modifiers[inp.dataset.mod] = v;
          }
          for (const cb of mods.querySelectorAll('input[data-mod-bool]')) { if (cb.checked) modifiers[cb.dataset.modBool] = true; }
          for (const cb of mods.querySelectorAll('input[data-modBool]')) { if (cb.checked) modifiers[cb.dataset.modBool] = true; }
          const payload = {
            id: ev.id ?? undefined, name: name.value.trim(), desc: desc.value, mode: mode.value,
            map: map.value || null, status: status.value, priority: parseInt(prio.value, 10) || 5,
            modifiers,
            mission: { metric: mMetric.value, target: parseInt(mTarget.value, 10) || 3, desc: mDesc.value },
            reward: { ...(parseInt(rCredits.value, 10) ? { credits: parseInt(rCredits.value, 10) } : {}), ...(parseInt(rTokens.value, 10) ? { rift_tokens: parseInt(rTokens.value, 10) } : {}), ...(rTitle.value ? { title: rTitle.value } : {}) },
            startAt: start.value ? new Date(start.value).toISOString() : null,
            endAt: end.value ? new Date(end.value).toISOString() : null,
          };
          try {
            await api.post('/api/admin/events', { event: payload });
            toast('Event enregistré', 'success');
            close(); refresh();
          } catch (e) {
            if (e.code === 'INVALID_EVENT') toast('Event invalide: ' + (e.errors?.join(', ') ?? ''), 'error');
            else toast(errText(e), 'error');
          }
        } },
      ],
    });
  }
}

// ---------- news ----------
async function viewNews(body) {
  const list = h('div', {});
  body.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
    h('h3', { text: 'News' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', html: `${icon('plus')} Nouvelle`, onClick: () => editor(null) })), list);
  refresh();
  async function refresh() {
    const { news } = await api.get('/api/admin/news');
    list.innerHTML = '';
    for (const n of news) {
      list.append(h('div', { class: 'list-row' },
        h('span', { class: 'badge ' + (n.published ? 'green' : 'gray'), text: n.published ? 'publié' : 'brouillon' }),
        h('b', { text: n.title }),
        h('span', { class: 'faint small', text: n.category }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', text: 'Éditer', onClick: () => editor(n) }),
        h('button', { class: 'btn small danger', text: 'X', onClick: async () => {
          confirmBox('Supprimer', `Supprimer « ${n.title} » ?`, async () => {
            await api.post('/api/admin/news/delete', { id: n.id }); refresh();
          });
        } })));
    }
    if (!news.length) list.append(h('div', { class: 'empty', text: 'Aucune news.' }));
  }
  function editor(n) {
    n = n ?? { title: '', body: '', category: 'Annonce', priority: 5, published: false };
    const title = h('input', { value: n.title, placeholder: 'Titre', maxlength: 80, style: { width: '100%' } });
    const bodyIn = h('textarea', { placeholder: 'Contenu', maxlength: 4000, style: { width: '100%', minHeight: '120px' } });
    bodyIn.value = n.body;
    const cat = h('select', { style: { width: '100%' } }, ['Update', 'Patch', 'Combattant', 'Event', 'Maintenance', 'Annonce', 'Concours', 'Map', 'Modes'].map(c => h('option', { value: c, ...(n.category === c ? { selected: true } : {}) }, c)));
    const prio = h('input', { type: 'number', min: 0, max: 10, value: n.priority ?? 5, style: { width: '100%' } });
    const pub = h('input', { type: 'checkbox', checked: !!n.published });
    modal({
      title: n.id ? 'Éditer la news' : 'Nouvelle news',
      body: h('div', {},
        h('div', { class: 'form-row' }, h('label', { text: 'Titre' }), title),
        h('div', { class: 'form-row' }, h('label', { text: 'Contenu' }), bodyIn),
        h('div', { class: 'row' },
          h('div', { class: 'form-row', style: { flex: 1 } }, h('label', { text: 'Catégorie' }), cat),
          h('div', { class: 'form-row', style: { width: '100px' } }, h('label', { text: 'Priorité' }), prio),
          h('div', { class: 'form-row' }, h('label', { text: 'Publié' }), h('label', { class: 'switch' }, pub, h('i'))))),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: 'Enregistrer', kind: 'primary', onClick: async (close) => {
          try {
            await api.post('/api/admin/news', { news: { id: n.id, title: title.value, body: bodyIn.value, category: cat.value, priority: parseInt(prio.value, 10) || 5, published: pub.checked } });
            toast('News enregistrée', 'success'); close(); refresh();
          } catch (e) { toast(errText(e), 'error'); }
        } },
      ],
    });
  }
}

// ---------- maps moderation ----------
async function viewMaps(body) {
  body.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  const { maps } = await api.get('/api/admin/maps');
  body.innerHTML = '';
  body.append(h('p', { class: 'dim small', style: { marginBottom: '10px' } },
    'Valide les maps communautaires ("pending") pour les publier, ou mets-les en avant dans la rotation officielle.'));
  if (!maps.length) { body.append(h('div', { class: 'empty', text: 'Aucune map communautaire.' })); return; }
  for (const m of maps) {
    body.append(h('div', { class: 'list-row' },
      h('span', { class: 'badge ' + ({ published: 'green', pending: 'gold', draft: 'gray', rejected: 'red' }[m.status] ?? ''), text: m.status },
      ),
      h('b', { text: m.name ?? 'Sans titre' }),
      h('span', { class: 'faint small', text: `par ${m.author_name ?? m.authorName ?? '?'}` }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small primary', text: 'Valider', onClick: async () => {
        await api.post('/api/admin/maps/validate', { id: m.id, accept: true }); toast('Map publiée'); viewMaps(body);
      } }),
      h('button', { class: 'btn small ghost', text: 'Rejeter', onClick: async () => {
        await api.post('/api/admin/maps/validate', { id: m.id, accept: false }); viewMaps(body);
      } }),
      h('button', { class: 'btn small violet', text: m.featured ? 'Retirer featured' : 'Featured', onClick: async () => {
        await api.post('/api/admin/maps/feature', { id: m.id, featured: !m.featured }); viewMaps(body);
      } })));
  }
}

// ---------- fighters balance ----------
async function viewFighters(body) {
  const { fighters, overrides } = await api.get('/api/admin/fighters');
  const table = h('table', { class: 'adm-table' });
  table.append(h('tr', {}, ['Combattant', 'PV', 'Dégâts', 'Vitesse', 'Reload', 'Overrides', ''].map(x => h('th', { text: x }))));
  for (const f of fighters) {
    const o = overrides[f.id] ?? {};
    table.append(h('tr', {},
      h('td', {}, h('b', { text: f.name })),
      h('td', { class: 'mono', text: fmt(f.hp) }),
      h('td', { class: 'mono', text: fmt(f.attack.damage) }),
      h('td', { class: 'mono', text: fmt(f.speed) }),
      h('td', { class: 'mono', text: f.attack.reload + 'ms' }),
      h('td', { class: 'mono small', text: Object.keys(o).length ? JSON.stringify(o) : '—' }),
      h('td', {}, h('button', { class: 'btn small ghost', text: 'Ajuster', onClick: () => adjustModal(f, o) }))));
  }
  body.append(h('p', { class: 'dim small', style: { marginBottom: '10px' } },
    'Les multiplicateurs (0.5–2.0) sont appliqués aux prochains matchs créés — les matchs en cours ne sont pas affectés (configuration snapshot).'));
  body.append(h('div', { class: 'table-scroll' }, table));

  function adjustModal(f, cur) {
    const mk = (k, label) => {
      const inp = h('input', { type: 'number', step: 0.05, min: 0.5, max: 2, value: cur[k] ?? 1, style: { width: '100%' } });
      return [label, inp, k];
    };
    const rows = [mk('hpMult', 'PV x'), mk('damageMult', 'Dégâts x'), mk('speedMult', 'Vitesse x'), mk('reloadMult', 'Reload ÷')];
    modal({
      title: `Équilibrage ${f.name}`,
      body: h('div', {}, rows.map(([l, inp, k]) => h('div', { class: 'form-row' }, h('label', { text: l }), inp))),
      actions: [
        { label: 'Réinitialiser', kind: 'ghost', onClick: async (close) => {
          await api.post('/api/admin/fighters/clear', { fighterId: f.id });
          toast('Override retiré', 'success'); close(); viewFighters(body);
        } },
        { label: 'Appliquer', kind: 'primary', onClick: async (close) => {
          const patch = {};
          for (const [, inp, k] of rows) {
            const v = parseFloat(inp.value);
            if (v && v !== 1) patch[k] = v;
          }
          try { await api.post('/api/admin/fighters/override', { fighterId: f.id, ...patch }); toast('Équilibrage appliqué', 'success'); close(); viewFighters(body); }
          catch (e) { toast(errText(e), 'error'); }
        } },
      ],
    });
  }
}

// ---------- config ----------
async function viewConfig(body) {
  const { config, keys } = await api.get('/api/admin/config');
  const table = h('table', { class: 'adm-table' });
  table.append(h('tr', {}, ['Clé', 'Valeur', ''].map(x => h('th', { text: x }))));
  for (const k of keys) {
    const v = config[k];
    table.append(h('tr', {},
      h('td', { class: 'mono small', text: k }),
      h('td', {}, h('input', { value: String(v), style: { width: '140px' }, dataset: { key: k } })),
      h('td', {}, h('button', { class: 'btn small primary', text: 'OK', onClick: async (e) => {
        const inp = e.target.closest('tr').querySelector('input');
        let value = inp.value;
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!Number.isNaN(+value)) value = +value;
        try { await api.post('/api/admin/config/set', { key: k, value }); toast(`${k} = ${value}`, 'success'); }
        catch (err) { toast(errText(err), 'error'); }
      } }))));
  }
  body.append(h('p', { class: 'dim small', style: { marginBottom: '10px' } },
    'Configuration runtime — appliquée sans redéploiement. Les matchs en cours gardent leur snapshot.'));
  body.append(h('div', { class: 'table-scroll' }, table));
}

// ---------- server controls ----------
async function viewServer(body) {
  const { config } = await api.get('/api/admin/config');
  body.append(h('div', { class: 'panel' },
    h('div', { class: 'panel-title', html: `${icon('bolt')} Contrôles serveur` }),
    h('div', { class: 'setting-row' },
      h('div', { class: 's-label', text: 'Mode maintenance' }, h('div', { class: 's-sub', text: 'Les joueurs non-staff ne peuvent plus se connecter' })),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!config['maintenance'], onChange: async (e) => {
        try { await api.post('/api/admin/server', { action: 'maintenance', on: e.target.checked }); toast(e.target.checked ? 'Maintenance ON' : 'Maintenance OFF', 'success'); }
        catch (err) { toast(errText(err), 'error'); }
      } }), h('i'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 's-label', text: 'Annonce globale' }, h('div', { class: 's-sub', text: 'Diffusée en temps réel à tous les clients' })),
      h('button', { class: 'btn small violet', text: 'Diffuser', onClick: () => {
        const input = h('input', { placeholder: 'Message (200)', maxlength: 200, style: { width: '100%' } });
        modal({ title: 'Annonce globale', body: input, actions: [
          { label: 'Annuler', kind: 'ghost' },
          { label: 'Diffuser', kind: 'primary', onClick: async (close) => {
            try { await api.post('/api/admin/server', { action: 'announce', text: input.value }); toast('Annonce diffusée', 'success'); close(); }
            catch (e) { toast(errText(e), 'error'); }
          } }] });
      } }))));
  body.append(h('div', { class: 'panel', style: { marginTop: '12px' } },
    h('div', { class: 'panel-title', html: `${icon('play')} Modes & maps` }),
    h('div', { class: 'row wrap', style: { gap: '6px' } },
      MODES.map(m => h('button', { class: `mod-chip ${(config['modes.disabled'] ?? {})[m.id] ? '' : 'on'}`, onClick: async (e) => {
        const off = e.currentTarget.classList.contains('on');
        await api.post('/api/admin/server', { action: 'toggle_mode', mode: m.id, off });
        toast(`${m.name} ${off ? 'désactivé' : 'activé'}`); viewServer(body);
      } }, m.name)))));
  body.append(h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } },
    MAPS_READY.map(m => h('button', { class: `mod-chip ${(config['maps.disabled'] ?? {})[m.id] ? '' : 'on'}`, onClick: async (e) => {
      const off = e.currentTarget.classList.contains('on');
      await api.post('/api/admin/server', { action: 'toggle_map', map: m.id, off });
      toast(`${m.name} ${off ? 'désactivée' : 'activée'}`); viewServer(body);
    } }, m.name))));
  body.append(h('div', { class: 'panel', style: { marginTop: '12px' } },
    h('div', { class: 'panel-title', html: `${icon('ranked')} Saisons classées` }),
    h('button', { class: 'btn danger', text: 'Clôturer la saison et en ouvrir une nouvelle', onClick: () => {
      confirmBox('Clôturer la saison', 'Les RP seront archivés, une nouvelle saison démarre. Continuer ?', async () => {
        try { await api.post('/api/admin/server', { action: 'end_season' }); toast('Nouvelle saison créée', 'success'); }
        catch (e) { toast(errText(e), 'error'); }
      });
    } })));
}

// ---------- logs ----------
async function viewLogs(body) {
  body.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  const { logs } = await api.get('/api/admin/logs');
  body.innerHTML = '';
  if (!logs.length) { body.append(h('div', { class: 'empty', text: 'Aucun log.' })); return; }
  for (const l of logs) {
    body.append(h('div', { class: 'log-line' },
      h('span', { class: 'faint small mono', text: new Date(l.at).toLocaleString('fr-FR') }),
      h('b', { text: l.author }),
      h('span', { class: 'l-role', text: l.role }),
      h('span', { class: 'l-act', text: l.action }),
      h('span', { text: l.target }),
      Object.keys(l.details ?? {}).length ? h('span', { class: 'faint small mono', text: JSON.stringify(l.details) }) : null));
  }
}
