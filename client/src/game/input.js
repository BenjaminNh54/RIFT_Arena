// RIFT ARENA — game input: PC (keyboard+mouse, configurable) & mobile (joystick + buttons, aim drag)
import { settings } from '../state.js';
import { sfx } from './audio.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';

export class GameInput {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.mobile = opts.mobile ?? false;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false, right: false };
    this.dx = 0; this.dy = 0;
    this.aim = 0;             // world angle
    this.aimDist = 0;         // distance de visée (tirs courbes)
    this.fire = false;
    this.wantSuper = false;   // one-shot flags (consumed by client)
    this.wantAbility = false;
    this.wantKick = false;
    this.aimTouch = null;     // {startX,startY} while dragging attack button
    this.aiming = false;
    this.seq = 0;
    this.onEscape = opts.onEscape ?? (() => {});
    this.onSuper = opts.onSuper ?? (() => {});
    this.aimAssist = opts.aimAssist ?? true;
    this.autoAim = opts.autoAim ?? false;
    this.autoAttack = opts.autoAttack ?? false;
    this._listenerCleanup = [];
    this.bind();
  }

  bind() {
    const cv = this.canvas;
    const kd = (e) => {
      if (e.code === 'Escape') { this.onEscape(); return; }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    const ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    const mm = (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
    };
    const md = (e) => {
      mm(e);
      if (e.button === 0) { this.mouse.down = true; e.preventDefault(); }
      if (e.button === 2) { this.wantAbility = true; e.preventDefault(); }
    };
    const mu = (e) => { if (e.button === 0) this.mouse.down = false; };
    const ctxm = (e) => e.preventDefault();
    cv.addEventListener('mousemove', mm);
    cv.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    cv.addEventListener('contextmenu', ctxm);
    this._listenerCleanup.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      cv.removeEventListener('mousemove', mm);
      cv.removeEventListener('mousedown', md);
      window.removeEventListener('mouseup', mu);
      cv.removeEventListener('contextmenu', ctxm);
    });
  }

  // per-frame update: computes dx/dy/aim/fire from devices
  update(local, camera, worldToScreen) {
    const s = settings();
    const kb = s.keybinds;
    if (!this.mobile && local) {
      // movement
      let dx = 0, dy = 0;
      if (this.keys.has(kb.up ?? 'KeyW') || this.keys.has('ArrowUp')) dy -= 1;
      if (this.keys.has(kb.down ?? 'KeyS') || this.keys.has('ArrowDown')) dy += 1;
      if (this.keys.has(kb.left ?? 'KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
      if (this.keys.has(kb.right ?? 'KeyD') || this.keys.has('ArrowRight')) dx += 1;
      this.dx = dx; this.dy = dy;
      if (this.keys.has(kb.super ?? 'Space')) { this.wantSuper = true; }
      if (this.keys.has(kb.interact ?? 'KeyE')) { this.wantKick = true; }
      // aim toward mouse world position (+ distance: les tirs courbes atterrissent sur la souris)
      const w = screenToWorld(camera, this.mouse.x, this.mouse.y);
      this.aim = Math.atan2(w.y - local.y, w.x - local.x);
      const range = FIGHTER_MAP[local.f]?.attack?.range ?? 560;
      this.aimDist = Math.max(0, Math.min(range, Math.hypot(w.x - local.x, w.y - local.y)));
      this.fire = this.mouse.down;
      if (this.autoAttack && local.ammo >= 1) {
        // fire only when an enemy is near the aim line (server validates anyway)
        this.fire = true;
      }
    }
  }

  consume() {
    const out = {
      seq: ++this.seq, dx: this.dx, dy: this.dy, aim: this.aim, aimDist: this.aimDist,
      fire: this.fire, wantSuper: this.wantSuper, wantAbility: this.wantAbility, wantKick: this.wantKick,
    };
    this.wantSuper = false; this.wantAbility = false; this.wantKick = false;
    return out;
  }

  destroy() {
    for (const fn of this._listenerCleanup) fn();
    this._listenerCleanup = [];
  }
}

// camera shared state
export const camera = { x: 0, y: 0, zoom: 1, w: 1280, h: 720 };
export function screenToWorld(cam, sx, sy) {
  return {
    x: (sx - cam.w / 2) / cam.zoom + cam.x,
    y: (sy - cam.h / 2) / cam.zoom + cam.y,
  };
}

// ---------- mobile joystick + buttons ----------
export function bindMobileControls(root, input, getLocal, cameraRef) {
  const s = settings();
  const joyWrap = document.createElement('div');
  joyWrap.className = 'joystick';
  joyWrap.style[s.joystickSide === 'right' ? 'right' : 'left'] = '18px';
  joyWrap.style[s.joystickSide === 'right' ? 'left' : 'right'] = 'auto';
  joyWrap.innerHTML = '<div class="joy-base"></div><div class="joy-knob"></div>';
  root.appendChild(joyWrap);
  const knob = joyWrap.querySelector('.joy-knob');
  let joyId = null, joyCx = 0, joyCy = 0;

  joyWrap.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId;
    joyWrap.setPointerCapture(joyId);
    const r = joyWrap.getBoundingClientRect();
    joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
    move(e);
  });
  joyWrap.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) move(e); });
  const up = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; input.dx = 0; input.dy = 0;
    knob.style.left = '37px'; knob.style.top = '37px';
  };
  joyWrap.addEventListener('pointerup', up);
  joyWrap.addEventListener('pointercancel', up);
  function move(e) {
    const r = joyWrap.getBoundingClientRect();
    const max = r.width / 2 - 14;
    let dx = e.clientX - joyCx, dy = e.clientY - joyCy;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    knob.style.left = `${37 + dx}px`; knob.style.top = `${37 + dy}px`;
    input.dx = dx / max; input.dy = dy / max;
  }

  // aim/fire button: drag to aim, release to shoot; tap = shoot forward (aim assist snaps to nearest enemy)
  const actions = document.createElement('div');
  actions.className = 'action-buttons';
  const aimBtn = document.createElement('div');
  aimBtn.className = 'aim-btn';
  aimBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>';
  const abBtn = document.createElement('div');
  abBtn.className = 'ability-btn';
  abBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h10v3a4 4 0 0 1-1 2.6V9h1a2 2 0 0 1 2 2v4h-2v4h2v3H5v-3h2v-4H5v-4a2 2 0 0 1 2-2h1V7.6A4 4 0 0 1 7 5V2z"/></svg>';
  const supBtn = document.createElement('div');
  supBtn.className = 'super-btn';
  supBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.6H21l-5.5 4 2.1 6.6L12 15.2 6.4 19.2l2.1-6.6L3 8.6h6.8L12 2z"/></svg>';
  actions.append(abBtn, supBtn, aimBtn);
  root.appendChild(actions);

  let aimId = null;
  aimBtn.addEventListener('pointerdown', (e) => {
    aimId = e.pointerId;
    aimBtn.setPointerCapture(aimId);
    input.aiming = true;
    aimBtn.classList.add('aiming');
    e.preventDefault();
  });
  aimBtn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimId) return;
    const local = getLocal();
    if (!local) return;
    // visée = angle + distance depuis le CENTRE RÉEL du bouton (avant codé en dur window-60 → faux)
    const r = aimBtn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    input.aim = Math.atan2(e.clientY - cy, e.clientX - cx);
    // longueur du drag → distance d'atterrissage (drag court = tir proche, façon BS)
    const range = local ? FIGHTER_MAP[local.f]?.attack?.range ?? 560 : 560;
    const dragLen = Math.hypot(e.clientX - cx, e.clientY - cy);
    input.aimDist = Math.max(100, Math.min(range, (dragLen / 55) * range));
    input._aimDrag = true;
  });
  const aimUp = (e) => {
    if (e.pointerId !== aimId) return;
    aimId = null;
    input.aiming = false;
    input.fire = true;                 // release = shoot
    aimBtn.classList.remove('aiming');
  };
  aimBtn.addEventListener('pointerup', aimUp);
  aimBtn.addEventListener('pointercancel', aimUp);
  aimBtn.addEventListener('pointerdown', (e) => { if (s.autoAttack) { input.fire = true; } });

  supBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); input.wantSuper = true; });
  abBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); input.wantAbility = true; });

  return {
    update(superReady, abilityUses) {
      supBtn.classList.toggle('ready', superReady);
      let uses = abilityUses.querySelector ? null : null;
    },
    setAbilityUses(n) {
      abBtn.querySelector('.uses')?.remove();
      if (n > 0) abBtn.insertAdjacentHTML('beforeend', `<span class="uses">${n}</span>`);
    },
    destroy() { joyWrap.remove(); actions.remove(); },
  };
}
