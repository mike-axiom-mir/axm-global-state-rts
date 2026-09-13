export const VERIFIED_LOCAL_SALVAGE_RESERVATION_LEDGER_SCHEMA =
  'axm.global-state-rts.verified-local-salvage-reservation-ledger/v0.1';
export const VERIFIED_LOCAL_SALVAGE_RESERVATION_ACCOUNT_SCHEMA =
  'axm.global-state-rts.verified-local-salvage-reservation-account/v0.1';

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

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
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

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function emptyAccount(participantId) {
  return {
    schema: VERIFIED_LOCAL_SALVAGE_RESERVATION_ACCOUNT_SCHEMA,
    participantId,
    sourcesBySeat: {}
  };
}

function normalizeSource(raw, seatId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`verified local salvage reservation source ${seatId} must be an object`);
  }
  const regionSeatId = normalizeSeatId(raw.regionSeatId ?? seatId);
  if (regionSeatId !== seatId) throw new Error(`verified local salvage reservation seat mismatch: ${seatId}`);
  return Object.freeze({
    regionSeatId,
    sourceRevision: nonNegativeInteger(raw.sourceRevision, `${seatId}.sourceRevision`),
    sourceStateHash: nonEmpty(raw.sourceStateHash, `${seatId}.sourceStateHash`),
    reservedScrapMilli: nonNegativeInteger(raw.reservedScrapMilli, `${seatId}.reservedScrapMilli`),
    controllerKind: normalizeControllerKind(raw.controllerKind),
    updatedAtWorldHourIndex: nonNegativeInteger(
      raw.updatedAtWorldHourIndex,
      `${seatId}.updatedAtWorldHourIndex`
    )
  });
}

function normalizePersistedAccount(snapshot) {
  const participantId = nonEmpty(snapshot?.participantId, 'participantId');
  const persisted = snapshot?.verifiedLocalSalvageReservation;
  if (!persisted) return null;
  if (typeof persisted !== 'object' || Array.isArray(persisted)) {
    throw new TypeError(`verifiedLocalSalvageReservation for ${participantId} must be an object`);
  }
  if (persisted.schema !== VERIFIED_LOCAL_SALVAGE_RESERVATION_ACCOUNT_SCHEMA) {
    throw new Error(`verifiedLocalSalvageReservation schema mismatch for ${participantId}`);
  }
  const sources = persisted.sourcesBySeat || {};
  if (typeof sources !== 'object' || Array.isArray(sources)) {
    throw new TypeError(`verifiedLocalSalvageReservation.sourcesBySeat for ${participantId} must be an object`);
  }
  const normalized = emptyAccount(participantId);
  for (const seatId of Object.keys(sources).sort()) {
    normalized.sourcesBySeat[normalizeSeatId(seatId)] = normalizeSource(sources[seatId], seatId);
  }
  return normalized;
}

function accountSummary(account) {
  const sources = Object.values(account.sourcesBySeat).sort((a, b) => a.regionSeatId.localeCompare(b.regionSeatId));
  const reservedScrapMilli = sources.reduce((total, source) => total + source.reservedScrapMilli, 0);
  return Object.freeze({
    schema: VERIFIED_LOCAL_SALVAGE_RESERVATION_ACCOUNT_SCHEMA,
    participantId: account.participantId,
    reservedScrapMilli,
    reservedScrap: reservedScrapMilli / 1000,
    sourceCount: sources.length,
    sources: Object.freeze(sources.map(source => Object.freeze({ ...source }))),
    reservationMeaning:
      'explicit-host-account-reservation-of-verified-local-salvage-not-transfer-not-global-currency'
  });
}

export class VerifiedLocalSalvageReservationLedger {
  constructor({ restoredAccounts = [] } = {}) {
    if (!Array.isArray(restoredAccounts)) throw new TypeError('restoredAccounts must be an array');
    this.schema = VERIFIED_LOCAL_SALVAGE_RESERVATION_LEDGER_SCHEMA;
    this.accounts = new Map();
    this.revision = 0;
    for (const snapshot of restoredAccounts) {
      if (snapshot?.profileKind !== 'world-account') continue;
      const account = normalizePersistedAccount(snapshot);
      if (account) this.accounts.set(account.participantId, account);
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
    return accountSummary(this.accounts.get(id) || emptyAccount(id));
  }

  source(participantId, regionSeatId) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    return this.accounts.get(id)?.sourcesBySeat?.[seatId] || null;
  }

