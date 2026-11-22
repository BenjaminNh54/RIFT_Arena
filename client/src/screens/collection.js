// RIFT ARENA — fighter collection + fighter detail (stats, abilities, skins, select)
import { h, modal, toast, fmt, drawFighter, pill, confirmBox } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText } from '../network/api.js';
import { state } from '../state.js';
import { refreshProfile } from '../app.js';
import { navigate } from '../router.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';

const RARITY_FR = { starter: 'Starter', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire' };

export function renderCollection(el) {
  const wrap = h('div', { class: 'screen-pad' });
  const head = h('div', { class: 'screen-head' },
    h('h2', { text: 'Combattants' }),
    h('span', { class: 'sub', text: 'Chaque combattant a sa propre mécanique' }));
  wrap.append(head);

  const grid = h('div', { class: 'fighter-grid', id: 'fighter-grid' });
  wrap.append(grid);
  el.append(wrap);
  load(grid);
}

async function load(grid) {
  let data;
  try { data = await api.get('/api/fighters'); }
  catch { grid.append(h('div', { class: 'empty', text: 'Chargement impossible (hors ligne).' })); return; }

  grid.innerHTML = '';
  const owned = data.fighters.filter(f => f.owned);
  const locked = data.fighters.filter(f => !f.owned);
  const ordered = [...owned.sort(sortFn), ...locked.sort(sortFn)];
  for (const f of ordered) {
    const card = h('div', { class: `fighter-card ${f.owned ? '' : 'locked'} ${f.selected ? 'selected' : ''}` });
    const port = h('div', { class: 'fc-portrait' });
    const cv = h('canvas');
    port.append(cv);
    card.append(port,
      h('div', { class: 'fc-name', text: f.name }),
      h('div', { class: 'fc-class', text: `${f.clazz} · ${RARITY_FR[f.rarity] ?? ''}` }));
    if (!f.owned) card.append(h('span', { class: 'badge gray fc-locked', html: `${icon('lock')} ${f.unlock?.value ?? ''} TR` }));
    else card.append(h('span', { class: 'fc-trophies', html: `${icon('trophy')} ${f.trophies}` }));
    card.onclick = () => navigate('collection', { fighter: f.id });
    grid.append(card);
    drawFighter(cv, f, { size: 108 });
  }
}

function sortFn(a, b) { return (b.level ?? 0) - (a.level ?? 0) || (b.trophies ?? 0) - (a.trophies ?? 0); }

// ---------- detail ----------
export function renderFighterDetail(el, fighterId) {
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('button', { class: 'iconbtn', html: icon('back'), onClick: () => navigate('collection') }),
    h('h2', { text: 'Détail combattant' })));
  const body = h('div', { class: 'dim small', text: 'Chargement…' });
  wrap.append(body);
  el.append(wrap);
  loadDetail(body, fighterId);
}

