import { ACTION_WINDOW_MS } from '../input/action-rate-gate.mjs';
import { DEFAULT_APM_CAP, MAX_LOCAL_SEATS } from '../session/seat-contract.mjs';
import {
  PARTICIPANT_CONTROLLER_KINDS,
  PARTICIPANT_PROFILE_KINDS
} from './world-participant-registry.mjs';
import {
  WORLD_RUN_CLOSE_ACTION,
  WORLD_RUN_CRAFT_WEAPON_ACTION,
  WORLD_RUN_EQUIP_WEAPON_ACTION,
  WORLD_RUN_FOOD_POLICY_ACTION,
  WORLD_RUN_GLOBAL_CONTROL_ACTION,
  WORLD_RUN_LICENSE_UNIT_ACTION,
  WORLD_RUN_TRAIN_UNIT_ACTION
} from './durable-world-run-command-authority.mjs';

export const SHARED_WORLD_AUTHORITY_CONTRACT_SCHEMA =
  'axm.global-state-rts.shared-world-authority-contract/v0.1';

export const CURRENT_DURABLE_RUN_ACTION_IDS = Object.freeze([
  WORLD_RUN_GLOBAL_CONTROL_ACTION,
  WORLD_RUN_FOOD_POLICY_ACTION,
  WORLD_RUN_TRAIN_UNIT_ACTION,
  WORLD_RUN_LICENSE_UNIT_ACTION,
  WORLD_RUN_CRAFT_WEAPON_ACTION,
  WORLD_RUN_EQUIP_WEAPON_ACTION,
  WORLD_RUN_CLOSE_ACTION
]);

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, frozenCopy(item)])
    ));
  }
  return value;
}

export function createSharedWorldAuthorityContract({ worldAuthority } = {}) {
  if (!worldAuthority || typeof worldAuthority.authoritativeSnapshot !== 'function') {
    throw new TypeError('worldAuthority with authoritativeSnapshot required');
  }
  if (typeof worldAuthority.accountPersistenceMeta !== 'function') {
    throw new TypeError('worldAuthority with accountPersistenceMeta required');
  }

  const host = worldAuthority.authoritativeSnapshot();
  const participants = host?.participants;
  if (!participants || !Number.isInteger(participants.apmCap) || participants.apmCap < 1) {
    throw new Error('world participant registry must expose a positive integer apmCap');
  }

  const accountPersistence = worldAuthority.accountPersistenceMeta();
  const policySatisfied = participants.apmCap === DEFAULT_APM_CAP && ACTION_WINDOW_MS === 60_000;

  return frozenCopy({
    schema: SHARED_WORLD_AUTHORITY_CONTRACT_SCHEMA,
    authority: {
      topology: 'single-host-authoritative-shared-world',
      stateScope: 'one-host-state-shared-by-registered-participants',
      participantCardinality: 'multiple-participants-supported-capacity-not-benchmarked-here',
      worldLifecycle: 'long-running-host-state-deliberate-world-end-protocol-not-claimed-here',
      multiHostConsensus: false,
      productionScaleClaim: false,
      productionSecurityClaim: false
    },
    identity: {
      profileKinds: [...PARTICIPANT_PROFILE_KINDS],
      persistentWorldProfileKind: 'world-account',
      controllerKinds: [...PARTICIPANT_CONTROLLER_KINDS],
      humanMachineRule: 'same-participant-command-and-observation-rules-regardless-of-controller-kind',
      privilegedMachineFeeds: false,
      localPresentationSeats: {
        maximumPerClient: MAX_LOCAL_SEATS,
        idPattern: 'seat-1-through-seat-4',
        persistentWorldIdentity: false,
        scope: 'per-client-local-presentation-and-access-only'
      }
    },
    commandAdmission: {
      scope: 'participant-account-id',
      rollingWindowMs: ACTION_WINDOW_MS,
      configuredMaxActions: participants.apmCap,
      requiredSharedWorldMaxActions: DEFAULT_APM_CAP,
      requiredPolicySatisfied: policySatisfied,
      humanMachineParity: 'same-rolling-window-gate-no-controller-kind-bypass'
    },
    durableRunAuthority: {
      actionIds: [...CURRENT_DURABLE_RUN_ACTION_IDS],
      ordering: 'host-persist-before-apply-ordered-replay',
      exactRetry: 'same-mutation-id-and-payload-reconciles-without-second-admission',
      scopeBoundary:
        'listed-actions-only-other-local-rts-actions-are-not-claimed-host-authoritative-by-this-contract'
    },
    persistence: {
      worldAccounts: accountPersistence,
      restartDurability: accountPersistence?.enabled
        ? 'world-account-records-use-the-configured-persistence-adapter'
        : 'world-account-restart-durability-not-proven-without-a-persistence-adapter'
    },
    observedHost: {
      registryRevision: participants.revision,
      participantCount: participants.participantCount,
      worldEpochMs: participants.worldEpochMs
    },
    truthBoundary: [
      'single-host-contract-not-multi-host-consensus',
      'capacity-and-production-scale-not-established',
      'no-production-security-or-sophisticated-anti-cheat-claim',
      'no-privileged-machine-feed',
      'local-seat-ids-are-not-persistent-world-identities',
      'deliberate-world-end-protocol-is-not-established-by-this-contract'
    ]
  });
}
