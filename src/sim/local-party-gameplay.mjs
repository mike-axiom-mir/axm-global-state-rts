import { createPartyRegistry } from './party-registry.mjs';

export const LOCAL_PARTY_GAMEPLAY_SCHEMA = 'axm.global-state-rts.local-party-gameplay/v0.1';

function frozenResult(fields) {
  return Object.freeze({ handled: true, ...fields });
}

function nonEmptyParties(snapshot) {
  return snapshot.parties.filter(party => party.unitIds.length > 0);
}

export class LocalPartyGameplay {
  constructor(crewIds = []) {
    if (!Array.isArray(crewIds) || crewIds.length < 1) throw new RangeError('at least one Crew id is required');
    this.schema = LOCAL_PARTY_GAMEPLAY_SCHEMA;
    this.registry = createPartyRegistry(crewIds);
    this.registry.createParty('party-1', { label: 'Crew 1' });
    this.registry.assignUnits('party-1', crewIds);
    this.selectedPartyId = 'party-1';
    this.menuOpen = false;
    this.nextPartyNumber = 2;
  }

  selectedParty() {
    const selected = this.registry.party(this.selectedPartyId);
    if (selected?.unitIds.length) return selected;
    const fallback = nonEmptyParties(this.registry.snapshot())[0] || null;
    this.selectedPartyId = fallback?.id || 'party-1';
    return fallback;
  }

  selectedCrewIds() {
    return Object.freeze([...(this.selectedParty()?.unitIds || [])]);
  }

  #selectOffset(offset) {
    const parties = nonEmptyParties(this.registry.snapshot());
    if (!parties.length) return frozenResult({ accepted: false, reason: 'no-active-parties' });
    let index = parties.findIndex(party => party.id === this.selectedPartyId);
    if (index < 0) index = 0;
    index = (index + offset + parties.length) % parties.length;
    this.selectedPartyId = parties[index].id;
    return frozenResult({ accepted: true, action: 'party-select', party: this.selectedParty() });
  }

  #splitSelected() {
    const selected = this.selectedParty();
    if (!selected || selected.unitIds.length < 2) {
      return frozenResult({ accepted: false, reason: 'selected-party-too-small-to-split' });
    }
    const unitIds = [...selected.unitIds];
    const splitAt = Math.ceil(unitIds.length / 2);
    const detached = unitIds.slice(splitAt);
    let nextId = `party-${this.nextPartyNumber}`;
    while (this.registry.party(nextId)) {
      this.nextPartyNumber += 1;
      nextId = `party-${this.nextPartyNumber}`;
    }
    this.registry.createParty(nextId, { label: `Crew ${this.nextPartyNumber}` });
    this.nextPartyNumber += 1;
    this.registry.assignUnits(nextId, detached);
    this.selectedPartyId = nextId;
    return frozenResult({ accepted: true, action: 'party-split', party: this.selectedParty() });
  }

  #mergeSelectedIntoPrimary() {
    const selected = this.selectedParty();
    const primary = this.registry.party('party-1');
    if (!selected || !primary) return frozenResult({ accepted: false, reason: 'party-state-unavailable' });
    if (selected.id === primary.id) {
      const others = nonEmptyParties(this.registry.snapshot()).filter(party => party.id !== primary.id);
      if (!others.length) return frozenResult({ accepted: false, reason: 'no-other-party-to-merge' });
      for (const party of others) this.registry.assignUnits(primary.id, party.unitIds);
    } else {
      this.registry.assignUnits(primary.id, selected.unitIds);
    }
    this.selectedPartyId = primary.id;
    return frozenResult({ accepted: true, action: 'party-merge', party: this.selectedParty() });
  }

  handleAction(actionId) {
    if (actionId === 'party-menu') {
      this.menuOpen = !this.menuOpen;
      return frozenResult({ accepted: true, action: this.menuOpen ? 'party-menu-open' : 'party-menu-close', party: this.selectedParty() });
    }
    if (actionId === 'party-prev') return this.#selectOffset(-1);
    if (actionId === 'party-next') return this.#selectOffset(1);
    if (actionId === 'party-split') return this.#splitSelected();
    if (actionId === 'party-merge') return this.#mergeSelectedIntoPrimary();
    if (this.menuOpen && actionId === 'confirm') return this.#splitSelected();
    if (this.menuOpen && actionId === 'context') return this.#mergeSelectedIntoPrimary();
    if (this.menuOpen && actionId === 'cancel') {
      this.menuOpen = false;
      return frozenResult({ accepted: true, action: 'party-menu-close', party: this.selectedParty() });
    }
    return null;
  }

  snapshot() {
    const registry = this.registry.snapshot();
    const parties = nonEmptyParties(registry);
    const selected = this.selectedParty();
    return Object.freeze({
      schema: LOCAL_PARTY_GAMEPLAY_SCHEMA,
      menuOpen: this.menuOpen,
      selectedPartyId: selected?.id || null,
      selectedPartyLabel: selected?.label || null,
      selectedCrewIds: Object.freeze([...(selected?.unitIds || [])]),
      partyCount: parties.length,
      parties: Object.freeze(parties.map(party => Object.freeze({
        id: party.id,
        label: party.label,
        unitIds: Object.freeze([...party.unitIds])
      })))
    });
  }
}

export function createLocalPartyGameplay(crewIds) {
  return new LocalPartyGameplay(crewIds);
}
