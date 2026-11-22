// RIFT ARENA — game client: ws snapshots, interpolation, local prediction, HUD, results
import {h, toast, fmt} from '../components/ui.js';
import { icon } from '../components/icons.js';
import { api, onWs, wsSend } from '../network/api.js';
import { state, settings } from '../state.js';
import { navigate } from '../router.js';
import { MAP_MAP } from '/shared/definitions/maps.js';
import { MODE_MAP } from '/shared/definitions/modes.js';
import { FIGHTER_MAP } from '/shared/definitions/fighters.js';
import { Renderer } from './renderer.js';
import { GameInput, bindMobileControls, camera, screenToWorld } from './input.js';
import { TILE_PROPS } from '/shared/constants.js';
import { sfx, playMusic, stopMusic } from './audio.js';
import { moveCircleClient } from './predict.js';

const INTERP_MS = 100;

export async function launchMatchClient(match) {
  destroy(); // never two matches at once
  // full-screen game root replaces the shell visually but stays in the SPA
  const root = h('div', { class: 'game-root' });
  document.body.classList.add('in-game');
  document.getElementById('overlays').append(root);

  const loading = h('div', { class: 'match-loading' },
    h('div', { class: 'boot-logo', html: 'RIFT <span class="accent">ARENA</span>' }),
    h('div', { class: 'ml-mode', text: MODE_MAP[match.mode]?.name ?? match.mode }),
    h('div', { class: 'ml-map', id: 'ml-map', text: 'Chargement de la map…' }),
    h('div', { class: 'bar' }, h('i', { style: { width: '30%' } })));
  root.append(loading);
  playMusic('match');

  // resolve map (official shared def or community map via API)
  let map = MAP_MAP[match.map];
  if (!map) {
    try {
      const { decodeGrid } = await import('/shared/validators/index.js');
      const { map: cm } = await api.get(`/api/maps/${match.map}`);
      map = {
        id: cm.id, name: cm.name, theme: cm.theme ?? 'neon', width: cm.width, height: cm.height,
        grid: decodeGrid(cm.grid ?? '', cm.width) ?? [], portalPairs: [],
        spawns: { A: cm.spawns?.slice(0, 3) ?? [[2, 2]], B: cm.spawns?.slice(3, 6) ?? [[cm.width - 3, cm.height - 3]], FFA: cm.spawns ?? [[2, 2]] },
        objectives: cm.objectives ?? {},
      };
    } catch {
      loading.querySelector('#ml-map').textContent = 'Map indisponible — retour au lobby';
      setTimeout(() => destroy(), 1500);
      return;
    }
  }
  loading.querySelector('#ml-map').textContent = map.name.toUpperCase();

  const canvas = h('canvas', { class: 'game-canvas' });
  const hud = buildHud();
  root.append(canvas, hud.el);
  attachHudUpdate(hud, root);
  const renderer = new Renderer(canvas, map, { quality: qualityLevel() });
  const isMobile = match.mobile ?? checkMobile();
  const input = new GameInput(canvas, { mobile: isMobile, onEscape: () => togglePause() });
  const controls = isMobile ? bindMobileControls(root, input, () => client?.getLocal(), () => camera) : null;

  const client = new GameClient({ root, canvas, renderer, hud, input, controls, match, map });
  client.bindWs();
  current = client;
}

function checkMobile() {
  const s = settings();
  if (s.forceLayout === 'mobile') return true;
  if (s.forceLayout === 'desktop') return false;
  return window.matchMedia('(max-width: 860px)').matches || ('ontouchstart' in window && window.innerWidth < 1100);
}
function qualityLevel() {
  const s = settings();
  if (s.graphics !== 'auto') return s.graphics;
  // auto: mobile → medium, small screens → low
  if (checkMobile()) return 'medium';
  return 'high';
}

