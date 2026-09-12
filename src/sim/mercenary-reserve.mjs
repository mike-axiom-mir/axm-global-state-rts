export const MERCENARY_RESERVE_SCHEMA = 'axm.global-state-rts.mercenary-reserve/v0.1';

export const MERCENARY_CONTRACT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'mercenary:lone-rifle',
    label: 'Lone Rifle Mercenary',
    goldCost: 750,
    units: Object.freeze([
      Object.freeze({ role: 'rifle-guard', weaponId: 'weapon:scrap-rifle', licenses: Object.freeze([]) })
    ])
  }),
  Object.freeze({
    id: 'mercenary:scout-pair',
    label: 'Scout Pair',
    goldCost: 1800,
    units: Object.freeze([
      Object.freeze({ role: 'scout', weaponId: 'weapon:improvised-pistol', licenses: Object.freeze([]) }),
      Object.freeze({ role: 'scout', weaponId: 'weapon:scrap-rifle', licenses: Object.freeze([]) })
    ])
  }),
  Object.freeze({
    id: 'mercenary:assault-five',
    label: 'Five-person Assault Contract',
    goldCost: 4800,
    units: Object.freeze([
      Object.freeze({ role: 'rifle-guard', weaponId: 'weapon:scrap-rifle', licenses: Object.freeze([]) }),
      Object.freeze({ role: 'rifle-guard', weaponId: 'weapon:scrap-rifle', licenses: Object.freeze([]) }),
      Object.freeze({ role: 'rifle-guard', weaponId: 'weapon:scrap-rifle', licenses: Object.freeze([]) }),
      Object.freeze({ role: 'shotgun-raider', weaponId: 'weapon:pipe-shotgun', licenses: Object.freeze([]) }),
      Object.freeze({ role: 'medic', weaponId: 'weapon:improvised-pistol', licenses: Object.freeze([]) })
    ])
  })
]);

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new RangeError('mercenary contract catalog required');
  const seen = new Set();
  return Object.freeze(catalog.map(raw => {
    const id = String(raw?.id || '');
    if (!id) throw new TypeError('mercenary contract id required');
    if (seen.has(id)) throw new Error(`duplicate mercenary contract: ${id}`);
    seen.add(id);
    const goldCost = Number(raw.goldCost);
    if (!Number.isFinite(goldCost) || goldCost <= 0) throw new RangeError(`${id}.goldCost must be positive`);
    if (!Array.isArray(raw.units) || !raw.units.length) throw new RangeError(`${id} requires at least one unit`);
    const units = Object.freeze(raw.units.map(unit => Object.freeze({
      role: String(unit.role || ''),
      weaponId: String(unit.weaponId || ''),
      licenses: Object.freeze([...(unit.licenses || [])].map(String))
    })));
    if (units.some(unit => !unit.role || !unit.weaponId)) throw new TypeError(`${id} unit role/weapon required`);
    return Object.freeze({ id, label: String(raw.label || id), goldCost, units });
  }));
}

function pendingSnapshot(entry) {
  return Object.freeze({ serial: entry.serial, contractId: entry.contract.id, label: entry.contract.label, goldCost: entry.contract.goldCost, unitCount: entry.contract.units.length });
}

export class MercenaryReserve {
  constructor({ playerProgression, catalog = MERCENARY_CONTRACT_CATALOG } = {}) {
    if (!playerProgression?.spendBankedGold || !playerProgression?.snapshot) throw new TypeError('player progression required');
    this.schema = MERCENARY_RESERVE_SCHEMA;
    this.progression = playerProgression;
    this.catalog = normalizeCatalog(catalog);
    this.catalogById = new Map(this.catalog.map(contract => [contract.id, contract]));
    this.pending = [];
    this.nextSerial = 1;
    this.revision = 0;
    this.receipts = [];
  }

  contract(contractId) { return this.catalogById.get(String(contractId)) || null; }

  rent(contractId, count = 1) {
    if (this.progression.activeRun) return Object.freeze({ accepted: false, reason: 'mercenaries-rent-between-runs-only' });
    const contract = this.contract(contractId);
    if (!contract) return Object.freeze({ accepted: false, reason: 'unknown-mercenary-contract' });
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('count must be an integer from 1 to 100');
    const totalGold = contract.goldCost * count;
    const payment = this.progression.spendBankedGold(totalGold, { reason: `mercenary-contract:${contract.id}` });
    if (!payment.accepted) return payment;
    const entries = [];
    for (let index = 0; index < count; index++) {
      const entry = { serial: this.nextSerial++, contract };
      this.pending.push(entry);
      entries.push(pendingSnapshot(entry));
    }
    this.revision += 1;
    const receipt = Object.freeze({ type: 'mercenaries-rented', contractId: contract.id, count, totalGold, serials: Object.freeze(entries.map(entry => entry.serial)), bankedGold: payment.bankedGold });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, receipt, pending: this.pendingSnapshot() });
  }

  deployIntoRun(run) {
    if (!run?.manpower?.addExternalUnits || !run?.equipment?.grantExternalLoadout) throw new TypeError('civilization run with mercenary deployment authority required');
    if (!this.pending.length) return Object.freeze({ accepted: true, deployedContracts: 0, deployedUnits: Object.freeze([]), receipts: Object.freeze([]) });
    const deployedUnits = [];
    const deploymentReceipts = [];
    for (const entry of this.pending) {
      const eventId = `mercenary:${entry.serial}:run:${run.runId}`;
      const external = run.manpower.addExternalUnits(entry.contract.units.map(unit => ({ role: unit.role, licenses: unit.licenses })), {
        source: 'mercenary-contract', eventId, contractId: entry.contract.id
      });
      for (let index = 0; index < external.units.length; index++) {
        const unit = external.units[index];
        const spec = entry.contract.units[index];
        const loadout = run.equipment.grantExternalLoadout(unit.id, spec.weaponId, {
          source: 'mercenary-contract', eventId, contractId: entry.contract.id
        });
        if (!loadout.accepted) throw new Error(`mercenary contract loadout invalid: ${entry.contract.id} -> ${loadout.reason}`);
        deployedUnits.push(Object.freeze({ unitId: unit.id, role: unit.role, weaponId: spec.weaponId, contractId: entry.contract.id, serial: entry.serial }));
      }
      deploymentReceipts.push(Object.freeze({ serial: entry.serial, contractId: entry.contract.id, unitIds: Object.freeze(external.units.map(unit => unit.id)), runId: run.runId }));
    }
    const deployedContracts = this.pending.length;
    this.pending = [];
    this.revision += 1;
    const receipt = Object.freeze({ type: 'mercenary-reserve-deployed', runId: run.runId, deployedContracts, deployedUnitCount: deployedUnits.length });
    this.receipts.push(receipt);
    return Object.freeze({ accepted: true, deployedContracts, deployedUnits: Object.freeze(deployedUnits), receipts: Object.freeze(deploymentReceipts), receipt });
  }

  pendingSnapshot() { return Object.freeze(this.pending.map(pendingSnapshot)); }

  snapshot() {
    return Object.freeze({ schema: MERCENARY_RESERVE_SCHEMA, revision: this.revision, pendingContractCount: this.pending.length, pendingUnitCount: this.pending.reduce((sum, entry) => sum + entry.contract.units.length, 0), pending: this.pendingSnapshot(), receipts: Object.freeze([...this.receipts]) });
  }
}

export function createMercenaryReserve(options = {}) { return new MercenaryReserve(options); }
