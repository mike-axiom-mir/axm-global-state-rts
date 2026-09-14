import { createBlueprintLedger } from './blueprint-ledger.mjs';
import { createCivilizationFoodSystem } from './civilization-food.mjs';
import { createCivilizationManpower } from './civilization-manpower.mjs';
import { createCivilizationStockpile } from './civilization-stockpile.mjs';
import { createCombatEquipmentLedger } from './combat-equipment.mjs';
import { createHourlyDropCache } from './hourly-drop-cache.mjs';
import { createMercenaryReserve } from './mercenary-reserve.mjs';
import { createRunEconomy } from './run-economy.mjs';

export const PLAYER_PROGRESSION_SCHEMA = 'axm.global-state-rts.player-progression/v0.2';
export const CIVILIZATION_RUN_SCHEMA = 'axm.global-state-rts.civilization-run/v0.2';

function nonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${label} must be a positive safe integer`);
  return number;
}

function normalizeResources(resources = {}) {
  const result = {};
  for (const [id, raw] of Object.entries(resources || {})) {
    const value = nonNegative(raw, id);
    if (value > 0) result[id] = value;
  }
  return result;
}

function addResources(a = {}, b = {}) {
  const result = { ...normalizeResources(a) };
  for (const [id, value] of Object.entries(normalizeResources(b))) result[id] = (result[id] || 0) + value;
  return result;
}

function itemCounts(items = []) {
  const counts = new Map();
  for (const raw of items || []) {
    const id = String(raw || '');
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function frozenItemCounts(map) { return Object.freeze(Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))); }

function normalizeClaimRewards(claim, blueprintLedger) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) throw new TypeError('next-drop claim required');
  const runId = String(claim.runId || '').trim();
  if (!runId) throw new TypeError('next-drop claim runId required');
  if (claim.status !== 'claimed') throw new Error('next-drop claim must be in claimed state');
  positiveSafeInteger(claim.claimSerial, 'next-drop claim serial');
  const rewards = claim.rewards && typeof claim.rewards === 'object' && !Array.isArray(claim.rewards)
    ? claim.rewards
    : {};
  const resources = {
    food: nonNegative(rewards.food, 'next-drop claim food'),
    scrap: nonNegative(rewards.scrap, 'next-drop claim scrap')
  };
  const startingItems = [];
  const itemCountMap = rewards.itemCounts && typeof rewards.itemCounts === 'object' && !Array.isArray(rewards.itemCounts)
    ? rewards.itemCounts
    : {};
  for (const [rawItemId, rawCount] of Object.entries(itemCountMap)) {
    const itemId = String(rawItemId || '').trim();
    if (!itemId) throw new TypeError('next-drop claim item id required');
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`next-drop claim item count must be a non-negative safe integer: ${itemId}`);
    for (let index = 0; index < count; index++) startingItems.push(itemId);
  }
  const blueprintIds = Array.isArray(rewards.blueprintIds)
    ? [...new Set(rewards.blueprintIds.map(String))].sort()
    : [];
  for (const blueprintId of blueprintIds) {
    if (!blueprintLedger.definition(blueprintId)) throw new RangeError(`unknown next-drop claim blueprint: ${blueprintId}`);
  }
  return Object.freeze({ runId, resources: Object.freeze(resources), startingItems: Object.freeze(startingItems), blueprintIds: Object.freeze(blueprintIds) });
}

export class CivilizationRun {
  constructor({ runId, civilizationId, blueprintLedger, startingResources = {}, startingItems = [], crewCount = 8, foodPolicy = 'normal', foodPerDestroyedMaterial = 1 } = {}) {
    const id = String(runId || '');
    const civ = String(civilizationId || '');
    if (!id) throw new TypeError('runId required');
    if (!civ) throw new TypeError('civilizationId required');
    if (!blueprintLedger?.has || !blueprintLedger?.unlock || !blueprintLedger?.endRun) throw new TypeError('blueprintLedger required');
    if (!Number.isInteger(crewCount) || crewCount < 1) throw new RangeError('crewCount must be a positive integer');
    this.schema = CIVILIZATION_RUN_SCHEMA;
    this.runId = id;
    this.civilizationId = civ;
    this.blueprints = blueprintLedger;
    this.stockpile = createCivilizationStockpile(startingResources);
    this.manpower = createCivilizationManpower({ civilizationId: civ, crewCount });
    this.equipment = createCombatEquipmentLedger({ civilizationId: civ, stockpile: this.stockpile, manpower: this.manpower, blueprintLedger, runId: id });
    this.food = createCivilizationFoodSystem({ policy: foodPolicy });
    this.economy = createRunEconomy({ foodPerDestroyedMaterial });
    this.startingItems = itemCounts(startingItems);
    this.mercenaryDeployment = Object.freeze({ deployedContracts: 0, deployedUnits: Object.freeze([]) });
    this.closed = false;
    this.revision = 0;
  }

  #assertOpen() { if (this.closed) throw new Error('civilization run is already closed'); }

  recordMercenaryDeployment(deployment) {
    this.#assertOpen();
    this.mercenaryDeployment = Object.freeze({
      deployedContracts: Number(deployment?.deployedContracts || 0),
      deployedUnits: Object.freeze([...(deployment?.deployedUnits || [])])
    });
    if (this.mercenaryDeployment.deployedContracts > 0) this.revision += 1;
    return this.mercenaryDeployment;
  }

  unlockMatchBlueprint(blueprintId, eventId) {
    this.#assertOpen();
    const result = this.blueprints.unlock(blueprintId, { source: 'match-only', runId: this.runId, eventId });
    this.revision += 1;
    return result;
  }

  setFoodPolicy(policyId) { this.#assertOpen(); const result = this.food.setPolicy(policyId); this.revision += 1; return result; }

  trainUnit(unitId, roleId, options = {}) {
    this.#assertOpen();
    const result = this.manpower.train(unitId, roleId, { stockpile: this.stockpile, blueprintLedger: this.blueprints, runId: this.runId, ...options });
    if (result.accepted) this.revision += 1;
    return result;
  }

  licenseUnit(unitId, licenseId, options = {}) {
    this.#assertOpen();
    const result = this.manpower.license(unitId, licenseId, { stockpile: this.stockpile, ...options });
    if (result.accepted) this.revision += 1;
    return result;
  }

  assignVehicle(unitId, options = {}) { this.#assertOpen(); const result = this.manpower.assignVehicle(unitId, options); if (result.accepted) this.revision += 1; return result; }

  craftWeapon(weaponId, count = 1, options = {}) { this.#assertOpen(); const result = this.equipment.craft(weaponId, count, options); if (result.accepted) this.revision += 1; return result; }
  equipUnit(unitId, weaponId, options = {}) { this.#assertOpen(); const result = this.equipment.equip(unitId, weaponId, options); if (result.accepted) this.revision += 1; return result; }

  advanceFood(deltaSeconds, options = {}) {
    this.#assertOpen();
    const result = this.food.advance(deltaSeconds, { population: this.manpower.units.size, stockpile: this.stockpile, ...options });
    this.revision += 1;
    return result;
  }

  recordEnemyMaterialDestroyed(materialValue) {
    this.#assertOpen();
    const result = this.economy.recordEnemyMaterialDestroyed(materialValue);
    if (result.food > 0) this.stockpile.credit({ food: result.food }, { reason: 'combat-destruction-food', eventId: `combat-food:${this.economy.revision}` });
    this.revision += 1;
    return result;
  }

  recordGlobalControlPercent(percent) { this.#assertOpen(); const result = this.economy.recordGlobalControlPercent(percent); this.revision += 1; return result; }
  recordTerritoryLedger(territoryLedger, ownerId = this.civilizationId) { this.#assertOpen(); const result = this.economy.recordTerritoryLedger(territoryLedger, ownerId); this.revision += 1; return result; }

  close() {
    this.#assertOpen();
    const economy = this.economy.closeRun();
    this.blueprints.endRun(this.runId);
    this.closed = true;
    this.revision += 1;
    return Object.freeze({ runId: this.runId, civilizationId: this.civilizationId, finalGold: economy.finalGold, peakGlobalControlPercent: economy.peakGlobalControlPercent, destroyedEnemyMaterial: economy.destroyedEnemyMaterial, snapshot: this.snapshot() });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_RUN_SCHEMA, runId: this.runId, civilizationId: this.civilizationId, revision: this.revision, closed: this.closed,
      stockpile: this.stockpile.snapshot(), food: this.food.snapshot(), manpower: this.manpower.snapshot(), equipment: this.equipment.snapshot(),
      blueprints: this.blueprints.snapshot({ runId: this.runId }), startingItems: frozenItemCounts(this.startingItems), mercenaryDeployment: this.mercenaryDeployment,
      economy: this.economy.snapshot()
    });
  }
}

export class PlayerProgression {
  constructor({ playerId, playerSeed = null, cacheAnchorMs = 0, baseStartingResources = {}, baseCrewCount = 8 } = {}) {
    const id = String(playerId || '');
    if (!id) throw new TypeError('playerId required');
    if (!Number.isInteger(baseCrewCount) || baseCrewCount < 1) throw new RangeError('baseCrewCount must be a positive integer');
    this.schema = PLAYER_PROGRESSION_SCHEMA;
    this.playerId = id;
    this.playerSeed = String(playerSeed || id);
    this.baseStartingResources = Object.freeze(normalizeResources(baseStartingResources));
    this.baseCrewCount = baseCrewCount;
    this.blueprints = createBlueprintLedger();
    this.dropCache = createHourlyDropCache({ playerSeed: this.playerSeed, anchorMs: cacheAnchorMs });
    this.dropReserveResources = {};
    this.dropReserveItems = new Map();
    this.bankedGold = 0;
    this.activeRun = null;
    this.runHistory = [];
    this.revision = 0;
    this.mercenaryReserve = createMercenaryReserve({ playerProgression: this });
  }

  accrueDropCaches(nowMs) { const result = this.dropCache.accrue(nowMs); if (result.added > 0 || result.discardedByCap > 0) this.revision += 1; return result; }

  openDropCaches(count = 1) {
    if (this.activeRun) return Object.freeze({ accepted: false, reason: 'drop-reserve-only-between-runs', opened: Object.freeze([]) });
    const result = this.dropCache.open(count, { blueprintLedger: this.blueprints });
    if (!result.accepted) return result;
    for (const crate of result.opened) {
      this.dropReserveResources.food = (this.dropReserveResources.food || 0) + crate.food;
      this.dropReserveResources.scrap = (this.dropReserveResources.scrap || 0) + crate.scrap;
      for (const itemId of crate.startingItems) this.dropReserveItems.set(itemId, (this.dropReserveItems.get(itemId) || 0) + 1);
    }
    this.revision += 1;
    return Object.freeze({ ...result, reserve: this.dropReserveSnapshot() });
  }

  rentMercenaryContract(contractId, count = 1) {
    const result = this.mercenaryReserve.rent(contractId, count);
    if (result.accepted) this.revision += 1;
    return result;
  }

  unlockResearchBlueprint(blueprintId, eventId) { const result = this.blueprints.unlock(blueprintId, { source: 'research', eventId }); this.revision += 1; return result; }
  unlockQuestBlueprint(blueprintId, eventId) { const result = this.blueprints.unlock(blueprintId, { source: 'quest', eventId }); this.revision += 1; return result; }

  beginRun(runId, { crewCount = this.baseCrewCount, foodPolicy = 'normal', extraStartingResources = {}, startingItems = [] } = {}) {
    const id = String(runId || '').trim();
    if (!id) throw new TypeError('runId required');
    if (this.activeRun && !this.activeRun.closed) throw new Error('cannot begin a second run while one is active');
    if (this.runHistory.some(entry => entry.runId === id)) throw new Error(`run id already used: ${id}`);
    const runResources = addResources(addResources(this.baseStartingResources, this.dropReserveResources), extraStartingResources);
    const runItems = [];
    for (const [itemId, count] of this.dropReserveItems) for (let i = 0; i < count; i++) runItems.push(itemId);
    runItems.push(...startingItems.map(String));
    this.dropReserveResources = {};
    this.dropReserveItems.clear();
    this.activeRun = new CivilizationRun({ runId: id, civilizationId: this.playerId, blueprintLedger: this.blueprints, startingResources: runResources, startingItems: runItems, crewCount, foodPolicy });
    const deployment = this.mercenaryReserve.deployIntoRun(this.activeRun);
    this.activeRun.recordMercenaryDeployment(deployment);
    this.revision += 1;
    return this.activeRun;
  }

  beginRunFromNextDropClaim(claim, options = {}) {
    const normalized = normalizeClaimRewards(claim, this.blueprints);
    if (this.activeRun && !this.activeRun.closed) throw new Error('cannot begin a second run while one is active');
    if (this.runHistory.some(entry => entry.runId === normalized.runId)) throw new Error(`run id already used: ${normalized.runId}`);
    const {
      extraStartingResources = {},
      startingItems = [],
      ...runOptions
    } = options || {};
    const run = this.beginRun(normalized.runId, {
      ...runOptions,
      extraStartingResources: addResources(extraStartingResources, normalized.resources),
      startingItems: [...normalized.startingItems, ...startingItems.map(String)]
    });
    for (const blueprintId of normalized.blueprintIds) {
      this.blueprints.unlock(blueprintId, {
        source: 'rng-cache',
        eventId: `next-drop-claim:${claim.claimSerial}:${normalized.runId}:${blueprintId}`
      });
    }
    return run;
  }

  closeActiveRun() {
    if (!this.activeRun || this.activeRun.closed) throw new Error('no open run to close');
    const result = this.activeRun.close();
    this.bankedGold += result.finalGold;
    this.runHistory.push(Object.freeze({ runId: result.runId, finalGold: result.finalGold, peakGlobalControlPercent: result.peakGlobalControlPercent, destroyedEnemyMaterial: result.destroyedEnemyMaterial }));
    this.activeRun = null;
    this.revision += 1;
    return Object.freeze({ ...result, bankedGold: this.bankedGold });
  }

  spendBankedGold(amount, { reason = 'gold-spend' } = {}) {
    const value = nonNegative(amount, 'amount');
    if (value <= 0) throw new RangeError('amount must be greater than zero');
    if (value > this.bankedGold + 1e-9) return Object.freeze({ accepted: false, reason: 'insufficient-banked-gold', bankedGold: this.bankedGold });
    this.bankedGold -= value;
    this.revision += 1;
    return Object.freeze({ accepted: true, amount: value, reason: String(reason), bankedGold: this.bankedGold });
  }

  dropReserveSnapshot() { return Object.freeze({ resources: Object.freeze({ ...this.dropReserveResources }), items: frozenItemCounts(this.dropReserveItems) }); }

  snapshot() {
    return Object.freeze({
      schema: PLAYER_PROGRESSION_SCHEMA, playerId: this.playerId, revision: this.revision, bankedGold: this.bankedGold,
      blueprints: this.blueprints.snapshot({ runId: this.activeRun?.runId || null }), dropCache: this.dropCache.snapshot(), dropReserve: this.dropReserveSnapshot(),
      mercenaryReserve: this.mercenaryReserve.snapshot(), activeRun: this.activeRun?.snapshot() || null, runHistory: Object.freeze([...this.runHistory])
    });
  }
}

export function createPlayerProgression(options = {}) { return new PlayerProgression(options); }
