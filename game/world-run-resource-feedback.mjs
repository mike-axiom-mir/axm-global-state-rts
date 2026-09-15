function waitForRuntime(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const tick = () => {
      const bridge = window.__AXM_GLOBAL_STATE_RTS__ || null;
      const lifecycle = window.__AXM_WORLD_RUN_LIFECYCLE__ || null;
      const surface = document.getElementById('worldRunLifecycleSurface');
      if (bridge && lifecycle && surface) return resolve({ bridge, lifecycle, surface });
      if (performance.now() - startedAt >= timeoutMs) return reject(new Error('world run resource feedback runtime did not become available'));
      setTimeout(tick, 16);
    };
    tick();
  });
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function amountLabel(value) {
  const number = finite(value);
  if (number === null) return 'unavailable';
  if (Math.abs(number - Math.round(number)) <= 1e-9) return String(Math.round(number));
  return number.toFixed(1);
}

function percentLabel(value) {
  const number = finite(value);
  return number === null ? 'unavailable' : `${number.toFixed(1)}%`;
}

function multiplierLabel(value) {
  const number = finite(value);
  return number === null ? 'unavailable' : `x${number.toFixed(2)}`;
}

function policyLabel(value) {
  const id = String(value || '').trim();
  if (!id) return 'unknown policy';
  return id.split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

export function hostRunResourceFeedback(status) {
  const run = status?.progression?.activeRun || null;
  if (!run) return null;
  const resources = run.stockpile?.resources || {};
  const food = run.food || {};
  const modifiers = food.modifiers || {};
  const economy = run.economy || {};
  return Object.freeze({
    runId: run.runId || null,
    food: finite(resources.food, 0),
    scrap: finite(resources.scrap, 0),
    foodPolicy: String(food.policy || 'unknown'),
    foodFulfillment: finite(modifiers.fulfillment),
    peakGlobalControlPercent: finite(economy.peakGlobalControlPercent, 0),
    goldMultiplier: finite(economy.goldMultiplier, 1),
    foodFromDestruction: finite(economy.foodFromDestruction, 0)
  });
}

const { bridge, lifecycle, surface } = await waitForRuntime();
const lifecycleSummary = surface.querySelector('#worldRunLifecycleSummary');
if (!lifecycleSummary) throw new Error('missing #worldRunLifecycleSummary mount');

const resourceSummary = document.createElement('div');
resourceSummary.id = 'worldRunResourceSummary';
resourceSummary.className = 'gameplay-summary';
resourceSummary.setAttribute('aria-live', 'polite');
resourceSummary.hidden = true;
lifecycleSummary.insertAdjacentElement('afterend', resourceSummary);

const boundary = document.createElement('div');
boundary.id = 'worldRunResourceBoundary';
boundary.className = 'status';
boundary.textContent = 'Host-persistent run resources only · LOCAL battlefield materials, food consumption, combat and territory consequences remain browser-local unless an explicit host authority admits them.';
boundary.hidden = true;
resourceSummary.insertAdjacentElement('afterend', boundary);

let lastText = null;

function render() {
  const bound = bridge.worldBinding('seat-1') || null;
  const feedback = hostRunResourceFeedback(lifecycle.status());
  const visible = bound?.profileKind === 'world-account' && Boolean(feedback);
  resourceSummary.hidden = !visible;
  boundary.hidden = !visible;
  if (!visible) {
    lastText = null;
    resourceSummary.textContent = '';
    return null;
  }

  const fulfillment = feedback.foodFulfillment === null
    ? 'fulfillment unavailable'
    : `fulfillment ${Math.round(feedback.foodFulfillment * 100)}%`;
  const text = `Host-persistent resources · food ${amountLabel(feedback.food)} · scrap ${amountLabel(feedback.scrap)} · ${policyLabel(feedback.foodPolicy)} food policy · ${fulfillment} · territory peak ${percentLabel(feedback.peakGlobalControlPercent)} · close-score multiplier ${multiplierLabel(feedback.goldMultiplier)} · combat food ${amountLabel(feedback.foodFromDestruction)}`;
  if (text !== lastText) {
    resourceSummary.textContent = text;
    lastText = text;
  }
  return feedback;
}

Object.defineProperty(window, '__AXM_WORLD_RUN_RESOURCE_FEEDBACK__', {
  configurable: false,
  value: Object.freeze({
    describe: () => hostRunResourceFeedback(lifecycle.status()),
    render
  })
});

const lifecycleObserver = new MutationObserver(() => { render(); });
lifecycleObserver.observe(lifecycleSummary, { childList: true, characterData: true, subtree: true });

render();
setInterval(render, 1500);
