# Global State consumer research — aggregate city time characterization v0

Status: **RESEARCH CHARACTERIZATION / DO NOT MERGE AS A FIX**

## Question

Can the existing aggregate-city simulation be treated as a Global State consumer where a long offline interval is safely reconstructed by calling:

```text
city.advance(total_elapsed_seconds)
```

regardless of how that same elapsed time would have been divided while the world was active?

## Why this matters

The generic `axm-global-state` Temporal State Kernel can skip empty logical time only when the consumer's transition semantics are explicit.

There are several valid consumer shapes:

1. **closed-form / chunk-invariant** — one 12-hour advance equals twelve 1-hour advances;
2. **fixed quantum** — the product deliberately defines a canonical step such as one minute or one world hour;
3. **event-boundary** — the consumer advances directly between explicitly scheduled meaningful boundaries.

A product does not need to be chunk-invariant to use Global State, but it must not leave the stepping policy accidental.

## Current aggregate-city observation

`AggregateCity.advance(deltaSeconds)` currently contains nonlinear/history-sensitive operations including:

- starvation-pressure smoothing from the previous pressure value;
- readiness derived from that smoothed pressure;
- repair bounded by current readiness/resources;
- defense training using `Math.floor(...)` over each call's available time/resources/readiness.

Therefore it is not safe to assume arbitrary time chunks are equivalent.

## Characterization fixture

`tests/global-state-city-time-characterization.mjs` creates the same deterministic major city three times, places it under deliberate food pressure, applies identical starting damage, then advances exactly 12 hours using:

- one `43,200s` call;
- twelve `3,600s` calls;
- 720 `60s` calls.

The test requires:

- same seed + same schedule reproduces exactly;
- all schedules reach the same elapsed time;
- invariant rules such as `expansionIntent = 0` remain intact;
- at least one physical/economic field differs between chunk schedules;
- starvation pressure specifically differs, proving a real nonlinear history dependency rather than only a revision-counter difference.

## Meaning of a green characterization gate

A green gate means **the gap was reproduced and characterized**.

It does **not** mean Global State offline catch-up is integrated into the RTS, and it does not mean the current city behavior is wrong. It means the product must deliberately choose/define its canonical temporal semantics before Global State can reconstruct an absent period without changing meaning.

## Candidate next directions — not decisions

The active RTS builders should decide which semantics fit the game:

- declare a fixed aggregate-city quantum and replay only those boundaries during catch-up;
- refactor selected city equations into chunk-invariant closed-form transitions where that preserves intended behavior;
- expose meaningful city decision/economy boundaries to a consumer adapter;
- combine approaches: closed-form linear economy + fixed/event boundaries for nonlinear state.

Do not silently choose a quantum merely because it makes a test pass. The quantum becomes game behavior and therefore belongs to the RTS product contract.

## Truth boundary

This branch does not change `AggregateCity`, `WorldCityFabric`, gameplay balance, hosted authority, or Global State product integration. It is a read-only characterization of existing semantics plus test/documentation evidence.
