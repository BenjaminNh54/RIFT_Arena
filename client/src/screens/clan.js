// RIFT ARENA — clan screen (info, members, requests, chat, war, leaderboard, search/create)
import { h, modal, toast, fmt, confirmBox, timeLeft } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText, onWs, wsSend } from '../network/api.js';
import { navigate } from '../router.js';
import { CLAN_CONFIG } from '/shared/game-config/defaults.js';

const ROLE_LABEL = { leader: 'Chef', coleader: 'Second', officer: 'Officier', member: 'Membre', recruit: 'Recrue' };

export function renderClan(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' }, h('h2', { text: 'Clans' })));
  const body = h('div', {});
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  body.innerHTML = '';
  let data;
  try { data = await api.get('/api/clans/mine'); } catch { body.textContent = 'Hors ligne.'; return; }
  if (!data.clan) return renderDiscover(body);
  renderMyClan(body, data);
}

// ---------- not in clan: discover / create ----------
function renderDiscover(body) {
  const tabs = h('div', { class: 'tabs' });
  const content = h('div', {});
  body.append(tabs, content);
  const btns = [['top', 'Classement'], ['search', 'Recherche'], ['create', 'Créer']].map(([id, label]) =>
    h('button', { class: 'tab', text: label, onClick: () => select(id) }));
  btns.forEach(b => tabs.append(b));

  select('top');
  function select(id) {
    btns.forEach((b, i) => b.classList.toggle('active', [['top'], ['search'], ['create']][i][0] === id));
    content.innerHTML = '';
    if (id === 'top') loadTop(content);
    if (id === 'search') renderSearch(content);
    if (id === 'create') renderCreate(content);
  }
}

async function loadTop(content) {
  content.append(h('div', { class: 'dim small', text: 'Chargement…' }));
  try {
    const { clans } = await api.get('/api/clans/top');
    content.innerHTML = '';
    if (!clans.length) { content.append(h('div', { class: 'empty', text: 'Aucun clan pour l\'instant — crée le premier !' })); return; }
    clans.forEach((c, i) => {
      content.append(h('div', { class: 'list-row', onClick: () => tryJoin(c) },
        h('b', { class: 'mono', text: `#${i + 1}` }),
        h('span', { class: 'clan-tag', text: c.tag }),
        h('b', { text: c.name }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'dim small', text: `${c.members} membres` }),
        h('span', { class: 'mono', html: `${icon('trophy')} ${fmt(c.trophies)}` })));
    });
  } catch { content.textContent = 'Hors ligne.'; }
}

function renderSearch(content) {
  const input = h('input', { placeholder: 'Nom ou tag de clan…', style: { flex: 1 } });
  const results = h('div', { style: { marginTop: '12px' } });
  const doSearch = async () => {
    results.innerHTML = '';
    if (input.value.length < 2) return;
    const { clans } = await api.get(`/api/clans/search?q=${encodeURIComponent(input.value)}`);
    if (!clans.length) { results.append(h('div', { class: 'empty', text: 'Aucun résultat.' })); return; }
    for (const c of clans) {
      results.append(h('div', { class: 'list-row' },
        h('span', { class: 'clan-tag', text: c.tag }), h('b', { text: c.name }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'badge ' + (c.open ? 'green' : 'gray'), text: c.open ? 'ouvert' : 'sur demande' }),
        h('button', { class: 'btn small primary', text: 'Rejoindre', onClick: () => tryJoin(c) })));
    }
  };
  content.append(h('div', { class: 'row' }, input, h('button', { class: 'btn primary', html: `${icon('search')}`, onClick: doSearch })), results);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
}

function renderCreate(content) {
  const name = h('input', { placeholder: 'Nom du clan (3-20)', maxlength: 20 });
  const tag = h('input', { placeholder: 'Tag (2-5)', maxlength: 5, style: { textTransform: 'uppercase' } });
  const desc = h('input', { placeholder: 'Description (optionnel)', maxlength: 120 });
  const open = h('input', { type: 'checkbox', checked: true, style: { width: '18px' } });
  content.append(h('div', { class: 'panel', style: { maxWidth: '460px' } },
    h('div', { class: 'panel-title', html: `${icon('clan')} Créer un clan — ${CLAN_CONFIG.createCost} crédits` }),
    h('div', { class: 'form-row' }, h('label', { text: 'Nom' }), name),
    h('div', { class: 'form-row' }, h('label', { text: 'Tag' }), tag),
    h('div', { class: 'form-row' }, h('label', { text: 'Description' }), desc),
    h('div', { class: 'setting-row' }, h('div', { class: 's-label', text: 'Clan ouvert (entrée libre)' }), h('label', { class: 'switch' }, open, h('i'))),
    h('button', {
      class: 'btn primary', text: 'Créer le clan', onClick: async () => {
        try {
          await api.post('/api/clans', { name: name.value.trim(), tag: tag.value.trim(), desc: desc.value.trim(), open: open.checked });
          toast('Clan créé ! Tu en es le chef.', 'success');
          navigate('clan', {}, { force: true });
        } catch (e) { toast(errText(e), 'error'); }
      },
    })));
}