class GameClient {
  constructor({ root, canvas, renderer, hud, input, controls, match, map }) {
    this.root = root; this.canvas = canvas; this.renderer = renderer; this.hud = hud;
    this.input = input; this.controls = controls; this.match = match; this.map = map;
    this.userId = state.profile?.id;
    this.snapshots = [];        // {at, snap}
    this.localPredict = null;   // {x, y}
    this.fxQueue = [];
    this.ended = false;
    this.paused = false;
    this.lastSend = 0;
    this.scoreboard = false;
    this.myTeam = match.team;
    this.results = null;
    this.shakeT = 0;
    this.emoteWheel = null;
    this.running = true;
    this._unsubs = [];

    // hud event tag
    if (match.event) {
      hud.eventTag.textContent = `EVENT — ${match.event.name}`;
    }

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  getLocal() { return this.interpState()?.ents.find(e => e.id === `p_${this.userId}`) ?? null; }

  bindWs() {
    const offSnap = onWs('snap', (snap) => {
      this.snapshots.push({ at: performance.now(), snap });
      if (this.snapshots.length > 30) this.snapshots.shift();
      this.hud.hudDebug.textContent = `snap ${snap.tick} · ping ${Math.round(performance.now() - (snap._recv ?? performance.now()))}ms`;
    });
    const offFx = onWs('fx', (m) => {
      for (const fx of m.list ?? []) {
        this.renderer.addEffect(fx);
        this.handleFxSound(fx);
        if (fx.k === 'shake') this.shakeT = performance.now() + 220;
      }
    });
    const offEnd = onWs('end', (m) => this.showResults(m.results));
    const offJoined = onWs('joined', () => { /* reconnection ack */ });
    const offAnnounce = onWs('announcement', (m) => toast(`[Annonce] ${m.text}`));
    this._unsubs.push(offSnap, offFx, offEnd, offJoined, offAnnounce);
  }

  handleFxSound(fx) {
    const mine = fx.id === `p_${this.userId}` || fx.owner === `p_${this.userId}`;
    switch (fx.k) {
      case 'shot': if (mine) sfx.shoot(); break;
      case 'slash': if (mine) sfx.shootHeavy(); break;
      case 'hit': if (this.isNear(fx, 400)) sfx.hit(); break;
      case 'boom': case 'wave': if (this.isNear(fx, 700)) sfx.boom(); break;
      case 'death': if (fx.id === `p_${this.userId}`) sfx.death(); else if (this.isNear(fx, 500)) sfx.death(); break;
      case 'respawn': if (fx.id === `p_${this.userId}`) sfx.respawn(); break;
      case 'super': case 'zone': case 'wave': case 'reveal': if (mine) sfx.super(); break;
      case 'pickup': if (fx.id === `p_${this.userId}`) sfx.pickup(); break;
      case 'goal': sfx.goal(); break;
      default: break;
    }
  }
  isNear(fx, dist) {
    const local = this.getLocal();
    if (!local) return false;
    return Math.hypot(fx.x - local.x, fx.y - local.y) < dist;
  }

  // interpolate world state at (now - INTERP_MS)
  interpState() {
    const now = performance.now() - INTERP_MS;
    if (this.snapshots.length === 0) return null;
    let a = this.snapshots[0], b = this.snapshots[this.snapshots.length - 1];
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].at <= now && this.snapshots[i + 1].at >= now) {
        a = this.snapshots[i]; b = this.snapshots[i + 1];
        break;
      }
    }
    const t = b.at > a.at ? Math.min(1, (now - a.at) / (b.at - a.at)) : 1;
    // build interpolated view: interpolate entities that exist in both, else take latest
    const ents = [];
    const bEnts = new Map((b.snap.ents ?? []).map(e => [e.id, e]));
    const aEnts = new Map((a.snap.ents ?? []).map(e => [e.id, e]));
    for (const [id, eb] of bEnts) {
      const ea = aEnts.get(id);
      if (ea && (eb.kind === 'player' || eb.kind === 'bot')) {
        // local player: use prediction if available
        if (id === `p_${this.userId}` && this.localPredict) {
          ents.push({ ...eb, x: this.localPredict.x, y: this.localPredict.y });
          continue;
        }
        // teleport detection
        const jump = Math.hypot(eb.x - ea.x, eb.y - ea.y) > 90;
        ents.push(jump ? eb : { ...eb, x: ea.x + (eb.x - ea.x) * t, y: ea.y + (eb.y - ea.y) * t });
      } else {
        ents.push(eb);
      }
    }
    // projectiles interpolate
    const projs = [];
    const bP = new Map((b.snap.projs ?? []).map(p => [p.id, p]));
    const aP = new Map((a.snap.projs ?? []).map(p => [p.id, p]));
    for (const [id, pb] of bP) {
      const pa = aP.get(id);
      projs.push(pa ? { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t } : pb);
    }
    return {
      ents, projs,
      picks: b.snap.picks, zones: b.snap.zones, ball: b.snap.ball, safe: b.snap.safe,
      hud: b.snap.hud, tl: b.snap.tl, sA: b.snap.sA, sB: b.snap.sB, st: b.snap.st, cd: b.snap.cd,
      tick: b.snap.tick,
    };
  }

  predict(dtMs) {
    const local = this.getLocal();
    if (!local || local.d) { this.localPredict = null; return; }
    if (!this.localPredict) this.localPredict = { x: local.x, y: local.y };
    const speed = (FIGHTER_MAP[local.f]?.speed ?? 250) * (settings().graphics === 'low' ? 1 : 1);
    const dx = this.input.dx, dy = this.input.dy;
    const len = Math.hypot(dx, dy) || 1;
    const step = { x: (dx / len) * speed * dtMs / 1000, y: (dy / len) * speed * dtMs / 1000 };
    if (dx || dy) moveCircleClient(this.map, this.localPredict, step.x, step.y, 22);
    // soft reconciliation toward server position
    const err = Math.hypot(local.x - this.localPredict.x, local.y - this.localPredict.y);
    if (err > 60) { this.localPredict.x = local.x; this.localPredict.y = local.y; }
    else if (err > 2) {
      this.localPredict.x += (local.x - this.localPredict.x) * 0.12;
      this.localPredict.y += (local.y - this.localPredict.y) * 0.12;
    }
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const s = settings();

    // fps cap
    if (this.lastFrame && (now - this.lastFrame) < 1000 / (s.fpsCap ?? 60) - 1) return;
    const dt = Math.min(50, now - (this.lastFrame ?? now));
    this.lastFrame = now;

    // resize
    const dpr = Math.min(2, window.devicePixelRatio ?? 1);
    const w = this.canvas.clientWidth * dpr, hh = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== hh) {
      this.canvas.width = w; this.canvas.height = hh;
    }

    const st = this.interpState();
    if (!st) return;

    this.predict(dt);

    // camera follows local player
    const local = this.getLocal();
    if (local) {
      const targetX = this.localPredict?.x ?? local.x;
      const targetY = this.localPredict?.y ?? local.y;
      camera.x += (targetX - camera.x) * Math.min(1, dt / 120);
      camera.y += (targetY - camera.y) * Math.min(1, dt / 120);
    } else if (st.ents.length) {
      camera.x += ((st.ents[0].x ?? 0) - camera.x) * Math.min(1, dt / 300);
      camera.y += ((st.ents[0].y ?? 0) - camera.y) * Math.min(1, dt / 300);
    }
    camera.w = this.canvas.clientWidth; camera.h = this.canvas.clientHeight;
    camera.zoom = Math.max(0.55, Math.min(1.15, Math.min(camera.w / 1180, camera.h / 760)));
    // screen shake
    if (this.shakeT > now && s.shake) {
      camera.x += (Math.random() - 0.5) * 10;
      camera.y += (Math.random() - 0.5) * 10;
    }

    // input → aim assist (mobile)
    this.updateMobileAim(st, local);
    // input update (PC)
    if (!this.input.mobile) this.input.update(local, camera, screenToWorld);
    // send input at 20Hz
    if (now - this.lastSend > 50 && !this.ended) {
      this.lastSend = now;
      const msg = this.input.consume();
      wsSend({ t: 'in', ...msg });
      // auto-attack: fire when enemy within range & autoAttack enabled
      if (s.autoAttack && local && !local.d) {
        const enemy = st.ents.find(e => (e.kind === 'player' || e.kind === 'bot') && e.team !== local.team && !e.d &&
          Math.hypot(e.x - local.x, e.y - local.y) < (FIGHTER_MAP[local.f]?.attack?.range ?? 400));
        if (enemy) { msg.fire = true; this.input.aim = Math.atan2(enemy.y - local.y, enemy.x - local.x); wsSend({ t: 'in', ...msg }); }
      }
    }

    // render
    this.renderer.draw(camera, st, now, `p_${this.userId}`);
    this.hud.update(st, local, this.map, s);

    // aim assist visual on mobile handled in input
  }

  updateMobileAim(st, local) {
    const s = settings();
    if (!this.input.mobile || !local) return;
    // auto aim: nearest living enemy
    if (s.autoAim || s.aimAssist) {
      let best = null, bd = 1e9;
      for (const e of st.ents) {
        if ((e.kind !== 'player' && e.kind !== 'bot') || e.team === local.team || e.d) continue;
        const d = Math.hypot(e.x - local.x, e.y - local.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best && bd < (FIGHTER_MAP[local.f]?.attack?.range ?? 400)) {
        this.input.aim = Math.atan2(best.y - local.y, best.x - local.x);
      }
    }
    if (s.autoAttack && !this.input.aiming) {
      const enemy = st.ents.find(e => (e.kind === 'player' || e.kind === 'bot') && e.team !== local.team && !e.d &&
        Math.hypot(e.x - local.x, e.y - local.y) < (FIGHTER_MAP[local.f]?.attack?.range ?? 400));
      this.input.fire = !!enemy;
    }
  }

  showResults(results) {
    if (this.ended) return;
    this.ended = true;
    this.results = results;
    sfx[results.winner === this.myTeam ? 'win' : results.winner === 'draw' ? 'uiBig' : 'lose']?.();
    const me = results.players.find(p => p.userId === this.userId);
    const won = results.winner === this.myTeam;
    const draw = results.winner === 'draw';
    const rewards = me?.rewards ?? {};

    const overlay = h('div', { class: 'results-wrap' },
      h('div', { class: 'results-banner' },
        h('div', { class: `victory ${won ? '' : draw ? 'draw' : 'defeat'}`,
          text: draw ? 'ÉGALITÉ' : won ? 'VICTOIRE' : 'DÉFAITE' }),
        h('div', { class: 'dim', style: { marginTop: '6px' } },
          `${MODE_MAP[results.mode]?.name ?? results.mode} — ${this.map.name}`)),
      h('div', { class: 'reward-line' },
        rewards.trophies !== undefined ? rewardChip('trophy', `${rewards.trophies >= 0 ? '+' : ''}${rewards.trophies} TR`, 'var(--cyan)') : null,
        rewards.xp ? rewardChip('star', `+${rewards.xp} XP`, 'var(--violet)') : null,
        rewards.credits ? rewardChip('coin', `+${rewards.credits}`, 'var(--gold)') : null,
        rewards.passXp ? rewardChip('pass', `+${rewards.passXp} XP Pass`, 'var(--gold)') : null,
        rewards.rp ? rewardChip('ranked', `${rewards.rp >= 0 ? '+' : ''}${rewards.rp} RP`, 'var(--violet)') : null,
        me?.starPlayer ? rewardChip('crown', 'MVP', 'var(--gold)') : null,
        ...(rewards.unlocked ?? []).map(fid => rewardChip('fighters', `${fid.toUpperCase()} débloqué !`, 'var(--green)')),
        ...(rewards.road ?? []).map(r => rewardChip('trophy', `Route ${r.at} TR`, 'var(--green)')),
      ),
      rewards.promoted ? h('div', { style: { textAlign: 'center', color: 'var(--gold)', fontWeight: 900, letterSpacing: '0.14em' }, text: `PROMOTION — ${rewards.league}` }) : null,
      rewards.demoted ? h('div', { style: { textAlign: 'center', color: 'var(--red)', fontWeight: 900, letterSpacing: '0.14em' }, text: `DESCENTE — ${rewards.league}` }) : null,
      resultsTable(results, this.userId),
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' } },
        h('button', { class: 'btn play', html: `${icon('refresh')} REJOUER`, onClick: () => { destroy(); replayQueue(); } }),
        h('button', { class: 'btn primary', html: `${icon('friends')} INVITER`, onClick: () => { destroy(); navigate('friends'); } }),
        h('button', { class: 'btn', html: `${icon('ranked')} STATS`, onClick: () => { destroy(); navigate('profile', { name: state.profile.username }); } }),
        h('button', { class: 'btn ghost', text: 'Retour lobby', onClick: () => { destroy(); } }),
      ));
    this.root.append(overlay);
    stopMusic();
    refreshProfileQuiet();
  }

  destroyUi() {
    this.running = false;
    for (const off of this._unsubs) off();
    this.input.destroy();
    this.controls?.destroy();
    stopMusic();
  }
}

