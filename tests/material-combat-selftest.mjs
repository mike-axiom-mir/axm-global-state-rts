import assert from 'node:assert/strict';
import { createBlueprintLedger } from '../src/sim/blueprint-ledger.mjs';
import { createCombatEquipmentLedger } from '../src/sim/combat-equipment.mjs';
import { createCivilizationManpower } from '../src/sim/civilization-manpower.mjs';
import { createCivilizationStockpile } from '../src/sim/civilization-stockpile.mjs';
import { createCombatEncounter, createCombatFormation } from '../src/sim/formation-combat.mjs';
import { createRunEconomy } from '../src/sim/run-economy.mjs';

function createSide(id, count = 8) {
  const stockpile = createCivilizationStockpile({ scrap: 20_000, 'industrial-metal': 5000 });
  const blueprints = createBlueprintLedger();
  blueprints.unlock('weapon:scrap-rifle', { source: 'research', eventId: `${id}:rifle-research` });
  blueprints.unlock('weapon:pipe-shotgun', { source: 'research', eventId: `${id}:shotgun-research` });
  const manpower = createCivilizationManpower({ civilizationId: id, crewCount: count });
  const equipment = createCombatEquipmentLedger({
    civilizationId: id,
    stockpile,
    manpower,
    blueprintLedger: blueprints,
    runId: `${id}:run`
  });
  return { stockpile, blueprints, manpower, equipment };
}

const attackerSide = createSide('attackers', 8);
const defenderSide = createSide('defenders', 8);
const attackerIds = attackerSide.manpower.snapshot().units.map(unit => unit.id);
const defenderIds = defenderSide.manpower.snapshot().units.map(unit => unit.id);

for (const unitId of attackerIds) {
  const trained = attackerSide.manpower.train(unitId, 'rifle-guard', {
    stockpile: attackerSide.stockpile,
    blueprintLedger: attackerSide.blueprints,
    eventId: `train:${unitId}`
  });
  assert.equal(trained.accepted, true);
}
for (const unitId of defenderIds) {
  const trained = defenderSide.manpower.train(unitId, 'shotgun-raider', {
    stockpile: defenderSide.stockpile,
    blueprintLedger: defenderSide.blueprints,
    eventId: `train:${unitId}`
  });
  assert.equal(trained.accepted, true);
}

assert.equal(attackerSide.equipment.craft('weapon:scrap-rifle', attackerIds.length).accepted, true);
assert.equal(defenderSide.equipment.craft('weapon:pipe-shotgun', defenderIds.length).accepted, true);
for (const unitId of attackerIds) assert.equal(attackerSide.equipment.equip(unitId, 'weapon:scrap-rifle').accepted, true);
for (const unitId of defenderIds) assert.equal(defenderSide.equipment.equip(unitId, 'weapon:pipe-shotgun').accepted, true);

const attackerFormation = createCombatFormation({ id: 'rifle-line', memberIds: attackerIds, manpower: attackerSide.manpower, equipment: attackerSide.equipment });
const defenderFormation = createCombatFormation({ id: 'shotgun-line', memberIds: defenderIds, manpower: defenderSide.manpower, equipment: defenderSide.equipment });
assert.equal(attackerFormation.snapshot().activeCohorts, 1);
assert.equal(defenderFormation.snapshot().activeCohorts, 1);
assert.ok(attackerFormation.snapshot().remainingMaterialValue > 0);
assert.ok(defenderFormation.snapshot().remainingMaterialValue > 0);

const attackerEconomy = createRunEconomy();
const defenderEconomy = createRunEconomy();
const rangedEncounter = createCombatEncounter({
  id: 'range-test',
  attacker: attackerFormation,
  defender: defenderFormation,
  attackerRunEconomy: attackerEconomy,
  defenderRunEconomy: defenderEconomy
});

