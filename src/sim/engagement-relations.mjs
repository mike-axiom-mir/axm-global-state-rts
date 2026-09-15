export const ENGAGEMENT_RELATIONS_SCHEMA = 'axm.global-state-rts.engagement-relations/v0.1';

export const ENGAGEMENT_MODES = Object.freeze({
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
  DEFENSIVE: 'defensive'
});

function normalizedOwnerId(value) {
  const id = String(value || '').trim();
  if (!id) throw new TypeError('ownerId required');
  return id;
}

export function normalizeEngagementTarget(target) {
  if (!target || typeof target !== 'object') throw new TypeError('engagement target object required');
  const kind = String(target.kind || '').trim();
  const id = String(target.id || '').trim();
  if (!kind) throw new TypeError('engagement target kind required');
  if (!id) throw new TypeError('engagement target id required');
  return Object.freeze({ kind, id });
}

function targetKey(target) {
  const normalized = normalizeEngagementTarget(target);
  return JSON.stringify([normalized.kind, normalized.id]);
}

function normalizeMode(value) {
  const mode = String(value || ENGAGEMENT_MODES.AUTOMATIC);
  if (!Object.values(ENGAGEMENT_MODES).includes(mode)) throw new RangeError(`unsupported engagement mode: ${mode}`);
  return mode;
}

function frozenDecision(fields) {
  return Object.freeze({
    allowed: false,
    relation: 'default',
    mode: ENGAGEMENT_MODES.AUTOMATIC,
    reason: 'blocked',
    ...fields
  });
}

export class EngagementRelations {
  constructor({ ownerId, neutralTargets = [] } = {}) {
    this.schema = ENGAGEMENT_RELATIONS_SCHEMA;
    this.ownerId = normalizedOwnerId(ownerId);
    this.revision = 0;
    this.neutralTargets = new Map();

    if (!Array.isArray(neutralTargets)) throw new TypeError('neutralTargets must be an array');
    for (const target of neutralTargets) {
      const normalized = normalizeEngagementTarget(target);
      this.neutralTargets.set(targetKey(normalized), normalized);
    }
  }

  isNeutral(target) {
    return this.neutralTargets.has(targetKey(target));
  }

  setNeutral(target, neutral = true) {
    const normalized = normalizeEngagementTarget(target);
    const key = targetKey(normalized);
    const next = Boolean(neutral);
    const current = this.neutralTargets.has(key);
    if (current === next) {
      return Object.freeze({
        accepted: true,
        changed: false,
        ownerId: this.ownerId,
        target: normalized,
        neutral: next,
        revision: this.revision
      });
    }

    if (next) this.neutralTargets.set(key, normalized);
    else this.neutralTargets.delete(key);
    this.revision += 1;
    return Object.freeze({
      accepted: true,
      changed: true,
      ownerId: this.ownerId,
      target: normalized,
      neutral: next,
      revision: this.revision
    });
  }

  engagementDecision(target, {
    mode = ENGAGEMENT_MODES.AUTOMATIC,
    attackedByTarget = false
  } = {}) {
    const normalized = normalizeEngagementTarget(target);
    const resolvedMode = normalizeMode(mode);
    const neutral = this.isNeutral(normalized);
    const relation = neutral ? 'neutral' : 'default';

    if (resolvedMode === ENGAGEMENT_MODES.MANUAL) {
      return frozenDecision({
        allowed: true,
        relation,
        mode: resolvedMode,
        target: normalized,
        reason: neutral ? 'explicit-order-overrides-neutral-auto-restraint' : 'explicit-attack-order'
      });
    }

    if (resolvedMode === ENGAGEMENT_MODES.DEFENSIVE) {
      if (!attackedByTarget) {
        return frozenDecision({
          allowed: false,
          relation,
          mode: resolvedMode,
          target: normalized,
          reason: 'defensive-response-requires-attack'
        });
      }
      return frozenDecision({
        allowed: true,
        relation,
        mode: resolvedMode,
        target: normalized,
        reason: neutral ? 'neutral-target-attacked-owner-defense-allowed' : 'attacker-defense-allowed'
      });
    }

    if (neutral) {
      return frozenDecision({
        allowed: false,
        relation,
        mode: resolvedMode,
        target: normalized,
        reason: 'neutral-target-suppresses-auto-engagement'
      });
    }

    return frozenDecision({
      allowed: true,
      relation,
      mode: resolvedMode,
      target: normalized,
      reason: 'target-not-neutral'
    });
  }

  autoEngage(target) {
    return this.engagementDecision(target, { mode: ENGAGEMENT_MODES.AUTOMATIC });
  }

  defendAgainst(target, { attackedByTarget = true } = {}) {
    return this.engagementDecision(target, {
      mode: ENGAGEMENT_MODES.DEFENSIVE,
      attackedByTarget
    });
  }

  snapshot() {
    const neutralTargets = [...this.neutralTargets.values()]
      .map(target => Object.freeze({ ...target }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return Object.freeze({
      schema: ENGAGEMENT_RELATIONS_SCHEMA,
      ownerId: this.ownerId,
      revision: this.revision,
      neutralTargets: Object.freeze(neutralTargets),
      semantics: Object.freeze({
        neutralIsOneSided: true,
        suppressesAutomaticEngagement: true,
        blocksIncomingAttacks: false,
        defensiveFireAfterAttack: true,
        explicitManualAttackAllowed: true,
        neutralPersistsAfterDefense: true
      })
    });
  }
}

export function createEngagementRelations(options = {}) {
  return new EngagementRelations(options);
}
