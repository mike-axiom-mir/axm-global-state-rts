# World-time → local physical simulation sync v0

Status: **EXPERIMENTAL / TESTED ONLY THROUGH THE GATES NAMED BELOW**

## Gap closed

World time already existed as host-authoritative state and already controlled hourly chest accounting, while a newly bound LOCAL RTS simulation still started from its browser-local default lighting phase. That meant a participant could enter the persistent world at a known world hour yet descend into a physical local simulation whose gameplay visibility did not reflect that same host clock.

This seam makes one deliberately narrow connection: once a human or machine participant is authority-revalidated and bound to a local seat, the RTS reads `/api/world/meta`, derives the v0 gameplay lighting phase from the returned authoritative `worldHourIndex`, and applies that phase to the existing local simulation. The local simulation therefore uses the same world-hour source that account/chest entry exposes rather than a hidden browser clock.

## Deterministic v0 expression

The mapping is explicit game logic, not an astronomy claim:

- a world day is 24 authoritative world-hour indices;
- hours 06 through 19 are `day`;
- hours 20 through 05 are `night`;
- the phase is refreshed after the host-reported next-hour boundary;
- local-only seats keep the existing local default and are not falsely presented as world-synchronized.

The sync evidence records the authoritative world-hour index, derived clock hour, phase, participant id, controller kind, and the remaining host-reported milliseconds to the next world-hour boundary.

## Equal-entry boundary

No human-only world-time path was introduced. The sync begins from the already authority-bound participant record and is independent of whether its controller kind is `human` or `machine`. The browser gate continues through a machine world-account and checks that the same bound-seat surface receives the host-derived phase before using the machine action surface to enter LOCAL RTS.

## What changes physically

The existing local simulation's `lightingPhase` changes. That phase already controls Crew vision radius, so the result is a real deterministic gameplay-state change rather than a label-only clock display. The seat and participant UI also exposes the synchronized world hour and local lighting phase so the player can distinguish a world-bound physical simulation from an unsynchronized local-only seat.

## Truth boundary

This does **not** claim:

- astronomical sun position, seasons, latitude-aware sunrise/sunset, or a realistic day/night cycle;
- that deterministic weather is now driven by this sync (weather authority remains separate and unchanged);
- final fog, lighting, or visual quality;
- target-device FPS, memory, draw-call, scale, or deployment evidence;
- persistence of local Crew positions, gather/explore/repair orders, resource depletion, storage, or core integrity;
- secure public authentication or distributed world persistence.

The host clock is read-only from this seam. A browser cannot create canonical world time by setting its local phase.

## Required evidence for merge

The intended merge gate is:

1. repository deterministic/source suite (`npm test`);
2. `tests/world-time-local-sync-selftest.mjs` plus syntax checks;
3. real Chromium world-entry flow proving authority-bound participant → host world meta → retained sync evidence → local simulation phase, followed by the existing persistent cursor claim flow;
4. controller/machine-seat Chromium regression because `game/app.mjs` is shared by the controller shell;
5. root review: Truth, Agency/non-domination, Continuity, Wisdom before speed.

Passing these gates still carries only the bounded claims above.
