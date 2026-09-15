# Host-selected-party LOCAL journal v0

Status: **EXPERIMENTAL / AUTHORITY-CONVERGENCE FOUNDATION**

## Purpose

The playable LOCAL RTS lets a player split Crew into persistent parties and issue gather, repair, and explore orders to the selected party. The durable host LOCAL command journal originally reproduced the same action types only as whole-seat orders because its physical intent did not carry the selected Crew ids.

That mismatch prevented the player-facing party layer from moving onto the existing host journal without changing gameplay semantics. This foundation closes that mismatch instead of silently widening a selected-party order into an all-Crew host order.

## Additive physical intent

The existing LOCAL outcome intent keeps its v0.1 schema and its legacy four-key shape:

- `actionId`
- `cursorXM`
- `cursorZM`
- `stepCount`

A fifth field, `crewIds`, is optional. When supplied it is a bounded physical selector for the existing LOCAL simulation command. Crew ids are validated as non-empty, duplicate-free strings and canonicalized into sorted order before evidence is produced.

When `crewIds` is omitted, the normalized physical intent keeps the old four-key shape. This deliberately preserves replay/digest compatibility for already-persisted journal entries rather than silently rewriting old evidence with `crewIds: null`.

Unknown Crew ids still fail through the existing LOCAL simulation validation. An empty selected set produces the existing `no-commanded-crew` rejection rather than becoming an all-Crew command.

## Durable journal and checkpoint replay

`LocalRegionCommandJournalAuthority` carries optional selected-Crew scope through:

1. intent normalization;
2. physical command digesting;
3. deterministic command execution;
4. append-only journal persistence;
5. restart rehydration and journal verification.

The browser checkpoint replay/adoption path also replays the recorded `crewIds`. A selected-party host command therefore cannot be journaled as four Crew and later adopted as an eight-Crew command.

Human and machine controller identity remains separate from the physical command digest. Equal selected Crew, world hour, cursor, action, and step count must reproduce equal physical state regardless of controller kind.

## Player-facing host controls

The explicit host gather, repair, and explore controls read the shell's current selected party and submit those exact selected Crew ids with the host-bound intent. They remain available as diagnostic/manual authority controls.

The newer bound-primary integration rung described in `BOUND_PRIMARY_HOST_MACROS_V0.md` also reuses this exact journal path for ordinary admitted gather/repair/explore controls when a shared-world-bound seat is already in LOCAL RTS and no existing menu owns the input.

For those normal bound controls, host acceptance is followed by the existing deterministic checkpoint-adoption path. The requested browser macro is intercepted, so the same input is not also admitted as a second browser-local gather/repair/explore order. Host rejection, a missing authority bridge, an in-flight host command, or failed checkpoint adoption does not silently fall back to browser-local mutation.

Local-only seats continue to use the existing browser-local macro path, and party/build/production/vehicle/combat menu inputs remain owned by their existing gameplay layers.

## Truth boundary

The host-selected-party journal and bound-primary route do **not** make the entire LOCAL RTS host-authoritative. They promote only a bounded gather/repair/explore command plus the named deterministic checkpoint that is explicitly adopted after host acceptance.

The host macro currently advances a bounded 160 deterministic journal steps. Ordinary later browser ticks are still browser-local, as are party split/merge membership, construction, aggregate production, vehicles, convoy/strategic travel, city pressure, combat, casualties, and civilization-death causality unless separately promoted.

Party membership itself is not host-persistent. The browser supplies selected Crew ids as part of the physical command; the host validates those ids against the deterministic LOCAL Crew roster and journals their physical effect, but it does not own the higher-level party registry/split/merge history.

No global-economy authority is implied. The active-run bootstrap/checkpoint provenance rules still prevent admitted starting value from being reclassified as newly earned verified salvage.

No production hosting, multi-host scale, network security, latency, performance, visual quality, balance, or animation completion is claimed. The 1–4 seat shell remains per-client access to the shared world, not a global-world player cap.

## Evidence

The selected-party foundation remains covered by deterministic one-shot/restart/checkpoint replay tests and real Chromium selected-party host-journal adoption evidence.

The bound-primary integration adds:

- `tests/bound-primary-host-macro-selftest.mjs` for local-only preservation, existing-menu preservation, human/machine route parity, rejection behavior, missing-authority fail-closed behavior, and in-flight suppression;
- `tests/browser/bound-primary-host-macros.spec.js` for ordinary bound gather/repair/explore controls traversing the real browser shell, durable host journal, and checkpoint adoption path.

The exact integration candidate must remain green in those focused gates plus the existing controller/source regressions triggered by `src/session/local-seat-runtime.mjs`.

## Next convergence rung

After normal bound gather/repair/explore controls share one host route, the next useful authority work is not another input surface. It is to extend compatible provenance-bearing host authority into the next actual lifecycle gap—construction/production/vehicles/strategic travel or combat/death—without widening claims beyond what deterministic replay and browser evidence prove.
