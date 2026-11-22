// RIFT ARENA — friends & party (list, requests, search, block, party management, chat privé)
import { h, modal, toast, fmt, confirmBox } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText, wsSend, onWs } from '../network/api.js';
import { state } from '../state.js';
import { navigate } from '../router.js';

const PRESENCE_FR = { online: 'en ligne', in_match: 'en match', offline: 'hors ligne' };

export function renderFriends(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' }, h('h2', { text: 'Amis & Groupe' })));
  const body = h('div', { class: 'dim small', text: 'Chargement…' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/friends'); } catch { body.textContent = 'Hors ligne.'; return; }
  const { party } = await api.get('/api/party').catch(() => ({ party: null }));
  state.party = party;
  body.innerHTML = '';
  body.classList.remove('dim', 'small');

  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '14px' } });
  if (window.innerWidth < 900) grid.style.gridTemplateColumns = '1fr';

  // ---- friends column ----
  const friendsCol = h('div', {});
  friendsCol.append(h('div', { class: 'panel-title', html: `${icon('friends')} Amis (${data.friends.length})` }));

  // search + add
  const searchInput = h('input', { placeholder: 'Ajouter par nom de joueur…', maxlength: 16, style: { flex: 1 } });
  const results = h('div', {});
  const doSearch = async () => {
    results.innerHTML = '';
    if (searchInput.value.length < 2) return;
    const { users } = await api.get(`/api/users/search?q=${encodeURIComponent(searchInput.value)}`);
    for (const u of users) {
      results.append(h('div', { class: 'list-row', style: { padding: '6px 10px' } },
        h('b', { text: u.username }),
        h('span', { class: 'dim small mono', text: `${fmt(u.trophies)} TR` }),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', text: 'Inviter', onClick: async () => {
          try { await api.post('/api/friends/request', { username: u.username }); toast(`Demande envoyée à ${u.username}`, 'success'); }
          catch (e) { toast(errText(e), 'error'); }
        } })));
    }
    if (!users.length) results.append(h('div', { class: 'faint small', text: 'Aucun joueur trouvé.' }));
  };
  friendsCol.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, searchInput,
    h('button', { class: 'btn primary', html: icon('plus'), onClick: doSearch })), results);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // incoming requests
  if (data.requests.length) {
    const reqPanel = h('div', { class: 'panel', style: { marginBottom: '12px' } });
    reqPanel.append(h('div', { class: 'panel-title', html: `${icon('bell')} Demandes reçues (${data.requests.length})` }));
    for (const r of data.requests) {
      reqPanel.append(h('div', { class: 'list-row', style: { marginBottom: '6px' } },
        h('b', { text: r.username }), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', text: 'Accepter', onClick: async () => {
          try { await api.post('/api/friends/resolve', { from: r.from, accept: true }); toast(`${r.username} est maintenant ton ami`, 'success'); load(body); }
          catch (e) { toast(errText(e), 'error'); }
        } }),
        h('button', { class: 'btn small ghost', text: 'Refuser', onClick: async () => {
          await api.post('/api/friends/resolve', { from: r.from, accept: false }).catch(() => {});
          load(body);
        } })));
    }
    friendsCol.append(reqPanel);
  }

  // friends list
  if (!data.friends.length) {
    friendsCol.append(h('div', { class: 'empty', html: `${icon('friends')}<div>Aucun ami — cherche des joueurs ci-dessus.</div>` }));
  }
  for (const f of data.friends) {
    const blocked = !!f.blockedBy;
    friendsCol.append(h('div', { class: 'list-row' },
      h('span', { class: `presence ${f.presence}` }),
      h('div', { style: { flex: 1, cursor: 'pointer' }, onClick: () => navigate('profile', { name: f.username }) },
        h('b', { text: f.username }),
        h('div', { class: 'faint small', text: `${fmt(f.trophies)} TR · ${blocked ? 'bloqué' : PRESENCE_FR[f.presence]}` })),
      h('button', { class: 'iconbtn', title: 'Message', html: icon('chat'), onClick: () => privateChat(f) }),
      !blocked && f.presence !== 'offline' ? h('button', { class: 'iconbtn', title: 'Inviter en groupe', html: icon('party'), onClick: async () => {
        try {
          const { party: mine } = await api.get('/api/party');
          if (!mine) await api.post('/api/party', { action: 'create' });
          await api.post('/api/party', { action: 'invite', userId: f.id });
          toast(`Invitation envoyée à ${f.username}`, 'success');
        } catch (e) { toast(errText(e), 'error'); }
      } }) : null,
      blocked ? h('button', { class: 'iconbtn', title: 'Débloquer', html: icon('check'), onClick: async () => {
        await api.post('/api/friends/unblock', { userId: f.id }); load(body);
      } }) : h('button', { class: 'iconbtn', title: 'Bloquer', html: icon('close'), onClick: () => {
        confirmBox('Bloquer', `Bloquer ${f.username} ? Il ne pourra plus t'envoyer de demandes ni de messages.`, async () => {
          await api.post('/api/friends/block', { userId: f.id }); load(body);
        });
      } }),
      h('button', { class: 'iconbtn', title: 'Retirer', html: icon('trash'), onClick: () => {
        confirmBox('Retirer un ami', `Retirer ${f.username} de tes amis ?`, async () => {
          await api.post('/api/friends/remove', { userId: f.id }); load(body);
        });
      } }),
    ));
  }
  grid.append(friendsCol);

  // ---- party column ----
  const partyCol = h('div', {});
  partyCol.append(h('div', { class: 'panel-title', html: `${icon('party')} Groupe` }));
  const partyPanel = h('div', { class: 'panel' });
  renderParty(partyPanel, party, body);
  partyCol.append(partyPanel);
  grid.append(partyCol);

  body.append(grid);
}

