// RIFT ARENA — tiny DOM helpers + shared UI components
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svgIcon(name, cls = 'icon') {
  const span = h('span', { class: `iconbox ${cls}`, style: { display: 'inline-flex' } });
  span.innerHTML = icon(name);
  const svg = span.firstElementChild;
  if (svg) { svg.style.width = '1em'; svg.style.height = '1em'; }
  return span;
}

// ---------- modal ----------
export function modal({ title, body, actions = [], onClose = null, wide = false }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => { backdrop.remove(); onClose?.(); };
  const box = h('div', { class: 'modal', style: wide ? { width: 'min(860px, 100%)' } : {} });
  const head = h('div', { class: 'modal-head' }, title ?? '', h('span', { class: 'spacer' }),
    h('button', { class: 'iconbtn', html: icon('close'), onClick: close }));
  const bodyEl = h('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(h('button', { class: `btn ${a.kind ?? ''}`, onClick: () => { if (a.onClick) a.onClick(close); else close(); } }, a.label));
  }
  box.append(head, bodyEl, foot);
  backdrop.append(box);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.getElementById('overlays').append(backdrop);
  return { close, box, bodyEl };
}

// ---------- toasts ----------
export function toast(text, kind = '') {
  const root = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, text);
  root.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3400);
}

// ---------- tabs ----------
export function tabs(defs, onChange) {
  const bar = h('div', { class: 'tabs' });
  let current = null;
  const btns = [];
  for (const d of defs) {
    const b = h('button', { class: 'tab', text: d.label, onClick: () => select(d.id) });
    b._id = d.id;
    btns.push(b);
    bar.append(b);
  }
  function select(id) {
    current = id;
    for (const b of btns) b.classList.toggle('active', b._id === id);
    onChange?.(id);
  }
  select(defs[0]?.id);
  return { el: bar, select, get current() { return current; } };
}

// ---------- currency pills ----------
export function pill(kind, value) {
  const icons = { credits: 'coin', rift_tokens: 'token', trophies: 'trophy', pass_xp: 'star', xp: 'star' };
  const labels = { credits: '', rift_tokens: '', trophies: '', pass_xp: 'XP ', xp: 'XP ' };
  return h('span', {
    class: `pill ${kind === 'rift_tokens' ? 'tokens' : kind === 'credits' ? 'credits' : ''}`,
    html: `${icon(icons[kind] ?? 'coin')}<b class="mono">${labels[kind] ?? ''}${fmt(value)}</b>`,
  });
}

export function fmt(n) {
  if (n === undefined || n === null || Number.isNaN(+n)) return '0';
  return (+n).toLocaleString('fr-FR');
}

export function timeLeft(iso) {
  const t = new Date(iso).getTime() - Date.now();
  if (t <= 0) return 'terminé';
  const d = Math.floor(t / 86400e3), hh = Math.floor((t % 86400e3) / 3600e3), mm = Math.floor((t % 3600e3) / 60e3);
  if (d > 0) return `${d}j ${hh}h`;
  if (hh > 0) return `${hh}h ${mm}min`;
  return `${Math.max(1, mm)}min`;
}

