export const CIVILIZATION_LOGISTICS_CYCLE_SCHEMA = 'axm.global-state-rts.civilization-logistics-cycle/v0.1';

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

export class CivilizationLogisticsCycle {
  constructor({ production, logistics, stockpile } = {}) {
    if (!production?.advance || !production?.snapshot) throw new TypeError('production required');
    if (!logistics?.acceptProduction || !logistics?.advance) throw new TypeError('logistics required');
    if (!stockpile?.debit || !stockpile?.amount) throw new TypeError('stockpile required');
    this.schema = CIVILIZATION_LOGISTICS_CYCLE_SCHEMA;
    this.production = production;
    this.logistics = logistics;
    this.stockpile = stockpile;
    this.seenProducedByJob = new Map();
    this.elapsedSeconds = 0;
    this.revision = 0;
  }

  advance(deltaSeconds, { foodModifiers = null, eventId = null } = {}) {
    const seconds = finiteNonNegative(deltaSeconds, 'deltaSeconds');
    if (seconds === 0) return Object.freeze({ production: null, logistics: null, queued: Object.freeze({}) });

    const productionResult = this.production.advance(seconds, {
      foodModifiers,
      eventId: eventId ? `${eventId}:production` : null
    });

    const produced = productionResult.produced || {};
    const resourceIds = Object.keys(produced);
    if (resourceIds.length) {
      const debit = this.stockpile.debit(produced, {
        reason: 'route-production-through-logistics',
        eventId: eventId ? `${eventId}:buffer` : `logistics-buffer:${this.revision + 1}`
      });
      if (!debit.accepted) throw new Error('production credit could not be moved into logistics buffer');
    }

    const queued = {};
    for (const job of this.production.snapshot().jobs) {
      const previous = this.seenProducedByJob.get(job.buildingId) || 0;
      const delta = Math.max(0, job.totalProduced - previous);
      this.seenProducedByJob.set(job.buildingId, job.totalProduced);
      if (delta <= 1e-12) continue;
      const resourceId = job.source?.materialClass || (job.definitionId.includes('crop') || job.definitionId.includes('greenhouse') ? 'food' : null);
      if (!resourceId) throw new Error(`cannot resolve logistics resource for job ${job.buildingId}`);
      const accepted = this.logistics.acceptProduction({
        buildingId: job.buildingId,
        resourceId,
        amount: delta,
        workerCount: job.workerCount
      });
      if (!accepted.accepted) throw new Error(`logistics refused production from ${job.buildingId}: ${accepted.reason}`);
      queued[resourceId] = (queued[resourceId] || 0) + delta;
    }

    const logisticsResult = this.logistics.advance(seconds, {
      eventId: eventId ? `${eventId}:delivery` : null
    });
    this.elapsedSeconds += seconds;
    this.revision += 1;
    return Object.freeze({
      production: productionResult,
      logistics: logisticsResult,
      queued: Object.freeze({ ...queued })
    });
  }

  snapshot() {
    return Object.freeze({
      schema: CIVILIZATION_LOGISTICS_CYCLE_SCHEMA,
      revision: this.revision,
      elapsedSeconds: this.elapsedSeconds,
      seenProducedByJob: Object.freeze(Object.fromEntries([...this.seenProducedByJob.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
      logistics: this.logistics.snapshot(),
      production: this.production.snapshot()
    });
  }
}

export function createCivilizationLogisticsCycle(options = {}) {
  return new CivilizationLogisticsCycle(options);
}
