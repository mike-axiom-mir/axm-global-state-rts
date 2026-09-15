import { LocalCivilizationGameplay } from '../src/sim/local-civilization-gameplay.mjs';

export const HOST_STRATEGIC_CITY_PROVOCATION_SCHEMA = 'axm.global-state-rts.host-strategic-city-provocation/v0.1';

const INSTALL_MARK = Symbol.for('axm.global-state-rts.host-strategic-city-provocation/v0.1');
const pendingBySeat = new Map();
const receiptBySeat = new Map();

function freezeJson(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)])));
}

function selectedIds(value = []) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].sort();
}

function blockedResult(reason, message, fields = {}) {
  return Object.freeze({ handled: true, accepted: false, reason, message, ...fields });
}

function currentBoundCityContext(civilization, context = {}) {
  const rts = globalThis.window?.__AXM_GLOBAL_STATE_RTS__ || null;
  const strategic = globalThis.window?.__AXM_PRIMARY_STRATEGIC__ || null;
  if (!rts || !strategic || !civilization?.seatId) return null;

  const seatId = String(civilization.seatId);
  const binding = rts.worldBinding?.(seatId) || null;
  if (!binding) return null;

  const crewIds = selectedIds(context.selectedCrewIds);
  const state = strategic.snapshot?.(seatId, crewIds) || null;
  const journey = state?.journey || null;
  const city = state?.currentCity || null;
  if (!state?.menuOpen || !journey || journey.status !== 'arrived' || !city) return null;
  if (!journey.currentNodeId || journey.currentNodeId === state.homeNodeId || city.id !== journey.currentNodeId) return null;
  if (!strategic.blocksSelectedLocalCrew?.(seatId, crewIds)) return null;

  return Object.freeze({ rts, strategic, seatId, binding, crewIds, state, journey, city });
}

function commandIdFor({ binding, journey, city }) {
  return `strategic-city-provoke:${binding.participantId}:${journey.id}:${city.id}`;
}

function duplicateReconciliation(error, request) {
  const body = error?.body || null;
  const entry = body?.entry || null;
  if (body?.reason !== 'command-already-recorded') return null;
  if (entry?.commandId !== request.commandId) return null;
  if (entry?.eventType !== 'city.provoke') return null;
  if (entry?.actorId !== request.binding.participantId) return null;
  if (entry?.payload?.cityId !== request.city.id) return null;
  if (entry?.payload?.journeyId !== request.journey.id) return null;
  if (entry?.payload?.regionSeatId !== request.seatId) return null;
  return Object.freeze({
    accepted: true,
    reconciled: true,
    revision: body.revision ?? entry.revision ?? null,
    entry,
    result: body.result || null,
    participantId: request.binding.participantId,
    actorId: entry.actorId,
    eventType: entry.eventType
  });
}

function receiptFromHost(request, hostResult, localResult) {
  const hostCity = hostResult?.result?.city || null;
  const entry = hostResult?.entry || null;
  return freezeJson({
    schema: HOST_STRATEGIC_CITY_PROVOCATION_SCHEMA,
    accepted: true,
    status: 'accepted',
    seatId: request.seatId,
    participantId: request.binding.participantId,
    controllerKind: request.binding.controllerKind,
    cityId: request.city.id,
    journeyId: request.journey.id,
    commandId: request.commandId,
    hostRevision: hostResult?.revision ?? entry?.revision ?? null,
    hostHeadHash: hostResult?.headHash ?? null,
    hostStateHash: hostResult?.stateHash ?? null,
    reconciledDuplicate: Boolean(hostResult?.reconciled),
    hostEntry: entry,
    hostCity,
    localFollowthrough: {
      accepted: Boolean(localResult?.accepted),
      action: localResult?.action || null,
      reason: localResult?.reason || null
    },
    authority: 'host-journaled-city-provoke-with-browser-local-pressure-followthrough',
    truthBoundary: 'The host durably admits and replay-applies the canonical city.provoke event for the bound participant before the browser applies its existing city-pressure chain. The host does not yet replay-verify physical convoy arrival, browser strategic travel, WorldPressureDirector raid dispatch, LOCAL combat, casualties, or civilization death; those downstream consequences remain browser-local.'
  });
}

function rejectedReceipt(request, reason, error = null) {
  return freezeJson({
    schema: HOST_STRATEGIC_CITY_PROVOCATION_SCHEMA,
    accepted: false,
    status: 'rejected',
    seatId: request.seatId,
    participantId: request.binding.participantId,
    controllerKind: request.binding.controllerKind,
    cityId: request.city.id,
    journeyId: request.journey.id,
    commandId: request.commandId,
    reason,
    hostError: error ? String(error?.message || error) : null,
    authority: 'host-rejected-no-browser-city-mutation',
    truthBoundary: 'A bound strategic city provocation fails closed: host rejection or transport failure does not silently mutate the browser city or dispatch browser-local world pressure.'
  });
}

