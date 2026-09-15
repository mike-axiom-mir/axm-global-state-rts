export const LOCAL_DEFEAT_RUN_CLOSE_BRIDGE_SCHEMA = 'axm.global-state-rts.local-defeat-run-close-bridge/v0.1';

function freezeResult(fields = {}) {
  return Object.freeze({ schema: LOCAL_DEFEAT_RUN_CLOSE_BRIDGE_SCHEMA, ...fields });
}

export function localDefeatRunCloseReadiness({ binding = null, hostStatus = null, combat = null } = {}) {
  if (!binding) return freezeResult({ accepted: false, reason: 'world-participant-not-bound' });
  if (binding.profileKind !== 'world-account') {
    return freezeResult({ accepted: false, reason: 'world-account-required', participantId: binding.participantId || null });
  }

  const activeRun = hostStatus?.progression?.activeRun || null;
  if (!activeRun?.runId) {
    return freezeResult({ accepted: false, reason: 'no-active-host-run', participantId: binding.participantId || null });
  }

  const bootstrap = binding.runBootstrap || null;
  if (!bootstrap?.applied) {
    return freezeResult({
      accepted: false,
      reason: 'local-run-bootstrap-not-applied',
      participantId: binding.participantId || null,
      runId: activeRun.runId
    });
  }
  if (bootstrap.runId !== activeRun.runId) {
    return freezeResult({
      accepted: false,
      reason: 'local-run-bootstrap-mismatch',
      participantId: binding.participantId || null,
      runId: activeRun.runId,
      localRunId: bootstrap.runId || null
    });
  }

  const continuity = combat?.continuity || null;
  if (!continuity) {
    return freezeResult({
      accepted: false,
      reason: 'local-continuity-evidence-unavailable',
      participantId: binding.participantId || null,
      runId: activeRun.runId
    });
  }
  if (!continuity.dead) {
    return freezeResult({
      accepted: false,
      reason: 'local-civilization-not-terminal',
      participantId: binding.participantId || null,
      runId: activeRun.runId,
      activeEligibleBuildings: continuity.activeEligibleBuildings ?? null,
      totalEligibleBuildings: continuity.totalEligibleBuildings ?? null
    });
  }

  return freezeResult({
    accepted: true,
    reason: 'client-observed-local-continuity-terminal',
    participantId: binding.participantId,
    runId: activeRun.runId,
    evidence: Object.freeze({
      localStateScope: combat?.stateScope || 'unknown-browser-local-scope',
      activeEligibleBuildings: continuity.activeEligibleBuildings ?? 0,
      totalEligibleBuildings: continuity.totalEligibleBuildings ?? 0,
      destroyedEligibleBuildings: continuity.destroyedEligibleBuildings ?? null,
      hostileCrewRemaining: combat?.contact?.remainingCrew ?? null,
      runBootstrapApplied: true,
      runBootstrapRunId: bootstrap.runId
    }),
    truthBoundary: 'this only correlates a browser-local deterministic continuity terminal with the active run bootstrap; it is not host replay verification, shared-world combat authority, or proof that the host caused or observed the defeat'
  });
}