// ---------- fighter portrait (procedural canvas — shared by cards + game) ----------
// Draw a stylized original fighter bust from its shape archetype + palette.
export function drawFighter(canvas, fighter, { size = 200, scale = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0, 0, size, size);
  const c = { body: fighter.body, accent: fighter.accent, dark: fighter.dark };
  const s = size / 200 * scale;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';

  // glow base
  const grad = ctx.createRadialGradient(0, 20, 10, 0, 20, 90);
  grad.addColorStop(0, hexA(fighter.body, 0.35));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-100, -100, 200, 200);

  const shape = fighter.shape ?? 'bolt';
  // legs
  ctx.fillStyle = c.dark;
  ctx.fillRect(-16, 42, 13, 34);
  ctx.fillRect(4, 42, 13, 34);
  // torso
  ctx.fillStyle = c.body;
  roundedTri(ctx, -26, -12, 52, 60, 10);
  // chest accent
  ctx.fillStyle = c.accent;
  roundedTri(ctx, -12, 2, 24, 22, 6);

  // head variants
  ctx.fillStyle = c.body;
  if (shape === 'bolt') {
    tri(ctx, 0, -66, 26, 34, 0); // angular helmet
    ctx.fillStyle = c.accent;
    ctx.fillRect(-8, -52, 16, 6);
    // antenna
    ctx.strokeStyle = c.accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -66); ctx.lineTo(10, -84); ctx.stroke();
    ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(10, -84, 4, 0, 7); ctx.fill();
  } else if (shape === 'ranger') {
    ctx.beginPath(); ctx.arc(0, -48, 22, 0, 7); ctx.fill();
    // scope visor
    ctx.fillStyle = c.accent;
    ctx.fillRect(-22, -56, 44, 9);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(2, -54, 14, 5);
    // hood spike
    ctx.fillStyle = c.dark;
    tri(ctx, 0, -84, 16, 22, 0);
  } else if (shape === 'brute') {
    ctx.beginPath(); ctx.arc(0, -44, 26, 0, 7); ctx.fill();
    ctx.fillStyle = c.dark;
    ctx.fillRect(-26, -52, 52, 10);
    // jaw plate
    ctx.fillStyle = c.accent;
    ctx.fillRect(-14, -34, 28, 8);
    // shoulder pads
    ctx.fillStyle = c.dark;
    tri(ctx, -34, -6, 22, 20, 0); tri(ctx, 34, -6, 22, 20, 0, true);
  } else if (shape === 'spirit') {
    // hooded spirit
    tri(ctx, 0, -78, 40, 46, 0);
    ctx.fillStyle = '#0b1020';
    ctx.beginPath(); ctx.ellipse(0, -44, 12, 9, 0, 0, 7); ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath(); ctx.arc(-4, -44, 2.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -44, 2.4, 0, 7); ctx.fill();
  } else if (shape === 'shade') {
    ctx.beginPath(); ctx.arc(0, -46, 20, 0, 7); ctx.fill();
    // mask band + blades behind
    ctx.fillStyle = c.accent; ctx.fillRect(-20, -52, 40, 6);
    ctx.fillStyle = c.dark;
    ctx.save(); ctx.translate(-30, -20); ctx.rotate(-0.6); ctx.fillRect(-3, -18, 6, 30); ctx.restore();
    ctx.save(); ctx.translate(30, -20); ctx.rotate(0.6); ctx.fillRect(-3, -18, 6, 30); ctx.restore();
  } else { // tech
    ctx.fillRect(-20, -64, 40, 30);
    ctx.fillStyle = c.accent;
    ctx.fillRect(-20, -56, 40, 4);
    ctx.fillRect(-8, -64, 4, 30);
    // goggles
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(-16, -50, 12, 8); ctx.fillRect(4, -50, 12, 8);
    ctx.fillStyle = c.accent;
    ctx.fillRect(-14, -48, 7, 4); ctx.fillRect(6, -48, 7, 4);
  }

  // weapon hint
  ctx.strokeStyle = c.accent; ctx.lineWidth = 5;
  ctx.beginPath();
  if (shape === 'ranger') { ctx.moveTo(24, 6); ctx.lineTo(46, -34); }
  else if (shape === 'brute') { ctx.moveTo(30, 10); ctx.lineTo(44, 26); }
  else { ctx.moveTo(26, 8); ctx.lineTo(40, -2); }
  ctx.stroke();

  ctx.restore();
}

function roundedTri(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + hh - r);
  ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
  ctx.lineTo(x + r, y + hh);
  ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
function tri(ctx, cx, top, w, hh, rot, flip = false) {
  ctx.save();
  ctx.translate(cx, top);
  if (flip) ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w / 2, hh);
  ctx.lineTo(-w / 2, hh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- confirm dialog ----------
export function confirmBox(title, text, onYes, { danger = true, yesLabel = 'Confirmer' } = {}) {
  const m = modal({
    title,
    body: h('p', { style: { color: 'var(--text-dim)', fontSize: '14px', lineHeight: 1.5 } }, text),
    actions: [
      { label: 'Annuler', kind: 'ghost' },
      { label: yesLabel, kind: danger ? 'danger' : 'primary', onClick: (close) => { close(); onYes?.(); } },
    ],
  });
  return m;
}
