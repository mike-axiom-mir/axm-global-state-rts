# Action report — multi-seat/controller foundation v0

Date: 2026-09-12

Status: **EXPERIMENTAL · VERIFIED CONTRACT/SHELL**

## Requested direction

Build the Global State RTS from the beginning around:

- 1–4 local players;
- split-screen co-op / multiplayer-ready seat structure;
- controller-first practical testing;
- Seat 1 keyboard + pointer path for normal single-player PC use;
- machine intelligence allowed to occupy a normal user seat;
- machine user seat gets the same user observation/view/visual options and command authority, not more or less;
- the same 100 accepted actions-per-minute cap for human and machine user seats;
- a view boundary that can later move a seat from split-screen to another physical screen without inventing a second simulation.

## What changed

### Seat and authority contract

Added `src/session/seat-contract.mjs`:

- four fixed local seat slots;
- active kinds: `human`, `machine`, `closed`;
- team identity independent from controller type;
- shared seat-visible observation policy;
- shared command surface;
- shared visual-option vocabulary;
- explicit parity check proving a human seat and machine seat receive the same user-seat privileges/APM/observation/visual-option keys.

### Shared 100 APM admission gate

Added `src/input/action-rate-gate.mjs` and routed discrete seat actions through `src/session/local-seat-runtime.mjs`.

Rule:

- maximum 100 accepted discrete gameplay actions in a rolling 60-second window per seat;
- action 101 is rejected until the rolling window frees capacity;
- human and machine use the same gate;
- continuous analog camera/cursor/zoom state is not miscounted once per render frame; a discrete gameplay command is counted when it is issued.

### Controller-first path

Added:

- `src/input/gamepad-profile.mjs`;
- `src/input/gamepad-seat-router.mjs`.

The browser can bind up to four separate standard Gamepads. Seat 1 may hold both keyboard/pointer and a controller at the same time. Seats 2–4 do not silently share Seat 1 keyboard authority.

Gamepad buttons are edge-triggered before becoming discrete seat actions.

### Split-screen presentation

Added `src/presentation/split-screen-layout.mjs`:

- 1 player: full display;
- 2 players: equal halves;
- 3 players: equal thirds;
- 4 players: equal quadrants.

Added a seat-view surface seam so later work can render a seat onto a different physical display without changing seat authority/world state.

### First real Planet browser shell

Added `src/presentation/planet-renderer.mjs` and `/game/`.

The renderer:

- samples the pinned Foundation Planet model;
- builds the first miniature biome/relief globe expression;
- uses one shared Three.js world;
- renders independent seat cameras with viewport/scissor rectangles;
- allows controller camera control per bound seat;
- retains Seat 1 keyboard/pointer orbit/zoom.

This is the first visible shell, not yet the local RTS ground/units/buildings game.

## Failure found and repaired

The first Chromium controller run **failed** even though the pure tests were green.

Cause: browser `Gamepad` objects expose live getter-backed state. The router retained the previous Gamepad object by reference, so when a button changed the 'previous' object reflected the new button state too and the edge disappeared.

Repair: every polled Gamepad is now copied into an immutable frame snapshot before edge comparison. A new deterministic regression test uses a mutable getter-backed mock to reproduce the browser behavior.

This is why the controller browser gate is kept separate from source/syntax checks.

## Verification evidence

Current PR head after repair: `d105419440ed674b5c8cac9d9de411edb6c2b49e`.

### Deterministic/source workflow

Run `34702133220`: **PASS**.

It runs the full current `npm test` chain, including:

- globe/local spatial seam;
- Planet presentation coverage;
- multi-seat + human/machine parity + rolling APM tests;
- browser-shell module syntax checks.

### Chromium controller workflow

Run `34702133246`: **PASS**.

The browser test uses four independent virtual standard Gamepads and proves:

- real WebGL canvas loads;
- four local seat cards and four seat views exist;
- Seat 1 has keyboard/pointer + Gamepad 1;
- Seats 2–4 receive Gamepads 2–4 separately;
- discrete commands from each tested controller route to the correct seat;
- a three-seat configuration can assign Seat 3 to `machine` while retaining an equal visible seat surface;
- no page error, console error or failed request is accepted by the test;
- screenshots are preserved as workflow evidence.

### Visual inspection

The resulting screenshots were inspected after the green workflow:

- four-player view visibly resolves into four equal Planet quadrants with independent seat labels;
- three-player human/human/machine view visibly resolves into three equal Planet columns and exposes the machine seat through the same on-screen seat presentation.

## Still UNKNOWN / not claimed

- physical USB/Bluetooth controller behavior on Mike's actual machine;
- final controller button mapping/feel;
- actual local RTS unit/building controls;
- connected external/local AI provider observing/acting through a user seat;
- network multiplayer;
- separate-monitor/browser-window output;
- final globe-to-ground transition;
- economy, combat, fog, Guardian AI and mass-war scale/performance.

Those remain later rungs. This change deliberately builds the authority/input/view seams before gameplay so they do not have to be retrofitted after a one-player architecture hardens.
