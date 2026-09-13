export const VERIFIED_LOCAL_SALVAGE_LEDGER_SCHEMA =
  'axm.global-state-rts.verified-local-salvage-ledger/v0.1';
export const VERIFIED_LOCAL_SALVAGE_ACCOUNT_SCHEMA =
  'axm.global-state-rts.verified-local-salvage-account/v0.1';

const CONTROLLER_KINDS = Object.freeze(['human', 'machine']);

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return number;
}

function normalizeSeatId(value) {
  const seatId = nonEmpty(value, 'regionSeatId');
  if (!/^seat-[1-4]$/.test(seatId)) throw new RangeError('regionSeatId must be seat-1 through seat-4');
  return seatId;
}

function normalizeControllerKind(value) {
  const kind = nonEmpty(value, 'controllerKind');
  if (!CONTROLLER_KINDS.includes(kind)) throw new RangeError('controllerKind must be human or machine');
  return kind;
}

function scrapMilliFrom(value) {
  const scrap = Number(value);
  if (!Number.isFinite(scrap) || scrap < 0) throw new RangeError('storageScrap must be finite and non-negative');
  return Math.round(scrap * 1000);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function emptyAccount(participantId) {
  return {
    schema: VERIFIED_LOCAL_SALVAGE_ACCOUNT_SCHEMA,
    participantId,
    sourcesBySeat: {}
  };
}

function normalizeSource(raw, seatId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`verified local salvage source ${seatId} must be an object`);
  }
  const regionSeatId = normalizeSeatId(raw.regionSeatId ?? seatId);
  if (regionSeatId !== seatId) throw new Error(`verified local salvage source seat mismatch: ${seatId}`);
  return Object.freeze({
    regionSeatId,
    revision: nonNegativeInteger(raw.revision, `${seatId}.revision`),
    stateHash: nonEmpty(raw.stateHash, `${seatId}.stateHash`),
    recordedScrapMilli: nonNegativeInteger(raw.recordedScrapMilli, `${seatId}.recordedScrapMilli`),
    controllerKind: normalizeControllerKind(raw.controllerKind),
    recordedAtWorldHourIndex: nonNegativeInteger(
      raw.recordedAtWorldHourIndex,
      `${seatId}.recordedAtWorldHourIndex`
    )
  });
}

function normalizePersistedAccount(snapshot) {
  const participantId = nonEmpty(snapshot?.participantId, 'participantId');
  const persisted = snapshot?.verifiedLocalSalvage;
  if (!persisted) return emptyAccount(participantId);
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    throw new TypeError(`verifiedLocalSalvage for ${participantId} must be an object`);
  }
  if (persisted.schema !== VERIFIED_LOCAL_SALVAGE_ACCOUNT_SCHEMA) {
    throw new Error(`verifiedLocalSalvage schema mismatch for ${participantId}`);
  }
  const sources = persisted.sourcesBySeat || {};
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) {
    throw new TypeError(`verifiedLocalSalvage.sourcesBySeat for ${participantId} must be an object`);
  }
  const normalized = emptyAccount(participantId);
  for (const seatId of Object.keys(sources).sort()) {
    normalized.sourcesBySeat[normalizeSeatId(seatId)] = normalizeSource(sources[seatId], seatId);
  }
  return normalized;
}

function accountSummary(account) {
  const sources = Object.values(account.sourcesBySeat).sort((a, b) => a.regionSeatId.localeCompare(b.regionSeatId));
  const scrapMilli = sources.reduce((total, source) => total + source.recordedScrapMilli, 0);
  return Object.freeze({
    schema: VERIFIED_LOCAL_SALVAGE_ACCOUNT_SCHEMA,
    participantId: account.participantId,
    scrapMilli,
    scrap: scrapMilli / 1000,
    sourceCount: sources.length,
    sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))),
    persistenceMeaning:
      'highest-host-verified-local-storage-scrap-per-seat-not-spendable-shared-economy'
  });
}

export class VerifiedLocalSalvageLedger {
  constructor({ restoredAccounts = [] } = {}) {
    if (!Array.isArray(restoredAccounts)) throw new TypeError('restoredAccounts must be an array');
    this.schema = VERIFIED_LOCAL_SALVAGE_LEDGER_SCHEMA;
    this.accounts = new Map();
    this.revision = 0;
    for (const snapshot of restoredAccounts) {
      if (snapshot?.profileKind !== 'world-account') continue;
      const account = normalizePersistedAccount(snapshot);
      this.accounts.set(account.participantId, account);
    }
  }

