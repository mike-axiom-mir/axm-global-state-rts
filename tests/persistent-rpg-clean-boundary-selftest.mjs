import assert from 'node:assert/strict';
import fs from 'node:fs';

const gameFiles = fs.readdirSync(new URL('../game/', import.meta.url))
  .filter(name => !name.startsWith('.'))
  .sort();

assert.deepEqual(gameFiles, [
  'index.html',
  'rpg-world.css',
  'rpg-world.mjs'
]);

const app = fs.readFileSync(new URL('../game/rpg-world.mjs', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../src/rpg/presentation/rpg-renderer.mjs', import.meta.url), 'utf8');

for (const forbidden of [
  '../src/presentation/planet-renderer.mjs',
  'local-rts',
  'createLocalRegionSimulation',
  'createLocalCombatGameplay',
  'createLocalCivilizationGameplay',
  'primary-strategic',
  'gameplay-surface'
]) {
  assert.equal(app.includes(forbidden), false, `active RPG app must not contain donor game seam: ${forbidden}`);
}

for (const forbidden of [
  '../../presentation/',
  '../../sim/',
  'globe-world-overlay',
  'local-region-scene',
  'graphics-quality-pass',
  'post-apocalyptic',
  'crew-base-a',
  'building-settlement-core-a'
]) {
  assert.equal(renderer.includes(forbidden), false, `clean RPG renderer must not import donor presentation/game assumption: ${forbidden}`);
}

console.log('persistent RPG clean active-layer boundary selftest passed');