let firstCasualtyReceipt = null;
for (let i = 0; i < 20 && !rangedEncounter.closed; i++) {
  const tick = rangedEncounter.advance(2, {
    distanceM: 120,
    attackerCombatModifier: 1.1,
    defenderCombatModifier: 1.1
  });
  assert.equal(tick.accepted, true);
  assert.equal(tick.receipt.attackerPackets, 1, 'eight rifle units resolve as one rifle cohort packet');
  assert.equal(tick.receipt.defenderPackets, 0, 'shotguns cannot return fire outside their range');
  if (tick.receipt.defenderCasualties > 0 && !firstCasualtyReceipt) firstCasualtyReceipt = tick.receipt;
}
assert.ok(firstCasualtyReceipt, 'ranged formation should eventually destroy material');
assert.ok(attackerEconomy.snapshot().destroyedEnemyMaterial > 0);
assert.equal(defenderEconomy.snapshot().destroyedEnemyMaterial, 0);
assert.ok(attackerEconomy.snapshot().rawGold > 0);
assert.ok(Math.abs(attackerEconomy.snapshot().rawGold - attackerEconomy.snapshot().destroyedEnemyMaterial * 0.01) < 1e-9);
assert.ok(Math.abs(attackerEconomy.snapshot().foodFromDestruction - attackerEconomy.snapshot().destroyedEnemyMaterial * 0.99) < 1e-9);

// Food/combat policy modifier must matter without creating a separate combat authority path.
const modifierA = createSide('modifier-a', 4);
const modifierB = createSide('modifier-b', 4);
const aIds = modifierA.manpower.snapshot().units.map(unit => unit.id);
const bIds = modifierB.manpower.snapshot().units.map(unit => unit.id);
for (const [side, ids] of [[modifierA, aIds], [modifierB, bIds]]) {
  for (const id of ids) {
    side.manpower.train(id, 'rifle-guard', { stockpile: side.stockpile, blueprintLedger: side.blueprints, eventId: `train:${id}` });
  }
  side.equipment.craft('weapon:scrap-rifle', ids.length);
  for (const id of ids) side.equipment.equip(id, 'weapon:scrap-rifle');
}
const equalA = createCombatFormation({ id: 'well-fed-side', memberIds: aIds, manpower: modifierA.manpower, equipment: modifierA.equipment });
const equalB = createCombatFormation({ id: 'ration-side', memberIds: bIds, manpower: modifierB.manpower, equipment: modifierB.equipment });
const closeEncounter = createCombatEncounter({ id: 'food-modifier-test', attacker: equalA, defender: equalB });
const closeTick = closeEncounter.advance(10, { distanceM: 100, attackerCombatModifier: 1.1, defenderCombatModifier: 0.9 });
assert.equal(closeTick.receipt.attackerPackets, 1);
assert.equal(closeTick.receipt.defenderPackets, 1);
assert.ok(closeTick.receipt.defenderCasualties >= closeTick.receipt.attackerCasualties, 'higher combat modifier cannot create less deterministic damage in an equal matchup');

// A thousand remote/local macro members should still produce one cohort attack packet, not one thousand attack ticks.
const massStockpile = createCivilizationStockpile({});
const massBlueprints = createBlueprintLedger();
const massManpower = createCivilizationManpower({ civilizationId: 'mass', crewCount: 1000 });
const massEquipment = createCombatEquipmentLedger({
  civilizationId: 'mass', stockpile: massStockpile, manpower: massManpower, blueprintLedger: massBlueprints
});
const massFormation = createCombatFormation({
  id: 'mass-unarmed',
  memberIds: massManpower.snapshot().units.map(unit => unit.id),
  manpower: massManpower,
  equipment: massEquipment
});
assert.equal(massFormation.snapshot().activeCohorts, 1);
assert.equal(massFormation.attackPackets(1, 2, 1).length, 1, '1000 same-loadout members collapse into one combat cohort packet');
assert.equal(massFormation.attackPackets(1, 50, 1).length, 0, 'unarmed cohort has no hidden ranged attack');

console.log('material-backed bounded formation combat selftest: PASS');
