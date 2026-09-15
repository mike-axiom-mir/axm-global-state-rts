import { createWorldHttpApiService } from './world-http-api.mjs';
import {
  ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA
} from './archived-world-run-mutation-authority.mjs';
import {
  DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
  WORLD_RUN_CLOSE_ACTION,
  WORLD_RUN_CRAFT_WEAPON_ACTION,
  WORLD_RUN_EQUIP_WEAPON_ACTION,
  WORLD_RUN_FOOD_POLICY_ACTION,
  WORLD_RUN_GLOBAL_CONTROL_ACTION,
  WORLD_RUN_LICENSE_UNIT_ACTION,
  WORLD_RUN_TRAIN_UNIT_ACTION,
  createDurableWorldRunCommandAuthority
} from './durable-world-run-command-authority.mjs';
import {
  PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
  createPreparedWorldRunRolloverAuthority
} from './prepared-world-run-rollover-authority.mjs';
import {
  WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
  createWorldRunDurableCheckpointAuthority
} from './world-run-durable-checkpoint-authority.mjs';
import { WORLD_RUN_SESSION_AUTHORITY_SCHEMA } from './world-run-session-authority.mjs';

export const WORLD_RUN_HTTP_API_SCHEMA = 'axm.global-state-rts.world-run-http-api/v0.12';

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
  if (result?.reason === 'mutation-persistence-failed-before-apply') return 503;
  if (result?.reason === 'rollover-run-start-persistence-failed-before-account-commit') return 503;
  if (result?.reason === 'durable-run-and-archive-storage-required') return 503;
  if (result?.reason === 'durable-run-storage-required') return 503;
  if ([
    'run-start-rejected',
    'no-active-run',
    'run-id-mismatch',
    'no-durable-run-record',
    'previous-run-id-mismatch',
    'previous-run-not-terminal',
    'terminal-archive-not-durable',
    'next-run-id-already-archived',
    'prepared-rollover-record-mismatch'
  ].includes(result?.reason)) return 409;
  if (String(result?.reason || '').includes('claim')) return 409;
  return 400;
}

function authorityWithMethod(authority, methodName) {
  const seen = new Set();
  let current = authority;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (typeof current[methodName] === 'function') return current;
    seen.add(current);
    current = current.base || null;
  }
  return null;
}

