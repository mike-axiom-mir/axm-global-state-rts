# Host-selected-party LOCAL journal v0

Status: **EXPERIMENTAL / AUTHORITY-CONVERGENCE PREREQUISITE**

## Purpose

The playable LOCAL RTS already lets a player split Crew into persistent parties and issue gather, repair, and explore orders to the selected party. The durable host LOCAL command journal previously reproduced the same action types, but only as whole-seat orders because its physical intent did not carry the selected Crew ids.

That mismatch prevented the player-facing party layer from moving onto the existing host journal without changing gameplay semantics. This rung closes that mismatch instead of silently widening a selected-party order into an all-Crew host order.

## Additive physical intent

The existing LOCAL outcome intent keeps its v0.1 schema and its legacy four-key shape:

- `actionId`
- `cursorXM`
- `cursorZM`
- `stepCount`

A fifth field, `crewIds`, is now optional. When supplied it is a bounded physical selector for the existing LOCAL simulation command. Crew ids are validated as non-empty, duplicate-free strings and canonicalized into sorted order before evidence is produced.

When `crewIds` is omitted, the normalized physical intent keeps the old four-key shape. This deliberately preserves replay/digest compatibility for already-persisted journal entries rather than silently rewriting old evidence with `crewIds: null`.

Unknown Crew ids still fail through the existing LOCAL simulation validation. An empty selected set produces the existing `no-commanded-crew` rejection rather than becoming an all-Crew command.

## Durable journal and checkpoint replay

`LocalRegionCommandJournalAuthority` now carries optional selected-Crew scope through:

1. intent normalization;
2. physical command digesting;
3. deterministic command execution;
4. append-only journal persistence;
5. restart rehydration and journal verification.

The browser checkpoint replay/adoption path also replays the recorded `crewIds`. A selected-party host command therefore cannot be journaled as four Crew and later adopted as an eight-Crew command.

Human and machine controller identity remains separate from the physical command digest. Equal selected Crew, world hour, cursor, action, and step count must reproduce equal physical state regardless of controller kind.

## Player-facing gather bridge

The existing explicit host gather control now reads the shell's current selected party. `Journal selected-party gather` submits those exact selected Crew ids with the host-bound gather intent.

The host result and the later explicit checkpoint adoption both retain that Crew scope. The browser does not silently adopt the host result; the existing `Adopt host checkpoint` action remains a separate user-visible choice.

This is deliberate agency and continuity behavior: a host command is not automatically replayed or applied to a client after a revision conflict or after host acceptance.

## Truth boundary

This PR does **not** make ordinary keyboard/controller LOCAL macros host-authoritative. The main gather/repair/explore gameplay path still mutates the browser-local simulation first. The selected-party host route remains the explicit host-journal surface beside it.

This PR also does not make party membership itself host-persistent. The browser supplies selected Crew ids as part of the physical command; the host validates those ids against the deterministic LOCAL Crew roster and journals their physical effect, but it does not yet own the higher-level party registry/split/merge history.

No construction, production, vehicle, convoy, combat, casualty, civilization-death, global-economy, or shared-world state is promoted by this change. No production hosting, multi-host scale, network security, latency, performance, visual quality, balance, or animation completion is claimed.

## Evidence required before merge

The exact candidate head must pass:

- full repository deterministic/source tests;
- selected-party one-shot host replay with physical/outcome digest distinction from all-Crew replay;
- selected-party durable journal replay across restart;
- selected-party checkpoint replay/adoption equivalence;
- legacy four-key journal compatibility without adding `crewIds` to old canonical intent shape;
- real Chromium world-account entry, LOCAL party split, selected-party host gather, host journal evidence, and explicit checkpoint adoption;
- existing host local-seat checkpoint regression;
- existing world-entry and controller regressions triggered by the affected paths.

## Next convergence rung

With selected-party physical semantics available on the host journal, the next safe integration target is the primary playable gather/repair/explore input path: for a bound world participant, submit the selected-party macro through host authority and adopt the resulting checkpoint without creating a second simulation rule set. That step must preserve explicit revision/conflict behavior and must not silently fall back to browser-only authority when a host command is rejected.