async function loadDetail(body, fighterId) {
  let data;
  try { data = await api.get('/api/fighters'); } catch { body.textContent = 'Hors ligne.'; return; }
  const f = data.fighters.find(x => x.id === fighterId) ?? data.fighters[0];
  body.innerHTML = '';
  body.classList.remove('dim', 'small');

  const detail = h('div', { class: 'fighter-detail' });

  // left: portrait + stats
  const left = h('div', {});
  const port = h('div', { class: 'fd-portrait' });
  const cv = h('canvas');
  port.append(cv);
  drawFighter(cv, f, { size: 240 });
  const stats = h('div', { class: 'fd-stats' });
  const maxes = { hp: 6000, speed: 300, damage: 1300, range: 950, reload: 2800 };
  const rows = [
    ['Santé', f.hp, 'hp', 'green'],
    ['Vitesse', f.speed, 'speed', 'blue'],
    ['Dégâts', f.attack.damage, 'damage', 'red'],
    ['Portée', f.attack.range, 'range', ''],
    ['Rechargement', f.attack.reload, 'reload', 'gold'],
  ];
  for (const [label, val, key, color] of rows) {
    stats.append(h('div', { class: 'fd-stat' },
      h('span', { text: label }),
      h('div', { class: `bar ${color}` }, h('i', { style: { width: `${Math.min(100, val / maxes[key] * 100)}%` } })),
      h('b', { class: 'mono', text: fmt(val) })));
  }
  left.append(port, stats,
    h('div', { class: 'row', style: { marginTop: '12px' } },
      pill('trophies', f.trophies),
      h('span', { class: 'badge', text: `Maîtrise Niv ${f.level}` }),
      f.selected ? h('span', { class: 'badge green', text: 'Sélectionné' }) : null,
    ));

  // right: abilities
  const right = h('div', {});
  right.append(h('div', { class: 'row' },
    h('h3', { text: f.name, style: { fontSize: '26px' } }),
    h('span', { class: 'badge violet', text: f.clazz }),
    h('span', { class: 'badge gray', text: RARITY_FR[f.rarity] ?? f.rarity }),
    h('span', { class: 'spacer' }),
    f.owned ? null : h('span', { class: 'badge gold', html: `${icon('lock')} Débloqué à ${f.unlock?.value} TR` }),
  ));
  right.append(h('p', { class: 'dim', style: { margin: '8px 0 14px', fontSize: '13.5px' }, text: f.tagline }));

  const abilities = h('div', { class: 'fd-abilities' });
  abilities.append(abilityCard('bolt', 'Attaque : ' + f.attack.name, describeAttack(f.attack), f.attack.color ?? 'var(--cyan)'));
  if (f.super) abilities.append(abilityCard('super', 'Super : ' + f.super.name, describeSuper(f.super), f.super.color ?? 'var(--gold)'));
  if (f.ability) abilities.append(abilityCard('gadget', 'Capacité : ' + f.ability.name, `${abilityDesc(f.ability)} · ${f.ability.uses} utilisations par match`, 'var(--violet)'));
  if (f.passive) abilities.append(abilityCard('passive', 'Passif', passiveDesc(f.passive), 'var(--cyan)'));
  right.append(abilities);

  // skins
  if (f.skins?.length) {
    right.append(h('div', { class: 'section-title', html: `${icon('star')} Skins` }));
    const skinRow = h('div', { class: 'grid cols-3', style: { gap: '8px' } });
    for (const s of f.skins) {
      const ownedSkin = (f.ownedSkins ?? []).includes(s.id);
      skinRow.append(h('div', { class: 'card', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('span', { style: { width: '22px', height: '22px', background: s.body, clipPath: 'polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)' } }),
        h('div', {},
          h('div', { style: { fontWeight: 800, fontSize: '12.5px' }, text: s.name }),
          h('div', { class: 'faint small', text: ownedSkin ? 'Possédé' : `${s.price} ${s.currency === 'credits' ? 'crédits' : 'jetons'}` })),
      ));
    }
    right.append(skinRow);
  }

  // actions
  const actions = h('div', { class: 'row', style: { marginTop: '16px', flexWrap: 'wrap' } });
  if (f.owned && !f.selected) {
    actions.append(h('button', { class: 'btn primary', text: 'Sélectionner', onClick: async () => {
      try {
        await api.post('/api/me/select', { fighterId: f.id });
        state.profile.selected_fighter = f.id;
        toast(`${f.name} sélectionné`, 'success');
        navigate('collection', {}, { force: true });
      } catch (e) { toast(errText(e), 'error'); }
    } }));
  }
  if (f.owned) {
    actions.append(h('button', { class: 'btn play', html: `${icon('play')} JOUER`, onClick: () => navigate('lobby') }));
  }
  right.append(actions);

  detail.append(left, right);
  body.append(detail);
}

function abilityCard(iconName, title, desc, color) {
  return h('div', { class: 'ability-card' },
    h('div', { class: 'ability-icon', style: { background: hexA2(color, 0.12), color } , html: icon(iconName) }),
    h('div', {}, h('b', { text: title }), h('div', { class: 'dim small', style: { marginTop: '4px', lineHeight: 1.5 }, text: desc })));
}
function hexA2(c, a) {
  if (!c.startsWith('#')) return `rgba(53,224,255,${a})`;
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function describeAttack(a) {
  const kind = { projectile: 'projectile rapide', spread: `projectiles multiples (x${a.count})`, melee: 'coup de mêlée en arc', lob: 'obus en cloche (passe les murs)', homing: 'drone à tête chercheuse (soigne les alliés traversés)' }[a.type];
  return `${kind} — ${fmt(a.damage)} dégâts, portée ${fmt(a.range)}, ${a.ammo} munitions (rechargement ${a.reload / 1000}s).`;
}
function describeSuper(s) {
  const map = {
    zone: `Zone électrique ${s.zone.radius}px infligeant ${s.zone.dps}/s pendant ${s.zone.duration / 1000}s + vitesse augmentée`,
    reveal: 'Révèle tous les ennemis 8s ; la prochaine attaque perce les murs',
    shockwave: `Onde de choc ${s.wave.radius}px : ${fmt(s.wave.damage)} dégâts, repousse et étourdit`,
    dash: `Dash de ${s.dash.distance}px, l'attaque suivante inflige x${s.dash.buff?.nextDamageMult ?? 1.3}`,
    turret: `Tourelle ${s.turret.hp} PV, ${fmt(s.turret.damage)} dégâts/tir pendant ${s.turret.lifetime / 1000}s`,
    drone: `Drone gardien : soigne ${s.drone.healPerSec} PV/s aux alliés proches pendant ${s.drone.duration / 1000}s`,
  };
  return map[s.special] ?? 'Super';
}
function abilityDesc(a) {
  return {
    reload: `Recharge ${a.amount} munition(s) instantanément`,
    dash: `Petit dash de ${a.distance}px`,
    shield: `Bouclier de ${fmt(a.amount)} pendant ${a.duration / 1000}s`,
    heal: `Soigne ${fmt(a.amount)} PV (+ répare la tourelle)`,
    buff: 'Prochaine attaque renforcée (+40%)',
  }[a.type] ?? 'Capacité';
}
function passiveDesc(p) {
  return {
    speed_on_hit: `Vitesse +${Math.round((p.mult - 1) * 100)}% pendant 2s après avoir touché`,
    shield_regen: `Bouclier qui se régénère (${p.rate}/s jusqu'à ${fmt(p.max)}) hors combat`,
    ally_speed: `Alliés proches (rayon ${p.radius}) gagnent +${Math.round((p.mult - 1) * 100)}% vitesse`,
    adrenaline: `Vitesse +${Math.round((p.mult - 1) * 100)}% quand les PV passent sous ${p.below * 100}%`,
  }[p.type] ?? 'Passif';
}