if (!LocalCivilizationGameplay.prototype[INSTALL_MARK]) {
  Object.defineProperty(LocalCivilizationGameplay.prototype, INSTALL_MARK, { value: true });
  const previousHandleAction = LocalCivilizationGameplay.prototype.handleAction;

  LocalCivilizationGameplay.prototype.handleAction = function hostStrategicCityProvocationHandleAction(actionId, context = {}) {
    const seatId = String(this.seatId || '');
    const pending = pendingBySeat.get(seatId) || null;
    if (pending) {
      const message = `${pending.cityId} host city authority is still resolving; no second strategic command is admitted until that result returns.`;
      this.lastOutcome = Object.freeze({ kind: 'blocked', message });
      return blockedResult('host-city-provoke-pending', message, { cityId: pending.cityId, commandId: pending.commandId });
    }

    if (String(actionId || '') !== 'ui-left') return previousHandleAction.call(this, actionId, context);
    const requestContext = currentBoundCityContext(this, context);
    if (!requestContext) return previousHandleAction.call(this, actionId, context);

    const previousReceipt = receiptBySeat.get(seatId) || null;
    if (previousReceipt?.accepted
      && previousReceipt.cityId === requestContext.city.id
      && previousReceipt.journeyId === requestContext.journey.id) {
      return previousHandleAction.call(this, actionId, context);
    }

    const commandId = commandIdFor(requestContext);
    const request = Object.freeze({ ...requestContext, commandId });
    pendingBySeat.set(seatId, Object.freeze({
      seatId,
      cityId: request.city.id,
      journeyId: request.journey.id,
      commandId,
      participantId: request.binding.participantId
    }));

    const pendingMessage = `${request.city.id} city contact submitted to host authority before browser-local pressure is allowed to mutate.`;
    this.lastOutcome = Object.freeze({ kind: 'host-city-contact-pending', message: pendingMessage });

    void Promise.resolve()
      .then(() => request.rts.submitBoundWorldCommand({
        seatId,
        commandId,
        eventType: 'city.provoke',
        payload: Object.freeze({
          cityId: request.city.id,
          journeyId: request.journey.id,
          regionSeatId: seatId
        })
      }))
      .catch(error => {
        const reconciled = duplicateReconciliation(error, request);
        if (reconciled) return reconciled;
        throw error;
      })
      .then(hostResult => {
        if (!hostResult?.accepted) {
          const reason = String(hostResult?.reason || 'host-city-provoke-rejected');
          const receipt = rejectedReceipt(request, reason);
          receiptBySeat.set(seatId, receipt);
          const message = `${request.city.id} host city contact rejected (${reason}); browser city/pressure state was left unchanged.`;
          this.lastOutcome = Object.freeze({ kind: 'blocked', message });
          return;
        }

        const localResult = previousHandleAction.call(this, actionId, context);
        const receipt = receiptFromHost(request, hostResult, localResult);
        receiptBySeat.set(seatId, receipt);
        if (localResult?.accepted) {
          const revisionText = receipt.hostRevision === null ? 'recorded revision' : `world revision ${receipt.hostRevision}`;
          this.lastOutcome = Object.freeze({
            kind: 'city-contact',
            message: `${localResult.message} Host authority accepted city.provoke first at ${revisionText}; raid transit/combat follow-through remains browser-local.`
          });
        } else {
          this.lastOutcome = Object.freeze({
            kind: 'blocked',
            message: `${request.city.id} was accepted by host city authority, but the browser-local follow-through rejected (${localResult?.reason || 'unknown'}). No claim of synchronized city/raid state is made.`
          });
        }
      })
      .catch(error => {
        const reason = String(error?.body?.reason || error?.message || 'host-city-provoke-request-failed');
        receiptBySeat.set(seatId, rejectedReceipt(request, reason, error));
        this.lastOutcome = Object.freeze({
          kind: 'blocked',
          message: `${request.city.id} host city contact failed (${reason}); browser city/pressure state was left unchanged.`
        });
      })
      .finally(() => {
        const active = pendingBySeat.get(seatId);
        if (active?.commandId === commandId) pendingBySeat.delete(seatId);
      });

    return Object.freeze({
      handled: true,
      accepted: true,
      pending: true,
      action: 'strategic-city-provoke-host-pending',
      cityId: request.city.id,
      journeyId: request.journey.id,
      commandId,
      message: pendingMessage
    });
  };
}

const publicBridge = Object.freeze({
  snapshot(seatId = 'seat-1') {
    const normalizedSeatId = String(seatId || '');
    const pending = pendingBySeat.get(normalizedSeatId) || null;
    const receipt = receiptBySeat.get(normalizedSeatId) || null;
    if (pending) {
      return freezeJson({
        schema: HOST_STRATEGIC_CITY_PROVOCATION_SCHEMA,
        accepted: null,
        status: 'pending',
        ...pending,
        truthBoundary: 'Host city.provoke is in flight and the browser city/pressure chain has not been mutated yet.'
      });
    }
    return receipt;
  }
});

Object.defineProperty(window, '__AXM_HOST_STRATEGIC_CITY_PROVOCATION__', {
  configurable: false,
  value: publicBridge
});