async function refreshProfileQuiet() {
  try {
    const { profile } = await api.get('/api/me');
    state.profile = profile;
    document.getElementById('w-credits') && (document.getElementById('w-credits').textContent = (profile.credits ?? 0).toLocaleString('fr-FR'));
    document.getElementById('w-tokens') && (document.getElementById('w-tokens').textContent = (profile.rift_tokens ?? 0).toLocaleString('fr-FR'));
  } catch { /* offline */ }
}

function replayQueue() {
  const mode = localStorage.getItem('ra_mode') ?? 'crystal_rush';
  api.post('/api/queue', { mode, ranked: false }).catch(() => {});
  navigate('lobby');
}

function rewardChip(iconName, text, color) {
  return h('div', { class: 'reward-chip', html: `${icon(iconName)} <span>${text}</span>`, style: { color } });
}

function resultsTable(results, myId) {
  const table = h('div', { class: 'panel results-table' });
  table.append(h('div', { class: 'r-row head' },
    h('span', { text: '' }), h('span', { text: 'Joueur' }), h('span', { text: 'K/D' }),
    h('span', { class: 'r-hide-m', text: 'Dégâts' }), h('span', { text: 'TR' })));
  for (const p of [...results.players].sort((a, b) => (b.team === results.winner ? 1 : 0) - (a.team === results.winner ? 1 : 0) || b.kills - a.kills)) {
    table.append(h('div', { class: `r-row ${p.userId === myId ? 'me' : ''}` },
      h('span', { class: p.team === 'A' ? 'team-a' : p.team === 'B' ? 'team-b' : '' },
        p.team === 'A' ? '●' : p.team === 'B' ? '▲' : '◆'),
      h('span', {}, `${p.starPlayer ? '★ ' : ''}${p.name}${p.bot ? ' (bot)' : ''}`),
      h('span', { class: 'mono', text: `${p.kills}/${p.deaths}` }),
      h('span', { class: 'mono r-hide-m', text: fmt(p.damage) }),
      h('span', { class: 'mono', text: p.rewards ? `${p.rewards.trophies >= 0 ? '+' : ''}${p.rewards.trophies}` : '—' })));
  }
  return table;
}

