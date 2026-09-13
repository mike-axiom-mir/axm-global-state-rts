import { createSettlementWorldHttpApiService } from './settlement-world-http-api.mjs';

export const FINALIZED_SETTLEMENT_WORLD_HTTP_API_SCHEMA =
  'axm.global-state-rts.finalized-settlement-world-http-api/v0.1';

function response(status, body) {
  return Object.freeze({ status, body: Object.freeze(body) });
}

function transferStatusCode(result) {
  if (result?.accepted) return 200;
  if (result?.reason === 'salvage-transfer-not-prepared') return 404;
  const reason = String(result?.reason || '');
  if (
    reason.includes('conflict')
    || reason.includes('requires-local-debit')
    || reason.includes('invalid-from')
  ) return 409;
  return 400;
}

export class FinalizedSettlementWorldHttpApiService {
  constructor({ authority, writeMode = 'off', clock = () => Date.now() } = {}) {
    if (!authority || typeof authority.finalizeSalvageTransferGlobalCredit !== 'function') {
      throw new TypeError('finalized settlement world session authority required');
    }
    this.schema = FINALIZED_SETTLEMENT_WORLD_HTTP_API_SCHEMA;
    this.authority = authority;
    this.writeMode = String(writeMode || 'off');
    this.base = createSettlementWorldHttpApiService({ authority, writeMode: this.writeMode, clock });
  }

  handle({ method = 'GET', pathname, searchParams = null, body = {} } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const route = String(pathname || '');
    try {
      if (verb === 'POST' && route === '/api/world/local-seat/salvage-transfer/finalize-global-credit') {
        if (this.writeMode !== 'dev') {
          return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        }
        const result = this.authority.finalizeSalvageTransferGlobalCredit({
          transferId: body.transferId,
          participantId: body.participantId
        });
        return response(transferStatusCode(result), result);
      }
      return this.base.handle({ method: verb, pathname: route, searchParams, body });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /unknown participant/.test(message) ? 404 : 400;
      return response(status, { error: message });
    }
  }
}

export function createFinalizedSettlementWorldHttpApiService(options = {}) {
  return new FinalizedSettlementWorldHttpApiService(options);
}
