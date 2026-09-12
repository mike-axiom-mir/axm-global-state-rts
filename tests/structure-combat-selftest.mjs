import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCivilizationCombatAuthority } from '../src/sim/combat-authority.mjs';
import { createCombatEquipmentLedger } from '../src/sim/combat-equipment.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createConstructionEconomy } from '../src/sim/construction-economy.mjs';
import { createCombatFormation } from '../src/sim/formation-combat.mjs';
import { createPartyRegistry } from '../src/sim/party-registry.mjs';
import { createRunEconomy } from '../src/sim/run-economy.mjs';
import {
  createAuthoritativeStructureSiegeEncounter,
  createStaticDefenseBattery,
  createStructureSiegeEncounter
} from '../src/sim/structure-combat.mjs';

function createAttacker(id, count = 20) {
  const stockpile = createCivilizationStockpile({ scrap: 100_000, 'industrial-metal': 20_000 });
  const blueprints = createBlueprintLedger();
  blueprints.unlock('weapon:scrap-rifle', { source: 'research', eventId: `${id}:rifle` });
  const manpower = createCivilizationManpower({ civilizationId: id, crewCount: count });
  const equipment = createCombatEquipmentLedger({ civilizationId: id, stockpile, manpower, blueprintLedger: blueprints, runId: `${id}:run` });
  const unitIds = manpower.snapshot().units.map(unit => unit.id);
  for (const unitId of unitIds) {
    assert.equal(manpower.train(unitId, 'rifle-guard', {
      stockpile,
      blueprintLedger: blueprints,
      eventId: `${id}:train:${unitId}`
    }).accepted, true);
  }
  assert.equal(equipment.craft('weapon:scrap-rifle', unitIds.length).accepted, true);
  for (const unitId of unitIds) assert.equal(equipment.equip(unitId, 'weapon:scrap-rifle').accepted, true);
  const parties = createPartyRegistry(unitIds);
  parties.createParty(`${id}:party`);
  parties.assignUnits(`${id}:party`, unitIds);
  return { id, stockpile, blueprints, manpower, equipment, unitIds, parties };
}

function createDefender(id, turretCount = 0) {
  const stockpile = createCivilizationStockpile({
    scrap: 2_000_000,
    stone: 1_000_000,
    timber: 1_000_000,
    'industrial-metal': 1_000_000
  });
  const blueprints = createBlueprintLedger();
  blueprints.unlock('defense:bathtub-turret', { source: 'research', eventId: `${id}:bathtub` });
  blueprints.unlock('defense:comic-book-wall', { source: 'research', eventId: `${id}:comic-wall` });
  const construction = createConstructionEconomy({ civilizationId: id, stockpile, blueprintLedger: blueprints, runId: `${id}:run` });
  assert.equal(construction.construct('building:settlement-core', { instanceId: `${id}:core`, xM: 0, zM: 0 }).accepted, true);
  const turretIds = [];
  for (let index = 0; index < turretCount; index++) {
    const turretId = `${id}:turret-${String(index + 1).padStart(4, '0')}`;
    assert.equal(construction.construct('defense:bathtub-turret', {
      instanceId: turretId,
      xM: 20 + (index % 50) * 4,
      zM: 20 + Math.floor(index / 50) * 4
    }).accepted, true);
    turretIds.push(turretId);
  }
  return { id, stockpile, blueprints, construction, turretIds };
}

// A thousand identical active turrets become one bounded defense packet, not 1000 weapon timers.
const massDefense = createDefender('mass-defense', 1000);
const massBattery = createStaticDefenseBattery({
  id: 'mass-defense:battery',
  construction: massDefense.construction,
  buildingIds: massDefense.turretIds
});
const massPackets = massBattery.attackPackets(1, 100, 1);
assert.equal(massPackets.length, 1);
assert.equal(massPackets[0].sourceCount, 1000);
assert.equal(massPackets[0].workUnits, 1);
assert.equal(massBattery.snapshot().activeCohorts.length, 1);
assert.equal(massBattery.snapshot().activeArmedBuildingCount, 1000);
assert.equal(massBattery.attackPackets(1, 200, 1).length, 0, 'battery cannot fire beyond its profile range');

