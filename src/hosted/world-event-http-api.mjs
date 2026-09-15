import { createMemoryWorldJournalStore } from './journal-store.mjs';
import { createWorldEventEncounterAuthority } from './world-event-encounter-authority.mjs';
import { createWorldEventOutcomeAuthority } from './world-event-outcome-authority.mjs';
import { activeWorldEvents } from '../world/world-events.mjs';

export const WORLD_EVENT_HTTP_API_SCHEMA = 'axm.global-state-rts.world-event-http-api/v0.1';

function response(status, body) {
  return Object.freeze({ status, body: Object.freeze(body) });
}

function finiteHostTime(clock) {
  const nowMs = Number(clock());
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('host clock must return a finite non-negative timestamp');
  return nowMs;
}

function supportedEncounterEvent(event) {
  return event?.kind === 'king-of-hill' && event?.objective?.type === 'hold-zone';
}

function mutationStatus(result) {
  if (result?.accepted) return 200;
  if (result?.reason === 'participant-action-rate-limited') return 429;
  if (result?.reason === 'persistent-encounter-requires-world-account') return 403;
  if (result?.reason === 'encounter-not-open') return 409;
  if (String(result?.reason || '').includes('journal') || String(result?.reason || '').includes('revision')) return 503;
  return 400;
}

function optionalSearchParam(searchParams, key) {
  if (!searchParams) return null;
  if (typeof searchParams.get === 'function') {
    const value = searchParams.get(key);
    return value == null || value === '' ? null : value;
  }
  const value = searchParams[key];
  return value == null || value === '' ? null : String(value);
}

export class WorldEventHttpApiService {
  constructor({
    authority,
    baseApi,
    writeMode = 'off',
    clock = () => Date.now(),
    storeFactory = () => createMemoryWorldJournalStore(),
    outcomeStore = null
  } = {}) {
    if (!authority?.participants || !authority?.sharedState) throw new TypeError('world session authority required');
    if (typeof baseApi?.handle !== 'function') throw new TypeError('baseApi with handle required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (typeof storeFactory !== 'function') throw new TypeError('storeFactory must be a function');
    this.schema = WORLD_EVENT_HTTP_API_SCHEMA;
    this.authority = authority;
    this.baseApi = baseApi;
    this.writeMode = String(writeMode || 'off');
    this.clock = clock;
    this.storeFactory = storeFactory;
    this.encounters = new Map();
    const resolvedOutcomeStore = outcomeStore || this.storeFactory(Object.freeze({
      id: '__world-event-outcomes__',
      kind: 'host-outcome-ledger'
    }));
    if (!resolvedOutcomeStore || typeof resolvedOutcomeStore.readAll !== 'function' || typeof resolvedOutcomeStore.append !== 'function') {
      throw new TypeError('outcomeStore with readAll and append required');
    }
    this.outcomes = createWorldEventOutcomeAuthority({
      participantRegistry: this.authority.participants,
      store: resolvedOutcomeStore
    });
  }

  #worldNow() {
    const hostNowMs = finiteHostTime(this.clock);
    const worldTime = this.authority.participants.worldTime(hostNowMs);
    return Object.freeze({ hostNowMs, worldTime, encounterNowMs: worldTime.nowMs - worldTime.epochMs });
  }

