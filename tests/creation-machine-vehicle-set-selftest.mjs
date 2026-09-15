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

assert.equal(CREATION_MACHINE_VEHICLE_SET_SCHEMA, 'axm.global-state-rts.creation-machine-vehicle-static-set/v0.2');
assert.equal(CREATION_MACHINE_VEHICLE_SET.length, 2);

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

const alternate = creationMachineVehicleSetEntry('vehicle-scrap-truck-a', 'flatbed-convoy-truck');
assert.ok(alternate);
assert.equal(alternate.candidateId, 'vehicle-scrap-truck-a:flatbed-convoy-truck');
assert.equal(alternate.stableAssetId, 'vehicle-scrap-truck-a');
assert.equal(alternate.sourceAsset, 'flatbed-convoy-truck');
assert.equal(alternate.sourceFamily, 'vehicles');
assert.equal(alternate.gameplayDefinitionId, 'vehicle:utility-hauler');
assert.equal(alternate.candidateRole, 'explicit-alternate-static-candidate');
assert.equal(alternate.runtimeTrial.variant, 'far');
assert.equal(alternate.runtimeTrial.automaticLodSelection, false);
assert.equal(alternate.collision.footprint, null);
assert.equal(alternate.animation.status, 'HANDOFF_LATER');
assert.equal(creationMachineVehicleCandidate(alternate.candidateId), alternate);

const plan = creationMachineVehicleTrialPlan();
assert.equal(plan.length, 2);
assert.deepEqual(plan.map(candidate => candidate.sourceAsset), ['utility-hauler', 'flatbed-convoy-truck']);
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