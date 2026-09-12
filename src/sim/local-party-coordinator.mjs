import { createPartyRegistry, PARTY_REGISTRY_SCHEMA } from './party-registry.mjs';
import { createLocalRoutePlanner, LOCAL_ROUTE_PLAN_SCHEMA } from '../world/local-route-planner.mjs';
import { STARTER_REGION_SCHEMA } from '../world/starter-region.mjs';

export const LOCAL_PARTY_COORDINATOR_SCHEMA = 'axm.global-state-rts.local-party-coordinator/v0.1';

export class LocalPartyCoordinator {
  constructor(region, unitIds = [], {
    registry = null,
    routePlanner = null
  } = {}) {
    if (!region || region.schema !== STARTER_REGION_SCHEMA) throw new TypeError('starter region required');
    this.schema = LOCAL_PARTY_COORDINATOR_SCHEMA;
    this.region = region;
    this.registry = registry || createPartyRegistry(unitIds);
    if (!this.registry || this.registry.schema !== PARTY_REGISTRY_SCHEMA) throw new TypeError('valid party registry required');
    this.routePlanner = routePlanner || createLocalRoutePlanner(region);
    if (!this.routePlanner || typeof this.routePlanner.plan !== 'function') throw new TypeError('routePlanner with plan() required');
    this.revision = 0;
  }

  createParty(id, options = {}) {
    const party = this.registry.createParty(id, options);
    this.revision += 1;
    return party;
  }

  assignUnits(partyId, unitIds) {
    const party = this.registry.assignUnits(partyId, unitIds);
    this.revision += 1;
    return party;
  }

  issueMove(partyId, {
    from,
    target,
    mode = 'foot'
  } = {}) {
    const party = this.registry.party(partyId);
    if (!party) throw new RangeError(`unknown party: ${partyId}`);
    if (party.unitIds.length === 0) return Object.freeze({ accepted: false, reason: 'party-empty' });
    const route = this.routePlanner.plan(from, target, { mode });
    if (!route || route.schema !== LOCAL_ROUTE_PLAN_SCHEMA) throw new TypeError('routePlanner returned an invalid route plan');
    if (!route.reachable) {
      return Object.freeze({ accepted: false, reason: route.reason || 'route-unreachable', route });
    }

    const command = this.registry.commandParty(partyId, {
      type: 'move-route',
      mode,
      target: { xM: target.xM, zM: target.zM },
      route: {
        estimatedCostM: route.estimatedCostM,
        waypoints: route.waypoints
      }
    });
    this.revision += 1;
    return Object.freeze({
      accepted: command.accepted,
      partyId,
      commandedUnitCount: party.unitIds.length,
      route,
      party: command.party
    });
  }

  issuePolicy(partyId, policy) {
    const command = this.registry.commandParty(partyId, {
      type: 'policy',
      policy: structuredClone(policy)
    });
    if (command.accepted) this.revision += 1;
    return command;
  }

  snapshot() {
    return Object.freeze({
      schema: LOCAL_PARTY_COORDINATOR_SCHEMA,
      revision: this.revision,
      regionId: this.region.id,
      registry: this.registry.snapshot()
    });
  }
}

export function createLocalPartyCoordinator(region, unitIds = [], options = {}) {
  return new LocalPartyCoordinator(region, unitIds, options);
}
