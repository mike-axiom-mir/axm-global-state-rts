export const WORLD_ENTRY_CLIENT_SCHEMA = 'axm.global-state-rts.world-entry-client/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

export class WorldEntryHttpError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'WorldEntryHttpError';
    this.status = status;
    this.body = body;
  }
}

export class WorldEntryClient {
  constructor({ baseUrl = '', fetchImpl = null } = {}) {
    const resolvedFetch = fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    if (typeof resolvedFetch !== 'function') throw new TypeError('fetch implementation required');
    this.schema = WORLD_ENTRY_CLIENT_SCHEMA;
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = resolvedFetch;
  }

  async #request(pathname, { method = 'GET', body = null } = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      method,
      headers: body === null ? undefined : { 'Content-Type': 'application/json' },
      body: body === null ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.error || `world request failed with HTTP ${response.status}`;
      throw new WorldEntryHttpError(message, { status: response.status, body: payload });
    }
    return payload;
  }

  meta() {
    return this.#request('/api/world/meta');
  }

  participant(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    return this.#request(`/api/world/participant?participantId=${encodeURIComponent(id)}`);
  }

  career(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    return this.#request(`/api/world/career?participantId=${encodeURIComponent(id)}`);
  }

  enterGuest({ sessionId, displayName = 'Guest', controllerKind = 'human' } = {}) {
    return this.#request('/api/world/enter/guest', {
      method: 'POST',
      body: {
        sessionId: nonEmpty(sessionId, 'sessionId'),
        displayName: String(displayName || 'Guest').trim() || 'Guest',
        controllerKind: String(controllerKind || 'human')
      }
    });
  }

  async enterAccount({ accountId, displayName = null, controllerKind = 'human' } = {}) {
    const account = nonEmpty(accountId, 'accountId');
    const participantId = `world:${account}`;
    try {
      const existing = await this.participant(participantId);
      return Object.freeze({
        participant: existing.participant,
        reused: true,
        accountPersistence: null
      });
    } catch (error) {
      if (!(error instanceof WorldEntryHttpError) || error.status !== 404) throw error;
    }

    const created = await this.#request('/api/world/enter/account', {
      method: 'POST',
      body: {
        accountId: account,
        displayName: String(displayName || account).trim() || account,
        controllerKind: String(controllerKind || 'human'),
        credentialMode: 'none'
      }
    });
    return Object.freeze({ ...created, reused: false });
  }

  accrueChests(participantId) {
    return this.#request('/api/world/chests/accrue', {
      method: 'POST',
      body: { participantId: nonEmpty(participantId, 'participantId') }
    });
  }

  openChests(participantId, count = 1) {
    const requested = Number(count);
    if (!Number.isInteger(requested) || requested < 1) throw new RangeError('count must be a positive integer');
    return this.#request('/api/world/chests/open', {
      method: 'POST',
      body: { participantId: nonEmpty(participantId, 'participantId'), count: requested }
    });
  }
}

export function createWorldEntryClient(options = {}) {
  return new WorldEntryClient(options);
}
