// RIFT ARENA — map editor (community maps): paint, fill, rect, spawns, undo/redo, save/publish/test
import { h, toast, modal, confirmBox, icon } from '../components/ui.js';
import { api, errText } from '../network/api.js';
import { TILE } from '/shared/constants.js';
import { validateMapData } from '/shared/validators/index.js';
import { drawMini } from '../screens/maps.js';

const TILE_COLORS = {
  0: '#141c3a', 1: '#3a4a8a', 2: '#7a5a2a', 3: '#1e7a4a', 4: '#1a4a8a', 5: '#8a2a2a', 6: '#7a3adf',
  spawn: '#35e0ff',
};
const TILE_LABELS = { 0: 'Sol', 1: 'Mur', 2: 'Caisse', 3: 'Buisson', 4: 'Eau', 5: 'Zone risquée', 6: 'Portail' };

const DEFAULT_W = 24, DEFAULT_H = 16;
const VIEW = 26; // px per tile on screen

export function renderEditor(el) {
  document.title = 'RIFT ARENA — Éditeur';
  const state = {
    w: DEFAULT_W, h: DEFAULT_H,
    grid: Array.from({ length: DEFAULT_H }, () => Array(DEFAULT_W).fill(0)),
    spawns: [[2, 2], [DEFAULT_W - 3, DEFAULT_H - 3]],
    tool: 'brush', tile: 1, spawnTeam: 0,
    undoStack: [], redoStack: [],
    name: 'Ma map', desc: '', theme: 'neon', modes: ['elimination'],
    painting: false, rectStart: null, panStart: null, offsetX: 0, offsetY: 0, zoom: 1,
    clipboard: null,
  };

  const wrap = h('div', { class: 'editor-wrap' });
  const bar = h('div', { class: 'editor-bar' });
  const canvasWrap = h('div', { class: 'editor-canvas-wrap' });
  const canvas = h('canvas');
  canvasWrap.append(canvas);
  const palette = h('div', { class: 'editor-palette' });
  wrap.append(bar, canvasWrap, palette);
  el.append(wrap);

  // ---- top bar tools ----
  const tools = [
    ['brush', 'brush'], ['eraser', 'eraser'], ['fill', 'fill'], ['rect', 'rect'], ['spawn', 'spawn'], ['pan', 'move'],
  ];
  const toolBtns = {};
  for (const [id, ic] of tools) {
    const b = h('button', { class: 'tool-btn', html: icon(ic), title: id, onClick: () => setTool(id) });
    toolBtns[id] = b;
    bar.append(b);
  }
  function setTool(id) {
    state.tool = id;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('active', k === id);
  }
  setTool('brush');

  bar.append(h('span', { class: 'spacer' }));
  const undoBtn = h('button', { class: 'tool-btn', html: icon('undo'), title: 'Undo', onClick: undo });
  const redoBtn = h('button', { class: 'tool-btn', html: icon('redo'), title: 'Redo', onClick: redo });
  bar.append(undoBtn, redoBtn);
  bar.append(h('button', { class: 'tool-btn', html: icon('close'), title: 'Tout effacer', onClick: () => {
    confirmBox('Tout effacer', 'Réinitialiser toute la grille ?', () => { pushUndo(); state.grid = Array.from({ length: state.h }, () => Array(state.w).fill(0)); draw(); });
  } }));
  bar.append(h('button', { class: 'btn small primary', html: `${icon('save')} Sauver`, onClick: () => save('save') }));
  bar.append(h('button', { class: 'btn small violet', html: `${icon('send')} Publier`, onClick: () => save('publish') }));
  bar.append(h('button', { class: 'btn small ghost', html: `${icon('test')} Tester`, onClick: testMap }));

  // ---- palette ----
  const swatches = [];
  for (const [t, label] of Object.entries(TILE_LABELS)) {
    const sw = h('button', { class: 'tile-swatch', style: { background: TILE_COLORS[t] }, title: label, onClick: () => { state.tile = +t; state.tool = +t === 0 ? 'eraser' : 'brush'; setTool(state.tool); markSwatch(); } });
    sw.append(h('span', { text: label }));
    swatches.push(sw);
    palette.append(sw);
  }
  const spawnSw = h('button', { class: 'tile-swatch', style: { background: TILE_COLORS.spawn }, title: 'Spawns', onClick: () => { setTool('spawn'); markSwatch(); } },
    h('span', { text: 'Spawn' }));
  palette.append(spawnSw);
  swatches.push(spawnSw);
  function markSwatch() {
    swatches.forEach((s, i) => s.classList.toggle('active', (i === +state.tile && state.tool === 'brush') || (state.tool === 'spawn' && s === spawnSw) || (state.tool === 'eraser' && i === 0)));
  }

  // meta row (name/theme/modes) in a collapsible panel
  const metaBar = h('div', { class: 'row', style: { padding: '6px 10px', gap: '8px', background: 'rgba(10,15,30,0.95)', borderTop: '1px solid var(--line)', flexWrap: 'wrap', flex: 'none' } });
  const nameIn = h('input', { value: state.name, maxlength: 32, style: { width: '160px' } });
  nameIn.addEventListener('input', () => { state.name = nameIn.value; });
  const themeSel = h('select', {}, ['neon', 'dust', 'moss', 'core', 'frost', 'ember', 'sky', 'factory'].map(t => h('option', { value: t }, t)));
  themeSel.addEventListener('change', () => { state.theme = themeSel.value; draw(); });
  const modeSel = h('select', { multiple: true, style: { height: '34px' } }, ['crystal_rush', 'strikeball', 'domination', 'elimination', 'last_core', 'boss_raid'].map(m => h('option', { value: m }, m)));
  modeSel.addEventListener('change', () => { state.modes = [...modeSel.selectedOptions].map(o => o.value); });
  const wIn = h('input', { type: 'number', min: 8, max: 64, value: state.w, style: { width: '60px' } });
  const hIn = h('input', { type: 'number', min: 8, max: 48, value: state.h, style: { width: '60px' } });
  wIn.addEventListener('change', () => resize(+wIn.value, state.h));
  hIn.addEventListener('change', () => resize(state.w, +hIn.value));
  metaBar.append(h('span', { class: 'faint small', text: 'Nom' }), nameIn, h('span', { class: 'faint small', text: 'Thème' }), themeSel,
    h('span', { class: 'faint small', text: 'Modes' }), modeSel, h('span', { class: 'faint small', text: 'L x H' }), wIn, hIn);
  wrap.append(metaBar);

  function resize(w, hh) {
    pushUndo();
    state.w = Math.max(8, Math.min(64, w));
    state.h = Math.max(8, Math.min(48, hh));
    state.grid = state.grid.slice(0, state.h).map(row => row.slice(0, state.w));
    while (state.grid.length < state.h) state.grid.push(Array(state.w).fill(0));
    for (const row of state.grid) while (row.length < state.w) row.push(0);
    state.spawns = state.spawns.filter(([x, y]) => x < state.w && y < state.h);
    wIn.value = state.w; hIn.value = state.h;
    draw();
  }

  // ---- undo / redo ----
  function pushUndo() {
    state.undoStack.push(JSON.stringify({ grid: state.grid, spawns: state.spawns }));
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack.length = 0;
  }
  function undo() {
    const s = state.undoStack.pop();
    if (!s) return;
    state.redoStack.push(JSON.stringify({ grid: state.grid, spawns: state.spawns }));
    restore(s);
  }
  function redo() {
    const s = state.redoStack.pop();
    if (!s) return;
    state.undoStack.push(JSON.stringify({ grid: state.grid, spawns: state.spawns }));
    restore(s);
  }
  function restore(s) {
    const o = JSON.parse(s);
    state.grid = o.grid; state.spawns = o.spawns;
    state.w = o.grid[0].length; state.h = o.grid.length;
    draw();
  }

  // ---- canvas interactions ----
  let dpr = Math.min(2, window.devicePixelRatio ?? 1);
  function tileFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left + state.offsetX) / (VIEW * state.zoom));
    const y = Math.floor((e.clientY - r.top + state.offsetY) / (VIEW * state.zoom));
    if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
    return [x, y];
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const t = tileFromEvent(e);
    if (state.tool === 'pan') {
      state.panStart = { x: e.clientX, y: e.clientY, ox: state.offsetX, oy: state.offsetY };
      return;
    }
    if (state.tool === 'spawn') {
      if (t) {
        const same = state.spawns.findIndex(([sx, sy]) => sx === t[0] && sy === t[1]);
        if (same >= 0) state.spawns.splice(same, 1);
        else state.spawns.push([t[0], t[1]]);
        draw();
      }
      return;
    }
    if (state.tool === 'fill' && t) {
      pushUndo();
      floodFill(t[0], t[1], state.tile === 0 ? 0 : state.tile);
      draw();
      return;
    }
    if (state.tool === 'rect' && t) {
      state.rectStart = t;
      return;
    }
    if (t) { pushUndo(); state.painting = true; paint(t[0], t[1]); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state.tool === 'pan' && state.panStart) {
      state.offsetX = Math.max(0, state.panStart.ox - (e.clientX - state.panStart.x));
      state.offsetY = Math.max(0, state.panStart.oy - (e.clientY - state.panStart.y));
      draw();
      return;
    }
    if (state.tool === 'rect' && state.rectStart) {
      state.rectCur = tileFromEvent(e);
      draw();
      return;
    }
    if (state.painting) {
      const t = tileFromEvent(e);
      if (t) paint(t[0], t[1]);
    }
  });
  window.addEventListener('pointerup', () => {
    if (state.tool === 'rect' && state.rectStart) {
      const [x0, y0] = state.rectStart;
      const [x1, y1] = state.rectCur ?? state.rectStart;
      pushUndo();
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          if (state.grid[y] && state.grid[y][x] !== undefined) state.grid[y][x] = state.tile;
        }
      }
      state.rectStart = null; state.rectCur = null;
      draw();
    }
    state.painting = false;
    state.panStart = null;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = Math.max(0.4, Math.min(2, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    draw();
  }, { passive: false });

  function paint(x, y) {
    const v = state.tool === 'eraser' ? 0 : state.tile;
    if (state.grid[y][x] !== v) { state.grid[y][x] = v; draw(); }
  }
  function floodFill(x, y, v) {
    const target = state.grid[y][x];
    if (target === v) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= state.w || cy >= state.h) continue;
      if (state.grid[cy][cx] !== target) continue;
      state.grid[cy][cx] = v;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  // ---- draw ----
  function draw() {
    const ts = VIEW * state.zoom;
    canvas.width = state.w * ts * dpr; canvas.height = state.h * ts * dpr;
    canvas.style.width = `${state.w * ts}px`; canvas.style.height = `${state.h * ts}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, state.w * ts, state.h * ts);
    ctx.save();
    ctx.translate(-state.offsetX, -state.offsetY);
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        ctx.fillStyle = TILE_COLORS[state.grid[y][x]];
        ctx.fillRect(x * ts, y * ts, ts - 1, ts - 1);
      }
    }
    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x <= state.w; x++) { ctx.beginPath(); ctx.moveTo(x * ts, 0); ctx.lineTo(x * ts, state.h * ts); ctx.stroke(); }
    for (let y = 0; y <= state.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * ts); ctx.lineTo(state.w * ts, y * ts); ctx.stroke(); }
    // spawns
    ctx.fillStyle = TILE_COLORS.spawn;
    for (const [sx, sy] of state.spawns) {
      ctx.beginPath(); ctx.arc(sx * ts + ts / 2, sy * ts + ts / 2, ts / 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#04202a'; ctx.font = `900 ${ts * 0.4}px system-ui`;
      ctx.fillText('S', sx * ts + ts / 2 - ts * 0.12, sy * ts + ts * 0.65);
      ctx.fillStyle = TILE_COLORS.spawn;
    }
    // rect preview
    if (state.rectStart && state.rectCur) {
      const [x0, y0] = state.rectStart, [x1, y1] = state.rectCur;
      ctx.strokeStyle = '#35e0ff'; ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(x0, x1) * ts, Math.min(y0, y1) * ts, (Math.abs(x1 - x0) + 1) * ts, (Math.abs(y1 - y0) + 1) * ts);
    }
    ctx.restore();
  }
  draw();

  // ---- save / publish ----
  async function save(action) {
    const errors = validateMapData({ name: state.name, grid: state.grid, spawns: state.spawns });
    if (errors.length) {
      toast('Map invalide : ' + errors[0], 'error');
      return;
    }
    try {
      const out = await api.post('/api/maps', {
        action,
        map: {
          id: state.mapId, name: state.name, desc: state.desc, theme: state.theme,
          grid: state.grid, spawns: state.spawns, modes: state.modes,
        },
      });
      state.mapId = out.map.id;
      toast(action === 'publish' ? 'Map publiée — en attente de validation par un admin' : 'Brouillon sauvegardé', 'success');
    } catch (e) {
      if (e.code === 'INVALID_MAP') toast('Map invalide', 'error');
      else toast(errText(e), 'error');
    }
  }

  function testMap() {
    const errors = validateMapData({ name: state.name, grid: state.grid, spawns: state.spawns });
    const bodyEl = h('div', {},
      h('canvas', { style: { width: '100%', imageRendering: 'pixelated', border: '1px solid var(--line)' } }),
      h('div', { style: { marginTop: '10px' } },
        errors.length
          ? h('div', { class: 'badge red', text: `${errors.length} problème(s)` })
          : h('div', { class: 'badge green', text: 'Map valide — tu peux la publier' }),
        errors.map(e2 => h('div', { class: 'dim small', style: { marginTop: '4px' }, text: '· ' + e2 })),
      ));
    drawMini(bodyEl.querySelector('canvas'), state.grid, state.theme, 12);
    modal({ title: `Test — ${state.name}`, body: bodyEl, actions: [{ label: 'Fermer', kind: 'primary' }] });
  }
}