async function tryJoin(c) {
  try {
    const out = await api.post('/api/clans/join', { clanId: c.id });
    toast(out.joined ? `Tu as rejoint ${c.name} !` : `Demande envoyée à ${c.name}`, 'success');
    navigate('clan', {}, { force: true });
  } catch (e) { toast(errText(e), 'error'); }
}

// ---------- in clan ----------
function renderMyClan(body, data) {
  const { clan, role, members, joinRequests, war } = data;
  const canManage = ['leader', 'coleader'].includes(role);
  const canRecruit = ['leader', 'coleader', 'officer'].includes(role);

  const tabs = h('div', { class: 'tabs' });
  const content = h('div', {});
  body.append(tabs, content);
  const defs = [['info', 'Clan'], ['members', `Membres (${members.length})`], ['chat', 'Chat'], ['war', 'Guerre']];
  if (canRecruit && joinRequests.length) defs.push(['requests', `Demandes (${joinRequests.length})`]);
  const btns = defs.map(([id, label]) => h('button', { class: 'tab', text: label, onClick: () => select(id) }));
  btns.forEach(b => tabs.append(b));
  select('info');

  function select(id) {
    btns.forEach((b, i) => b.classList.toggle('active', defs[i][0] === id));
    content.innerHTML = '';
    if (id === 'info') renderInfo(content);
    if (id === 'members') renderMembers(content);
    if (id === 'chat') renderChat(content);
    if (id === 'war') renderWar(content);
    if (id === 'requests') renderRequests(content);
  }

  function renderInfo(c) {
    c.append(h('div', { class: 'clan-hero' },
      h('span', { class: 'clan-tag', text: clan.tag }),
      h('div', {},
        h('h3', { text: clan.name }),
        h('div', { class: 'dim small', text: clan.desc || 'Pas de description.' })),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', text: role === 'leader' ? 'Dissoudre' : 'Quitter', onClick: async () => {
        confirmBox(role === 'leader' ? 'Dissoudre le clan' : 'Quitter le clan',
          role === 'leader' ? 'Le clan sera dissous pour tous les membres.' : 'Tu pourras rejoindre un autre clan ensuite.', async () => {
          try { await api.post('/api/clans/leave'); toast('Clan quitté'); navigate('clan', {}, { force: true }); }
          catch (e) { toast(errText(e), 'error'); }
        });
      } })));
    c.append(h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
      statBox(`Niv ${clan.level}`, 'Niveau clan'),
      statBox(fmt(clan.xp), 'XP clan'),
      statBox(fmt(clan.trophies), 'Trophées clan'),
      statBox(`${members.length}/${CLAN_CONFIG.maxMembers}`, 'Membres')));
    const nextLevel = CLAN_CONFIG.levels.find(l => l.level === clan.level + 1);
    if (nextLevel) {
      const prevXp = CLAN_CONFIG.levels.find(l => l.level === clan.level).xp;
      c.append(h('div', { style: { marginTop: '12px' } },
        h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (clan.xp - prevXp) / (nextLevel.xp - prevXp) * 100)}%` } })),
        h('div', { class: 'faint small', style: { marginTop: '4px' }, text: `Niveau ${nextLevel.level} à ${fmt(nextLevel.xp)} XP` })));
    }
    c.append(h('div', { class: 'panel', style: { marginTop: '12px' } },
      h('div', { class: 'panel-title', html: `${icon('info')} Fonctionnement` }),
      h('p', { class: 'dim small', style: { lineHeight: 1.6 } },
        'Le clan gagne de l\'XP à chaque match joué (bonus si victoire, bonus si tu joues avec un clanmate). Chaque niveau débloque de la visibilité dans le classement. La Guerre de clan agrège les performances hebdomadaires de tous les membres.')));
  }

  function renderMembers(c) {
    for (const m of members) {
      c.append(h('div', { class: 'member-row' },
        h('span', { class: `presence ${m.presence}`, title: m.presence }),
        h('div', {}, h('b', { text: m.username, onClick: () => navigate('profile', { name: m.username }) }),
          h('div', { class: 'faint small mono', text: `${fmt(m.trophies)} TR` })),
        h('span', { class: `role-badge ${m.role}`, text: ROLE_LABEL[m.role] ?? m.role }),
        h('span', { class: 'faint small m-hide-m', text: m.presence === 'in_match' ? 'en match' : m.presence === 'online' ? 'en ligne' : 'hors ligne' }),
        h('span', { class: 'row', style: { gap: '6px' } },
          canManage && m.role !== 'leader' ? h('button', { class: 'iconbtn', html: icon('edit'), title: 'Rôle', onClick: () => roleModal(m) }) : null,
          canManage && m.role !== 'leader' ? h('button', { class: 'iconbtn', html: icon('close'), title: 'Exclure', onClick: async () => {
            confirmBox('Exclure du clan', `Exclure ${m.username} du clan ?`, async () => {
              try { await api.post('/api/clans/kick', { clanId: clan.id, userId: m.userId }); toast('Membre exclu'); navigate('clan', {}, { force: true }); }
              catch (e) { toast(errText(e), 'error'); }
            });
          } }) : null,
        )));
    }
  }

  function roleModal(m) {
    const body2 = h('div', { class: 'row wrap' });
    for (const r of ['coleader', 'officer', 'member', 'recruit']) {
      body2.append(h('button', { class: 'btn small', text: ROLE_LABEL[r], onClick: async () => {
        try { await api.post('/api/clans/role', { clanId: clan.id, userId: m.userId, role: r }); mo.close(); toast(`${m.username} → ${ROLE_LABEL[r]}`); navigate('clan', {}, { force: true }); }
        catch (e) { toast(errText(e), 'error'); }
      } }));
    }
    const mo = modal({ title: `Rôle de ${m.username}`, body: body2, actions: [{ label: 'Fermer', kind: 'ghost' }] });
  }

  function renderChat(c) {
    const log = h('div', { class: 'chat-log' });
    const input = h('input', { placeholder: 'Message au clan…', maxlength: 240, style: { flex: 1 } });
    c.append(h('div', { class: 'chat-box', style: { height: '52vh' } }, log,
      h('div', { class: 'chat-input-row' }, input, h('button', { class: 'btn primary', html: icon('send'), onClick: send }))));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    (async () => {
      try {
        const { messages } = await api.get(`/api/chat/clan/${clan.id}`);
        for (const m of messages) addLine(m);
      } catch { /* offline */ }
    })();
    function addLine(m) {
      log.append(h('div', { class: 'chat-msg' }, h('span', { class: 'c-name', text: m.username }), h('span', { text: m.text })));
      log.scrollTop = log.scrollHeight;
    }
    async function send() {
      if (!input.value.trim()) return;
      wsSend({ t: 'chat', channel: 'clan', text: input.value });
      input.value = '';
    }
    // live clan chat via ws
    onWs('chat', (m) => { if (m.channel === 'clan' && m.channelId === clan.id) addLine(m); });
  }

  function renderWar(c) {
    c.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-title', html: `${icon('swords')} Guerre de clan — semaine ${war.week}` }),
      h('div', { class: 'grid cols-3' },
        statBox(`${war.score.points}`, 'Points'),
        statBox(`${war.score.wins}`, 'Victoires'),
        statBox(`${war.score.matches}`, 'Matchs')),
      h('p', { class: 'dim small', style: { marginTop: '10px', lineHeight: 1.6 } },
        'Les points se cumulent chaque semaine : +3 par victoire, +1 par défaite, comptabilisés uniquement quand tu joues avec un clanmate. Le classement des clans agrège ces points.')));
    // war leaderboard from /api/clans/top (trophies) — real war ranking endpoint
    api.get('/api/clans/top').then(({ clans }) => {
      const lb = h('div', { class: 'panel', style: { marginTop: '12px' } });
      lb.append(h('div', { class: 'panel-title', html: `${icon('crown')} Classement clans` }));
      clans.slice(0, 10).forEach((cl, i) => {
        lb.append(h('div', { class: 'lb-row', style: { gridTemplateColumns: '30px 1fr auto auto' } },
          h('b', { text: `#${i + 1}` }), h('span', { text: `${cl.tag} ${cl.name}` }),
          h('span', { class: 'dim small', text: `Niv ${cl.level}` }),
          h('b', { class: 'mono', text: fmt(cl.trophies) })));
      });
      c.append(lb);
    }).catch(() => {});
  }

  function renderRequests(c) {
    if (!joinRequests.length) { c.append(h('div', { class: 'empty', text: 'Aucune demande en attente.' })); return; }
    for (const r of joinRequests) {
      c.append(h('div', { class: 'list-row' },
        h('b', { text: r.username }),
        h('span', { class: 'dim small mono', text: `${fmt(r.trophies)} TR` }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', text: 'Accepter', onClick: async () => {
          try { await api.post('/api/clans/requests/resolve', { clanId: clan.id, userId: r.userId, accept: true }); toast('Membre ajouté'); navigate('clan', {}, { force: true }); }
          catch (e) { toast(errText(e), 'error'); }
        } }),
        h('button', { class: 'btn small ghost', text: 'Refuser', onClick: async () => {
          try { await api.post('/api/clans/requests/resolve', { clanId: clan.id, userId: r.userId, accept: false }); navigate('clan', {}, { force: true }); }
          catch (e) { toast(errText(e), 'error'); }
        } })));
    }
  }
}

function statBox(v, label) {
  return h('div', { class: 'pstat' }, h('b', { text: v }), h('span', { text: label }));
}
