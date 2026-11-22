// RIFT ARENA — mode registry
import { MODE_MAP } from '../../../../shared/definitions/modes.js';

import * as crystalRush from './crystal_rush.js';
import * as strikeball from './strikeball.js';
import * as domination from './domination.js';
import * as lastCore from './last_core.js';
import * as elimination from './elimination.js';
import * as bossRaid from './boss_raid.js';

const REGISTRY = {
  crystal_rush: crystalRush,
  strikeball,
  domination,
  last_core: lastCore,
  elimination,
  boss_raid: bossRaid,
};

export function getModeModule(modeId) {
  const mod = REGISTRY[modeId];
  if (!mod) throw new Error(`unknown mode ${modeId}`);
  // wrap (module namespace objects are read-only) and attach the mode definition
  return Object.assign({}, mod, { def: MODE_MAP[modeId] });
}
