export const WORLD_HTTP_API_SCHEMA = 'axm.global-state-rts.world-http-api/v0.1';

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

function writeBlocked(writeMode) {
  return response(403, { error: 'world writes disabled', writeMode });
}

function mutationStatus(result) {
  if (result?.accepted) return 200;
  if (result?.reason === 'participant-action-rate-limited') return 429;
  if (String(result?.reason || '').includes('conflict')) return 409;
  return 400;
}

export class WorldHttpApiService {
  constructor({ authority, writeMode = 'off', clock = () => Date.now() } = {}) {
    if (!authority?.participants || !authority?.sharedState || typeof authority.submitParticipantCommand !== 'function') {
      throw new TypeError('world session authority required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.schema = WORLD_HTTP_API_SCHEMA;
    this.authority = authority;
    this.writeMode = String(writeMode || 'off');
    this.clock = clock;
  }

  #canWrite() {
    return this.writeMode === 'dev';
  }

  handle({ method = 'GET', pathname, searchParams = null, body = {} } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const route = String(pathname || '');
    try {
      if (verb === 'GET' && route === '/api/global-state/meta') {
        return response(200, this.authority.sharedState.meta());
      }

      if (verb === 'GET' && (route === '/api/global-state/leaderboard' || route === '/api/world/leaderboard')) {
        const metric = queryValue(searchParams, 'metric') || 'dominance';
        const limit = Number(queryValue(searchParams, 'limit') || 100);
        return response(200, {
          metric,
          revision: this.authority.sharedState.meta().revision,
          entries: this.authority.leaderboard(metric, limit)
        });
      }

      if (verb === 'GET' && route === '/api/global-state/player') {
        const playerId = queryValue(searchParams, 'playerId');
        if (!playerId) return response(400, { error: 'playerId query parameter required' });
        return response(200, {
          revision: this.authority.sharedState.meta().revision,
          playerId,
          summary: this.authority.sharedState.playerSummary(playerId)
        });
      }

      if (verb === 'GET' && route === '/api/world/meta') {
        const snapshot = this.authority.authoritativeSnapshot();
        return response(200, {
          schema: WORLD_HTTP_API_SCHEMA,
          writeMode: this.writeMode,
          worldTime: this.authority.participants.worldTime(finiteHostTime(this.clock)),
          participantRevision: snapshot.participants.revision,
          participantCount: snapshot.participants.participantCount,
          accountPersistence: snapshot.accountPersistence,
          sharedState: this.authority.sharedState.meta()
        });
      }

      if (verb === 'GET' && route === '/api/world/participant') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        const participant = this.authority.participant(participantId);
        return participant
          ? response(200, { participant })
          : response(404, { error: 'participant not found', participantId });
      }

      if (verb === 'GET' && route === '/api/world/career') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        return response(200, this.authority.participantCareerSummary(participantId));
      }

      if (verb === 'POST' && route === '/api/global-state/command') {
        if (!this.#canWrite()) return writeBlocked(this.writeMode);
        return response(410, {
          error: 'raw shared-state command endpoint retired; use /api/world/command with a registered participant',
          replacement: '/api/world/command'
        });
      }

      if (verb === 'POST' && route.startsWith('/api/world/')) {
        if (!this.#canWrite()) return writeBlocked(this.writeMode);
        const nowMs = finiteHostTime(this.clock);

        if (route === '/api/world/enter/guest') {
          const participant = this.authority.enterGuest({
            sessionId: body.sessionId,
            displayName: body.displayName,
            controllerKind: body.controllerKind,
            nowMs
          });
          return response(200, { participant });
        }

        if (route === '/api/world/enter/account') {
          const accountId = String(body.accountId ?? '').trim();
          if (!accountId) return response(400, { error: 'accountId required' });
          const existing = this.authority.participant(`world:${accountId}`);
          if (existing) {
            return response(200, {
              participant: existing,
              accountPersistence: this.authority.accountPersistenceMeta(),
              reused: true
            });
          }
          const participant = this.authority.createWorldAccount({
            accountId,
            displayName: body.displayName,
            controllerKind: body.controllerKind,
            credentialMode: body.credentialMode,
            nowMs
          });
          return response(200, {
            participant,
            accountPersistence: this.authority.accountPersistenceMeta(),
            reused: false
          });
        }

        if (route === '/api/world/promote') {
          const result = this.authority.promoteGuest({
            sessionId: body.sessionId,
            accountId: body.accountId,
            displayName: body.displayName,
            credentialMode: body.credentialMode,
            nowMs
          });
          return response(result.accepted ? 200 : 400, result);
        }

        if (route === '/api/world/chests/accrue') {
          const result = this.authority.accrueChests(body.participantId, nowMs);
          return response(200, result);
        }

        if (route === '/api/world/chests/open') {
          const result = this.authority.openChests(body.participantId, body.count === undefined ? 1 : Number(body.count));
          return response(result.accepted ? 200 : 400, result);
        }

        if (route === '/api/world/command') {
          const result = this.authority.submitParticipantCommand({
            participantId: body.participantId,
            commandId: body.commandId,
            eventType: body.eventType,
            payload: body.payload,
            timestampMs: nowMs,
            recordedAtMs: nowMs,
            expectedRevision: body.expectedRevision === undefined
              ? this.authority.sharedState.meta().revision
              : Number(body.expectedRevision)
          });
          return response(mutationStatus(result), result);
        }
      }

      return response(404, { error: 'API route not found' });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /already exists/.test(message) ? 409 : /unknown participant/.test(message) ? 404 : 400;
      return response(status, { error: message });
    }
  }
}

export function createWorldHttpApiService(options = {}) {
  return new WorldHttpApiService(options);
}