function renderParty(panel, party, body) {
  panel.innerHTML = '';
  if (!party) {
    panel.append(h('div', { class: 'dim small', text: 'Tu n\'es pas dans un groupe. Crée-en un et invite jusqu\'à 4 amis pour matcher ensemble.' }),
      h('button', { class: 'btn primary', style: { marginTop: '10px' }, text: 'Créer un groupe', onClick: async () => {
        try { await api.post('/api/party', { action: 'create' }); toast('Groupe créé', 'success'); load(body); }
        catch (e) { toast(errText(e), 'error'); }
      } }));
    return;
  }
  const isLeader = party.leaderId === state.profile?.id;
  panel.append(h('div', { class: 'row' }, h('b', { text: `Groupe (${party.members.length}/5)` }), h('span', { class: 'spacer' }),
    h('button', { class: 'btn small ghost', text: 'Quitter', onClick: async () => { await api.post('/api/party', { action: 'leave' }); load(body); } })));
  for (const m of party.members) {
    panel.append(h('div', { class: 'list-row', style: { padding: '6px 10px' } },
      h('b', { text: m }),
      m === party.leaderId ? h('span', { class: 'badge gold', text: 'CHEF' }) : null,
      h('span', { class: 'spacer' }),
      isLeader && m !== party.leaderId ? h('button', { class: 'iconbtn', html: icon('close'), title: 'Exclure', onClick: async () => {
        await api.post('/api/party', { action: 'kick', userId: m }); load(body);
      } }) : null));
  }
  if (isLeader) {
    panel.append(h('div', { class: 'form-row', style: { marginTop: '8px' } },
      h('label', { text: 'Mode du groupe (le chef décide)' }),
      h('select', { onChange: async (e) => { await api.post('/api/party', { action: 'mode', mode: e.target.value }); toast('Mode du groupe mis à jour', 'success'); } },
        ['crystal_rush', 'strikeball', 'domination', 'elimination', 'last_core', 'boss_raid'].map(m2 =>
          h('option', { value: m2, ...(party.mode === m2 ? { selected: true } : {}) }, MODE_NAME[m2] ?? m2)))));
    panel.append(h('button', { class: 'btn play', style: { marginTop: '8px', width: '100%' }, html: `${icon('play')} JOUER EN GROUPE`, onClick: () => navigate('lobby') }));
  } else {
    panel.append(h('div', { class: 'faint small', style: { marginTop: '8px' } }, 'Le chef lance la recherche pour tout le groupe.'));
  }
}

const MODE_NAME = {
  crystal_rush: 'Crystal Rush', strikeball: 'Strikeball', domination: 'Domination',
  elimination: 'Elimination', last_core: 'Last Core', boss_raid: 'Boss Raid',
};

function privateChat(f) {
  const log = h('div', { class: 'chat-log', style: { height: '300px' } });
  const input = h('input', { placeholder: 'Message privé…', maxlength: 240, style: { flex: 1 } });
  const m = modal({
    title: `Chat privé — ${f.username}`,
    body: h('div', { class: 'chat-box' }, log, h('div', { class: 'chat-input-row' }, input,
      h('button', { class: 'btn primary', html: icon('send'), onClick: send }))),
    actions: [{ label: 'Fermer', kind: 'ghost' }],
  });
  const un = onWs('chat', (msg) => {
    if (msg.channel === 'private' && (msg.userId === f.id || msg.channelId === f.id)) addLine(msg);
  });
  api.get(`/api/chat/private/${f.id}`).then(({ messages }) => { for (const mm of messages) addLine(mm); }).catch(() => {});
  function addLine(msg) {
    log.append(h('div', { class: 'chat-msg' }, h('span', { class: 'c-name', text: msg.username }), h('span', { text: msg.text })));
    log.scrollTop = log.scrollHeight;
  }
  async function send() {
    if (!input.value.trim()) return;
    wsSend({ t: 'chat', channel: 'private', to: f.id, text: input.value });
    input.value = '';
  }
  const obs = new MutationObserver(() => {
    if (!document.body.contains(log)) { un(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