// ---------- HUD ----------
function buildHud() {
  const el = h('div', {});
  el.innerHTML = `
    <div class="hud-top">
      <div class="hud-score">
        <span class="hs-num hs-a" id="hud-sA">0</span>
        <span class="hud-timer" id="hud-timer">2:30</span>
        <span class="hs-num hs-b" id="hud-sB">0</span>
      </div>
    </div>
    <div class="hud-event-tag" id="hud-event" style="display:none"><span id="hud-event-text"></span></div>
    <div class="hud-count hidden" id="hud-count"></div>
    <div class="hud-banner hidden" id="hud-banner"></div>
    <div class="hud-debug" id="hud-debug"></div>
    <div class="hud-team left" id="hud-team-left"></div>
    <div class="hud-team right" id="hud-team-right"></div>
    <div class="hud-player">
      <div class="hud-hp">
        <div class="hp-text"><span id="hud-myname"></span><span id="hud-hpnum"></span></div>
        <div class="bar green"><i id="hud-hp"></i></div>
        <div class="bar blue shieldbar" style="height:4px"><i id="hud-shield" style="width:0%"></i></div>
      </div>
      <div class="hud-ammo" id="hud-ammo"></div>
      <div class="hud-super">
        <div class="bar gold"><i id="hud-super"></i></div>
        <div class="hud-super-ready hidden" id="hud-super-ready">SUPER PRÊT — ESPACE</div>
      </div>
    </div>
    <div class="hud-minimap"><canvas id="hud-minimap" width="140" height="100"></canvas></div>
    <div class="death-overlay hidden" id="hud-death">
      <div class="do-title">Éliminé</div>
      <div class="do-timer" id="hud-respawn">3</div>
    </div>
    <div class="spectate-tag hidden" id="hud-spectate">SPECTATEUR</div>
  `;
  const eventTag = el.querySelector('#hud-event');
  const wrap = {
    el,
    eventTag,
    update: null,
  };
  return wrap;
}