export class WorldRunHttpApiService {
  constructor({
    authority,
    runAuthority = null,
    runStartStore = null,
    runArchiveStore = null,
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
    const commandAuthority = runAuthority || createDurableWorldRunCommandAuthority({
      worldAuthority: authority,
      runStartStore,
      clock
    });
    this.runAuthority = commandAuthority?.prepareNextDropRollover
      ? commandAuthority
      : createPreparedWorldRunRolloverAuthority({ worldAuthority: authority, runAuthority: commandAuthority, runStartStore, runArchiveStore, clock });
    this.checkpointAuthority = createWorldRunDurableCheckpointAuthority({
      runAuthority: this.runAuthority,
      runStartStore
    });
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

      if (verb === 'GET' && route === '/api/world/run/archive') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        return response(200, this.runAuthority.archivedRuns(participantId));
      }

      if (verb === 'GET' && route === '/api/world/run/checkpoint') {
        const participantId = queryValue(searchParams, 'participantId');
        if (!participantId) return response(400, { error: 'participantId query parameter required' });
        return response(200, this.checkpointAuthority.checkpoint(participantId));
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

      if (verb === 'POST' && route === '/api/world/run/prepare-rollover') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const result = this.runAuthority.prepareNextDropRollover({
          participantId: body.participantId,
          previousRunId: body.previousRunId,
          nextRunId: body.nextRunId,
          runOptions: body.runOptions,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/execute-rollover') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const result = this.runAuthority.executePreparedNextDropRollover({
          participantId: body.participantId,
          previousRunId: body.previousRunId,
          nextRunId: body.nextRunId,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/global-control') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const result = this.runAuthority.recordGlobalControlPercent({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          percent: body.percent,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/food-policy') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const foodPolicyAuthority = authorityWithMethod(this.runAuthority, 'setFoodPolicy');
        if (!foodPolicyAuthority) return response(503, { error: 'host food-policy authority unavailable' });
        const result = foodPolicyAuthority.setFoodPolicy({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          policyId: body.policyId,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/train-unit') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const trainingAuthority = authorityWithMethod(this.runAuthority, 'trainUnit');
        if (!trainingAuthority) return response(503, { error: 'host unit-training authority unavailable' });
        const result = trainingAuthority.trainUnit({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          unitId: body.unitId,
          roleId: body.roleId,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/license-unit') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const licensingAuthority = authorityWithMethod(this.runAuthority, 'licenseUnit');
        if (!licensingAuthority) return response(503, { error: 'host vehicle-licensing authority unavailable' });
        const result = licensingAuthority.licenseUnit({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          unitId: body.unitId,
          licenseId: body.licenseId,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/craft-weapon') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const craftingAuthority = authorityWithMethod(this.runAuthority, 'craftWeapon');
        if (!craftingAuthority) return response(503, { error: 'host weapon-crafting authority unavailable' });
        const result = craftingAuthority.craftWeapon({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          weaponId: body.weaponId,
          count: body.count,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/equip-weapon') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const equippingAuthority = authorityWithMethod(this.runAuthority, 'equipUnitWeapon');
        if (!equippingAuthority) return response(503, { error: 'host weapon-equipping authority unavailable' });
        const result = equippingAuthority.equipUnitWeapon({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
          unitId: body.unitId,
          weaponId: body.weaponId,
          timestampMs: finiteHostTime(this.clock)
        });
        return response(runMutationStatus(result), result);
      }

      if (verb === 'POST' && route === '/api/world/run/close') {
        if (this.writeMode !== 'dev') return response(403, { error: 'world writes disabled', writeMode: this.writeMode });
        const result = this.runAuthority.closeActiveRun({
          participantId: body.participantId,
          runId: body.runId,
          mutationId: body.mutationId,
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
            mutationAuthoritySchema: DURABLE_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
            terminalArchiveAuthoritySchema: ARCHIVED_WORLD_RUN_MUTATION_AUTHORITY_SCHEMA,
            rolloverPreparationAuthoritySchema: PREPARED_WORLD_RUN_ROLLOVER_AUTHORITY_SCHEMA,
            durableCheckpointSchema: WORLD_RUN_DURABLE_CHECKPOINT_SCHEMA,
            progressionPersistence: persistence,
            hostAuthoritativeMutationActions: Object.freeze([
              WORLD_RUN_GLOBAL_CONTROL_ACTION,
              WORLD_RUN_FOOD_POLICY_ACTION,
              WORLD_RUN_TRAIN_UNIT_ACTION,
              WORLD_RUN_LICENSE_UNIT_ACTION,
              WORLD_RUN_CRAFT_WEAPON_ACTION,
              WORLD_RUN_EQUIP_WEAPON_ACTION,
              WORLD_RUN_CLOSE_ACTION
            ]),
            durableArchiveEndpoint: '/api/world/run/archive?participantId=<world-account-participant-id>',
            durableCheckpointEndpoint: '/api/world/run/checkpoint?participantId=<world-account-participant-id>',
            durableRolloverPreparationEndpoint: '/api/world/run/prepare-rollover',
            durableRolloverExecutionEndpoint: '/api/world/run/execute-rollover',
            durableFoodPolicyEndpoint: '/api/world/run/food-policy',
            durableUnitTrainingEndpoint: '/api/world/run/train-unit',
            durableVehicleLicensingEndpoint: '/api/world/run/license-unit',
            durableWeaponCraftingEndpoint: '/api/world/run/craft-weapon',
            durableWeaponEquippingEndpoint: '/api/world/run/equip-weapon',
            truthBoundary: persistence.durableRolloverPreparation?.enabled
              ? 'next-drop-run-start plus bounded global-control food-policy unit-training vehicle-licensing weapon-crafting weapon-equipping and terminal-close mutations are host-authoritative and replayable;terminal runs are archived;archive-bound rollover can be prepared and then executed into one new durable generation carrying only banked score/run history,with run-store-first account reconciliation across restart but no multi-host or atomic-database claim'
              : persistence.terminalRunArchive?.enabled
                ? 'next-drop-run-start plus bounded global-control food-policy unit-training vehicle-licensing weapon-crafting weapon-equipping and terminal-close mutations are host-authoritative and replayable;terminal runs are idempotently archived while safe generation rollover still requires durable run-start storage'
                : persistence.enabled
                  ? 'next-drop-run-start plus bounded global-control food-policy unit-training vehicle-licensing weapon-crafting weapon-equipping and terminal-close mutations are host-authoritative and replayable from durable evidence;read-only deterministic checkpoints compare that evidence across restart'
                  : 'next-drop-run-start global-control food-policy unit-training vehicle-licensing weapon-crafting weapon-equipping and run-close commands are host-authoritative in-process but active progression and durable checkpoint evidence remain unavailable without durable run-start storage'
          })
        });
      }

      return this.baseApi.handle({ method, pathname, searchParams, body });
    } catch (error) {
      const message = String(error?.message || error);
      const status = /already exists|id conflict|application state ambiguous|archive conflict|rollover intent conflict|rollover execution conflict|rollover intent archive mismatch/.test(message)
        ? 409
        : /unknown participant/.test(message)
          ? 404
          : 400;
      return response(status, { error: message });
    }
  }
}

export function createWorldRunHttpApiService(options = {}) {
  return new WorldRunHttpApiService(options);
}