  #account(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    let account = this.accounts.get(id);
    if (!account) {
      account = emptyAccount(id);
      this.accounts.set(id, account);
    }
    return account;
  }

  summary(participantId) {
    const id = nonEmpty(participantId, 'participantId');
    const account = this.accounts.get(id) || emptyAccount(id);
    return accountSummary(account);
  }

  record({
    participantId,
    controllerKind,
    regionSeatId,
    revision,
    stateHash,
    storageScrap,
    worldHourIndex
  } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const kind = normalizeControllerKind(controllerKind);
    const seatId = normalizeSeatId(regionSeatId);
    const sourceRevision = nonNegativeInteger(revision, 'revision');
    const sourceStateHash = nonEmpty(stateHash, 'stateHash');
    const currentScrapMilli = scrapMilliFrom(storageScrap);
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const account = this.#account(id);
    const previous = account.sourcesBySeat[seatId] || null;

    if (previous) {
      if (sourceRevision < previous.revision) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-stale-source-revision',
          participantId: id,
          regionSeatId: seatId,
          requestedRevision: sourceRevision,
          currentRevision: previous.revision
        });
      }
      if (sourceRevision === previous.revision) {
        if (sourceStateHash !== previous.stateHash || currentScrapMilli !== previous.recordedScrapMilli) {
          return Object.freeze({
            accepted: false,
            reason: 'verified-local-salvage-same-revision-mismatch',
            participantId: id,
            regionSeatId: seatId,
            revision: sourceRevision
          });
        }
        return Object.freeze({
          accepted: true,
          reused: true,
          participantId: id,
          controllerKind: kind,
          regionSeatId: seatId,
          creditedScrapMilli: 0,
          creditedScrap: 0,
          summary: this.summary(id),
          source: previous,
          truthBoundary:
            'idempotent-persistent-record-of-host-verified-storage-high-water-not-currency-transfer'
        });
      }
      if (currentScrapMilli < previous.recordedScrapMilli) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-source-regressed',
          participantId: id,
          regionSeatId: seatId,
          revision: sourceRevision,
          previousScrapMilli: previous.recordedScrapMilli,
          currentScrapMilli
        });
      }
    }

    const previousScrapMilli = previous?.recordedScrapMilli || 0;
    const creditedScrapMilli = currentScrapMilli - previousScrapMilli;
    const source = Object.freeze({
      regionSeatId: seatId,
      revision: sourceRevision,
      stateHash: sourceStateHash,
      recordedScrapMilli: currentScrapMilli,
      controllerKind: kind,
      recordedAtWorldHourIndex: hostWorldHour
    });
    account.sourcesBySeat[seatId] = source;
    this.revision += 1;

    return Object.freeze({
      accepted: true,
      reused: false,
      participantId: id,
      controllerKind: kind,
      regionSeatId: seatId,
      creditedScrapMilli,
      creditedScrap: creditedScrapMilli / 1000,
      summary: this.summary(id),
      source,
      truthBoundary:
        'persistent-record-of-host-verified-storage-high-water-not-currency-transfer'
    });
  }

  overlayWorldAccounts(accounts) {
    if (!Array.isArray(accounts)) throw new TypeError('accounts must be an array');
    return Object.freeze(accounts.map(snapshot => {
      const participantId = nonEmpty(snapshot?.participantId, 'account participantId');
      const account = this.accounts.get(participantId) || emptyAccount(participantId);
      return Object.freeze({
        ...cloneJson(snapshot),
        verifiedLocalSalvage: Object.freeze({
          schema: VERIFIED_LOCAL_SALVAGE_ACCOUNT_SCHEMA,
          participantId,
          sourcesBySeat: Object.freeze(Object.fromEntries(
            Object.entries(account.sourcesBySeat)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([seatId, source]) => [seatId, Object.freeze({ ...source })])
          ))
        })
      });
    }));
  }

  snapshot() {
    const participantIds = [...this.accounts.keys()].sort();
    return Object.freeze({
      schema: VERIFIED_LOCAL_SALVAGE_LEDGER_SCHEMA,
      revision: this.revision,
      accountCount: participantIds.length,
      accounts: Object.freeze(participantIds.map(participantId => this.summary(participantId))),
      truthBoundary:
        'account-persistent-proof-of-host-local-storage-high-water-not-spendable-shared-world-economy'
    });
  }
}

export function createVerifiedLocalSalvageLedger(options = {}) {
  return new VerifiedLocalSalvageLedger(options);
}
