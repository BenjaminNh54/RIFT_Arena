// RIFT ARENA — launch maps (data-driven, symmetric, playable in every mode)
// Grid legend: '.' floor | '#' wall | 'C' crate(destructible) | 'B' bush | 'W' water | 'X' hazard | 'P' portal
// Team maps are mirrored left-right (half includes center column).
// FFA maps are mirrored left-right AND top-bottom (quadrant includes center lines).

function mirrorLR(half) {
  return half.map(row => row + [...row.slice(0, -1)].reverse().join(''));
}
function mirrorTB(rows) {
  return [...rows, ...rows.slice(0, -1).reverse()];
}
function quadrant(rows) {
  const lr = mirrorLR(rows);            // full width rows (top half)
  return mirrorTB(lr);                  // full grid
}

const MAPS = [
  {
    id: 'neon_yard', name: 'Neon Yard', theme: 'neon',
    desc: 'Futurist city yard with neon lanes, gates and crates.',
    modes: ['crystal_rush', 'strikeball', 'domination', 'elimination'],
    half: [
      '.................',
      '..##.........C...',
      '..##.........#...',
      '.......BB....#...',
      '..C....BB........',
      '.......#.....B...',
      '....W...#...CC...',
      '....W...#........',
      '..B..###.........',
      '.....###....C....',
      '...........BB....',
      '..C..............',
      '.....BB...##.....',
      '..........##.....',
      '....C...#........',
      '........#....B...',
      '...CC....#.......',
      '.........#.......',
      '.......BB........',
      '.................',
      '..##.........C...',
      '..##.............',
      '.................',
    ],
    spawns: {
      A: [[2, 11], [2, 9], [2, 13]],
      B: [[30, 11], [30, 13], [30, 9]],
      FFA: [[4, 4], [28, 4], [4, 18], [28, 18], [10, 11], [22, 11], [16, 2], [16, 20]],
    },
    objectives: {
      crystals: [[16, 4], [16, 11], [16, 18]],
      ball: [16, 11], goalA: [1, 11], goalB: [31, 11],
      zones: { A: [7, 11], B: [25, 11], C: [16, 11] },
    },
  },
  {
    id: 'dust_canyon', name: 'Dust Canyon', theme: 'dust',
    desc: 'Narrow canyon corridors carved in orange rock.',
    modes: ['crystal_rush', 'domination', 'elimination'],
    half: [
      '.................',
      '.##.....##.......',
      '.##.....##....C..',
      '....C........##..',
      '........C....##..',
      '..##.............',
      '..##..BB.....C...',
      '.......##........',
      '..C....##....BB..',
      '.............BB..',
      '....BB...C.......',
      '.........C...##..',
      '..##.............',
      '..##...BB....C...',
      '.......##........',
      '....C..##....BB..',
      '.............BB..',
      '..##..........C..',
      '..##.....C.......',
      '.##.....##....C..',
      '.##.....##.......',
      '.................',
      '.................',
    ],
    spawns: {
      A: [[1, 11], [1, 8], [1, 14]],
      B: [[31, 11], [31, 14], [31, 8]],
      FFA: [[3, 2], [29, 2], [3, 20], [29, 20], [9, 11], [23, 11], [16, 6], [16, 16]],
    },
    objectives: {
      crystals: [[13, 6], [16, 11], [13, 16]],
      ball: [16, 11], goalA: [1, 11], goalB: [31, 11],
      zones: { A: [6, 11], B: [26, 11], C: [16, 11] },
    },
  },
  {
    id: 'moss_temple', name: 'Moss Temple', theme: 'moss',
    desc: 'Overgrown temple grounds — thick bushes, ambush country.',
    modes: ['crystal_rush', 'strikeball', 'domination', 'elimination', 'last_core', 'boss_raid'],
    half: [
      '.................',
      '..B..#......BB...',
      '..B..#......BB...',
      '.....#..C........',
      '..BB.....##......',
      '..BB.....##...C..',
      '......B..........',
      '.##...B...B......',
      '.##.......B...B..',
      '..........B......',
      '....C............',
      '..B.....####.....',
      '..B.....####..C..',
      '....C............',
      '..........B......',
      '.##.......B...B..',
      '.##...B...B......',
      '......B..........',
      '..BB.....##...C..',
      '..BB.....##......',
      '.....#..C........',
      '..B..#......BB...',
      '..B..#......BB...',
    ],
    spawns: {
      A: [[2, 11], [1, 6], [1, 16]],
      B: [[30, 11], [31, 16], [31, 6]],
      FFA: [[3, 3], [29, 3], [3, 19], [29, 19], [10, 11], [22, 11], [16, 4], [16, 18]],
    },
    objectives: {
      crystals: [[16, 3], [16, 11], [16, 19]],
      ball: [16, 11], goalA: [1, 11], goalB: [31, 11],
      zones: { A: [7, 11], B: [25, 11], C: [16, 11] },
    },
  },
  {
    id: 'core_station', name: 'Core Station', theme: 'core',
    desc: 'Tight orbital station. Walls everywhere, portals save lives.',
    width: 27, height: 19,
    modes: ['crystal_rush', 'strikeball', 'domination', 'elimination'],
    half: [
      '..............',
      '..###....C....',
      '..###.........',
      '......BB..##..',
      '..C..BB...##..',
      '.........#....',
      '...#.....#.C..',
      '...#..P.......',
      '.......###....',
      '..C....###....',
      '..............',
      '..........B...',
      '..C....###.B..',
      '.......###....',
      '...#..P.......',
      '...#.....#.C..',
      '.........#....',
      '..C..BB...##..',
      '......BB..##..',
    ],
    spawns: {
      A: [[2, 9], [2, 4], [2, 14]],
      B: [[24, 9], [24, 14], [24, 4]],
      FFA: [[2, 2], [24, 2], [2, 16], [24, 16], [9, 9], [17, 9], [13, 2], [13, 16]],
    },
    objectives: {
      crystals: [[13, 4], [13, 9], [13, 14]],
      ball: [13, 9], goalA: [0, 9], goalB: [26, 9],
      zones: { A: [5, 9], B: [21, 9], C: [13, 9] },
    },
  },
  {
    id: 'frostline', name: 'Frostline', theme: 'frost',
    desc: 'Frozen shoreline. Ice water cuts the field in lanes.',
    modes: ['crystal_rush', 'domination', 'elimination', 'boss_raid'],
    half: [
      '.................',
      '...##.......BB...',
      '...##.......BB...',
      '..........#......',
      '.WW.......#...C..',
      '.WW..............',
      '.WW...C....##....',
      '.WW........##....',
      '.........B.......',
      '.....#...B.......',
      '.....#...........',
      '..C..............',
      '.....#...........',
      '.....#...B.......',
      '.........B.......',
      '.WW........##....',
      '.WW...C....##....',
      '.WW..............',
      '.WW.......#...C..',
      '..........#......',
      '...##.......BB...',
      '...##.......BB...',
      '.................',
    ],
    spawns: {
      A: [[1, 11], [1, 3], [1, 19]],
      B: [[31, 11], [31, 19], [31, 3]],
      FFA: [[3, 2], [29, 2], [3, 20], [29, 20], [9, 6], [23, 6], [9, 16], [23, 16]],
    },
    objectives: {
      crystals: [[16, 2], [16, 11], [16, 20]],
      ball: [16, 11], goalA: [1, 11], goalB: [31, 11],
      zones: { A: [6, 11], B: [26, 11], C: [16, 11] },
    },
  },
  {
    id: 'ember_pit', name: 'Ember Pit', theme: 'ember',
    desc: 'Volcanic pit with lava pools. Watch your step.',
    modes: ['crystal_rush', 'domination', 'elimination', 'boss_raid'],
    half: [
      '.................',
      '.###.......BB....',
      '.###.......BB....',
      '....C............',
      '..XX........C....',
      '..XX......###....',
      '.....C....###....',
      '.............#...',
      '..BB........#....',
      '..BB...XX........',
      '.......XX....C...',
      '...#.............',
      '...#..XX.........',
      '......XX.....C...',
      '.............#...',
      '..BB........#....',
      '..BB.............',
      '.....C....###....',
      '..XX......###....',
      '..XX........C....',
      '....C............',
      '.###.......BB....',
      '.###.......BB....',
    ],
    spawns: {
      A: [[1, 11], [1, 7], [1, 15]],
      B: [[31, 11], [31, 15], [31, 7]],
      FFA: [[2, 2], [30, 2], [2, 20], [30, 20], [9, 11], [23, 11], [16, 2], [16, 20]],
    },
    objectives: {
      crystals: [[16, 2], [16, 11], [16, 20]],
      ball: [16, 11], goalA: [1, 11], goalB: [31, 11],
      zones: { A: [6, 4], B: [26, 4], C: [16, 11] },
    },
  },
  {
    id: 'sky_circuit', name: 'Sky Circuit', theme: 'sky',
    width: 41, height: 29, ffa: true,
    desc: 'Suspended circuit in the clouds. Portals flip the fight.',
    modes: ['last_core', 'elimination'],
    quad: [
      '.....................',
      '....##.........BB....',
      '....##.........BB....',
      '.........C...........',
      '..BB.................',
      '..BB....####....C....',
      '........####.........',
      '.....C...............',
      '.....................',
      '...#.....WW....P.....',
      '...#.....WW..........',
      '..............BB.....',
      '..C...........BB.....',
      '.....BB..............',
      '.....BB......C.......',
    ],
    spawns: {
      FFA: [[4, 4], [36, 4], [4, 24], [36, 24], [13, 14], [27, 14], [20, 3], [20, 25]],
    },
    objectives: {
      crystals: [[20, 8], [20, 20], [8, 14], [32, 14]],
      zones: { A: [10, 14], B: [30, 14], C: [20, 14] },
    },
  },
  {
    id: 'lost_factory', name: 'Lost Factory', theme: 'factory',
    width: 41, height: 29, ffa: true,
    desc: 'Abandoned factory floor. Crate maze and rust.',
    modes: ['last_core', 'boss_raid'],
    quad: [
      '.....................',
      '..CC.....#......BB...',
      '..CC.....#......BB...',
      '.........#...........',
      '.....WW..............',
      '..#..WW...CC....#....',
      '..#.......CC....#....',
      '.....................',
      '......XX.............',
      '..BB..XX.....C.......',
      '..BB.........C..##...',
      '................##...',
      '....C....P...........',
      '....C...........BB...',
      '................BB...',
    ],
    spawns: {
      FFA: [[3, 3], [37, 3], [3, 25], [37, 25], [11, 14], [29, 14], [20, 3], [20, 25]],
    },
    objectives: {
      crystals: [[20, 8], [20, 20], [9, 14], [31, 14]],
      zones: { A: [9, 14], B: [31, 14], C: [20, 14] },
      boss: [20, 14],
    },
  },
];

