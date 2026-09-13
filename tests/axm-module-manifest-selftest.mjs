import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'AXM_MODULE.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert.equal(manifest.schema_version, '1.4');
assert.equal(manifest.module?.name, 'axm-global-state-rts');
assert.ok(Array.isArray(manifest.capabilities));

const callableCapabilities = manifest.capabilities.filter(capability => capability?.callable);
assert.equal(callableCapabilities.length, 2, 'exactly two source-callable capabilities are currently declared');

for (const capability of callableCapabilities) {
  const descriptor = capability.callable;
  assert.equal(descriptor.schema, 'axm.callable-capability/v0.1');
  assert.equal(descriptor.kind, 'module-export');
  assert.equal(descriptor.authority, 'none');
  assert.equal(descriptor.network, 'none');
  assert.ok(typeof descriptor.runtime === 'string' && descriptor.runtime.length > 0);
  assert.ok(typeof descriptor.path === 'string' && descriptor.path.length > 0);
  assert.ok(!descriptor.path.startsWith('/') && !descriptor.path.split(/[\\/]/).includes('..'));
  assert.match(descriptor.export, /^[A-Za-z_$][A-Za-z0-9_$]*$/);

  const target = resolve(root, descriptor.path);
  assert.ok(target.startsWith(`${root}${sep}`), `${capability.id} callable must remain inside repository root`);
  assert.ok(existsSync(target), `${capability.id} callable target must exist`);
  const loaded = await import(pathToFileURL(target).href);
  assert.equal(typeof loaded[descriptor.export], 'function', `${capability.id} declared export must be callable source`);
}

const selector = callableCapabilities.find(capability => capability.id === 'asset.workshop-lod-selection');
assert.ok(selector);
const selectorModule = await import(pathToFileURL(resolve(root, selector.callable.path)).href);
const select = selectorModule[selector.callable.export];
assert.equal(select(90).role, 'tactical');
assert.equal(select(119.999).role, 'tactical');
assert.equal(select(120).role, 'rts');
assert.equal(select(360).role, 'rts');
assert.equal(select(2600).role, 'rts');
assert.equal(select(360).farCandidateStatus, 'HOLD_DISTANCE_HANDOFF_UNPROVEN');

const installer = callableCapabilities.find(capability => capability.id === 'asset.workshop-lod-installation');
assert.ok(installer);
assert.equal(installer.callable.export, 'installWorkshopLodForView');

assert.ok(manifest.truth_boundary?.not_claimed?.some(claim => claim.includes('Monolith')));
assert.ok(manifest.truth_boundary?.not_claimed?.some(claim => claim.includes('CANON')));

console.log('AXM native callable manifest selftest: PASS (2 source declarations, execution authority unchanged)');
