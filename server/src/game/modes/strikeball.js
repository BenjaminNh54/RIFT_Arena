// RIFT ARENA — Strikeball: carry or kick the core-ball into the enemy goal.
export const def = null;

export function init(room) {
  const [bx, by] = room.map.objectives.ball ?? [room.map.width >> 1, room.map.height >> 1];
  room.modeState = {
    ball: { x: (bx + 0.5) * 64, y: (by + 0.5) * 64, vx: 0, vy: 0, holderId: null },
    resetTimer: 0,
    overtime: false,
    target: room.modeDef.target ?? 2,
  };
}

export function start(room) { /* ball already placed */ }

export function tick(room, dt) {
  const ball = room.modeState.ball;

  // post-goal reset delay
  if (room.modeState.resetTimer > 0) {
    room.modeState.resetTimer -= dt * 1000;
    if (room.modeState.resetTimer <= 0) {
      const [bx, by] = room.map.objectives.ball;
      ball.x = (bx + 0.5) * 64; ball.y = (by + 0.5) * 64;
      ball.vx = ball.vy = 0; ball.holderId = null;
    }
    return;
  }

  if (ball.holderId) {
    const holder = room.ents.get(ball.holderId);
    if (!holder || holder.dead) { dropBall(room, holder); }
    else { ball.x = holder.x; ball.y = holder.y; }
  } else {
    // free ball physics with wall bounce
    const nx = ball.x + ball.vx * dt, ny = ball.y + ball.vy * dt;
    const solidAt = (x, y) => {
      const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
      const t = (ty >= 0 && ty < room.map.height && tx >= 0 && tx < room.map.width) ? room.map.grid[ty][tx] : 1;
      return t === 1 || t === 2 || t === 4;
    };
    if (solidAt(nx, ball.y)) { ball.vx *= -0.6; } else { ball.x = nx; }
    if (solidAt(ball.x, ny)) { ball.vy *= -0.6; } else { ball.y = ny; }
    ball.vx *= Math.pow(0.35, dt); ball.vy *= Math.pow(0.35, dt);
    // pickup
    for (const e of room.combatables()) {
      if ((e.kind !== 'player' && e.kind !== 'bot') || e.dead) continue;
      if (Math.hypot(e.x - ball.x, e.y - ball.y) < e.radius + 16) {
        ball.holderId = e.id; e.hasBall = true;
        room.fx({ k: 'ballgrab', id: e.id });
        break;
      }
    }
  }

  // goal check
  const { goalA, goalB } = room.map.objectives;
  if (goalA && Math.hypot(ball.x - (goalA[0] + 0.5) * 64, ball.y - (goalA[1] + 0.5) * 64) < 55) score(room, 'B');
  else if (goalB && Math.hypot(ball.x - (goalB[0] + 0.5) * 64, ball.y - (goalB[1] + 0.5) * 64) < 55) score(room, 'A');
}

function score(room, team) {
  room.score[team]++;
  room.fx({ k: 'goal', team });
  room.modeState.resetTimer = 1600;
  room.modeState.ball.holderId = null;
  for (const e of room.ents.values()) if (e.hasBall) e.hasBall = false;
}

export function onKick(room, ent) {
  const ball = room.modeState.ball;
  if (ball.holderId !== ent.id) return;
  ball.holderId = null;
  ent.hasBall = false;
  const power = 780;
  ball.vx = Math.cos(ent.angle) * power;
  ball.vy = Math.sin(ent.angle) * power;
  room.fx({ k: 'ballkick', id: ent.id });
}

export function onKill(room, killer, victim) {
  if (victim.hasBall) dropBall(room, victim);
}

function dropBall(room, victim) {
  const ball = room.modeState.ball;
  ball.holderId = null;
  if (victim) { ball.x = victim.x; ball.y = victim.y; }
  for (const e of room.ents.values()) if (e.hasBall) e.hasBall = false;
}

export function checkEnd(room) {
  if (room.score.A >= room.modeState.target) return { winner: 'A' };
  if (room.score.B >= room.modeState.target) return { winner: 'B' };
  if (room.timeLeft <= 0) {
    if (!room.modeDef.overtime || room.modeState.overtime) {
      return { winner: room.score.A === room.score.B ? 'draw' : (room.score.A > room.score.B ? 'A' : 'B') };
    }
    // golden goal overtime
    room.modeState.overtime = true;
    room.timeLeft = room.modeDef.timer ? 30000 : 30000;
    return null;
  }
  return null;
}

export const respawn = true;

export function hud(room) {
  return { kind: 'strikeball', target: room.modeState.target, overtime: room.modeState.overtime, reset: room.modeState.resetTimer > 0 };
}
