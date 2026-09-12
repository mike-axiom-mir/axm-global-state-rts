export const PARTY_REGISTRY_SCHEMA = 'axm.global-state-rts.party-registry/v0.2';

function nonEmpty(value, label) {
  const text = String(value ?? '');
  if (!text.length) throw new RangeError(`${label} must be non-empty`);
  return text;
}

function freezeParty(party) {
  return Object.freeze({
    id: party.id,
    label: party.label,
    unitIds: Object.freeze([...party.unitIds]),
    orderRevision: party.orderRevision,
    order: party.order ? Object.freeze(structuredClone(party.order)) : null
  });
}

export class PartyRegistry {
  constructor(unitIds = []) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    this.schema = PARTY_REGISTRY_SCHEMA;
    this.knownUnits = new Set(unitIds.map(id => nonEmpty(id, 'unit id')));
    this.parties = new Map();
    this.primaryPartyByUnit = new Map();
    this.revision = 0;
  }

  registerUnits(unitIds) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    for (const id of unitIds) this.knownUnits.add(nonEmpty(id, 'unit id'));
    this.revision += 1;
  }

  unregisterUnits(unitIds) {
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const removing = new Set(unitIds.map(id => String(id)).filter(Boolean));
    let removedKnownUnits = 0;
    const affectedParties = new Set();
    for (const unitId of removing) {
      if (this.knownUnits.delete(unitId)) removedKnownUnits += 1;
      const partyId = this.primaryPartyByUnit.get(unitId);
      if (partyId) affectedParties.add(partyId);
      this.primaryPartyByUnit.delete(unitId);
    }
    for (const party of this.parties.values()) {
      const before = party.unitIds.length;
      party.unitIds = party.unitIds.filter(id => !removing.has(id));
      if (party.unitIds.length !== before) affectedParties.add(party.id);
    }
    if (removedKnownUnits > 0 || affectedParties.size > 0) this.revision += 1;
    return Object.freeze({
      removedKnownUnits,
      affectedParties: Object.freeze([...affectedParties].sort())
    });
  }

  createParty(id, { label = id } = {}) {
    const partyId = nonEmpty(id, 'party id');
    if (this.parties.has(partyId)) throw new Error(`party already exists: ${partyId}`);
    const party = {
      id: partyId,
      label: nonEmpty(label, 'party label'),
      unitIds: [],
      orderRevision: 0,
      order: null
    };
    this.parties.set(partyId, party);
    this.revision += 1;
    return freezeParty(party);
  }

  party(id) {
    const party = this.parties.get(String(id));
    return party ? freezeParty(party) : null;
  }

  listParties() {
    return Object.freeze([...this.parties.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(freezeParty));
  }

  assignUnits(partyId, unitIds) {
    const party = this.parties.get(String(partyId));
    if (!party) throw new RangeError(`unknown party: ${partyId}`);
    if (!Array.isArray(unitIds) || unitIds.length === 0) throw new RangeError('unitIds must contain at least one unit');

    const normalized = unitIds.map(id => nonEmpty(id, 'unit id'));
    for (const unitId of normalized) {
      if (!this.knownUnits.has(unitId)) throw new RangeError(`unknown unit: ${unitId}`);
    }

    for (const unitId of normalized) {
      const previousPartyId = this.primaryPartyByUnit.get(unitId);
      if (previousPartyId && previousPartyId !== party.id) {
        const previous = this.parties.get(previousPartyId);
        if (previous) previous.unitIds = previous.unitIds.filter(id => id !== unitId);
      }
      this.primaryPartyByUnit.set(unitId, party.id);
      if (!party.unitIds.includes(unitId)) party.unitIds.push(unitId);
    }

    party.unitIds.sort();
    this.revision += 1;
    return freezeParty(party);
  }

  removeUnits(partyId, unitIds) {
    const party = this.parties.get(String(partyId));
    if (!party) throw new RangeError(`unknown party: ${partyId}`);
    if (!Array.isArray(unitIds)) throw new TypeError('unitIds must be an array');
    const removing = new Set(unitIds.map(id => String(id)));
    party.unitIds = party.unitIds.filter(id => !removing.has(id));
    for (const unitId of removing) {
      if (this.primaryPartyByUnit.get(unitId) === party.id) this.primaryPartyByUnit.delete(unitId);
    }
    this.revision += 1;
    return freezeParty(party);
  }

  commandParty(partyId, order) {
    const party = this.parties.get(String(partyId));
    if (!party) throw new RangeError(`unknown party: ${partyId}`);
    if (!order || typeof order !== 'object' || Array.isArray(order)) throw new TypeError('order must be an object');
    if (party.unitIds.length === 0) return Object.freeze({ accepted: false, reason: 'party-empty', party: freezeParty(party) });
    party.orderRevision += 1;
    party.order = structuredClone(order);
    this.revision += 1;
    return Object.freeze({ accepted: true, party: freezeParty(party) });
  }

  snapshot() {
    return Object.freeze({
      schema: PARTY_REGISTRY_SCHEMA,
      revision: this.revision,
      knownUnitCount: this.knownUnits.size,
      parties: this.listParties()
    });
  }
}

export function createPartyRegistry(unitIds = []) {
  return new PartyRegistry(unitIds);
}
