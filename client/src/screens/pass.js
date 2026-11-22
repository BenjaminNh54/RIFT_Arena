// RIFT ARENA — Battle Pass (free + premium tracks, claim tiers)
import { h, modal, toast, fmt, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state } from '../state.js';

const KIND_LABEL = {
  credits: 'Crédits', rift_tokens: 'Jetons', skin: 'Skin', title: 'Titre', banner: 'Bannière',
  chest: 'Coffre', emote: 'Emote', effect: 'Effet', avatar: 'Avatar', fighter: 'Combattant',
};
function rewLabel(r) {
  if (!r) return '—';
  const base = KIND_LABEL[r.type] ?? r.type;
  if (r.type === 'credits' || r.type === 'rift_tokens') return `${fmt(r.amount)} ${base}`;
  if (r.type === 'chest') return `Coffre ${r.id}`;
  return base + (r.id ? ` ${r.id}` : '');
}
const KIND_ICON = { credits: 'coin', rift_tokens: 'token', skin: 'star', title: 'crown', banner: 'flag', chest: 'pass', emote: 'chat', effect: 'bolt', avatar: 'profile', fighter: 'fighters' };

export function renderPass(el) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' }, h('h2', { text: 'Battle Pass' })));
  const body = h('div', { class: 'dim small', text: 'Chargement…' });
  wrap.append(body);
  el.append(wrap);
  load(body);
}

async function load(body) {
  let data;
  try { data = await api.get('/api/pass'); } catch { body.textContent = 'Hors ligne.'; return; }
  body.innerHTML = '';
  body.classList.remove('dim', 'small');
  const { pass, progress, tiers } = data;

  // header
  body.append(h('div', { class: 'panel' },
    h('div', { class: 'row wrap' },
      h('div', {},
        h('h3', { text: pass.name }),
        h('div', { class: 'dim small', text: `Saison ${pass.season} · ${pass.tiers} paliers · ${pass.xpPerTier} XP / palier` })),
      h('span', { class: 'spacer' }),
      progress.premium ? h('span', { class: 'badge gold', text: 'PREMIUM ACTIF' })
        : h('button', {
          class: 'btn violet', html: `${icon('token')} Premium — ${pass.premiumPrice.amount} jetons`,
          onClick: () => buyPremium(body),
        })),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      h('b', { class: 'mono', text: `Palier ${progress.tier} / ${pass.tiers}` }),
      h('span', { class: 'spacer' }),
      h('span', { class: 'dim small mono', text: `${fmt(progress.xp)} XP` })),
    h('div', { class: 'bar gold', style: { marginTop: '6px' } },
      h('i', { style: { width: `${Math.min(100, (progress.xp % pass.xpPerTier) / pass.xpPerTier * 100)}%` } })),
  ));

  // track
  const track = h('div', { class: 'pass-track' });
  for (const t of tiers) {
    const locked = t.tier > progress.tier;
    const tierEl = h('div', { class: `pass-tier ${locked ? 'locked' : ''}` });
    tierEl.append(h('div', { class: 'pt-num' }, h('span', { text: `PALIER ${t.tier}` }), h('span', { text: locked ? '' : 'OK' })));
    tierEl.append(passRewardCard(t, 'free', locked, body));
    tierEl.append(passRewardCard(t, 'premium', locked || !progress.premium, body));
    track.append(tierEl);
  }
  body.append(track);
}

function passRewardCard(t, trackName, locked, body) {
  const r = trackName === 'premium' ? t.premium : t.free;
  const claimed = trackName === 'premium' ? t.claimedPremium : t.claimedFree;
  const claimable = !locked && !claimed;
  return h('div', { class: `pt-rew ${trackName === 'premium' ? 'premium' : ''}` },
    h('span', { class: 'pt-sub', text: trackName === 'premium' ? 'PREMIUM' : 'GRATUIT' }),
    h('div', { class: 'row' }, h('span', { html: icon(KIND_ICON[r?.type] ?? 'star'), style: { color: trackName === 'premium' ? 'var(--gold)' : 'var(--cyan)', width: '18px' } }),
      h('div', { class: 'pt-kind', text: rewLabel(r) })),
    h('button', {
      class: `btn small ${claimed ? 'ghost' : claimable ? 'primary claim-pulse' : 'ghost'}`,
      text: claimed ? 'Reçu' : claimable ? 'Réclamer' : locked ? 'Verrouillé' : '—',
      disabled: !claimable,
      onClick: async () => {
        try {
          const out = await api.post('/api/pass/claim', { tier: t.tier, track: trackName });
          toast(`Récompense reçue : ${rewLabel(out.reward)}`, 'success');
          load(body);
        } catch (e) { toast(errText(e), 'error'); }
      },
    }),
  );
}

async function buyPremium(body) {
  const { confirmBox } = await import('../components/ui.js');
  confirmBox('Pass Premium', 'Débloque le track premium (skins exclusifs, jetons, titres) pour cette saison. Cosmétique uniquement — aucun avantage gameplay.', async () => {
    try {
      await api.post('/api/pass/premium');
      toast('Pass Premium activé !', 'success');
      load(body);
    } catch (e) { toast(errText(e), 'error'); }
  }, { danger: false, yesLabel: 'Acheter' });
}
