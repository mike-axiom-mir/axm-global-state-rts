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
