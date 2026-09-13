# Host-reproduced LOCAL RTS gather command v0

Status: **EXPERIMENTAL / SINGLE-COMMAND PERSISTENCE RUNG**

## Purpose

PR #77 bound an authority-revalidated shared-world participant to a host-owned LOCAL RTS command journal, but browser-local gather/explore/repair still remained entirely outside that journal. This rung adds the smallest explicit command bridge without pretending the browser simulation is canonical.

## Enabled command

Only `gather-scrap` is enabled through the new host-bound command surface in this rung.

The browser submits:

- the already authority-revalidated participant id;
- the already bound local region seat;
- the displayed expected journal revision;
- a strict physical intent containing exactly `actionId`, `cursorXM`, `cursorZM`, and `stepCount`.

The host independently re-reads:

- the participant record and controller kind;
- the participant → local-seat binding;
- the current host world hour;
- the current journal revision and canonical prior state.

The client cannot author controller identity or world hour through this route. Extra identity/time fields on the outer HTTP body are ignored, while extra fields inside the physical intent are rejected by the underlying journal contract.

## Revision / agency contract

A host-local command must include an explicit `expectedRevision` taken from the host checkpoint already displayed to the participant.

If the checkpoint is stale, the host returns `local-authority-revision-conflict`. The browser refreshes checkpoint evidence but does **not** automatically retry the gameplay intent. A human or machine participant must choose whether to submit again against the new state.

This avoids silently replaying an action after authority state has changed.

## Human / machine equal-entry contract

Human and machine participants traverse the same `LocalSeatJournalAuthority.submitBoundCommand()` path, the same participant action-rate gate, the same deterministic `LocalRegionCommandJournalAuthority`, and the same host world-time source.

For equal region seat, genesis hour, physical intent, and command hour:

- physical command evidence must match;
- reproduced physical state must match;
- participant/controller identity remains separately auditable in the admission digest.

The controller kind does not change the local physics.

## Player-facing flow

When seat 1 has a shared-world participant and the shell is in LOCAL RTS, `Journal gather at cursor` becomes available.

It:

1. reads the current physical RTS cursor from the existing shell;
2. uses the displayed host journal revision as `expectedRevision`;
3. submits one bounded `gather-scrap` intent to host authority;
4. shows the resulting host journal revision and host-reproduced scrap snapshot;
5. refreshes checkpoint continuity evidence.

The button and the public `__AXM_HOST_LOCAL_SEAT__.submitGatherAtCursor()` surface use the same path, so machine participants do not receive a privileged physics route.

## Truth boundary

This is **not** browser/server lockstep and it is **not** global-economy persistence.

Specifically:

- ordinary browser-local gather/explore/repair still advance only the browser-local simulation;
- an explicit host journal gather advances only the host journal simulation;
- the browser simulation is not overwritten or silently reconciled from the host result;
- host journal scrap is not promoted into the shared/global player economy;
- explore and repair are intentionally not enabled on the host-bound command route yet;
- no combat result, Crew position, resource depletion, exploration knowledge, construction state, or core integrity is promoted into shared/global truth by this rung.

The separate hosted territory-claim route remains a different authority surface.

## Durability boundary

The host-local seat binding and default per-seat journal wiring remain process-local memory in the hosted runtime. The lower-level journal has separate file-backed replay evidence, but this rung does not make participant → seat ownership restart-durable.

No claim is made here for distributed consensus, public authentication security, deployment, latency, throughput, mass-RTS performance, target-device performance, visual quality, or gameplay balance.

## Merge evidence required

The exact candidate head must pass:

- full repository deterministic/source gate;
- local outcome replay and chained command-journal regressions;
- local-seat authority selftest including host command, stale revision rejection, rate admission, and human/machine physical parity;
- local-seat HTTP selftest proving host actor/world-time authority and write-mode behavior;
- world browser-client selftest for the new command request;
- real Chromium shared-world machine entry → local-seat binding → browser-local gather remains unjournaled → explicit host journal gather advances r0 → r1;
- existing world-entry Chromium regression;
- existing four-controller + machine-seat Chromium regression.

Only evidence actually produced by those gates may be claimed.

## Next safe rung

The next activation should inspect fresh state before choosing between:

- restart-safe participant → local-seat/journal ownership metadata; or
- a deterministic reconciliation/read-model that lets the player intentionally adopt a host checkpoint into the browser simulation without silently replacing local state.

Globalizing gathered scrap should wait until the host command result has an explicit economic promotion contract, ownership rules, replay/rollback evidence, and conflict semantics.
