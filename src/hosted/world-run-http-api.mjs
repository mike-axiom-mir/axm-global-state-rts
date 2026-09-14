import { createWorldHttpApiService } from './world-http-api.mjs';
import {
  WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
  createWorldRunSessionAuthority
} from './world-run-session-authority.mjs';

export const WORLD_RUN_HTTP_API_SCHEMA = 'axm.global-state-rts.world-run-http-api/v0.2';

function queryValue(searchParams, key) {
  if (!searchParams) return null;
  if (typeof searchParams.get === 'function') return searchParams.get(key);
  const value = searchParams[key];
  return value === undefined || value === null ? null : String(value);
}

function response(status, body) {
  return Object.freeze({ status, body: Object.freeze(body) });
}

function finiteHostTime(clock) {
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('host clock must return a finite non-negative timestamp');
  return nowMs;
}

function runMutationStatus(result) {
  if (result?.accepted) return 200;
  if (result?.reason === 'participant-action-rate-limited') return 429;
  if (result?.reason === 'run-start-rejected') return 409;
  if (String(result?.reason || '').includes('claim')) return 409;
  return 400;
}

export class WorldRunHttpApiService {
  constructor({
    authority,
    runAuthority = null,
    runStartStore = null,
    baseApi = null,
    writeMode = 'off',
    clock = () => Date.now()
  } = {}) {
    if (!authority?.participants || !authority?.sharedState) throw new TypeError('world session authority required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (baseApi !== null && typeof baseApi?.handle !== 'function') throw new TypeError('baseApi must provide handle');
    this.schema = WORLD_RUN_HTTP_API_SCHEMA;
    this.authority = authority;
    this.writeMode = String(writeMode || 'off');
    this.clock = clock;
    this.runAuthority = runAuthority || createWorldRunSessionAuthority({ worldAuthority: authority, runStartStore, clock });
    this.baseApi = baseApi || createWorldHttpApiService({ authority, writeMode: this.writeMode, clock });
  }

  handle({ method = 'GET', pathname, searchParams = null, body = {} } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const route = String(pathname || '');
    try {
      if (verb === 'GET' && route === '/api/world/run') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        return response(200, this.runAuthority.status(participantId));
      }

      if (verb === 'POST' && route === '/api/world/run/begin-next-drop') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const result = this.runAuthority.beginNextDropRun({
          participantId: body.participantId,
          runId: body.runId,
          runOptions: body.runOptions,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'GET' && route === '/api/world/meta') {
        const base = this.baseApi.handle({ method, pathname, searchParams, body });
        if (base.status !== 200) return base;
        const persistence = this.runAuthority.progressionPersistenceMeta();
        return response(200, {
          ...base.body,
          runLifecycle: Object.freeze({
            schema: WORLD_RUN_SESSION_AUTHORITY_SCHEMA,
            progressionPersistence: persistence,
            truthBoundary: persistence.enabled
              ? 'next-drop-run-start-is-host-authoritative-and-its-initial-progression-state-can-be-replayed-from-durable-start-evidence;later-in-run-mutations-remain-outside-this-replay-contract'
              : 'next-drop-run-start-is-host-authoritative-but-active-progression-remains-process-memory-only'
          })
        });
      }

      return this.baseApi.handle({ method, pathname, searchParams, body });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /already exists/.test(message) ? 409 : /unknown participant/.test(message) ? 404 : 400;
      return response(status, { error: message });
    }
  }
}

export function createWorldRunHttpApiService(options = {}) {
  return new WorldRunHttpApiService(options);
}
