# Bound primary host macros v0

Status: experimental convergence rung

## What changed

For a shared-world-bound seat that is already in `LOCAL RTS` and has no party, civilization, or combat menu open, the ordinary admitted primary macro controls now reuse the existing host LOCAL journal path:

- `confirm` / A / Enter → selected-party `gather-scrap`;
- `context` / X → selected-party `repair-core`;
- `explore` / L3 / F → selected-party `explore` at the current cursor.

The input still enters through `LocalSeatRuntime`, so the same 100-APM admission applies before authority routing. Human, gamepad, and machine users therefore reach the same routing decision instead of receiving a privileged machine-only path.

For those three actions only, a bound LOCAL seat no longer immediately emits the original browser-local macro event. The admitted event is marked as a host-authority pending/blocked event, the existing `__AXM_HOST_LOCAL_SEAT__` bridge submits the selected Crew scope and cursor/revision evidence to the durable host journal, and an accepted command is followed by explicit checkpoint adoption into the active browser simulation.

Local-only seats preserve the existing browser-local macro path. Globe controls and actions consumed by the existing party, construction/production/vehicle, or combat menus also preserve their existing behavior.

## Fail-closed rule

Once one of these three actions qualifies for bound host routing, it does not silently fall back to browser-local mutation because the host bridge is unavailable, a prior command is still in flight, the host rejects the intent, or checkpoint adoption fails.

The original requested action is retained on the admitted event as `requestedActionId`, while the delivered `actionId` identifies the host route as pending or blocked. This prevents `game/app.mjs` from accidentally admitting the same gather/repair/explore order into the browser simulation as a second command.

No automatic revision retry/rebase is introduced. Existing host revision-conflict behavior remains authoritative.

## Bounded command semantics

This rung uses the existing selected-party host macro budget of 160 deterministic journal steps. That is a bounded host-replayed command plus explicit checkpoint adoption, not a claim that the host continuously owns every subsequent LOCAL simulation tick.

Party membership/selection itself remains browser-local. Construction, aggregate production, vehicles, strategic travel, city pressure, combat, civilization-death causality, and bespoke animation are not promoted by this change.

The active-run bootstrap/checkpoint provenance rules remain in force: checkpoint adoption may reconcile the already-admitted run bootstrap, but starter/run value is not reclassified as newly earned salvage.

## Scope and persistence truth

This closes the player-facing split where a bound participant had special host-journal buttons while normal gather/repair/explore controls still always created browser-local orders first. It does **not** make the whole RTS host-authoritative.

Current truth boundary:

- host journal: authoritative for the admitted bounded gather/repair/explore command and its deterministic checkpoint;
- browser adoption: explicit deterministic replacement from that host replay package after acceptance;
- later ordinary browser ticks and all unpromoted subsystems: still browser-local unless separately grounded;
- 1–4 seats remain per-client access slots, not a global-world player cap;
- no production hosting, distributed scale, secure public networking, performance, balance, visual-quality, or animation-completion claim is made.

## Evidence

`tests/bound-primary-host-macro-selftest.mjs` covers local-only preservation, menu preservation, human/machine parity, host rejection without adoption, missing-authority fail-closed behavior, and duplicate in-flight suppression.

`tests/browser/bound-primary-host-macros.spec.js` exercises the real browser shell with a bound world-account machine seat, enters LOCAL RTS through the ordinary command surface, submits gather/repair/explore through `submitMachineAction`, requires host journal revisions and successful checkpoint adoption, and verifies a second primary macro cannot slip through browser-local while the first host route is in flight.
