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

let pendingRetry = null;

function appendSettledRetryGuidance() {
  const pending = pendingRetry;
  if (!pending) return;

  const feedback = document.querySelector('#gameplayFeedback');
  const outcome = feedback?.textContent?.trim() || '';
  if (!feedback || !outcome) return;

  // submitAction first reports transport/admission. Wait until the existing gameplay
  // authority has replaced that temporary text with its settled command outcome.
  if (/submitted through its existing admitted input path$/i.test(outcome)) return;
  if (outcome.includes('Retry path ·')) {
    pendingRetry = null;
    return;
  }

  const readinessAfter = readText('#gameplayReadiness');
  if (!readinessBlocksAction(pending.actionId, readinessAfter)) {
    pendingRetry = null;
    return;
  }

  pendingRetry = null;
  feedback.textContent = `${outcome} · Retry path · ${readinessAfter}`;
}

const outcomeObserver = new MutationObserver(() => {
  queueMicrotask(appendSettledRetryGuidance);
});
outcomeObserver.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true
});

document.addEventListener('click', event => {
  const button = event.target.closest?.('#gameplaySurface [data-gameplay-action]');
  if (!button || button.disabled) return;

  const actionId = button.dataset.gameplayAction || '';
  if (!RETRYABLE_ACTIONS.has(actionId)) return;

  const readinessBefore = readText('#gameplayReadiness');
  if (!readinessBlocksAction(actionId, readinessBefore)) return;

  // Keep only one explicit attempted command pending. No command is repeated here;
  // this module observes the already-admitted path and explains how the player can retry.
  pendingRetry = { actionId, readinessBefore };
  queueMicrotask(appendSettledRetryGuidance);
}, true);
