export const LOCAL_CONTINUITY_COMBAT_BRIDGE_SCHEMA = 'axm.global-state-rts.local-continuity-combat-bridge/v0.1';

const CORE_DEFINITION_ID = 'building:settlement-core';
const LOCAL_CORE_MAX_INTEGRITY = 100;
const EPSILON = 1e-9;

function requireInputs(simulation, civilizationGameplay) {
  if (!simulation?.core || !simulation?.snapshot) throw new TypeError('LocalRegionSimulation with physical core required');
  const construction = civilizationGameplay?.construction;
  if (!construction?.snapshot || !construction?.damage || !construction?.definition || !construction?.continuity) {
    throw new TypeError('LocalCivilizationGameplay construction economy required');
  }
  return construction;
}

function syntheticCoreBuilding(simulation, construction) {
  const structural = construction.continuity.building(simulation.core.id);
  const definition = construction.definition(CORE_DEFINITION_ID);
  if (!structural || !definition) return null;
  return Object.freeze({
    instanceId: simulation.core.id,
    definitionId: CORE_DEFINITION_ID,
    category: definition.category,
    continuityEligible: structural.continuityEligible,
    xM: simulation.core.xM,
    zM: simulation.core.zM,
    yawDeg: 0,
    siteFeatureId: null,
    siteFeatureKind: null,
    productionRole: null,
    integrity: structural.integrity,
    maxIntegrity: structural.maxIntegrity,
    destroyed: structural.destroyed,
    source: 'preexisting-local-physical-core'
  });
}

export class LocalContinuityCombatBridge {
  constructor({ simulation, civilizationGameplay } = {}) {
    this.schema = LOCAL_CONTINUITY_COMBAT_BRIDGE_SCHEMA;
    this.simulation = simulation;
    this.civilizationGameplay = civilizationGameplay;
    this.construction = requireInputs(simulation, civilizationGameplay);
    this.coreDefinition = this.construction.definition(CORE_DEFINITION_ID);
    if (!this.coreDefinition) throw new Error(`${CORE_DEFINITION_ID} definition required`);
    this.coreId = String(simulation.core.id || '');
    if (!this.coreId) throw new TypeError('physical LOCAL core id required');
    this.revision = 0;

    const existing = this.construction.continuity.building(this.coreId);
    if (!existing) {
      const adopted = this.construction.continuity.addBuilding({
        id: this.coreId,
        category: this.coreDefinition.category,
        continuityEligible: this.coreDefinition.continuityEligible,
        integrity: simulation.core.integrity,
        maxIntegrity: LOCAL_CORE_MAX_INTEGRITY,
        rebuildable: true
      });
      if (!adopted.accepted) throw new Error(`LOCAL core continuity adoption failed: ${adopted.reason}`);
      this.revision += 1;
    }
    this.syncCoreFromSimulation({ eventId: `local-core-adopt:${this.coreId}` });
  }

  definition(definitionId) {
    return this.construction.definition(definitionId);
  }

  syncCoreFromSimulation({ eventId = null } = {}) {
    const structural = this.construction.continuity.building(this.coreId);
    if (!structural) throw new Error(`LOCAL core continuity missing: ${this.coreId}`);
    const targetIntegrity = Math.max(0, Math.min(structural.maxIntegrity, Number(this.simulation.core.integrity) || 0));
    const delta = targetIntegrity - structural.integrity;
    if (Math.abs(delta) <= EPSILON) {
      return Object.freeze({ accepted: true, changed: false, building: structural, dead: !this.construction.continuity.isAlive() });
    }

    const result = delta < 0
      ? this.construction.continuity.applyDamage(this.coreId, -delta, { eventId: eventId || `local-core-sync-damage:${this.coreId}` })
      : this.construction.continuity.repair(this.coreId, delta, { eventId: eventId || `local-core-sync-repair:${this.coreId}` });
    if (result.accepted && result.changed) this.revision += 1;
    return result;
  }

  damage(instanceId, amount, options = {}) {
    const id = String(instanceId || '');
    if (id !== this.coreId) return this.construction.damage(id, amount, options);
    const result = this.construction.continuity.applyDamage(id, amount, options);
    if (result.accepted && result.changed) {
      const nextIntegrity = result.building?.integrity ?? this.construction.continuity.building(id)?.integrity ?? 0;
      if (Math.abs(this.simulation.core.integrity - nextIntegrity) > EPSILON) {
        this.simulation.core.integrity = nextIntegrity;
        this.simulation.revision += 1;
      }
      this.revision += 1;
    }
    return result;
  }

  snapshot() {
    const base = this.construction.snapshot();
    const core = syntheticCoreBuilding(this.simulation, this.construction);
    const buildings = [...base.buildings];
    if (core && !buildings.some(building => building.instanceId === core.instanceId)) buildings.push(core);
    buildings.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    return Object.freeze({
      schema: LOCAL_CONTINUITY_COMBAT_BRIDGE_SCHEMA,
      civilizationId: base.civilizationId,
      runId: base.runId,
      revision: base.revision + this.revision,
      alive: this.construction.continuity.isAlive(),
      continuity: this.construction.continuity.snapshot(),
      buildings: Object.freeze(buildings),
      physicalCoreId: this.coreId,
      truthBoundary: 'bridges the already-existing physical LOCAL settlement core into the existing CivilizationContinuity/structure-combat path without treating it as a newly purchased build; state remains browser-local and is not host persistence or host death authority'
    });
  }
}

export function createLocalContinuityCombatBridge(options = {}) {
  return new LocalContinuityCombatBridge(options);
}
