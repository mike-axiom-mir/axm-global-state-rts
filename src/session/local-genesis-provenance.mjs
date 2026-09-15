export const LOCAL_REGION_GENESIS_PROVENANCE_SCHEMA =
  'axm.global-state-rts.local-region-genesis-provenance/v0.1';

const SCRAP_EPSILON = 1e-9;

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

function nonNegativeFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} must be finite and non-negative`);
  return number;
}

export function normalizeLocalRegionGenesisProvenance(raw = null) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('genesisProvenance must be an object or null');
  const localStarterScrap = nonNegativeFinite(raw.localStarterScrap ?? 0, 'genesisProvenance.localStarterScrap');
  const hostStartingScrap = nonNegativeFinite(raw.hostStartingScrap ?? 0, 'genesisProvenance.hostStartingScrap');
  const combinedStartingScrap = localStarterScrap + hostStartingScrap;
  if (raw.combinedStartingScrap !== undefined && Math.abs(nonNegativeFinite(raw.combinedStartingScrap, 'genesisProvenance.combinedStartingScrap') - combinedStartingScrap) > SCRAP_EPSILON) {
    throw new RangeError('genesisProvenance.combinedStartingScrap must equal localStarterScrap + hostStartingScrap');
  }
  const hostRunId = raw.hostRunId === null || raw.hostRunId === undefined || raw.hostRunId === ''
    ? null
    : nonEmpty(raw.hostRunId, 'genesisProvenance.hostRunId');
  if (hostStartingScrap > SCRAP_EPSILON && !hostRunId) throw new TypeError('genesisProvenance.hostRunId required when hostStartingScrap is positive');
  const source = String(raw.source || (hostRunId ? 'local-starter-plus-applied-next-drop-claim' : 'local-starter-only'));
  return Object.freeze({
    schema: LOCAL_REGION_GENESIS_PROVENANCE_SCHEMA,
    localStarterScrap,
    hostStartingScrap,
    combinedStartingScrap,
    protectedGenesisScrap: combinedStartingScrap,
    hostRunId,
    source,
    accounting: 'genesis-scrap-is-physical-and-spendable-local-value-but-not-earned-salvage'
  });
}
