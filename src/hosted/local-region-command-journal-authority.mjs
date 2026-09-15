import { createHash } from 'node:crypto';
import { createMemoryWorldJournalStore } from './journal-store.mjs';
import {
  LOCAL_OUTCOME_INTENT_SCHEMA,
  LOCAL_OUTCOME_REPLAY_MAX_STEPS
} from './local-outcome-replay-authority.mjs';
import {
  LOCAL_REGION_DEFAULT_STEP_MS,
  createLocalRegionSimulation
} from '../sim/local-region-sim.mjs';
import { lightingPhaseForWorldHour } from '../session/world-time-local-sync.mjs';
import { createStarterRegion } from '../world/starter-region.mjs';

export const LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA =
  'axm.global-state-rts.local-region-command-journal-authority/v0.1';
export const LOCAL_REGION_COMMAND_JOURNAL_ENTRY_SCHEMA =
  'axm.global-state-rts.local-region-command-journal-entry/v0.1';
export const LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA =
  'axm.global-state-rts.local-region-salvage-debit-entry/v0.1';
export const LOCAL_REGION_COMMAND_JOURNAL_MAX_COMMANDS = 128;

const ACTIONS = Object.freeze(['gather-scrap', 'explore', 'repair-core']);
const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);
const INTENT_KEYS = Object.freeze(['actionId', 'cursorXM', 'cursorZM', 'stepCount']);
const OPTIONAL_INTENT_KEYS = Object.freeze(['crewIds']);
const SCRAP_MILLI_PER_UNIT = 1000;
const SCRAP_EPSILON = 1e-9;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${label} must be a positive integer`);
  return number;
}

function normalizeRegionSeatId(value) {
  const seat = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seat)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seat;
}

function normalizeParticipant(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('participant host context required');
  const participantId = nonEmpty(raw.participantId, 'participant.participantId');
  const controllerKind = nonEmpty(raw.controllerKind, 'participant.controllerKind');
  if (!CONTROLLER_KINDS.includes(controllerKind)) throw new RangeError('participant.controllerKind must be human or machine');
  return Object.freeze({ participantId, controllerKind });
}

function normalizeCrewIds(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('intent.crewIds must be an array when supplied');
  const crewIds = value.map((raw, index) => {
    const id = String(raw ?? '').trim();
    if (!id) throw new TypeError(`intent.crewIds[${index}] must be a non-empty Crew id`);
    return id;
  });
  if (new Set(crewIds).size !== crewIds.length) throw new TypeError('intent.crewIds must not contain duplicates');
  return Object.freeze([...crewIds].sort());
}

function normalizeIntent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('intent must be an object');
  const keys = Object.keys(raw).sort();
  const allowed = new Set([...INTENT_KEYS, ...OPTIONAL_INTENT_KEYS]);
  const missing = INTENT_KEYS.filter(key => !keys.includes(key));
  const unknown = keys.filter(key => !allowed.has(key));
  if (missing.length || unknown.length) {
    throw new TypeError(`intent must contain exactly: ${INTENT_KEYS.join(', ')}, with optional crewIds`);
  }
  const actionId = nonEmpty(raw.actionId, 'intent.actionId');
  if (!ACTIONS.includes(actionId)) throw new RangeError(`unsupported local replay action: ${actionId}`);
  const cursorXM = finite(raw.cursorXM, 'intent.cursorXM');
  const cursorZM = finite(raw.cursorZM, 'intent.cursorZM');
  const stepCount = nonNegativeInteger(raw.stepCount, 'intent.stepCount');
  if (stepCount > LOCAL_OUTCOME_REPLAY_MAX_STEPS) {
    throw new RangeError(`intent.stepCount must be <= ${LOCAL_OUTCOME_REPLAY_MAX_STEPS}`);
  }
  const crewIds = normalizeCrewIds(raw.crewIds);
  return Object.freeze({
    actionId,
    cursorXM,
    cursorZM,
    stepCount,
    ...(crewIds === undefined ? {} : { crewIds })
  });
}

function stateHash(simulation) {
  return sha256Canonical(simulation.debugCanonicalSnapshot());
}

function createGenesis(regionSeatId, genesisWorldHourIndex) {
  const seat = normalizeRegionSeatId(regionSeatId);
  const worldHour = nonNegativeInteger(genesisWorldHourIndex, 'genesisWorldHourIndex');
  const lightingPhase = lightingPhaseForWorldHour(worldHour);
  const simulation = createLocalRegionSimulation(createStarterRegion(seat), {
    initialLightingPhase: lightingPhase
  });
  const initialStateHash = stateHash(simulation);
  const digest = sha256Canonical({
    schema: LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA,
    regionSeatId: seat,
    genesisWorldHourIndex: worldHour,
    lightingPhase,
    stepMs: LOCAL_REGION_DEFAULT_STEP_MS,
    initialStateHash
  });
  return Object.freeze({
    regionSeatId: seat,
    genesisWorldHourIndex: worldHour,
    lightingPhase,
    stepMs: LOCAL_REGION_DEFAULT_STEP_MS,
    initialStateHash,
    digest,
    simulation
  });
}

function physicalCommandDigest({ previousStateHash, intent, regionSeatId, worldHourIndex, lightingPhase }) {
  return sha256Canonical({
    intentSchema: LOCAL_OUTCOME_INTENT_SCHEMA,
    previousStateHash,
    intent,
    regionSeatId,
    worldHourIndex,
    lightingPhase,
    stepMs: LOCAL_REGION_DEFAULT_STEP_MS
  });
}

function salvageDebitDigest({ previousStateHash, transferId, amountMilli, regionSeatId, worldHourIndex, lightingPhase }) {
  return sha256Canonical({
    schema: LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA,
    previousStateHash,
    transferId,
    amountMilli,
    regionSeatId,
    worldHourIndex,
    lightingPhase
  });
}

function admissionDigest(physicalDigest, participant) {
  return sha256Canonical({
    physicalCommandDigest: physicalDigest,
    participant
  });
}

function salvageDebitAdmissionDigest(localDebitDigest, participant) {
  return sha256Canonical({
    localDebitDigest,
    participant
  });
}

function entryHashInput(entry) {
  return {
    schema: entry.schema,
    revision: entry.revision,
    commandId: entry.commandId,
    participantId: entry.participantId,
    controllerKind: entry.controllerKind,
    regionSeatId: entry.regionSeatId,
    genesisDigest: entry.genesisDigest,
    worldHourIndex: entry.worldHourIndex,
    lightingPhase: entry.lightingPhase,
    physicalIntent: entry.physicalIntent,
    physicalCommandDigest: entry.physicalCommandDigest,
    admissionDigest: entry.admissionDigest,
    recordedAtMs: entry.recordedAtMs,
    previousStateHash: entry.previousStateHash,
    stateHash: entry.stateHash,
    previousHash: entry.previousHash
  };
}

function salvageDebitEntryHashInput(entry) {
  return {
    schema: entry.schema,
    revision: entry.revision,
    commandId: entry.commandId,
    participantId: entry.participantId,
    controllerKind: entry.controllerKind,
    regionSeatId: entry.regionSeatId,
    genesisDigest: entry.genesisDigest,
    worldHourIndex: entry.worldHourIndex,
    lightingPhase: entry.lightingPhase,
    transferId: entry.transferId,
    amountMilli: entry.amountMilli,
    localDebitDigest: entry.localDebitDigest,
    admissionDigest: entry.admissionDigest,
    recordedAtMs: entry.recordedAtMs,
    previousStateHash: entry.previousStateHash,
    stateHash: entry.stateHash,
    previousHash: entry.previousHash
  };
}

function applyPhysicalCommand(simulation, intent, worldHourIndex) {
  const lightingPhase = lightingPhaseForWorldHour(worldHourIndex);
  simulation.setLightingPhase(lightingPhase);
  const action = simulation.issueLocalAction(intent.actionId, {
    cursorXM: intent.cursorXM,
    cursorZM: intent.cursorZM,
    crewIds: intent.crewIds ?? null
  });
  if (!action.accepted) return Object.freeze({ accepted: false, reason: action.reason, lightingPhase });
  simulation.advance(intent.stepCount * LOCAL_REGION_DEFAULT_STEP_MS);
  return Object.freeze({ accepted: true, action, lightingPhase });
}

function availableStoredScrapMilli(simulation) {
  return Math.max(0, Math.floor((simulation.storage.scrap + SCRAP_EPSILON) * SCRAP_MILLI_PER_UNIT));
}

function applySalvageDebit(simulation, amountMilli, worldHourIndex) {
  const lightingPhase = lightingPhaseForWorldHour(worldHourIndex);
  simulation.setLightingPhase(lightingPhase);
  const availableScrapMilli = availableStoredScrapMilli(simulation);
  if (amountMilli > availableScrapMilli) {
    return Object.freeze({
      accepted: false,
      reason: 'insufficient-local-scrap-for-transfer',
      amountMilli,
      availableScrapMilli,
      lightingPhase
    });
  }
  simulation.storage.scrap = Math.max(0, simulation.storage.scrap - amountMilli / SCRAP_MILLI_PER_UNIT);
  simulation.revision += 1;
  return Object.freeze({
    accepted: true,
    amountMilli,
    availableBeforeMilli: availableScrapMilli,
    availableAfterMilli: availableStoredScrapMilli(simulation),
    lightingPhase
  });
}

function replayEntries(entries, { regionSeatId, genesisWorldHourIndex }) {
  const genesis = createGenesis(regionSeatId, genesisWorldHourIndex);
  const simulation = genesis.simulation;
  let previousHash = null;
  let currentStateHash = genesis.initialStateHash;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const revision = index + 1;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`local journal entry ${revision} must be an object`);
    const physicalEntry = entry.schema === LOCAL_REGION_COMMAND_JOURNAL_ENTRY_SCHEMA;
    const salvageDebitEntry = entry.schema === LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA;
    if (!physicalEntry && !salvageDebitEntry) throw new Error(`local journal schema mismatch at revision ${revision}`);
    if (entry.revision !== revision) throw new Error(`local journal revision mismatch at ${revision}`);
    if ((entry.previousHash ?? null) !== (previousHash ?? null)) throw new Error(`local journal chain broken at revision ${revision}`);
    if (entry.regionSeatId !== genesis.regionSeatId) throw new Error(`local journal seat mismatch at revision ${revision}`);
    if (entry.genesisDigest !== genesis.digest) throw new Error(`local journal genesis mismatch at revision ${revision}`);
    if (entry.previousStateHash !== currentStateHash) throw new Error(`local journal previous state hash mismatch at revision ${revision}`);

    const participant = normalizeParticipant({
      participantId: entry.participantId,
      controllerKind: entry.controllerKind
    });
    const worldHourIndex = nonNegativeInteger(entry.worldHourIndex, `entry ${revision} worldHourIndex`);
    const lightingPhase = lightingPhaseForWorldHour(worldHourIndex);
    if (entry.lightingPhase !== lightingPhase) throw new Error(`local journal lighting mismatch at revision ${revision}`);

    if (physicalEntry) {
      const intent = normalizeIntent(entry.physicalIntent);
      const actualPhysicalDigest = physicalCommandDigest({
        previousStateHash: currentStateHash,
        intent,
        regionSeatId: genesis.regionSeatId,
        worldHourIndex,
        lightingPhase
      });
      if (entry.physicalCommandDigest !== actualPhysicalDigest) throw new Error(`local journal physical command digest mismatch at revision ${revision}`);
      const actualAdmissionDigest = admissionDigest(actualPhysicalDigest, participant);
      if (entry.admissionDigest !== actualAdmissionDigest) throw new Error(`local journal admission digest mismatch at revision ${revision}`);

      const applied = applyPhysicalCommand(simulation, intent, worldHourIndex);
      if (!applied.accepted) throw new Error(`persisted local command rejected during replay at revision ${revision}: ${applied.reason}`);
      const actualStateHash = stateHash(simulation);
      if (entry.stateHash !== actualStateHash) throw new Error(`local journal state hash mismatch at revision ${revision}`);

      const actualEntryHash = sha256Canonical(entryHashInput(entry));
      if (entry.entryHash !== actualEntryHash) throw new Error(`local journal entry hash mismatch at revision ${revision}`);
      currentStateHash = actualStateHash;
    } else {
      const transferId = nonEmpty(entry.transferId, `entry ${revision} transferId`);
      const amountMilli = positiveInteger(entry.amountMilli, `entry ${revision} amountMilli`);
      const actualLocalDebitDigest = salvageDebitDigest({
        previousStateHash: currentStateHash,
        transferId,
        amountMilli,
        regionSeatId: genesis.regionSeatId,
        worldHourIndex,
        lightingPhase
      });
      if (entry.localDebitDigest !== actualLocalDebitDigest) throw new Error(`local journal salvage debit digest mismatch at revision ${revision}`);
      const actualAdmissionDigest = salvageDebitAdmissionDigest(actualLocalDebitDigest, participant);
      if (entry.admissionDigest !== actualAdmissionDigest) throw new Error(`local journal salvage debit admission digest mismatch at revision ${revision}`);

      const applied = applySalvageDebit(simulation, amountMilli, worldHourIndex);
      if (!applied.accepted) throw new Error(`persisted local salvage debit rejected during replay at revision ${revision}: ${applied.reason}`);
      const actualStateHash = stateHash(simulation);
      if (entry.stateHash !== actualStateHash) throw new Error(`local journal state hash mismatch at revision ${revision}`);

      const actualEntryHash = sha256Canonical(salvageDebitEntryHashInput(entry));
      if (entry.entryHash !== actualEntryHash) throw new Error(`local journal entry hash mismatch at revision ${revision}`);
      currentStateHash = actualStateHash;
    }

    previousHash = entry.entryHash;
  }

  return {
    genesis,
    simulation,
    revision: entries.length,
    headHash: previousHash,
    stateHash: currentStateHash
  };
}

export class LocalRegionCommandJournalAuthority {
  constructor({
    regionSeatId,
    genesisWorldHourIndex,
    store = createMemoryWorldJournalStore(),
    clock = () => Date.now(),
    maxCommands = LOCAL_REGION_COMMAND_JOURNAL_MAX_COMMANDS
  } = {}) {
    if (!store?.readAll || !store?.append) throw new TypeError('journal store required');
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (!Number.isInteger(maxCommands) || maxCommands <= 0) throw new RangeError('maxCommands must be a positive integer');
    this.schema = LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA;
    this.regionSeatId = normalizeRegionSeatId(regionSeatId);
    this.genesisWorldHourIndex = nonNegativeInteger(genesisWorldHourIndex, 'genesisWorldHourIndex');
    this.store = store;
    this.clock = clock;
    this.maxCommands = maxCommands;
    this.genesis = null;
    this.simulation = null;
    this.revision = 0;
    this.headHash = null;
    this.stateHash = null;
    this.#rehydrate();
  }

  #applyReplay(replay) {
    this.genesis = replay.genesis;
    this.simulation = replay.simulation;
    this.revision = replay.revision;
    this.headHash = replay.headHash;
    this.stateHash = replay.stateHash;
  }

  #rehydrate() {
    const replay = replayEntries(this.store.readAll(), {
      regionSeatId: this.regionSeatId,
      genesisWorldHourIndex: this.genesisWorldHourIndex
    });
    this.#applyReplay(replay);
  }

  submit(intentInput, {
    participant,
    worldHourIndex,
    expectedRevision = this.revision,
    recordedAtMs = this.clock()
  } = {}) {
    const intent = normalizeIntent(intentInput);
    const actor = normalizeParticipant(participant);
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const recorded = finite(recordedAtMs, 'recordedAtMs');
    if (recorded < 0) throw new RangeError('recordedAtMs must be non-negative');

    const replay = replayEntries(this.store.readAll(), {
      regionSeatId: this.regionSeatId,
      genesisWorldHourIndex: this.genesisWorldHourIndex
    });

    if (expected !== replay.revision) {
      this.#applyReplay(replay);
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        expectedRevision: expected,
        currentRevision: replay.revision,
        headHash: replay.headHash,
        stateHash: replay.stateHash
      });
    }
    if (replay.revision >= this.maxCommands) {
      this.#applyReplay(replay);
      return Object.freeze({
        accepted: false,
        reason: 'local-journal-cap-reached',
        revision: replay.revision,
        maxCommands: this.maxCommands,
        headHash: replay.headHash,
        stateHash: replay.stateHash
      });
    }

    const previousStateHash = replay.stateHash;
    const lightingPhase = lightingPhaseForWorldHour(hostWorldHour);
    const physicalDigest = physicalCommandDigest({
      previousStateHash,
      intent,
      regionSeatId: this.regionSeatId,
      worldHourIndex: hostWorldHour,
      lightingPhase
    });
    const actorAdmissionDigest = admissionDigest(physicalDigest, actor);
    const applied = applyPhysicalCommand(replay.simulation, intent, hostWorldHour);
    if (!applied.accepted) {
      this.#rehydrate();
      return Object.freeze({
        accepted: false,
        reason: applied.reason,
        revision: this.revision,
        stateHash: this.stateHash,
        lightingPhase
      });
    }

    const nextRevision = replay.revision + 1;
    const nextStateHash = stateHash(replay.simulation);
    const draft = {
      schema: LOCAL_REGION_COMMAND_JOURNAL_ENTRY_SCHEMA,
      revision: nextRevision,
      commandId: `local:${this.regionSeatId}:r${nextRevision}`,
      participantId: actor.participantId,
      controllerKind: actor.controllerKind,
      regionSeatId: this.regionSeatId,
      genesisDigest: replay.genesis.digest,
      worldHourIndex: hostWorldHour,
      lightingPhase,
      physicalIntent: intent,
      physicalCommandDigest: physicalDigest,
      admissionDigest: actorAdmissionDigest,
      recordedAtMs: recorded,
      previousStateHash,
      stateHash: nextStateHash,
      previousHash: replay.headHash
    };
    const entry = Object.freeze({
      ...draft,
      entryHash: sha256Canonical(entryHashInput(draft))
    });

    let append;
    try {
      append = this.store.append(entry, {
        expectedRevision: replay.revision,
        expectedHeadHash: replay.headHash
      });
    } catch (error) {
      this.#rehydrate();
      throw error;
    }
    if (!append.accepted) {
      this.#rehydrate();
      return Object.freeze({
        accepted: false,
        reason: append.reason,
        currentRevision: this.revision,
        headHash: this.headHash,
        stateHash: this.stateHash
      });
    }

    this.genesis = replay.genesis;
    this.simulation = replay.simulation;
    this.revision = nextRevision;
    this.headHash = entry.entryHash;
    this.stateHash = nextStateHash;

    return Object.freeze({
      accepted: true,
      authority: 'host-owned-local-rts-command-journal-v0',
      persistence: 'host-journaled-local-state-no-shared-world-mutation',
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.stateHash,
      physicalCommandDigest: physicalDigest,
      admissionDigest: actorAdmissionDigest,
      entry,
      outcome: this.simulation.snapshot()
    });
  }

  submitSalvageDebit({ transferId, amountMilli } = {}, {
    participant,
    worldHourIndex,
    expectedRevision = this.revision,
    expectedStateHash,
    recordedAtMs = this.clock()
  } = {}) {
    const id = nonEmpty(transferId, 'transferId');
    const amount = positiveInteger(amountMilli, 'amountMilli');
    const actor = normalizeParticipant(participant);
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const expected = nonNegativeInteger(expectedRevision, 'expectedRevision');
    const expectedState = nonEmpty(expectedStateHash, 'expectedStateHash');
    const recorded = finite(recordedAtMs, 'recordedAtMs');
    if (recorded < 0) throw new RangeError('recordedAtMs must be non-negative');

    const entries = this.store.readAll();
    const replay = replayEntries(entries, {
      regionSeatId: this.regionSeatId,
      genesisWorldHourIndex: this.genesisWorldHourIndex
    });
    const existing = entries.find(entry =>
      entry?.schema === LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA
      && entry.transferId === id
    ) || null;
    if (existing) {
      this.#applyReplay(replay);
      const sameRequest = existing.participantId === actor.participantId
        && existing.controllerKind === actor.controllerKind
        && existing.amountMilli === amount;
      return Object.freeze({
        accepted: sameRequest,
        reused: sameRequest,
        reason: sameRequest ? null : 'local-salvage-debit-transfer-id-conflict',
        authority: 'host-owned-local-rts-salvage-debit-v0',
        persistence: 'host-journaled-local-storage-debit-no-global-credit',
        transferId: id,
        amountMilli: amount,
        sourceRevision: existing.revision - 1,
        sourceStateHash: existing.previousStateHash,
        resultingLocalRevision: existing.revision,
        resultingLocalStateHash: existing.stateHash,
        localDebitDigest: existing.localDebitDigest,
        admissionDigest: existing.admissionDigest,
        entry: existing,
        currentRevision: replay.revision,
        currentStateHash: replay.stateHash
      });
    }

    if (expected !== replay.revision) {
      this.#applyReplay(replay);
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-revision-conflict',
        transferId: id,
        expectedRevision: expected,
        currentRevision: replay.revision,
        headHash: replay.headHash,
        stateHash: replay.stateHash
      });
    }
    if (expectedState !== replay.stateHash) {
      this.#applyReplay(replay);
      return Object.freeze({
        accepted: false,
        reason: 'local-authority-state-conflict',
        transferId: id,
        expectedStateHash: expectedState,
        currentStateHash: replay.stateHash,
        currentRevision: replay.revision,
        headHash: replay.headHash
      });
    }
    if (replay.revision >= this.maxCommands) {
      this.#applyReplay(replay);
      return Object.freeze({
        accepted: false,
        reason: 'local-journal-cap-reached',
        transferId: id,
        revision: replay.revision,
        maxCommands: this.maxCommands,
        headHash: replay.headHash,
        stateHash: replay.stateHash
      });
    }

    const sourceRevision = replay.revision;
    const sourceStateHash = replay.stateHash;
    const lightingPhase = lightingPhaseForWorldHour(hostWorldHour);
    const localDebitDigest = salvageDebitDigest({
      previousStateHash: sourceStateHash,
      transferId: id,
      amountMilli: amount,
      regionSeatId: this.regionSeatId,
      worldHourIndex: hostWorldHour,
      lightingPhase
    });
    const actorAdmissionDigest = salvageDebitAdmissionDigest(localDebitDigest, actor);
    const applied = applySalvageDebit(replay.simulation, amount, hostWorldHour);
    if (!applied.accepted) {
      this.#rehydrate();
      return Object.freeze({
        accepted: false,
        reason: applied.reason,
        transferId: id,
        amountMilli: amount,
        availableScrapMilli: applied.availableScrapMilli,
        revision: this.revision,
        stateHash: this.stateHash,
        lightingPhase
      });
    }

    const nextRevision = replay.revision + 1;
    const nextStateHash = stateHash(replay.simulation);
    const draft = {
      schema: LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA,
      revision: nextRevision,
      commandId: `local:${this.regionSeatId}:salvage-debit:${id}:r${nextRevision}`,
      participantId: actor.participantId,
      controllerKind: actor.controllerKind,
      regionSeatId: this.regionSeatId,
      genesisDigest: replay.genesis.digest,
      worldHourIndex: hostWorldHour,
      lightingPhase,
      transferId: id,
      amountMilli: amount,
      localDebitDigest,
      admissionDigest: actorAdmissionDigest,
      recordedAtMs: recorded,
      previousStateHash: sourceStateHash,
      stateHash: nextStateHash,
      previousHash: replay.headHash
    };
    const entry = Object.freeze({
      ...draft,
      entryHash: sha256Canonical(salvageDebitEntryHashInput(draft))
    });

    let append;
    try {
      append = this.store.append(entry, {
        expectedRevision: replay.revision,
        expectedHeadHash: replay.headHash
      });
    } catch (error) {
      this.#rehydrate();
      throw error;
    }
    if (!append.accepted) {
      this.#rehydrate();
      return Object.freeze({
        accepted: false,
        reason: append.reason,
        transferId: id,
        currentRevision: this.revision,
        headHash: this.headHash,
        stateHash: this.stateHash
      });
    }

    this.genesis = replay.genesis;
    this.simulation = replay.simulation;
    this.revision = nextRevision;
    this.headHash = entry.entryHash;
    this.stateHash = nextStateHash;

    return Object.freeze({
      accepted: true,
      reused: false,
      authority: 'host-owned-local-rts-salvage-debit-v0',
      persistence: 'host-journaled-local-storage-debit-no-global-credit',
      transferId: id,
      amountMilli: amount,
      amountScrap: amount / SCRAP_MILLI_PER_UNIT,
      sourceRevision,
      sourceStateHash,
      resultingLocalRevision: this.revision,
      resultingLocalStateHash: this.stateHash,
      headHash: this.headHash,
      localDebitDigest,
      admissionDigest: actorAdmissionDigest,
      entry,
      outcome: this.simulation.snapshot(),
      truthBoundary: 'real-host-local-storage-debit-only-no-reservation-consumption-no-global-credit'
    });
  }

  meta() {
    return Object.freeze({
      schema: LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA,
      regionSeatId: this.regionSeatId,
      genesisWorldHourIndex: this.genesisWorldHourIndex,
      genesisDigest: this.genesis.digest,
      genesisStateHash: this.genesis.initialStateHash,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.stateHash,
      storeKind: this.store.kind || 'unknown',
      maxCommands: this.maxCommands,
      persistence: 'host-journaled-local-state-no-shared-world-mutation'
    });
  }

  authoritativeSnapshot() {
    return Object.freeze({
      schema: LOCAL_REGION_COMMAND_JOURNAL_AUTHORITY_SCHEMA,
      revision: this.revision,
      headHash: this.headHash,
      stateHash: this.stateHash,
      regionSeatId: this.regionSeatId,
      state: this.simulation.snapshot()
    });
  }

  verifyPersistedJournal() {
    const replay = replayEntries(this.store.readAll(), {
      regionSeatId: this.regionSeatId,
      genesisWorldHourIndex: this.genesisWorldHourIndex
    });
    return Object.freeze({
      accepted: true,
      revision: replay.revision,
      headHash: replay.headHash,
      stateHash: replay.stateHash,
      matchesLive:
        replay.revision === this.revision
        && replay.headHash === this.headHash
        && replay.stateHash === this.stateHash
    });
  }
}

export function createLocalRegionCommandJournalAuthority(options = {}) {
  return new LocalRegionCommandJournalAuthority(options);
}
