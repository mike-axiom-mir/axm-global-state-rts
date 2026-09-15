import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CREATION_MACHINE_VEHICLE_SET,
  CREATION_MACHINE_VEHICLE_SET_SCHEMA,
  creationMachineVehicleCandidate,
  creationMachineVehicleSetEntry,
  creationMachineVehicleTrialPlan
} from '../src/assets/creation-machine-vehicle-set.mjs';
import { LOCAL_VEHICLE_PLAN_IDS } from '../src/sim/local-vehicle-gameplay.mjs';
import { VEHICLE_CATALOG } from '../src/sim/vehicle-fabric.mjs';

assert.equal(CREATION_MACHINE_VEHICLE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-vehicle-static-set/v0.3');
assert.equal(CREATION_MACHINE_VEHICLE_SET.length, 3);

const entry = creationMachineVehicleSetEntry('vehicle-scrap-truck-a');
assert.ok(entry);
assert.equal(entry.candidateId, 'vehicle-scrap-truck-a:utility-hauler');
assert.equal(entry.sourceAsset, 'utility-hauler');
assert.equal(entry.sourceFamily, 'vehicles');
assert.equal(entry.gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(entry.targetKind, 'vehicle-instance');
assert.equal(entry.runtimeTrial.variant, 'far');
assert.equal(entry.runtimeTrial.automaticLodSelection, false);
assert.equal(entry.fallback.replacementRequiresExplicitRuntimeCall, true);
assert.equal(entry.collision.footprint, null);
assert.equal(entry.animation.status, 'HANDOFF_LATER');

const flatbed = creationMachineVehicleSetEntry('vehicle-scrap-truck-a', 'flatbed-convoy-truck');
assert.ok(flatbed);
assert.equal(flatbed.candidateId, 'vehicle-scrap-truck-a:flatbed-convoy-truck');
assert.equal(flatbed.stableAssetId, 'vehicle-scrap-truck-a');
assert.equal(flatbed.sourceAsset, 'flatbed-convoy-truck');
assert.equal(flatbed.sourceFamily, 'vehicles');
assert.equal(flatbed.gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(flatbed.candidateRole, 'explicit-alternate-static-candidate');
assert.equal(flatbed.runtimeTrial.variant, 'far');
assert.equal(flatbed.runtimeTrial.automaticLodSelection, false);
assert.equal(flatbed.collision.footprint, null);
assert.equal(flatbed.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineVehicleCandidate(flatbed.candidateId), flatbed);

const crane = creationMachineVehicleSetEntry('vehicle-scrap-truck-a', 'crane-truck');
assert.ok(crane);
assert.equal(crane.candidateId, 'vehicle-scrap-truck-a:crane-truck');
assert.equal(crane.stableAssetId, 'vehicle-scrap-truck-a');
assert.equal(crane.sourceAsset, 'crane-truck');
assert.equal(crane.sourceFamily, 'vehicles');
assert.equal(crane.gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(crane.candidateRole, 'explicit-alternate-static-candidate');
assert.equal(crane.runtimeTrial.variant, 'far');
assert.equal(crane.runtimeTrial.automaticLodSelection, false);
assert.equal(crane.collision.footprint, null);
assert.equal(crane.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineVehicleCandidate(crane.candidateId), crane);

const plan = creationMachineVehicleTrialPlan();
assert.equal(plan.length, 3);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['utility-hauler', 'flatbed-convoy-truck', 'crane-truck']);
for (const candidate of plan) {
  assert.equal(candidate.stableAssetId, 'vehicle-scrap-truck-a');
  assert.equal(candidate.gameplayDefinitionId, 'vehicle:utility-hauler');
  assert.equal(candidate.automaticLodSelection, false);
  assert.equal(candidate.footprint, null);
}

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
assert.match(
  sourceIndex,
  /^flatbed-convoy-truck,vehicles,assets\/flatbed-convoy-truck\/flatbed-convoy-truck\.gltf,assets\/flatbed-convoy-truck\/flatbed-convoy-truck-lod1\.gltf,False,False$/m
);
assert.match(
  sourceIndex,
  /^crane-truck,vehicles,assets\/crane-truck\/crane-truck\.gltf,assets\/crane-truck\/crane-truck-lod1\.gltf,False,False$/m
);

const sourceReadme = fs.readFileSync(new URL('../assets/creation-machine/README.md', import.meta.url), 'utf8');
assert.match(sourceReadme, /83 assets/);
assert.match(sourceReadme, /no new rigs,\s*animations, certified colliders or sockets/i);

console.log(JSON.stringify({
  schema: CREATION_MACHINE_VEHICLE_SET_SCHEMA,
  status: 'PASS',
  stableAssetId: entry.stableAssetId,
  candidates: plan.map(candidate => ({
    candidateId: candidate.candidateId,
    sourceAsset: candidate.sourceAsset,
    candidateRole: candidate.candidateRole,
    gameplayDefinitionId: candidate.gameplayDefinitionId,
    runtimeVariant: candidate.variant,
    automaticLodSelection: candidate.automaticLodSelection,
    footprint: candidate.footprint,
    animationStatus: candidate.animationStatus
  }))
}, null, 2));
