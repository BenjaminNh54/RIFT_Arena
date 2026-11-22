// RIFT ARENA — settings (audio, video, controls, mobile layout, privacy, account, language arch)
import { h, toast, confirmBox, pill } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, errText, disconnectWs } from '../network/api.js';
import { state, settings, saveSettings, isMobileLayout } from '../state.js';
import { navigate } from '../router.js';
import { sfx } from '../game/audio.js';

export function renderSettings(el) {
  const s = settings();
  const wrap = h('div', { class: 'screen-pad' });
  wrap.append(h('div', { class: 'screen-head' },
    h('h2', { text: 'Paramètres' }),
    h('span', { class: 'spacer' }),
    isStaff() ? h('button', { class: 'btn danger', html: `${icon('shield')} Panel Admin`, onClick: () => navigate('admin') }) : null));

  const apply = (patch) => { saveSettings(patch); sfx.ui(); };

  // ---- audio ----
  const audio = h('div', { class: 'panel' });
  audio.append(h('div', { class: 'panel-title', html: `${icon('pass')} Audio` }));
  audio.append(slider('Volume général', 'master', s, apply, v => { apply({ mute: false }); }));
  audio.append(slider('Musique', 'music', s, apply));
  audio.append(slider('Effets sonores', 'sfx', s, apply));
  audio.append(toggleRow('Tout couper (mute)', 'mute', s.mute, v => apply({ mute: v })));

  // ---- video ----
  const video = h('div', { class: 'panel' });
  video.append(h('div', { class: 'panel-title', html: `${icon('eye')} Affichage` }));
  video.append(selectRow('Qualité graphique', 'graphics', s.graphics, [
    ['auto', 'Auto'], ['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute'],
  ], v => apply({ graphics: v })));
  video.append(selectRow('Limite FPS', 'fpsCap', s.fpsCap, [
    [30, '30'], [60, '60'], [90, '90'], [120, '120'], [144, '144'], [999, 'Illimité'],
  ], v => apply({ fpsCap: +v })));
  video.append(toggleRow('Secousses d\'écran', 'shake', s.shake, v => apply({ shake: v })));
  video.append(toggleRow('Particules', 'particles', s.particles, v => apply({ particles: v })));

  // ---- controls ----
  const controls = h('div', { class: 'panel' });
  controls.append(h('div', { class: 'panel-title', html: `${icon('editor')} Contrôles (PC)` }));
  const kb = s.keybinds;
  for (const [action, label] of [['up', 'Haut'], ['down', 'Bas'], ['left', 'Gauche'], ['right', 'Droite'], ['super', 'Super'], ['interact', 'Action']]) {
    controls.append(keybindRow(label, action, kb, apply));
  }
  controls.append(h('div', { class: 'faint small', style: { marginTop: '6px' } },
    'Souris : clic gauche = attaque · clic droit = capacité · molette/visée libre. Escape = pause.'));

  // ---- mobile ----
  const mobile = h('div', { class: 'panel' });
  mobile.append(h('div', { class: 'panel-title', html: `${icon('party')} Mobile & tactile` }));
  mobile.append(selectRow('Interface forcée', 'forceLayout', s.forceLayout, [['auto', 'Auto'], ['mobile', 'Mobile'], ['desktop', 'Desktop']], v => apply({ forceLayout: v })));
  mobile.append(toggleRow('Aim assist', 'aimAssist', s.aimAssist, v => apply({ aimAssist: v })));
  mobile.append(toggleRow('Auto-visée', 'autoAim', s.autoAim, v => apply({ autoAim: v })));
  mobile.append(toggleRow('Auto-attaque', 'autoAttack', s.autoAttack, v => apply({ autoAttack: v })));
  mobile.append(selectRow('Côté joystick', 'joystickSide', s.joystickSide, [['left', 'Gauche'], ['right', 'Droite']], v => apply({ joystickSide: v })));
  mobile.append(slider('Taille du HUD', 'hudScale', { hudScale: s.hudScale * 50 }, v => apply({ hudScale: v / 50 })));

  // ---- privacy & account ----
  const account = h('div', { class: 'panel' });
  account.append(h('div', { class: 'panel-title', html: `${icon('profile')} Confidentialité & compte` }));
  account.append(h('div', { class: 'setting-row' },
    h('div', {}, h('div', { class: 's-label', text: 'Profil public' }), h('div', { class: 's-sub', text: 'Visible par les autres joueurs' })),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: (state.profile?.privacy ?? 'public') === 'public', onChange: async (e) => {
      try { await api.post('/api/me/cosmetics', { privacy: e.target.checked ? 'public' : 'private' }); toast('Préférence enregistrée', 'success'); }
      catch (err) { toast(errText(err), 'error'); }
    } }), h('i'))));
  account.append(h('div', { class: 'setting-row' },
    h('div', {}, h('div', { class: 's-label', text: 'Langue' }), h('div', { class: 's-sub', text: 'Architecture i18n — français actif' })),
    h('select', { disabled: true }, h('option', {}, 'Français'), h('option', {}, 'English (bientôt)'))));
  account.append(h('div', { class: 'setting-row' },
    h('div', {}, h('div', { class: 's-label', text: 'Application installable' }), h('div', { class: 's-sub', text: 'PWA — installe RIFT ARENA sur mobile et PC depuis ton navigateur' })),
    h('span', { class: 'badge green', text: 'ACTIF' })));

  const grid = h('div', { class: 'grid cols-2' });
  grid.append(audio, video, controls, mobile, account);
  wrap.append(grid);
  el.append(wrap);
}

function slider(label, key, s, apply, onChange) {
  const val = h('span', { class: 'mono small dim', text: Math.round(s[key] * 100) + '%' });
  const input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key], style: { width: '160px' } });
  input.addEventListener('input', () => {
    apply({ [key]: +input.value });
    val.textContent = Math.round(+input.value * 100) + '%';
    onChange?.(+input.value);
  });
  return h('div', { class: 'setting-row' }, h('div', { class: 's-label', text: label }), h('div', { class: 'row' }, input, val));
}

function toggleRow(label, key, checked, onToggle) {
  return h('div', { class: 'setting-row' },
    h('div', { class: 's-label', text: label }),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onChange: (e) => onToggle(e.target.checked) }), h('i')));
}

function selectRow(label, key, value, options, onSelect) {
  const sel = h('select', { style: { width: '160px' } },
    options.map(([v, l]) => h('option', { value: v, ...(String(value) === String(v0(v)) ? { selected: true } : {}) }, l)));
  sel.addEventListener('change', () => onSelect(sel.value));
  return h('div', { class: 'setting-row' }, h('div', { class: 's-label', text: label }), sel);
}
function v0(v) { return typeof v === 'number' ? v : v; }

function keybindRow(label, action, kb, apply) {
  const btn = h('button', { class: 'btn small ghost', style: { minWidth: '90px' }, text: keyName(kb[action]) });
  btn.addEventListener('click', () => {
    btn.textContent = 'Appuie…';
    const handler = (e) => {
      e.preventDefault();
      window.removeEventListener('keydown', handler, true);
      kb[action] = e.code;
      apply({ keybinds: kb });
      btn.textContent = keyName(kb[action]);
    };
    window.addEventListener('keydown', handler, true);
  });
  return h('div', { class: 'setting-row' }, h('div', { class: 's-label', text: label }), btn);
}
function keyName(code) {
  if (!code) return '—';
  return code.replace('Key', '').replace('Arrow', '↑↓←→ ').replace('mouse0', 'Clic G').replace('mouse2', 'Clic D');
}