function parseGrid(rows) {
  const grid = [];
  const portals = [];
  for (let y = 0; y < rows.length; y++) {
    const row = [];
    for (let x = 0; x < rows[y].length; x++) {
      const c = rows[y][x];
      const tile = c === '#' ? 1 : c === 'C' ? 2 : c === 'B' ? 3 : c === 'W' ? 4 : c === 'X' ? 5 : c === 'P' ? 6 : 0;
      if (c === 'P') portals.push([x, y]);
      row.push(tile);
    }
    grid.push(row);
  }
  return { grid, portals };
}

// relocate any spawn that landed on a solid tile to the nearest free tile (BFS)
function fixSpawns(grid, width, height, spawns) {
  const isFree = (x, y) => {
    const t = grid[y]?.[x];
    return t === 0 || t === 3;
  };
  const nearestFree = (x, y) => {
    if (isFree(x, y)) return [x, y];
    const q = [[x, y]]; const seen = new Set([`${x},${y}`]);
    while (q.length) {
      const [cx, cy] = q.shift();
      if (isFree(cx, cy)) return [cx, cy];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !seen.has(`${nx},${ny}`)) {
          seen.add(`${nx},${ny}`); q.push([nx, ny]);
        }
      }
    }
    return [x, y];
  };
  const out = {};
  for (const [team, list] of Object.entries(spawns)) {
    out[team] = list.map(([x, y]) => nearestFree(x, y));
  }
  return out;
}

export const MAPS_READY = MAPS.map(m => {
  const rows = m.quad ? quadrant(m.quad) : mirrorLR(m.half);
  const { grid, portals } = parseGrid(rows);
  const width = m.width ?? m.half[0].length * 2 - 1;
  const height = m.height ?? m.half.length;
  // pair portals: [0]<->[1], [2]<->[3]...
  const portalPairs = [];
  for (let i = 0; i + 1 < portals.length; i += 2) portalPairs.push([portals[i], portals[i + 1]]);
  return {
    id: m.id, name: m.name, theme: m.theme, desc: m.desc,
    width, height, grid, portalPairs,
    spawns: fixSpawns(grid, width, height, m.spawns),
    objectives: m.objectives,
    modes: m.modes, official: true, tileSize: 64,
  };
});

export const MAP_MAP = Object.fromEntries(MAPS_READY.map(m => [m.id, m]));
