export const WORLD_BROWSER_CLIENT_SCHEMA = 'axm.global-state-rts.world-browser-client/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function controllerKind(value) {
  const kind = String(value || 'human');
  if (!['human', 'machine'].includes(kind)) throw new RangeError(`unsupported controllerKind: ${kind}`);
  return kind;
}

function freezeJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])));
}

export class WorldBrowserApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = 'WorldBrowserApiError';
    this.status = status;
    this.body = freezeJson(body);
  }
}

export class WorldBrowserClient {
  constructor({ fetchImpl = globalThis.fetch, baseUrl = '' } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation required');
    this.schema = WORLD_BROWSER_CLIENT_SCHEMA;
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
  }

  async #request(method, pathname, { query = null, body = undefined } = {}) {
    const url = new URL(`${this.baseUrl}${pathname}`, globalThis.location?.href || 'http://127.0.0.1/');
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
    }
    const response = await this.fetchImpl(url.toString(), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new WorldBrowserApiError(payload?.error || `world API request failed (${response.status})`, {
        status: response.status,
        body: payload
      });
    }
    return freezeJson(payload);
  }

  worldMeta() {
    return this.#request('GET', '/api/world/meta');
  }

  participant(participantId) {
    return this.#request('GET', '/api/world/participant', { query: { participantId: nonEmpty(participantId, 'participantId') } });
  }

  career(participantId) {
    return this.#request('GET', '/api/world/career', { query: { participantId: nonEmpty(participantId, 'participantId') } });
  }

  enterGuest({ sessionId, displayName = 'Guest', controllerKind: requestedKind = 'human' } = {}) {
    return this.#request('POST', '/api/world/enter/guest', {
      body: {
        sessionId: nonEmpty(sessionId, 'sessionId'),
        displayName: String(displayName || 'Guest'),
        controllerKind: controllerKind(requestedKind)
      }
    });
  }

  enterAccount({ accountId, displayName = null, controllerKind: requestedKind = 'human', credentialMode = 'none' } = {}) {
    return this.#request('POST', '/api/world/enter/account', {
      body: {
        accountId: nonEmpty(accountId, 'accountId'),
        displayName: displayName === null ? null : String(displayName),
        controllerKind: controllerKind(requestedKind),
        credentialMode: String(credentialMode || 'none')
      }
    });
  }

  promoteGuest({ sessionId, accountId, displayName = null, credentialMode = 'none' } = {}) {
    return this.#request('POST', '/api/world/promote', {
      body: {
        sessionId: nonEmpty(sessionId, 'sessionId'),
        accountId: nonEmpty(accountId, 'accountId'),
        displayName: displayName === null ? null : String(displayName),
        credentialMode: String(credentialMode || 'none')
      }
    });
  }

  accrueChests(participantId) {
    return this.#request('POST', '/api/world/chests/accrue', {
      body: { participantId: nonEmpty(participantId, 'participantId') }
    });
  }

  openChests(participantId, count = 1) {
    const requested = Number(count);
    if (!Number.isInteger(requested) || requested < 1 || requested > 24) throw new RangeError('count must be an integer between 1 and 24');
    return this.#request('POST', '/api/world/chests/open', {
      body: { participantId: nonEmpty(participantId, 'participantId'), count: requested }
    });
  }
}

export function createWorldBrowserClient(options = {}) {
  return new WorldBrowserClient(options);
}