  #activeEvents(encounterNowMs) {
    const worldSeed = this.authority.sharedState.meta().worldSeed;
    return activeWorldEvents(encounterNowMs, { worldSeed });
  }

  #eventById(eventId, encounterNowMs) {
    const id = String(eventId || '');
    return this.#activeEvents(encounterNowMs).find(event => event.id === id) || null;
  }

  #encounterFor(event) {
    if (!supportedEncounterEvent(event)) return null;
    let encounter = this.encounters.get(event.id);
    if (!encounter) {
      encounter = createWorldEventEncounterAuthority({
        event,
        participantRegistry: this.authority.participants,
        store: this.storeFactory(event),
        clock: () => this.#worldNow().encounterNowMs
      });
      this.encounters.set(event.id, encounter);
    }
    return encounter;
  }

  #sync(encounter, encounterNowMs) {
    const result = encounter.advance({ nowMs: encounterNowMs });
    if (!result.accepted) {
      const error = new Error(`world-event host advance rejected: ${result.reason}`);
      error.code = 'WORLD_EVENT_ADVANCE_REJECTED';
      throw error;
    }
    const snapshot = result.snapshot;
    if (snapshot.ended && snapshot.contest?.closed && snapshot.contest?.winnerId && snapshot.contest?.reward) {
      const finalized = this.outcomes.finalizeEncounter(snapshot);
      if (!finalized.accepted) {
        const error = new Error(`world-event outcome finalization rejected: ${finalized.reason}`);
        error.code = 'WORLD_EVENT_OUTCOME_REJECTED';
        throw error;
      }
    }
    return snapshot;
  }

  #describeEvent(event, encounterNowMs) {
    if (!supportedEncounterEvent(event)) {
      return Object.freeze({
        event,
        authoritativeEncounter: false,
        support: 'announced-deterministic-world-event-not-yet-host-authoritative-v0.1'
      });
    }
    const encounter = this.#encounterFor(event);
    const snapshot = this.#sync(encounter, encounterNowMs);
    return Object.freeze({
      event,
      authoritativeEncounter: true,
      encounter: snapshot,
      outcome: this.outcomes.outcome(event.id),
      meta: encounter.meta()
    });
  }

  #eventIndex() {
    const time = this.#worldNow();
    const events = this.#activeEvents(time.encounterNowMs).map(event => this.#describeEvent(event, time.encounterNowMs));
    return Object.freeze({
      schema: WORLD_EVENT_HTTP_API_SCHEMA,
      worldTime: time.worldTime,
      encounterNowMs: time.encounterNowMs,
      events: Object.freeze(events),
      rules: Object.freeze({
        persistentIdentity: 'world-account-required-for-authoritative-encounter-presence',
        humanMachineParity: 'same-world-account-command-path-and-100-actions-per-rolling-60-seconds-gate',
        localSeatSemantics: 'seat-1-through-seat-4-remain-client-local-presentation-and-are-not-global-event-identities',
        advancement: 'host-clock-derived-only-clients-cannot-supply-delta-or-event-time',
        outcomeAuthority: 'host-derived-completed-encounter-outcomes-are-journaled-once-by-event-id',
        rewardApplication: 'next-drop-cache-bonus-is-durable-entitlement-evidence-only-not-yet-consumed',
        truthBoundary: 'single-host-durable-encounter-http-seam-not-production-scale-not-multi-host-consensus'
      })
    });
  }

  #outcomeIndex(searchParams) {
    const participantId = optionalSearchParam(searchParams, 'participantId');
    return Object.freeze({
      schema: WORLD_EVENT_HTTP_API_SCHEMA,
      outcomes: this.outcomes.outcomes({ participantId }),
      meta: this.outcomes.meta()
    });
  }

  handle({ method = 'GET', pathname, searchParams = null, body = {} } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const route = String(pathname || '');
    try {
      if (verb === 'GET' && route === '/api/world/events') {
        return response(200, this.#eventIndex());
      }

      if (verb === 'GET' && route === '/api/world/event-outcomes') {
        return response(200, this.#outcomeIndex(searchParams));
      }

      const outcomeMatch = route.match(/^\/api\/world\/event-outcomes\/([^/]+)$/);
      if (verb === 'GET' && outcomeMatch) {
        const eventId = decodeURIComponent(outcomeMatch[1]);
        const outcome = this.outcomes.outcome(eventId);
        if (!outcome) return response(404, { error: 'durable world event outcome not found', eventId });
        return response(200, { schema: WORLD_EVENT_HTTP_API_SCHEMA, outcome, meta: this.outcomes.meta() });
      }

      const statusMatch = route.match(/^\/api\/world\/events\/([^/]+)$/);
      if (verb === 'GET' && statusMatch) {
        const time = this.#worldNow();
        const eventId = decodeURIComponent(statusMatch[1]);
        const event = this.#eventById(eventId, time.encounterNowMs);
        if (!event) return response(404, { error: 'active world event not found', eventId });
        return response(200, this.#describeEvent(event, time.encounterNowMs));
      }

      const mutationMatch = route.match(/^\/api\/world\/events\/([^/]+)\/(join|leave)$/);
      if (verb === 'POST' && mutationMatch) {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const time = this.#worldNow();
        const eventId = decodeURIComponent(mutationMatch[1]);
        const operation = mutationMatch[2];
        const event = this.#eventById(eventId, time.encounterNowMs);
        if (!event) return response(404, { error: 'active world event not found', eventId });
        if (!supportedEncounterEvent(event)) {
          return response(501, {
            error: 'world event is announced but not yet supported by authoritative encounter v0.1',
            eventId,
            kind: event.kind
          });
        }
        const encounter = this.#encounterFor(event);
        this.#sync(encounter, time.encounterNowMs);
        const result = encounter[operation]({
          participantId: body.participantId,
          commandId: body.commandId || null,
          nowMs: time.encounterNowMs
        });
        return response(mutationStatus(result), result);
      }

      if (verb === 'GET' && route === '/api/world/meta') {
        const base = this.baseApi.handle({ method, pathname, searchParams, body });
        if (base.status !== 200) return base;
        return response(200, {
          ...base.body,
          worldEventAuthority: Object.freeze({
            schema: WORLD_EVENT_HTTP_API_SCHEMA,
            supportedEncounterKinds: Object.freeze(['king-of-hill:hold-zone']),
            participantIdentity: 'world-account',
            admission: 'world-participant-registry-shared-rolling-window-100-actions-per-60-seconds',
            advancement: 'host-clock-derived-only',
            persistence: 'per-event-append-only-journal-when-a-durable-store-factory-is-configured',
            outcomePersistence: this.outcomes.meta(),
            truthBoundary: 'single-host-durable-encounter-http-seam-not-production-scale-not-multi-host-consensus'
          })
        });
      }

      return this.baseApi.handle({ method, pathname, searchParams, body });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /unknown participant/.test(message)
        ? 404
        : /journal|revision|previousHash|beforeStateHash|entryHash|host advance rejected|outcome finalization rejected/.test(message)
          ? 503
          : 400;
      return response(status, { error: message });
    }
  }
}

export function createWorldEventHttpApiService(options = {}) {
  return new WorldEventHttpApiService(options);
}
