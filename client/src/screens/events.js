// RIFT ARENA — Events (list + detail + play + claim)
import { h, modal, toast, fmt, timeLeft, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import {api,errText} from '../network/api.js';
import { navigate } from '../router.js';
import { MODE_MAP } from '/shared/definitions/modes.js';

export function renderEvents(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Events' }),
    h('span', { class: 'sub', text: 'Modes avec modificateurs et récompenses — configurés par les admins' })));
  const body = h('div', { class: 'grid cols-2' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/events'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';
  const live = data.events.filter(e => e.live);
  const upcoming = data.events.filter(e => !e.live && e.status !== 'archived');
  if (!live.length && !upcoming.length) { body.append(h('div', { class: 'empty', text: 'Aucun event programmé.' })); return; }

  for (const ev of live) body.append(eventCard(ev, true));
  if (upcoming.length) {
    body.append(h('div', { class: 'section-title', style: { gridColumn: '1 / -1' }, html: `${icon('clock')} Programmés / en pause` }));
    for (const ev of upcoming) body.append(eventCard(ev, false));
  }
}

function eventCard(ev, live) {
  const mods = Object.entries(ev.modifiers ?? {});
  return h('div', { class: 'event-card', style: { '--ec': ev.banner ?? '#2f4a5a', '--ea': ev.accent ?? 'var(--cyan)' } },
    h('div', { class: 'ec-bg', onClick: () => openDetail(ev.id) },
      h('div', { class: 'ec-top' },
        h('div', {},
          h('h3', { text: ev.name }),
          h('div', { class: 'ec-accent small', style: { letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '2px' }, text: MODE_MAP[ev.mode]?.name ?? ev.mode }),
        ),
        h('div', { style: { textAlign: 'right' } },
          live ? h('div', { class: 'event-countdown', style: { color: ev.accent }, text: ev.endAt ? timeLeft(ev.endAt) : 'actif' })
            : h('span', { class: 'badge gray', text: ev.status === 'scheduled' ? 'bientôt' : ev.status }),
          h('div', { class: 'faint small', style: { marginTop: '4px' }, text: `priorité ${ev.priority ?? 5}` })),
      ),
      h('div', { class: 'ec-desc', text: ev.desc ?? '' }),
      h('div', { class: 'row wrap', style: { marginTop: '12px', gap: '6px' } },
        mods.map(([k, v]) => h('span', { class: 'badge violet', text: `${k}: ${v}` })),
        ev.mission ? h('span', { class: 'badge', text: ev.mission.desc ?? `${ev.mission.metric} x${ev.mission.target}` }) : null,
        ev.reward?.credits ? h('span', { class: 'badge gold', text: `+${ev.reward.credits} crédits` }) : null,
        ev.reward?.rift_tokens ? h('span', { class: 'badge gold', text: `+${ev.reward.rift_tokens} jetons` }) : null,
        ev.reward?.title ? h('span', { class: 'badge gold', text: `Titre ${ev.reward.title}` }) : null,
      ),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('div', { class: 'bar', style: { flex: 1 } }, h('i', { style: { width: `${Math.min(100, (ev.myProgress ?? 0) / (ev.mission?.target ?? 1) * 100)}%` } })),
        h('span', { class: 'mono small dim', text: `${ev.myProgress ?? 0}/${ev.mission?.target ?? 0}` }),
      ),
    ),
    live ? h('div', { class: 'row', style: { padding: '10px 16px', borderTop: '1px solid var(--line)' } },
      h('button', { class: 'btn play', style: { flex: 1 }, html: `${icon('play')} JOUER L'EVENT`, onClick: (e) => { e.stopPropagation(); playEvent(ev); } }),
      (ev.myProgress ?? 0) >= (ev.mission?.target ?? 1e9) && !ev.myClaimed
        ? h('button', { class: 'btn primary', text: 'Récompense', onClick: async (e) => { e.stopPropagation(); await claim(ev); } })
        : null,
    ) : null,
  );
}

async function claim(ev) {
  try {
    const out = await api.post('/api/events/claim', { eventId: ev.id });
    toast(`Récompense event reçue !`, 'gold');
    navigate('events', {}, { force: true });
  } catch (e) { toast(errText(e), 'error'); }
}

async function openDetail(id) {
  try {
    const { event: ev } = await api.get(`/api/events/${id}`);
    modal({
      title: ev.name,
      body: h('div', {},
        h('p', { class: 'dim', style: { lineHeight: 1.6 } }, ev.desc ?? ''),
        h('div', { class: 'stat-row' }, h('span', { text: 'Mode' }), h('b', { text: MODE_MAP[ev.mode]?.name ?? ev.mode })),
        ev.map ? h('div', { class: 'stat-row' }, h('span', { text: 'Map' }), h('b', { text: ev.map })) : null,
        h('div', { class: 'stat-row' }, h('span', { text: 'Statut' }), h('b', { text: ev.status })),
        Object.entries(ev.modifiers ?? {}).map(([k, v]) => h('div', { class: 'stat-row' }, h('span', { text: 'Modificateur' }), h('b', { text: `${k} = ${v}` }))),
        ev.mission ? h('div', { class: 'stat-row' }, h('span', { text: 'Objectif' }), h('b', { text: `${ev.mission.desc ?? ''} (${ev.myProgress ?? 0}/${ev.mission.target})` })) : null,
        h('div', { class: 'stat-row' }, h('span', { text: 'Récompense' }), h('b', { text: ev.reward?.credits ? `${ev.reward.credits} crédits` : ev.reward?.rift_tokens ? `${ev.reward.rift_tokens} jetons` : ev.reward?.title ? `Titre ${ev.reward.title}` : '—' })),
        ev.endAt ? h('div', { class: 'stat-row' }, h('span', { text: 'Termine' }), h('b', { text: new Date(ev.endAt).toLocaleString('fr-FR') })) : null,
      ),
      actions: [{ label: 'Fermer', kind: 'ghost' }],
    });
  } catch (e) { toast(errText(e), 'error'); }
}

async function playEvent(ev) {
  // queue directly into the event's mode with its modifiers (server keeps them in the room)
  try {
    await api.post('/api/queue', { mode: ev.mode, ranked: false, eventId: ev.id, eventName: ev.name, modifiers: ev.modifiers ?? {}, map: ev.map });
    toast(`Event « ${ev.name} » — recherche lancée`, 'success');
    const ov = h('div', { class: 'mm-overlay' },
      h('div', { class: 'mm-ring', html: icon('refresh') }),
      h('div', { class: 'mm-status', text: ev.name }),
      h('div', { class: 'mm-eta', text: 'Bots de remplissage après 8s (mode normal)' }),
      h('button', { class: 'btn danger', text: 'Annuler', onClick: () => {
        api.del('/api/queue').catch(() => {}); ov.remove();
      } }));
    document.getElementById('overlays').append(ov);
  } catch (e) { toast(errText(e), 'error'); }
}
