# Multi-seat / controller architecture

Status: **EXPERIMENTAL FOUNDATION v0.1**

This is built early because retrofitting split-screen, multiple controllers and machine seats after the renderer/game loop exists would force authority and camera assumptions into the wrong places.

## Local player target

- 1–4 active seats in one browser session.
- The same session can be co-op, teams, free-for-all, or a mixture with world/AI seats once game rules exist.
- Split-screen is a presentation choice, not a different simulation.
- Each active seat owns its own camera/view state and UI surface while all seats act on the same authoritative world state.
- Later external displays should reuse the same seat-view contract rather than invent a second multiplayer model.

### Split-screen defaults

The initial layout helper supports:

- 1 seat: full screen;
- 2 seats: equal side-by-side in landscape, equal stacked in portrait;
- 3 seats: three equal columns/rows so no seat gets a larger information surface by default;
- 4 seats: equal quadrants.

The renderer should eventually implement this with viewport/scissor rectangles so one world render pipeline can draw independent cameras without cloning world state.

## Controller-first input

Most playtesting is expected to use controllers.

The current standard controller adapter establishes a testable path before the browser game shell exists:

- left stick: seat cursor / focus movement;
- right stick: camera movement;
- triggers: zoom intent;
- A: confirm/select;
- B: cancel/back;
- X: context action;
- Y: party menu;
- LB/RB: previous/next party;
- D-pad: UI navigation;
- map/pause buttons are exposed separately.

Exact bindings are tuning, not yet final gameplay law. The important rule is that held buttons are edge-triggered into discrete seat actions rather than creating one command per render frame.

### Keyboard / mouse

Keyboard + pointer remain supported for obvious one-player PC use, but local keyboard/pointer authority belongs only to **Seat 1**. Seats 2–4 are controller or machine seats on one device.

This avoids ambiguous shared-keyboard ownership while keeping the normal desktop path intact.

## Human and machine seat equality

A machine intelligence may occupy a normal user seat.

It receives **the same seat contract, not a privileged observer contract**:

- same fog/vision-limited observation policy;
- same command surface;
- same visual-option vocabulary;
- same seat UI capability;
- same APM limit;
- no hidden world-state feed;
- no direct canonical-state mutation path;
- no faster command path.

Human and machine may differ in *input source* (`gamepad` / `keyboard-pointer` / `machine`) but not in seat authority.

Native world/city AI later may have different world roles because it is world simulation, not a player pretending to be a user seat. A machine that joins as a player uses the player seat rules.

## 100 APM rule

Every active user seat—human or machine—is capped at **100 accepted discrete gameplay actions in a rolling 60-second window**.

The gate is shared infrastructure, not a human-only limiter.

Examples of counted actions once gameplay commands exist:

- selection/party changes that issue a discrete seat command;
- move/attack/gather orders;
- build/train/assign commands;
- policy/stance changes;
- menu confirmations that materially change game state.

Continuous controller state is not itself an APM action. A held stick reporting 60 frames per second is one continuous input state, not 60 gameplay commands. When that state produces a discrete world command, the command goes through the 100-APM gate.

Blocked action 101 does not mutate state. Once the oldest accepted action leaves the 60-second window, a new action can be accepted.

## Source pieces

- `src/session/seat-contract.mjs` — 1–4 seats, team identity, equal human/machine interface and visual options.
- `src/session/local-seat-runtime.mjs` — local binding authority and the single discrete action admission path.
- `src/input/action-rate-gate.mjs` — deterministic rolling-window 100 APM limiter.
- `src/input/gamepad-profile.mjs` — normalized standard controller state and edge-triggered actions.
- `src/input/gamepad-seat-router.mjs` — routes multiple bound controllers into their seats.
- `src/presentation/split-screen-layout.mjs` — 1–4 independent view rectangles and future display-surface seam.

## Truth boundary

This rung does **not** claim a finished split-screen renderer, physical-controller QA, network multiplayer, independent HUD implementation, or a connected AI provider bridge. It establishes the contracts and tested pure routing/layout logic early so later renderer/gameplay work does not hard-code one human, one camera or one input source.
