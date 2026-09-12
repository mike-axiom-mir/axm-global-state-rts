import assert from 'node:assert/strict';
import { createPlayerProgression } from '../src/sim/civilization-progression.mjs';

const progression = createPlayerProgression({
  playerId: 'mercenary-player',
  baseStartingResources: { food: 1000, scrap: 1000, 'industrial-metal': 100 }
});

// Earn persistent gold from a doomed run first; contracts cannot be bought from the live run stockpile.
const earningRun = progression.beginRun('earning-run');
earningRun.recordEnemyMaterialDestroyed(1_000_000); // 10,000 raw gold at the existing 1% share.
const cannotRentWhileAlive = progression.rentMercenaryContract('mercenary:lone-rifle');
assert.equal(cannotRentWhileAlive.accepted, false);
assert.equal(cannotRentWhileAlive.reason, 'mercenaries-rent-between-runs-only');
const earningClose = progression.closeActiveRun();
assert.equal(earningClose.bankedGold, 10_000);

const lone = progression.rentMercenaryContract('mercenary:lone-rifle');
assert.equal(lone.accepted, true);
assert.equal(lone.receipt.totalGold, 750);
const pair = progression.rentMercenaryContract('mercenary:scout-pair');
assert.equal(pair.accepted, true);
assert.equal(pair.receipt.totalGold, 1800);
assert.equal(progression.snapshot().bankedGold, 7450);
assert.equal(progression.snapshot().mercenaryReserve.pendingContractCount, 2);
assert.equal(progression.snapshot().mercenaryReserve.pendingUnitCount, 3);

const deploymentRun = progression.beginRun('deployment-run');
assert.equal(progression.snapshot().mercenaryReserve.pendingContractCount, 0, 'rented contracts are consumed by the next drop');
assert.equal(deploymentRun.snapshot().mercenaryDeployment.deployedContracts, 2);
assert.equal(deploymentRun.snapshot().mercenaryDeployment.deployedUnits.length, 3);
assert.equal(deploymentRun.manpower.snapshot().population, 11, '8 ordinary Crew + 3 contracted mercenaries');
assert.equal(deploymentRun.manpower.snapshot().roleCounts.crew, 8, 'mercenaries do not rewrite the ordinary Crew start rule');
assert.equal(deploymentRun.manpower.snapshot().roleCounts['rifle-guard'], 1);
assert.equal(deploymentRun.manpower.snapshot().roleCounts.scout, 2);

const mercenaryUnits = deploymentRun.manpower.snapshot().units.filter(unit => unit.provenance?.source === 'mercenary-contract');
assert.equal(mercenaryUnits.length, 3);
assert.deepEqual([...new Set(mercenaryUnits.map(unit => unit.provenance.contractId))].sort(), ['mercenary:lone-rifle', 'mercenary:scout-pair']);
for (const unit of mercenaryUnits) {
  const loadout = deploymentRun.equipment.unitLoadout(unit.id);
  assert.ok(loadout.weaponId, 'contracted unit arrives with its paid contract loadout');
  assert.ok(loadout.totalMaterialValue > 0, 'mercenary still carries real material value when killed');
}

// The contract is an explicit external-provenance exception, not a permanent blueprint/stat shortcut.
const ordinaryCrewId = deploymentRun.manpower.snapshot().units.find(unit => unit.role === 'crew').id;
const ordinaryRifleTraining = deploymentRun.trainUnit(ordinaryCrewId, 'rifle-guard', { eventId: 'ordinary-rifle-attempt' });
assert.equal(ordinaryRifleTraining.accepted, false);
assert.equal(ordinaryRifleTraining.reason, 'required-blueprint-unavailable');
const mercSwitch = deploymentRun.trainUnit(mercenaryUnits[0].id, 'citizen', { eventId: 'mercenary-respecialize-attempt' });
assert.equal(mercSwitch.accepted, false);
assert.equal(mercSwitch.reason, 'specialization-is-irreversible');

const duringDrop = progression.rentMercenaryContract('mercenary:assault-five');
assert.equal(duringDrop.accepted, false, 'gold reserve cannot inject mercenaries into a fight already in progress');
progression.closeActiveRun();

// Saved gold can stack across runs and be deliberately spent on a much larger push later.
const assault = progression.rentMercenaryContract('mercenary:assault-five');
assert.equal(assault.accepted, true);
assert.equal(assault.receipt.totalGold, 4800);
const assaultDrop = progression.beginRun('assault-drop');
assert.equal(assaultDrop.snapshot().mercenaryDeployment.deployedUnits.length, 5);
assert.equal(assaultDrop.manpower.snapshot().population, 13);
assert.equal(assaultDrop.manpower.snapshot().roleCounts['rifle-guard'], 3);
assert.equal(assaultDrop.manpower.snapshot().roleCounts['shotgun-raider'], 1);
assert.equal(assaultDrop.manpower.snapshot().roleCounts.medic, 1);
assert.equal(assaultDrop.equipment.snapshot().loadouts.length, 5);

console.log('banked-gold next-drop mercenary reserve selftest: PASS');
