import { createWorldHttpApiService } from './world-http-api.mjs';

export const SETTLEMENT_WORLD_HTTP_API_SCHEMA = 'axm.global-state-rts.settlement-world-http-api/v0.1';

function queryValue(searchParams, key) {
  if (!searchParams) return null;
  if (typeof searchParams.get === 'function') return searchParams.get(key);
  const value = searchParams[key];
  return value === undefined || value === null ? null : String(value);
}

function response(status, body) {
  return Object.freeze({ status, body: Object.freeze(body) });
}

function writeBlocked(writeMode) {
  return response(403, { error: 'world writes disabled', writeMode });
}

function transferStatusCode(result) {
  if (result?.accepted) return 200;
  if (result?.reason === 'salvage-transfer-not-prepared') return 404;
  if (result?.reason === 'participant-action-rate-limited') return 429;
  const reason = String(result?.reason || '');
  if (
    reason.includes('conflict')
    || reason.includes('invalid-from')
    || reason.includes('requires-current')
    || reason.includes('requires-covered')
    || reason.includes('locks-reservation')
  ) return 409;
  return 400;
}

export class SettlementWorldHttpApiService {
  constructor({ authority, writeMode = 'off', clock = () => Date.now() } = {}) {
    if (!authority || typeof authority.salvageTransferMeta !== 'function'
      || typeof authority.prepareSalvageTransfer !== 'function'
      || typeof authority.settleSalvageTransferLocalDebit !== 'function'
      || typeof authority.salvageTransferStatus !== 'function') {
      throw new TypeError('settlement world session authority required');
    }
    this.schema = SETTLEMENT_WORLD_HTTP_API_SCHEMA;
    this.authority = authority;
    this.writeMode = String(writeMode || 'off');
    this.base = createWorldHttpApiService({ authority, writeMode: this.writeMode, clock });
  }

  #canWrite() {
    return this.writeMode === 'dev';
  }

  handle({ method = 'GET', pathname, searchParams = null, body = {} } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const route = String(pathname || '');
    try {
      if (verb === 'GET' && route === '/api/world/meta') {
        const base = this.base.handle({ method: verb, pathname: route, searchParams, body });
        if (base.status !== 200) return base;
        return response(200, {
          ...base.body,
          salvageTransferSettlement: this.authority.salvageTransferMeta()
        });
      }

      if (verb === 'GET' && route === '/api/world/local-salvage/transfers') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        const regionSeatId = queryValue(searchParams, 'regionSeatId');
        const transferId = queryValue(searchParams, 'transferId');
        const result = this.authority.salvageTransferStatus({
          participantId,
          ...(regionSeatId ? { regionSeatId } : {}),
          ...(transferId ? { transferId } : {})
        });
        return response(transferStatusCode(result), result);
      }

      if (verb === 'POST' && route.startsWith('/api/world/local-seat/salvage-transfer/')) {
        if (!this.#canWrite()) return writeBlocked(this.writeMode);

        if (route === '/api/world/local-seat/salvage-transfer/prepare') {
          const result = this.authority.prepareSalvageTransfer({
            transferId: body.transferId,
            participantId: body.participantId,
            regionSeatId: body.regionSeatId,
            expectedRevision: body.expectedRevision,
            amountMilli: body.amountMilli
          });
          return response(transferStatusCode(result), result);
        }

        if (route === '/api/world/local-seat/salvage-transfer/debit') {
          const result = this.authority.settleSalvageTransferLocalDebit({
            transferId: body.transferId,
            participantId: body.participantId
          });
          return response(transferStatusCode(result), result);
        }

        if (route === '/api/world/local-seat/salvage-transfer/cancel') {
          if (typeof this.authority.cancelPreparedSalvageTransfer !== 'function') {
            return response(501, { error: 'salvage transfer cancellation authority unavailable' });
          }
          const result = this.authority.cancelPreparedSalvageTransfer({
            transferId: body.transferId,
            participantId: body.participantId,
            cancelReason: body.cancelReason
          });
          return response(transferStatusCode(result), result);
        }
      }

      return this.base.handle({ method: verb, pathname: route, searchParams, body });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /unknown participant/.test(message) ? 404 : 400;
      return response(status, { error: message });
    }
  }
}

export function createSettlementWorldHttpApiService(options = {}) {
  return new SettlementWorldHttpApiService(options);
}
