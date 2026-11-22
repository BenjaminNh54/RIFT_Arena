// RIFT ARENA — procedural audio (WebAudio): SFX + lobby/match music, no external files
import { settings } from '../state.js';

let ctx = null;
let masterGain = null, musicGain = null, sfxGain = null;
let musicTimer = null;
let currentTrack = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext ?? window.webkitAudioContext)();
  masterGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain = ctx.createGain();
  masterGain.connect(ctx.destination);
  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);
  applyVolumes();
  return ctx;
}

export function applyVolumes() {
  if (!ctx) return;
  const s = settings();
  masterGain.gain.value = s.mute ? 0 : s.master;
  musicGain.gain.value = s.music;
  sfxGain.gain.value = s.sfx;
}

function env(gain, t0, a, d, peak = 1) {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + a);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + a + d);
}

function blip({ freq = 440, freq2 = null, dur = 0.15, type = 'square', vol = 0.5, slideDur = null }) {
  if (!ctx || settings().mute) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + (slideDur ?? dur));
  env(g, t0, 0.005, dur, vol);
  osc.connect(g); g.connect(sfxGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.2, vol = 0.4, lowpass = 1200 }) {
  if (!ctx || settings().mute) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = lowpass;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t0);
}

export const sfx = {
  ui() { blip({ freq: 700, freq2: 900, dur: 0.07, type: 'triangle', vol: 0.25 }); },
  uiBig() { blip({ freq: 500, freq2: 1000, dur: 0.18, type: 'triangle', vol: 0.4 }); },
  shoot(color = '') { blip({ freq: 520, freq2: 190, dur: 0.1, type: 'square', vol: 0.3 }); },
  shootHeavy() { blip({ freq: 260, freq2: 90, dur: 0.22, type: 'sawtooth', vol: 0.4 }); },
  hit() { noise({ dur: 0.08, vol: 0.3, lowpass: 900 }); blip({ freq: 200, freq2: 120, dur: 0.07, vol: 0.2 }); },
  death() { blip({ freq: 300, freq2: 60, dur: 0.5, type: 'sawtooth', vol: 0.5 }); noise({ dur: 0.4, vol: 0.4, lowpass: 600 }); },
  super() { blip({ freq: 220, freq2: 880, dur: 0.35, type: 'square', vol: 0.5 }); blip({ freq: 440, freq2: 1760, dur: 0.3, type: 'triangle', vol: 0.3 }); },
  boom() { noise({ dur: 0.45, vol: 0.6, lowpass: 400 }); blip({ freq: 120, freq2: 40, dur: 0.4, vol: 0.5 }); },
  pickup() { blip({ freq: 900, freq2: 1400, dur: 0.12, type: 'triangle', vol: 0.4 }); },
  goal() { [523, 659, 784].forEach((f, i) => setTimeout(() => blip({ freq: f, dur: 0.16, type: 'triangle', vol: 0.4 }), i * 110)); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip({ freq: f, dur: 0.24, type: 'triangle', vol: 0.5 }), i * 160)); },
  lose() { [440, 349, 261].forEach((f, i) => setTimeout(() => blip({ freq: f, dur: 0.3, type: 'sawtooth', vol: 0.4 }), i * 200)); },
  respawn() { blip({ freq: 600, freq2: 1200, dur: 0.25, type: 'triangle', vol: 0.35 }); },
};

// ---------- music: simple procedural loops ----------
const LOBBY = { bpm: 96, bass: [55, 55, 65.4, 49], lead: [220, 261.6, 329.6, 246.9, 220, 293.7, 329.6, 392] };
const MATCH = { bpm: 128, bass: [49, 49, 58.3, 61.7], lead: [196, 233, 261.6, 311.1, 293.7, 261.6, 233, 196] };

export function playMusic(track = 'lobby') {
  ensure();
  applyVolumes();
  if (currentTrack === track && musicTimer) return;
  stopMusic();
  currentTrack = track;
  const def = track === 'match' ? MATCH : LOBBY;
  const beat = 60 / def.bpm;
  let step = 0;
  const tick = () => {
    if (settings().mute || settings().music === 0) return;
    const t0 = ctx.currentTime;
    // bass every beat
    if (step % 2 === 0) {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = def.bass[(step / 2) % def.bass.length];
      env(g, t0, 0.01, beat * 0.9, 0.16);
      osc.connect(g); g.connect(musicGain);
      osc.start(t0); osc.stop(t0 + beat);
    }
    // lead arp
    const osc2 = ctx.createOscillator(); const g2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.value = def.lead[step % def.lead.length] / 2;
    env(g2, t0, 0.02, beat * 0.5, 0.05);
    osc2.connect(g2); g2.connect(musicGain);
    osc2.start(t0); osc2.stop(t0 + beat);
    step++;
  };
  musicTimer = setInterval(tick, beat * 500);
}

export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  currentTrack = null;
}

// unlock audio on first interaction (browsers require it)
export function unlockAudio() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
}
window.addEventListener('pointerdown', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });
