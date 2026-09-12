import { CIVILIZATION_STOCKPILE_SCHEMA } from './civilization-stockpile.mjs';
import { LOCAL_INFRASTRUCTURE_SCHEMA } from '../world/local-infrastructure.mjs';

export const TRANSPORT_CONDITION_AUTHORITY_SCHEMA = 'axm.global-state-rts.transport-condition-authority/v0.2';
export const TRANSPORT_SEGMENT_STATES = Object.freeze(['open', 'broken', 'repaired']);

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function validateSegment(segment) {
  if (!segment?.id || !segment?.edgeId || !segment?.terrain?.surfaceClass || !Number.isFinite(segment.lengthM)) {
    throw new TypeError('local infrastructure corridor segment required');
  }
  return segment;
}

function segmentEdgeProgress(segment) {
  if (Number.isFinite(segment.edgeProgress)) return clamp(segment.edgeProgress, 0, 1);
  const match = /:(\d+)$/.exec(String(segment.id));
  if (!match) return 0.5;
  return clamp(Number(match[1]) / 1_000_000, 0, 1);
}

function repairCostFor(segment) {
  validateSegment(segment);
  const depth = Math.max(0, Number(segment.terrain.maxDepthM) || 0);
  const length = Math.max(1, Number(segment.lengthM) || 1);
  const classFactor = segment.rail ? 1.35 : segment.roadClass === 'trunk-road' ? 1.15 : segment.roadClass === 'regional-road' ? 1 : 0.82;
  return Object.freeze({
    scrap: Math.ceil((length * 0.18 + depth * 0.8) * classFactor),
    stone: Math.ceil((length * 0.26 + depth * 0.55) * classFactor),
    'industrial-metal': Math.ceil((length * 0.72 + depth * 2.4) * classFactor)
  });
}

function defaultBroken(segment) {
  return segment.terrain.surfaceClass === 'broken-water-gap';
}

function observedRecord(segment) {
  return freezeRecord({
    segmentId: segment.id,
    edgeId: segment.edgeId,
    edgeProgress: segmentEdgeProgress(segment),
    roadClass: segment.roadClass,
    rail: Boolean(segment.rail),
    surfaceClass: segment.terrain.surfaceClass,
    lengthM: segment.lengthM,
    maxDepthM: segment.terrain.maxDepthM,
    repairCost: repairCostFor(segment)
  });
}

export class TransportConditionAuthority {
  constructor({ stockpile = null } = {}) {
    if (stockpile && stockpile.schema !== CIVILIZATION_STOCKPILE_SCHEMA) {
      throw new TypeError('stockpile must be a CivilizationStockpile when supplied');
    }
    this.schema = TRANSPORT_CONDITION_AUTHORITY_SCHEMA;
    this.stockpile = stockpile;
    this.revision = 0;
    this.observed = new Map();
    this.mutations = new Map();
    this.receipts = [];
  }

  observeInfrastructure(query) {
    if (!query || query.schema !== LOCAL_INFRASTRUCTURE_SCHEMA || !Array.isArray(query.corridors)) {
      throw new TypeError('local infrastructure query required');
    }
    let added = 0;
    for (const segment of query.corridors) {
      validateSegment(segment);
      if (!defaultBroken(segment)) continue;
      if (this.observed.has(segment.id)) continue;
      this.observed.set(segment.id, observedRecord(segment));
      added += 1;
    }
    if (added) this.revision += 1;
    return added;
  }

  statusFor(segmentOrId) {
    const segmentId = typeof segmentOrId === 'string' ? segmentOrId : validateSegment(segmentOrId).id;
    const mutation = this.mutations.get(segmentId);
    if (mutation) return mutation.state;
    const observed = this.observed.get(segmentId);
    if (observed) return 'broken';
    if (typeof segmentOrId === 'object' && defaultBroken(segmentOrId)) return 'broken';
    return 'open';
  }

  unresolvedBreakDetailsForEdge(edgeId) {
    return Object.freeze([...this.observed.values()]
      .filter(item => item.edgeId === edgeId && this.statusFor(item.segmentId) === 'broken')
      .sort((a, b) => a.edgeProgress - b.edgeProgress || a.segmentId.localeCompare(b.segmentId))
      .map(item => freezeRecord({
        segmentId: item.segmentId,
        edgeId: item.edgeId,
        edgeProgress: item.edgeProgress,
        surfaceClass: item.surfaceClass,
        lengthM: item.lengthM,
        maxDepthM: item.maxDepthM,
        repairCost: item.repairCost
      })));
  }

  unresolvedBreaksForEdge(edgeId) {
    return Object.freeze(this.unresolvedBreakDetailsForEdge(edgeId).map(item => item.segmentId));
  }

  edgePolicy(edge, mode) {
    const unresolvedDetails = this.unresolvedBreakDetailsForEdge(edge.id);
    if (!unresolvedDetails.length) return Object.freeze({ passable: true, multiplier: 1, reason: null, unresolvedSegmentIds: Object.freeze([]) });
    return Object.freeze({
      passable: false,
      multiplier: Infinity,
      reason: 'observed-broken-crossing',
      mode,
      unresolvedSegmentIds: Object.freeze(unresolvedDetails.map(item => item.segmentId)),
      unresolvedBreaks: unresolvedDetails
    });
  }

  repairCost(segmentId) {
    const observed = this.observed.get(String(segmentId));
    if (!observed) throw new RangeError(`segment has not been observed as broken: ${segmentId}`);
    return observed.repairCost;
  }

  repair(segmentId, { eventId = null } = {}) {
    const id = String(segmentId);
    const observed = this.observed.get(id);
    if (!observed) return Object.freeze({ accepted: false, reason: 'segment-not-observed-broken' });
    if (this.statusFor(id) === 'repaired') return Object.freeze({ accepted: false, reason: 'already-repaired' });
    if (!this.stockpile) return Object.freeze({ accepted: false, reason: 'no-stockpile-bound' });

    const debit = this.stockpile.debit(observed.repairCost, {
      reason: 'transport-crossing-repair',
      eventId: eventId || `repair:${id}`
    });
    if (!debit.accepted) return debit;

    const mutation = freezeRecord({
      segmentId: id,
      edgeId: observed.edgeId,
      edgeProgress: observed.edgeProgress,
      state: 'repaired',
      repairedFrom: observed.surfaceClass,
      eventId: eventId ? String(eventId) : null
    });
    this.mutations.set(id, mutation);
    this.revision += 1;
    const receipt = freezeRecord({
      type: 'transport-repair',
      revision: this.revision,
      segmentId: id,
      edgeId: observed.edgeId,
      edgeProgress: observed.edgeProgress,
      cost: observed.repairCost,
      eventId: mutation.eventId
    });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, state: mutation.state });
  }

  damage(segment, { reason = 'transport-damage', eventId = null } = {}) {
    validateSegment(segment);
    if (!['bridge-span', 'causeway'].includes(segment.terrain.surfaceClass) && this.statusFor(segment) !== 'repaired') {
      return Object.freeze({ accepted: false, reason: 'segment-not-engineered-crossing' });
    }
    if (!this.observed.has(segment.id)) this.observed.set(segment.id, observedRecord(segment));
    const observed = this.observed.get(segment.id);
    const mutation = freezeRecord({
      segmentId: segment.id,
      edgeId: segment.edgeId,
      edgeProgress: observed.edgeProgress,
      state: 'broken',
      reason: String(reason),
      eventId: eventId ? String(eventId) : null
    });
    this.mutations.set(segment.id, mutation);
    this.revision += 1;
    const receipt = freezeRecord({ type: 'transport-damage', revision: this.revision, ...mutation });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, state: 'broken' });
  }

  snapshot() {
    const observed = [...this.observed.values()].sort((a, b) => a.segmentId.localeCompare(b.segmentId));
    const mutations = [...this.mutations.values()].sort((a, b) => a.segmentId.localeCompare(b.segmentId));
    return Object.freeze({
      schema: TRANSPORT_CONDITION_AUTHORITY_SCHEMA,
      revision: this.revision,
      observedBreakCount: observed.filter(item => this.statusFor(item.segmentId) === 'broken').length,
      observed: Object.freeze(observed),
      mutations: Object.freeze(mutations),
      receipts: Object.freeze([...this.receipts])
    });
  }
}

export function createTransportConditionAuthority(options = {}) {
  return new TransportConditionAuthority(options);
}