  reserve({
    participantId,
    controllerKind,
    regionSeatId,
    sourceRevision,
    sourceStateHash,
    verifiedScrapMilli,
    amountMilli,
    worldHourIndex
  } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const kind = normalizeControllerKind(controllerKind);
    const seatId = normalizeSeatId(regionSeatId);
    const revision = nonNegativeInteger(sourceRevision, 'sourceRevision');
    const stateHash = nonEmpty(sourceStateHash, 'sourceStateHash');
    const verified = nonNegativeInteger(verifiedScrapMilli, 'verifiedScrapMilli');
    const amount = positiveInteger(amountMilli, 'amountMilli');
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const account = this.#account(id);
    const previous = account.sourcesBySeat[seatId] || null;

    if (previous) {
      if (revision < previous.sourceRevision) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-reservation-stale-source',
          participantId: id,
          regionSeatId: seatId,
          requestedRevision: revision,
          currentRevision: previous.sourceRevision
        });
      }
      if (revision === previous.sourceRevision && stateHash !== previous.sourceStateHash) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-reservation-source-mismatch',
          participantId: id,
          regionSeatId: seatId,
          sourceRevision: revision
        });
      }
      if (verified < previous.reservedScrapMilli) {
        return Object.freeze({
          accepted: false,
          reason: 'verified-local-salvage-reservation-source-no-longer-covers-reserved',
          participantId: id,
          regionSeatId: seatId,
          reservedScrapMilli: previous.reservedScrapMilli,
          verifiedScrapMilli: verified
        });
      }
    }

    const currentReserved = previous?.reservedScrapMilli || 0;
    const available = verified - currentReserved;
    if (amount > available) {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-exceeds-available',
        participantId: id,
        regionSeatId: seatId,
        requestedScrapMilli: amount,
        availableScrapMilli: available,
        verifiedScrapMilli: verified,
        reservedScrapMilli: currentReserved
      });
    }

    const source = Object.freeze({
      regionSeatId: seatId,
      sourceRevision: revision,
      sourceStateHash: stateHash,
      reservedScrapMilli: currentReserved + amount,
      controllerKind: kind,
      updatedAtWorldHourIndex: hostWorldHour
    });
    account.sourcesBySeat[seatId] = source;
    this.revision += 1;

    return Object.freeze({
      accepted: true,
      participantId: id,
      controllerKind: kind,
      regionSeatId: seatId,
      reservedNowMilli: amount,
      reservedNow: amount / 1000,
      source,
      summary: this.summary(id),
      truthBoundary:
        'reservation-prevents-current-host-local-repair-use-but-does-not-transfer-credit-or-create-global-currency'
    });
  }

  release({ participantId, regionSeatId, amountMilli, worldHourIndex } = {}) {
    const id = nonEmpty(participantId, 'participantId');
    const seatId = normalizeSeatId(regionSeatId);
    const amount = positiveInteger(amountMilli, 'amountMilli');
    const hostWorldHour = nonNegativeInteger(worldHourIndex, 'worldHourIndex');
    const account = this.accounts.get(id);
    const previous = account?.sourcesBySeat?.[seatId] || null;
    if (!previous || previous.reservedScrapMilli === 0) {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-reservation-empty',
        participantId: id,
        regionSeatId: seatId
      });
    }
    if (amount > previous.reservedScrapMilli) {
      return Object.freeze({
        accepted: false,
        reason: 'verified-local-salvage-release-exceeds-reserved',
        participantId: id,
        regionSeatId: seatId,
        requestedScrapMilli: amount,
        reservedScrapMilli: previous.reservedScrapMilli
      });
    }

    const source = Object.freeze({
      ...previous,
      reservedScrapMilli: previous.reservedScrapMilli - amount,
      updatedAtWorldHourIndex: hostWorldHour
    });
    account.sourcesBySeat[seatId] = source;
    this.revision += 1;
    return Object.freeze({
      accepted: true,
      participantId: id,
      regionSeatId: seatId,
      releasedNowMilli: amount,
      releasedNow: amount / 1000,
      source,
      summary: this.summary(id),
      truthBoundary:
        'explicit-release-removes-reservation-only-no-transfer-credit-or-global-currency-created'
    });
  }

  overlayWorldAccounts(accounts) {
    if (!Array.isArray(accounts)) throw new TypeError('accounts must be an array');
    return Object.freeze(accounts.map(snapshot => {
      const participantId = nonEmpty(snapshot?.participantId, 'account participantId');
      const account = this.accounts.get(participantId);
      if (!account && !snapshot?.verifiedLocalSalvageReservation) return Object.freeze(cloneJson(snapshot));
      const resolved = account || normalizePersistedAccount(snapshot) || emptyAccount(participantId);
      return Object.freeze({
        ...cloneJson(snapshot),
        verifiedLocalSalvageReservation: Object.freeze({
          schema: VERIFIED_LOCAL_SALVAGE_RESERVATION_ACCOUNT_SCHEMA,
          participantId,
          sourcesBySeat: Object.freeze(Object.fromEntries(
            Object.entries(resolved.sourcesBySeat)
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
      schema: VERIFIED_LOCAL_SALVAGE_RESERVATION_LEDGER_SCHEMA,
      revision: this.revision,
      accountCount: participantIds.length,
      accounts: Object.freeze(participantIds.map(participantId => this.summary(participantId))),
      truthBoundary:
        'restart-persistent-reservation-layer-only-current-host-repair-guarded-no-global-transfer-credit-or-spend'
    });
  }
}

export function createVerifiedLocalSalvageReservationLedger(options = {}) {
  return new VerifiedLocalSalvageReservationLedger(options);
}