// attach update logic (needs access to DOM ids) — extend prototype via closure
export function attachHudUpdate(hud, root) {
  const $ = (id) => root.querySelector(`#${id}`);
  hud.update = (st, local, map, s) => {
    const q = $;
    // score/timer
    q('hud-sA').textContent = Math.floor(st.sA);
    q('hud-sB').textContent = Math.floor(st.sB);
    const tl = Math.max(0, st.tl);
    q('hud-timer').textContent = `${Math.floor(tl / 60000)}:${String(Math.floor((tl % 60000) / 1000)).padStart(2, '0')}`;
    // countdown
    const cd = q('hud-count');
    if (st.st === 'countdown' && st.cd !== null) {
      cd.classList.remove('hidden');
      cd.textContent = Math.ceil(st.cd / 1000);
    } else cd.classList.add('hidden');
    // mode banner (crystal countdown etc.)
    const banner = q('hud-banner');
    if (st.hud?.kind === 'crystal' && st.hud.counting) {
      banner.classList.remove('hidden');
      banner.textContent = `COMPTE À REBOURS ${st.hud.countdownLeft}s — DÉFENDS TES CRISTAUX`;
    } else if (st.hud?.overtime) {
      banner.classList.remove('hidden');
      banner.textContent = 'PROLONGATION — BUT EN OR';
    } else banner.classList.add('hidden');
    // local player HUD
    if (local) {
      q('hud-myname').textContent = local.n ?? '';
      q('hud-hpnum').textContent = `${Math.max(0, Math.round(local.hp))} / ${local.mhp}`;
      q('hud-hp').style.width = `${Math.max(0, local.hp / local.mhp * 100)}%`;
      q('hud-shield').style.width = `${Math.min(100, (local.sh ?? 0) / 12)}%`;
      // ammo pips
      const ammoEl = q('hud-ammo');
      const pips = Math.floor(local.ama);
      if (ammoEl.childElementCount !== pips) {
        ammoEl.innerHTML = '';
        for (let i = 0; i < pips; i++) ammoEl.append(h('div', { class: 'ammo-pip' }, h('i')));
      }
      [...ammoEl.children].forEach((pip, i) => {
        const fill = Math.max(0, Math.min(1, local.am - i));
        pip.firstElementChild.style.transform = `scaleX(${fill})`;
      });
      q('hud-super').style.width = `${Math.round(local.sc * 100)}%`;
      q('hud-super-ready').classList.toggle('hidden', local.sc < 1);
      // death overlay
      const dead = !!local.d;
      q('hud-death').classList.toggle('hidden', !dead);
      if (dead) {
        const rs = local.respawnIn ?? 3;
        q('hud-respawn').textContent = Math.max(1, Math.ceil(rs));
      }
    }
    // teammates
    renderTeam(q('hud-team-left'), st.ents.filter(e => (e.kind === 'player' || e.kind === 'bot') && e.team === 'A'), 'A');
    renderTeam(q('hud-team-right'), st.ents.filter(e => (e.kind === 'player' || e.kind === 'bot') && e.team === 'B'), 'B');
    // minimap
    drawMinimap(q('hud-minimap'), st, map, local);
  };
  return hud;
}

