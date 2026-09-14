export const NEXT_DROP_RUN_BRIDGE_SCHEMA = 'axm.global-state-rts.next-drop-run-bridge/v0.1';

function nonEmpty(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} required`);
  return text;
}

export function beginClaimedNextDropRun({
  participantRegistry,
  playerProgression,
  participantId,
  runId,
  runOptions = {}
} = {}) {
  if (!participantRegistry?.participant || !participantRegistry?.claimNextDropRewards || !participantRegistry?.acknowledgeNextDropRewards) {
    throw new TypeError('participantRegistry with participant/claim/acknowledge methods required');
  }
  if (!playerProgression?.snapshot || !playerProgression?.beginRunFromNextDropClaim) {
    throw new TypeError('playerProgression with snapshot/beginRunFromNextDropClaim required');
  }
  const participant = nonEmpty(participantId, 'participantId');
  const nextRunId = nonEmpty(runId, 'runId');
  if (playerProgression.playerId !== participant) {
    return Object.freeze({
      schema: NEXT_DROP_RUN_BRIDGE_SCHEMA,
      accepted: false,
      reason: 'participant-progression-identity-mismatch',
      participantId: participant,
      progressionPlayerId: playerProgression.playerId,
      runId: nextRunId
    });
  }
  const record = participantRegistry.participant(participant);
  if (!record) throw new RangeError(`unknown participant: ${participant}`);

  const existingProgression = playerProgression.snapshot();
  const existingClaim = record.dropCache?.nextDropClaim || null;
  if (existingProgression.activeRun?.runId === nextRunId && existingClaim?.runId === nextRunId) {
    const acknowledged = participantRegistry.acknowledgeNextDropRewards(participant, nextRunId);
    if (!acknowledged.result.accepted) {
      throw new Error(`failed to reconcile active run with next-drop claim: ${acknowledged.result.reason}`);
    }
    return Object.freeze({
      schema: NEXT_DROP_RUN_BRIDGE_SCHEMA,
      accepted: true,
      reconciled: true,
      participantId: participant,
      runId: nextRunId,
      claim: acknowledged.result.claim,
      run: existingProgression.activeRun,
      truthBoundary: 'reconciled-existing-active-run-with-matching-claim-no-second-run-created'
    });
  }

  const claimed = participantRegistry.claimNextDropRewards(participant, nextRunId);
  if (!claimed.result.accepted) {
    return Object.freeze({
      schema: NEXT_DROP_RUN_BRIDGE_SCHEMA,
      accepted: false,
      reason: claimed.result.reason,
      participantId: participant,
      runId: nextRunId,
      claim: claimed.result.claim || null
    });
  }

  let run;
  try {
    run = playerProgression.beginRunFromNextDropClaim(claimed.result.claim, runOptions);
  } catch (error) {
    return Object.freeze({
      schema: NEXT_DROP_RUN_BRIDGE_SCHEMA,
      accepted: false,
      reason: 'run-start-rejected',
      participantId: participant,
      runId: nextRunId,
      claim: claimed.result.claim,
      error: String(error?.message || error),
      retryableClaim: true
    });
  }

  const acknowledged = participantRegistry.acknowledgeNextDropRewards(participant, nextRunId);
  if (!acknowledged.result.accepted) {
    throw new Error(`next-drop run started but claim acknowledgement failed: ${acknowledged.result.reason}`);
  }

  return Object.freeze({
    schema: NEXT_DROP_RUN_BRIDGE_SCHEMA,
    accepted: true,
    reconciled: false,
    participantId: participant,
    runId: nextRunId,
    reusedClaim: claimed.result.reused,
    claim: acknowledged.result.claim,
    run: run.snapshot(),
    truthBoundary: 'explicit-next-drop-claim-applied-once-to-one-progression-run-no-host-world-deployment-claim'
  });
}
