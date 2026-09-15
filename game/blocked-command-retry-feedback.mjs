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

function appendRetryGuidance(actionId, readinessBefore) {
  const readinessAfter = readText('#gameplayReadiness');
  if (!readinessBlocksAction(actionId, readinessAfter)) return;

  const feedback = document.querySelector('#gameplayFeedback');
  const outcome = feedback?.textContent?.trim() || '';
  if (!feedback || !outcome || outcome.includes('Retry path ·')) return;

  // The action authority remains in gameplay-surface/local simulation. This layer only
  // turns the already-visible readiness state into an actionable retry explanation
  // after a player actually attempts a command that was known to be blocked.
  if (readinessAfter !== readinessBefore && !/\bblocked\b/i.test(readinessAfter)) return;
  feedback.textContent = `${outcome} · Retry path · ${readinessAfter}`;
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('#gameplaySurface [data-gameplay-action]');
  if (!button || button.disabled) return;

  const actionId = button.dataset.gameplayAction || '';
  if (!RETRYABLE_ACTIONS.has(actionId)) return;

  const readinessBefore = readText('#gameplayReadiness');
  if (!readinessBlocksAction(actionId, readinessBefore)) return;

  // gameplay-surface resolves the admitted action on a zero-delay timer. Queue this
  // timer from the post-click microtask so the authoritative outcome lands first.
  queueMicrotask(() => {
    setTimeout(() => appendRetryGuidance(actionId, readinessBefore), 0);
  });
}, true);
