import './host-strategic-city-provocation.mjs';

const RETRYABLE_ACTIONS = new Set(['confirm', 'gather-scrap', 'repair-core', 'explore']);

function readText(selector) {
  return document.querySelector(selector)?.textContent?.trim() || '';
}

function readinessBlocksAction(actionId, text) {
  if (!text || !/\bblocked\b/i.test(text)) return false;
  if (actionId === 'confirm') return true;
  if (['gather-scrap', 'repair-core', 'explore'].includes(actionId)) {
    return /^Macro readiness\b/i.test(text);
  }
  return false;
}

function scheduleRetryGuidance(actionId, feedbackAtAttempt) {
  let checks = 0;
  const timer = setInterval(() => {
    checks += 1;
    const feedback = document.querySelector('#gameplayFeedback');
    const outcome = feedback?.textContent?.trim() || '';
    const readinessAfter = readText('#gameplayReadiness');

    if (!feedback || !readinessBlocksAction(actionId, readinessAfter)) {
      clearInterval(timer);
      return;
    }
    if (outcome.includes('Retry path ·')) {
      clearInterval(timer);
      return;
    }

    const stillAdmissionText = /submitted through its existing admitted input path$/i.test(outcome);
    const settledOutcome = outcome && outcome !== feedbackAtAttempt && !stillAdmissionText;
    if (settledOutcome) {
      clearInterval(timer);
      feedback.textContent = `${outcome} · Retry path · ${readinessAfter}`;
      return;
    }

    // Presentation-only observation window. The command itself is never repeated.
    if (checks >= 60) clearInterval(timer);
  }, 16);
}

function selectedSeatOwnsStatus(statusText) {
  const seatId = document.querySelector('#gameplaySeat')?.value || '';
  return Boolean(seatId && statusText.startsWith(`${seatId} · `));
}

function isKnownNativeBlockedOutcome(statusText, readinessText) {
  if (!statusText || !readinessText || !/\bblocked\b/i.test(readinessText)) return false;

  // This is deliberately narrow: only promote native-input rejections whose
  // authoritative shell outcome is already explicit. Do not infer a rejected
  // command merely because the current readiness projection is blocked.
  if (/^Production readiness\b/i.test(readinessText)) {
    return /No Shallow Mine exists yet\. Build one first\./i.test(statusText)
      || /\bno-production-building\b/i.test(statusText);
  }

  return false;
}

function surfaceNativeBlockedRetry() {
  const statusText = readText('#inputStatus');
  const readinessText = readText('#gameplayReadiness');
  const feedback = document.querySelector('#gameplayFeedback');
  if (!feedback || !selectedSeatOwnsStatus(statusText)) return;
  if (!isKnownNativeBlockedOutcome(statusText, readinessText)) return;
  if (feedback.textContent?.includes('Retry path ·')) return;

  // Keyboard/gamepad actions do not click the command-deck buttons. Mirror the
  // already-authoritative shell rejection into the player-facing deck and add
  // only the existing state-derived retry guidance; never repeat the command.
  feedback.textContent = `${statusText} · Retry path · ${readinessText}`;
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('#gameplaySurface [data-gameplay-action]');
  if (!button || button.disabled) return;

  const actionId = button.dataset.gameplayAction || '';
  if (!RETRYABLE_ACTIONS.has(actionId)) return;

  const readinessBefore = readText('#gameplayReadiness');
  if (!readinessBlocksAction(actionId, readinessBefore)) return;

  // Observe the already-admitted action only. No automatic retry, alternate command
  // path, or gameplay mutation is introduced by this presentation layer.
  scheduleRetryGuidance(actionId, readText('#gameplayFeedback'));
}, true);

const inputStatus = document.querySelector('#inputStatus');
if (inputStatus) {
  const observer = new MutationObserver(() => surfaceNativeBlockedRetry());
  observer.observe(inputStatus, { childList: true, characterData: true, subtree: true });
}
