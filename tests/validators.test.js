// RIFT ARENA — tests: validators & shared data
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername, validatePassword, validateMapData, validateEventConfig, encodeGrid, decodeGrid } from '../shared/validators/index.js';
import { MAPS_READY, MAP_MAP } from '../shared/definitions/maps.js';
import { FIGHTERS, FIGHTER_MAP } from '../shared/definitions/fighters.js';
import { MODE_MAP } from '../shared/definitions/modes.js';
import { hasPerm } from '../shared/constants.js';

test('username validation', () => {
  assert.equal(validateUsername('TB_player-1'), true);
  assert.equal(validateUsername('ab'), false);
  assert.equal(validateUsername('a'.repeat(17)), false);
  assert.equal(validateUsername('bad name!'), false);
});

test('password validation', () => {
  assert.equal(validatePassword('hunter2'), true);
  assert.equal(validatePassword('12345'), false);
  assert.equal(validatePassword('x'.repeat(73)), false);
});

test('all launch maps are symmetric, valid and mode-compatible', () => {
  assert.equal(MAPS_READY.length, 8);
  for (const m of MAPS_READY) {
    assert.equal(m.grid.length, m.height, `${m.id} height`);
    for (const row of m.grid) assert.equal(row.length, m.width, `${m.id} row width`);
    const errs = validateMapData({ name: m.name, grid: m.grid, spawns: m.spawns.FFA ?? m.spawns.A });
    assert.equal(errs.length, 0, `${m.id}: ${errs.join(', ')}`);
    for (const mode of m.modes) assert.ok(MODE_MAP[mode], `${m.id} unknown mode ${mode}`);
  }
});

test('all maps are mirrored left-right', () => {
  for (const m of MAPS_READY) {
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        assert.equal(m.grid[y][x], m.grid[y][m.width - 1 - x], `${m.id} asymmetry at ${x},${y}`);
      }
    }
  }
});

test('every mode has a compatible map and every fighter is defined', () => {
  for (const mode of Object.keys(MODE_MAP)) {
    assert.ok(MAPS_READY.some(m => m.modes.includes(mode)), `no map for ${mode}`);
  }
  assert.equal(FIGHTERS.length, 6);
  for (const f of FIGHTERS) {
    assert.ok(f.attack && f.super && f.ability && f.passive, `${f.id} incomplete`);
    assert.ok(FIGHTER_MAP[f.id], `${f.id} map missing`);
  }
});

test('map validation rejects junk', () => {
  assert.ok(validateMapData({ name: 'ab', grid: [[0]], spawns: [] }).length > 0);
  assert.ok(validateMapData({ name: 'valid name', grid: [[1, 1], [1, 1]], spawns: [[0, 0], [0, 0]] }).length > 0); // spawns in wall
});

test('grid encode/decode round-trip', () => {
  const grid = [[0, 0, 1, 1, 1], [2, 3, 3, 3, 3], [4, 4, 4, 4, 6]];
  const enc = encodeGrid(grid);
  const dec = decodeGrid(enc, 5);
  assert.deepEqual(dec, grid);
});

test('event config whitelist', () => {
  assert.equal(validateEventConfig({ name: 'Test Event', modifiers: { speed_mult: 1.5 } }).length, 0);
  assert.ok(validateEventConfig({ name: 'Bad', modifiers: { arbitrary_code: 'alert(1)' } }).length > 0);
  assert.ok(validateEventConfig({ name: 'Range', modifiers: { damage_mult: 99 } }).length > 0);
  assert.ok(validateEventConfig({ name: 'Dates', startAt: '2026-01-02', endAt: '2026-01-01' }).length > 0);
});

test('admin permission matrix', () => {
  assert.equal(hasPerm('ADMIN', 'config.set'), true);
  assert.equal(hasPerm('MODERATOR', 'mute'), true);
  assert.equal(hasPerm('MODERATOR', 'config.set'), false);
  assert.equal(hasPerm('HELPER', 'tempban'), false);
  assert.equal(hasPerm('player', 'players.view'), false);
});
