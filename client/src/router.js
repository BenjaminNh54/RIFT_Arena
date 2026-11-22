// RIFT ARENA — internal SPA router (no reloads, no redirects — screens swap in place)
import { h } from './components/ui.js';

const screens = new Map();
let current = null;
let container = null;
let hooks = []; // called on every navigation (e.g. update nav highlight)

export function registerScreen(id, def) { screens.set(id, def); }

export function initRouter(el) { container = el; }

export function navigate(id, params = {}, opts = {}) {
  const def = screens.get(id);
  if (!def) { console.warn('[router] unknown screen', id); return; }
  if (current && !opts.force) {
    const prev = screens.get(current);
    prev?.leave?.();
  }
  current = id;
  container.innerHTML = '';
  const el = h('div', { class: 'screen' });
  container.append(el);
  try { def.render(el, params); }
  catch (e) {
    console.error('[router] render failed', id, e);
    el.append(h('div', { class: 'empty', text: 'Erreur d\'affichage de cet écran.' }));
  }
  requestAnimationFrame(() => el.classList.add('active'));
  def.after?.(el, params);
  for (const fn of hooks) fn(id);
}

export function currentScreen() { return current; }
export function onNavigate(fn) { hooks.push(fn); }
