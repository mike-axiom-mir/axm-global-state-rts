export const OFFLINE_GUARDIAN_SCHEMA = 'axm.global-state-rts.offline-guardian/v0.1';
export const OFFLINE_GUARDIAN_STATE_SCHEMA = 'axm.global-state-rts.offline-civilization/v0.1';

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function sortedIds(buildings) {
  return [...buildings.map(building => String(building.id))].sort();
}

export function createOfflineCivilizationState({
  id,
  food = 0,
  materials = 0,
  population = 1,
  defenseUnits = 0,
  authorizedDefenseCap = defenseUnits,
  foodIncomePerSecond = 0,
  materialIncomePerSecond = 0,
  researchDirection = null,
  territoryRevision = 0,
  buildings = []
} = {}) {
  const civilizationId = String(id || '');
  if (!civilizationId) throw new RangeError('id required');
  finiteNonNegative(food, 'food');
  finiteNonNegative(materials, 'materials');
  if (!Number.isInteger(population) || population <= 0) throw new RangeError('population must be a positive integer');
  if (!Number.isInteger(defenseUnits) || defenseUnits < 0) throw new RangeError('defenseUnits must be a non-negative integer');
  if (!Number.isInteger(authorizedDefenseCap) || authorizedDefenseCap < defenseUnits) throw new RangeError('authorizedDefenseCap must be >= defenseUnits');
  finiteNonNegative(foodIncomePerSecond, 'foodIncomePerSecond');
  finiteNonNegative(materialIncomePerSecond, 'materialIncomePerSecond');
  if (!Number.isInteger(territoryRevision) || territoryRevision < 0) throw new RangeError('territoryRevision must be a non-negative integer');
  if (!Array.isArray(buildings)) throw new TypeError('buildings must be an array');

  const seen = new Set();
  const normalizedBuildings = buildings.map((building, index) => {
    const buildingId = String(building?.id || '');
    if (!buildingId) throw new RangeError(`buildings[${index}].id required`);
    if (seen.has(buildingId)) throw new Error(`duplicate building id: ${buildingId}`);
    seen.add(buildingId);
    const integrity = Number(building.integrity ?? 100);
    finiteNonNegative(integrity, `buildings[${index}].integrity`);
    if (integrity > 100) throw new RangeError('building integrity cannot exceed 100');
    const rebuildMaterialCost = Number(building.rebuildMaterialCost ?? 100);
    finiteNonNegative(rebuildMaterialCost, `buildings[${index}].rebuildMaterialCost`);
    return {
      id: buildingId,
      kind: String(building.kind || 'utility'),
      integrity,
      active: building.active !== false && integrity > 0,
      rebuildMaterialCost,
      repairMaterialPerIntegrity: Number(building.repairMaterialPerIntegrity ?? 1),
      defensive: Boolean(building.defensive),
      resource: Boolean(building.resource),
      continuity: Boolean(building.continuity)
    };
  });

  return freezeDeep({
    schema: OFFLINE_GUARDIAN_STATE_SCHEMA,
    id: civilizationId,
    food,
    materials,
    population,
    defenseUnits,
    authorizedDefenseCap,
    foodIncomePerSecond,
    materialIncomePerSecond,
    researchDirection: researchDirection === null ? null : clone(researchDirection),
    territoryRevision,
    buildings: normalizedBuildings,
    guardianRevision: 0
  });
}

export class OfflineGuardian {
  constructor(initialState, {
    foodPerPersonPerSecond = 1 / 86400,
    defenseFoodMultiplier = 0.25,
    defenseMaterialCost = 4,
    defenseFoodCost = 1.5,
    maxDefenseTrainingPerSecond = 0.15,
    maxRepairIntegrityPerSecond = 0.025
  } = {}) {
    if (!initialState || initialState.schema !== OFFLINE_GUARDIAN_STATE_SCHEMA) throw new TypeError('valid offline civilization state required');
    finiteNonNegative(foodPerPersonPerSecond, 'foodPerPersonPerSecond');
    finiteNonNegative(defenseFoodMultiplier, 'defenseFoodMultiplier');
    finiteNonNegative(defenseMaterialCost, 'defenseMaterialCost');
    finiteNonNegative(defenseFoodCost, 'defenseFoodCost');
    finiteNonNegative(maxDefenseTrainingPerSecond, 'maxDefenseTrainingPerSecond');
    finiteNonNegative(maxRepairIntegrityPerSecond, 'maxRepairIntegrityPerSecond');

    this.schema = OFFLINE_GUARDIAN_SCHEMA;
    this.state = clone(initialState);
    this.allowedBuildingIds = Object.freeze(sortedIds(initialState.buildings));
    this.researchAnchor = JSON.stringify(initialState.researchDirection);
    this.territoryAnchor = initialState.territoryRevision;
    this.authorizedDefenseCap = initialState.authorizedDefenseCap;
    this.tuning = Object.freeze({
      foodPerPersonPerSecond,
      defenseFoodMultiplier,
      defenseMaterialCost,
      defenseFoodCost,
      maxDefenseTrainingPerSecond,
      maxRepairIntegrityPerSecond
    });
  }

