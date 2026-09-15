# Host LOCAL RTS checkpoint adoption v0

Status: **EXPERIMENTAL / EXPLICIT RECONCILIATION RUNG**

## Purpose

The host already owns a per-seat deterministic LOCAL RTS command journal, while the browser still runs a separate local simulation. This rung adds an explicit reconciliation action instead of silently pretending those two legitimate states are identical.

A bound human or machine participant may choose **Adopt host checkpoint** while in LOCAL RTS. The browser requests a host-issued replay package for the exact journal revision it is currently displaying. The host revalidates participant→seat ownership and rejects the request if that revision is stale. The browser then replays the bounded physical command history from the journal genesis, verifies that the replayed public snapshot matches the host package, and only then replaces the already-running local simulation in place.

## Authority and stale-state boundary

The browser cannot choose a journal revision and force the host to resurrect it. The adoption request carries the displayed `expectedRevision`; if the host journal advanced meanwhile, the request fails with `local-authority-revision-conflict`, the browser refreshes the checkpoint display, and no checkpoint replacement is applied to the local simulation. The ordinary local simulation may still continue advancing under its normal frame loop; a rejection is a claim about **no reconciliation mutation**, not a claim that local time was frozen.

The host package includes only the deterministic replay material needed by this v0 seam:

- region seat id;
- genesis world hour and derived lighting phase;
- ordered physical intents and their host world hours;
- revision/head/state hashes;
- the host's public LOCAL RTS snapshot.

It does **not** disclose coordinates or amounts for still-hidden resources. Browser replay constructs the same hidden state from the same deterministic starter-region genesis rather than receiving hidden-resource truth from the host response.

## Active host-run bootstrap compatibility

The playable world-run path now has one additional piece of browser-local genesis that the host LOCAL command journal does not yet reproduce: after Continue revalidates an active host civilization run, its admitted starting scrap is added exactly once to the fresh LOCAL physical store on top of the browser-local starter fixture.

That value must not be silently erased by adopting a host LOCAL checkpoint whose journal still begins from the bare deterministic region. `adoptLocalCheckpointIntoActiveSimulation` therefore fails closed with `active-host-run-bootstrap-not-in-host-local-journal-genesis` whenever the target LOCAL simulation carries applied world-run bootstrap evidence. The target simulation is left unchanged.

This guard is intentionally narrower than claiming the genesis problem is solved. The host journal still does not own the browser-local starter fixture, host starting scrap, host food/items/blueprints, or the rest of the playable civilization side state. It also does not promote bootstrap value into verified salvage. A later convergence rung must define one provenance-aware genesis/accounting contract before those surfaces can be merged safely.

## Replacement evidence

When genesis is compatible, adoption is explicit and records both sides of the replacement in browser evidence:

- checkpoint id and host revision;
- prior browser-local snapshot;
- adopted browser-local snapshot;
- number of replayed host commands;
- host state hash carried by the package.

The running simulation object is replaced in place so the existing renderer/input loop continues to use the adopted state rather than creating a second disconnected browser simulation. This is **point-in-time convergence**: immediately after replacement the browser state equals the verified host public checkpoint, then the ordinary local frame loop may advance it again. This rung does not claim continuous lockstep between browser and host journal.

## Human / machine parity

The adoption endpoint, expected-revision rule, deterministic replay, bootstrap-compatibility guard, and replacement path do not branch on human versus machine controller kind. Controller identity remains part of the host seat binding and admission evidence, but the same physical checkpoint and the same fail-closed bootstrap rule apply to either controller kind.

## Truth boundary / non-claims

This proves an explicitly requested browser-local replacement can be reconstructed from the currently named host journal checkpoint when its known genesis is compatible, that a stale host checkpoint is rejected before replacement, and that an active host-run bootstrap cannot be overwritten by the still-bare host LOCAL journal. It does **not** make browser-local actions authoritative, automatically journal local gather/explore/repair, reconcile the browser-local starter fixture with host genesis, promote host-journal scrap into shared/global economy, establish continuous host/browser lockstep, establish distributed consensus, provide cryptographic client authentication, or prove deployment/performance/visual-quality targets.

The package is trusted as a same-origin host-authority response in this development rung. The browser verifies deterministic replay against the host's public snapshot but does not independently recompute the Node-side SHA-256 state hash. Global economy promotion should remain blocked until the project deliberately defines which host outcomes and which bootstrap provenance cross that separate authority boundary.