function renderTeam(container, ents, team) {
  container.innerHTML = '';
  for (const e of ents) {
    if (e.d) continue;
    const row = h('div', { class: `tm-row ${e.d ? 'tm-dead' : ''}` },
      h('b', { text: e.n ?? '' }),
      h('div', { class: `bar ${team === 'A' ? 'blue' : 'red'} tm-bar` }, h('i', { style: { width: `${Math.max(0, e.hp / e.mhp * 100)}%` } })));
    container.append(row);
  }
}

function drawMinimap(cv, st, map, local) {
  const ctx = cv.getContext('2d');
  const w = cv.width, hh = cv.height;
  const sx = w / (map.width * 64), sy = hh / (map.height * 64);
  ctx.clearRect(0, 0, w, hh);
  ctx.fillStyle = 'rgba(10,16,32,0.9)';
  ctx.fillRect(0, 0, w, hh);
  // walls
  ctx.fillStyle = 'rgba(120,150,255,0.35)';
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.grid[y][x];
      if (t === 1) ctx.fillRect(x * 64 * sx, y * 64 * sy, Math.ceil(64 * sx), Math.ceil(64 * sy));
      else if (t === 3) { ctx.fillStyle = 'rgba(74,222,128,0.35)'; ctx.fillRect(x * 64 * sx, y * 64 * sy, Math.ceil(64 * sx), Math.ceil(64 * sy)); ctx.fillStyle = 'rgba(120,150,255,0.35)'; }
    }
  }
  // pickups
  ctx.fillStyle = '#35e0ff';
  for (const p of st.picks ?? []) ctx.fillRect(p.x * sx - 2, p.y * sy - 2, 4, 4);
  // entities
  for (const e of st.ents ?? []) {
    if (e.kind !== 'player' && e.kind !== 'bot') continue;
    if (e.d) continue;
    ctx.fillStyle = e.id === `p_${state.profile?.id}` ? '#ffffff' : e.team === 'A' ? '#3fa9ff' : e.team === 'B' ? '#ff4d6d' : '#c77dff';
    ctx.beginPath();
    ctx.arc(e.x * sx, e.y * sy, 3, 0, 7);
    ctx.fill();
  }
}