// A static defense can inflict real named casualties while the formation destroys a continuity building in the same simultaneous tick.
const attacker = createAttacker('siege-attacker', 20);
const defender = createDefender('siege-defender', 1);
const attackerFormation = createCombatFormation({
  id: 'siege-rifle-line',
  memberIds: attacker.unitIds,
  manpower: attacker.manpower,
  equipment: attacker.equipment
});
const defenderKillEconomy = createRunEconomy();
const siege = createStructureSiegeEncounter({
  id: 'core-siege',
  attacker: attackerFormation,
  defenderConstruction: defender.construction,
  targetBuildingId: 'siege-defender:core',
  defendingBuildingIds: defender.turretIds,
  defenderRunEconomy: defenderKillEconomy
});
const attackerAuthority = createCivilizationCombatAuthority({
  civilizationId: attacker.id,
  manpower: attacker.manpower,
  equipment: attacker.equipment,
  partyRegistry: attacker.parties
});
const authoritativeSiege = createAuthoritativeStructureSiegeEncounter({ encounter: siege, attackerAuthority });
const siegeTick = authoritativeSiege.advance(20, {
  distanceM: 120,
  attackerCombatModifier: 1,
  defenderCombatModifier: 1
});
assert.equal(siegeTick.accepted, true);
assert.equal(siegeTick.receipt.attackerPackets, 1, 'rifle formation remains one cohort packet');
assert.equal(siegeTick.receipt.defensePackets, 1, 'one active turret profile remains one defense packet');
assert.equal(siegeTick.receipt.targetDestroyed, true);
assert.equal(siegeTick.receipt.defenderCivilizationDead, true, 'destroying the final continuity building ends the civilization');
assert.equal(defender.construction.snapshot().alive, false);
assert.equal(siegeTick.receipt.attackerCasualties, 1, 'simultaneous turret packet should still land before the core dies');
assert.equal(siegeTick.authority.attacker.receipt.removedCount, 1);
assert.equal(attacker.manpower.snapshot().population, 19);
assert.equal(attacker.parties.snapshot().knownUnitCount, 19);
assert.ok(defenderKillEconomy.snapshot().destroyedEnemyMaterial > 0, 'static defense unit kills feed the existing unit-destruction economy');
assert.equal(defenderKillEconomy.snapshot().rawGold, defenderKillEconomy.snapshot().destroyedEnemyMaterial * 0.01);
assert.equal(defender.construction.canConstruct('building:settlement-core').reason, 'run-already-dead');

// Destroying a non-continuity defense ends that target engagement, not the civilization.
const wallAttacker = createAttacker('turret-breaker', 20);
const turretDefender = createDefender('turret-target', 1);
const turretSiege = createStructureSiegeEncounter({
  id: 'turret-only-siege',
  attacker: createCombatFormation({
    id: 'turret-breaker-line',
    memberIds: wallAttacker.unitIds,
    manpower: wallAttacker.manpower,
    equipment: wallAttacker.equipment
  }),
  defenderConstruction: turretDefender.construction,
  targetBuildingId: turretDefender.turretIds[0],
  defendingBuildingIds: []
});
const turretTick = turretSiege.advance(10, { distanceM: 120 });
assert.equal(turretTick.accepted, true);
assert.equal(turretTick.receipt.targetDestroyed, true);
assert.equal(turretTick.receipt.defenderCivilizationDead, false);
assert.equal(turretDefender.construction.snapshot().alive, true, 'defense spam never becomes a hidden continuity token');
assert.equal(turretDefender.construction.snapshot().buildings.find(building => building.instanceId === turretDefender.turretIds[0]).destroyed, true);

console.log('bounded building and static defense combat selftest: PASS');
