import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_VEHICLE_SET,
  CREATION_MACHINE_VEHICLE_SET_SCHEMA,
  creationMachineVehicleSetEntry,
  creationMachineVehicleTrialPlan
} from '../src/assets/creation-machine-vehicle-set.mjs';
import { LOCAL_VEHICLE_PLAN_IDS } from '../src/sim/local-vehicle-gameplay.mjs';
import { VEHICLE_CATALOG } from '../src/sim/vehicle-fabric.mjs';

assert.equal(CREATION_MACHINE_VEHICLE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-vehicle-static-set/v0.1');
assert.equal(CREATION_MACHINE_VEHICLE_SET.length, 1);

const entry = creationMachineVehicleSetEntry('vehicle-scrap-truck-a');
assert.ok(entry);
assert.equal(entry.sourceAsset, 'utility-hauler');
assert.equal(entry.sourceFamily, 'vehicles');
assert.equal(entry.gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(entry.targetKind, 'vehicle-instance');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const plan = creationMachineVehicleTrialPlan();
assert.equal(plan.length, 1);
assert.equal(plan[0].stableAssetId, 'vehicle-scrap-truck-a');
assert.equal(plan[0].sourceAsset, 'utility-hauler');
assert.equal(plan[0].gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(plan[0].automaticLodSelection, false);
assert.equal(plan[0].footprint, null);

assert.ok(LOCAL_VEHICLE_PLAN_IDS.includes('vehicle:utility-hauler'), 'Utility Hauler must remain a current LOCAL vehicle-plan target');
const definition = VEHICLE_CATALOG.find(candidate => candidate.id === 'vehicle:utility-hauler');
assert.ok(definition, 'vehicle catalog must contain vehicle:utility-hauler');
assert.equal(definition.requiredBlueprintId, null);
assert.equal(definition.movementMode, 'wheeled');
assert.equal(definition.cargoCapacity, 700);

const assetList = fs.readFileSync(new URL('../ASSET_LIST.md', import.meta.url), 'utf8');
assert.match(assetList, /`vehicle-scrap-truck-a`/);

const sourceIndex = fs.readFileSync(new URL('../assets/creation-machine/asset-index.csv', import.meta.url), 'utf8');
assert.match(
  sourceIndex,
  /^utility-hauler,vehicles,assets\/utility-hauler\/utility-hauler\.gltf,assets\/utility-hauler\/utility-hauler-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_VEHICLE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  sourceAsset: entry.sourceAsset,
  gameplayDefinitionId: entry.gameplayDefinitionId,
  runtimeVariant: entry.runtimeTrial.variant,
  automaticLodSelection: entry.runtimeTrial.automaticLodSelection,
  footprint: entry.collision.footprint,
  animationStatus: entry.animation.status
}, null, 2));
