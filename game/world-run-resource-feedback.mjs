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

function signedAmountLabel(value) {
  const number = finite(value, 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${amountLabel(number)}`;
}

function percentLabel(value) {
  const number = finite(value);
  return number === null ? 'unavailable' : `${number.toFixed(1)}%`;
}

function signedPercentPointLabel(value) {
  const number = finite(value, 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(1)}pp`;
}

function multiplierLabel(value) {
  const number = finite(value);
  return number === null ? 'unavailable' : `x${number.toFixed(2)}`;
}

function signedMultiplierLabel(value) {
  const number = finite(value, 0);
  const sign = number > 0 ? '+' : '';
  return `${sign}${number.toFixed(2)}`;
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

export function hostRunResourceDelta(baseline, current) {
  if (!baseline || !current || !baseline.runId || baseline.runId !== current.runId) return null;
  const baselineFulfillment = finite(baseline.foodFulfillment);
  const currentFulfillment = finite(current.foodFulfillment);
  return Object.freeze({
    runId: current.runId,
    food: finite(current.food, 0) - finite(baseline.food, 0),
    scrap: finite(current.scrap, 0) - finite(baseline.scrap, 0),
    foodFulfillmentPoints: baselineFulfillment === null || currentFulfillment === null
      ? null
      : (currentFulfillment - baselineFulfillment) * 100,
    peakGlobalControlPoints: finite(current.peakGlobalControlPercent, 0) - finite(baseline.peakGlobalControlPercent, 0),
    goldMultiplier: finite(current.goldMultiplier, 1) - finite(baseline.goldMultiplier, 1),
    foodFromDestruction: finite(current.foodFromDestruction, 0) - finite(baseline.foodFromDestruction, 0),
    foodPolicyChanged: baseline.foodPolicy === current.foodPolicy ? null : Object.freeze({
      from: String(baseline.foodPolicy || 'unknown'),
      to: String(current.foodPolicy || 'unknown')
    })
  });
}

function hasResourceDelta(delta) {
  if (!delta) return false;
  return Math.abs(delta.food) > 1e-9
    || Math.abs(delta.scrap) > 1e-9
    || (delta.foodFulfillmentPoints !== null && Math.abs(delta.foodFulfillmentPoints) > 1e-9)
    || Math.abs(delta.peakGlobalControlPoints) > 1e-9
    || Math.abs(delta.goldMultiplier) > 1e-9
    || Math.abs(delta.foodFromDestruction) > 1e-9
    || Boolean(delta.foodPolicyChanged);
}

function resourceDeltaText(delta) {
  if (!delta || !hasResourceDelta(delta)) {
    return 'Host resource change · no durable host resource change observed since this command-deck baseline.';
  }
  const parts = [
    `food ${signedAmountLabel(delta.food)}`,
    `scrap ${signedAmountLabel(delta.scrap)}`,
    `territory peak ${signedPercentPointLabel(delta.peakGlobalControlPoints)}`,
    `score multiplier ${signedMultiplierLabel(delta.goldMultiplier)}`,
    `combat food ${signedAmountLabel(delta.foodFromDestruction)}`
  ];
  if (delta.foodFulfillmentPoints !== null) parts.splice(2, 0, `fulfillment ${signedPercentPointLabel(delta.foodFulfillmentPoints)}`);
  if (delta.foodPolicyChanged) parts.push(`policy ${policyLabel(delta.foodPolicyChanged.from)} → ${policyLabel(delta.foodPolicyChanged.to)}`);
  return `Host resource change since command-deck baseline · ${parts.join(' · ')}`;
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

const resourceChange = document.createElement('div');
resourceChange.id = 'worldRunResourceChange';
resourceChange.className = 'status';
resourceChange.setAttribute('aria-live', 'polite');
resourceChange.hidden = true;
resourceSummary.insertAdjacentElement('afterend', resourceChange);

const boundary = document.createElement('div');
boundary.id = 'worldRunResourceBoundary';
boundary.className = 'status';
boundary.textContent = 'Host-persistent run resources only · LOCAL battlefield materials, food consumption, combat and territory consequences remain browser-local unless an explicit host authority admits them. Resource change is measured from this command deck session only; that browser baseline is presentation evidence, not host checkpoint authority.';
boundary.hidden = true;
resourceChange.insertAdjacentElement('afterend', boundary);

let lastText = null;
let lastChangeText = null;
let baselineFeedback = null;

function resetPresentation() {
  lastText = null;
  lastChangeText = null;
  baselineFeedback = null;
  resourceSummary.textContent = '';
  resourceChange.textContent = '';
}

function render() {
  const bound = bridge.worldBinding('seat-1') || null;
  const feedback = hostRunResourceFeedback(lifecycle.status());
  const visible = bound?.profileKind === 'world-account' && Boolean(feedback);
  resourceSummary.hidden = !visible;
  resourceChange.hidden = !visible;
  boundary.hidden = !visible;
  if (!visible) {
    resetPresentation();
    return null;
  }

  if (!baselineFeedback || baselineFeedback.runId !== feedback.runId) {
    baselineFeedback = feedback;
    lastChangeText = null;
  }

  const fulfillment = feedback.foodFulfillment === null
    ? 'fulfillment unavailable'
    : `fulfillment ${Math.round(feedback.foodFulfillment * 100)}%`;
  const text = `Host-persistent resources · food ${amountLabel(feedback.food)} · scrap ${amountLabel(feedback.scrap)} · ${policyLabel(feedback.foodPolicy)} food policy · ${fulfillment} · territory peak ${percentLabel(feedback.peakGlobalControlPercent)} · close-score multiplier ${multiplierLabel(feedback.goldMultiplier)} · combat food ${amountLabel(feedback.foodFromDestruction)}`;
  if (text !== lastText) {
    resourceSummary.textContent = text;
    lastText = text;
  }

  const changeText = resourceDeltaText(hostRunResourceDelta(baselineFeedback, feedback));
  if (changeText !== lastChangeText) {
    resourceChange.textContent = changeText;
    lastChangeText = changeText;
  }
  return feedback;
}

Object.defineProperty(window, '__AXM_WORLD_RUN_RESOURCE_FEEDBACK__', {
  configurable: false,
  value: Object.freeze({
    describe: () => hostRunResourceFeedback(lifecycle.status()),
    describeDelta: () => hostRunResourceDelta(baselineFeedback, hostRunResourceFeedback(lifecycle.status())),
    render
  })
});

const lifecycleObserver = new MutationObserver(() => { render(); });
lifecycleObserver.observe(lifecycleSummary, { childList: true, characterData: true, subtree: true });

render();
setInterval(render, 1500);