  #assertConstitutionalBounds() {
    const stateIds = sortedIds(this.state.buildings);
    if (stateIds.join('|') !== this.allowedBuildingIds.join('|')) throw new Error('guardian may not create or remove strategic building identities');
    if (JSON.stringify(this.state.researchDirection) !== this.researchAnchor) throw new Error('guardian may not change research direction');
    if (this.state.territoryRevision !== this.territoryAnchor) throw new Error('guardian may not claim or release territory');
    if (this.state.authorizedDefenseCap !== this.authorizedDefenseCap) throw new Error('guardian may not raise authorized defense cap');
    if (this.state.defenseUnits > this.authorizedDefenseCap) throw new Error('guardian defense force exceeded authorized cap');
  }

  applyDamage({
    buildingDamage = {},
    defenseLosses = 0
  } = {}) {
    if (!buildingDamage || typeof buildingDamage !== 'object' || Array.isArray(buildingDamage)) throw new TypeError('buildingDamage must be an object');
    if (!Number.isInteger(defenseLosses) || defenseLosses < 0) throw new RangeError('defenseLosses must be a non-negative integer');
    for (const building of this.state.buildings) {
      const damage = Number(buildingDamage[building.id] || 0);
      finiteNonNegative(damage, `damage:${building.id}`);
      if (damage <= 0) continue;
      building.integrity = Math.max(0, building.integrity - damage);
      building.active = building.integrity > 0;
    }
    this.state.defenseUnits = Math.max(0, this.state.defenseUnits - defenseLosses);
    this.state.guardianRevision += 1;
    this.#assertConstitutionalBounds();
    return this.snapshot();
  }

  advance(deltaSeconds) {
    finiteNonNegative(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds === 0) return Object.freeze({ snapshot: this.snapshot(), actions: Object.freeze([]) });
    const actions = [];

    this.state.food += this.state.foodIncomePerSecond * deltaSeconds;
    this.state.materials += this.state.materialIncomePerSecond * deltaSeconds;

    const foodNeeded = (
      this.state.population + this.state.defenseUnits * this.tuning.defenseFoodMultiplier
    ) * this.tuning.foodPerPersonPerSecond * deltaSeconds;
    const foodConsumed = Math.min(this.state.food, foodNeeded);
    this.state.food -= foodConsumed;
    const shortage = foodNeeded > 0 ? Math.max(0, 1 - foodConsumed / foodNeeded) : 0;

    for (const building of this.state.buildings) {
      if (building.active && building.integrity < 100 && this.state.materials > 0) {
        const missing = 100 - building.integrity;
        const maxByTime = this.tuning.maxRepairIntegrityPerSecond * deltaSeconds;
        const maxByMaterials = this.state.materials / Math.max(1e-9, building.repairMaterialPerIntegrity);
        const repaired = Math.min(missing, maxByTime, maxByMaterials);
        if (repaired > 0) {
          building.integrity += repaired;
          this.state.materials -= repaired * building.repairMaterialPerIntegrity;
          actions.push(Object.freeze({ type: 'repair-existing', buildingId: building.id, integrityRestored: repaired }));
        }
      }
    }

    if (shortage < 0.20) {
      for (const building of this.state.buildings) {
        if (building.active || building.integrity > 0) continue;
        if (this.state.materials < building.rebuildMaterialCost) continue;
        this.state.materials -= building.rebuildMaterialCost;
        building.integrity = 25;
        building.active = true;
        actions.push(Object.freeze({ type: 'rebuild-existing', buildingId: building.id }));
      }
    }

    if (shortage < 0.12 && this.state.defenseUnits < this.authorizedDefenseCap) {
      const needed = this.authorizedDefenseCap - this.state.defenseUnits;
      const byTime = Math.floor(this.tuning.maxDefenseTrainingPerSecond * deltaSeconds);
      const byMaterials = Math.floor(this.state.materials / Math.max(1e-9, this.tuning.defenseMaterialCost));
      const byFood = Math.floor(this.state.food / Math.max(1e-9, this.tuning.defenseFoodCost));
      const restored = Math.max(0, Math.min(needed, byTime, byMaterials, byFood));
      if (restored > 0) {
        this.state.defenseUnits += restored;
        this.state.materials -= restored * this.tuning.defenseMaterialCost;
        this.state.food -= restored * this.tuning.defenseFoodCost;
        actions.push(Object.freeze({ type: 'restore-authorized-defense', units: restored }));
      }
    }

    this.state.guardianRevision += 1;
    this.#assertConstitutionalBounds();
    return Object.freeze({
      snapshot: this.snapshot(),
      shortage,
      actions: Object.freeze(actions)
    });
  }

  snapshot() {
    this.#assertConstitutionalBounds();
    return freezeDeep(clone(this.state));
  }
}

export function createOfflineGuardian(initialState, options = {}) {
  return new OfflineGuardian(initialState, options);
}