// ---------- pause menu ----------
let pauseEl = null;
export function togglePause() {
  if (pauseEl) { pauseEl.remove(); pauseEl = null; return; }
  pauseEl = h('div', { class: 'pause-menu' },
    h('div', { class: 'pause-panel' },
      h('h3', { text: 'PAUSE', style: { letterSpacing: '0.3em' } }),
      h('p', { class: 'dim small' }, 'Le serveur continue le match — la pause ne stoppe pas le jeu.'),
      h('div', { class: 'faint small', style: { lineHeight: 1.8 } },
        'WASD/ZQSD ou flèches : déplacement · Souris : visée · Clic G : attaque · Clic D : capacité · Espace : Super · E : action · Tab : score'),
      h('button', { class: 'btn primary', text: 'Reprendre', onClick: () => togglePause() }),
      h('button', { class: 'btn danger', text: 'Abandonner (retour lobby)', onClick: () => {
        wsSend({ t: 'leave_room' });
        pauseEl?.remove(); pauseEl = null;
        destroy();
      } })));
  document.getElementById('overlays').append(pauseEl);
}

// scoreboard on Tab handled via keydown here:
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && document.querySelector('.game-root')) {
    e.preventDefault();
    showScoreboard();
  }
});
let sbEl = null;
function showScoreboard() {
  if (sbEl) { sbEl.remove(); sbEl = null; return; }
  sbEl = h('div', { class: 'hud-scoreboard' }, h('div', { class: 'dim small', text: 'Scores disponibles à la fin du match et via l\'écran de résultats.' }));
  document.querySelector('.game-root')?.append(sbEl);
  setTimeout(() => { sbEl?.remove(); sbEl = null; }, 1600);
}

export function destroy() {
  document.querySelectorAll('.game-root').forEach(el => el.remove());
  document.body.classList.remove('in-game');
  stopMusic();
  if (current) { current.destroyUi(); current = null; }
}

let current = null;
