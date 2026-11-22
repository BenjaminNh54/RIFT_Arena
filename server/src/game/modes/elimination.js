// RIFT ARENA — Elimination: every elimination scores for the killer's team.
export const def = null;

export function init(room) {
  room.modeState = { target: room.modeDef.target ?? 10 };
  room.score = { A: 0, B: 0 };
}

export function onKill(room, killer) {
  if (!killer) return;
  if (killer.team === 'A' || killer.team === 'B') room.score[killer.team]++;
}

export function checkEnd(room) {
  if (room.score.A >= room.modeState.target) return { winner: 'A' };
  if (room.score.B >= room.modeState.target) return { winner: 'B' };
  return null;
}

export function defaultWinner(room) {
  return room.score.A > room.score.B ? 'A' : room.score.B > room.score.A ? 'B' : 'draw';
}

export const respawn = true;

export function hud(room) {
  return { kind: 'elimination', target: room.modeState.target };
}
