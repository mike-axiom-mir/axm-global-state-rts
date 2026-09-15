# AXM Global State RTS — global logical clock / deterministic catch-up proposal

Status: **RESEARCH PROPOSAL ONLY — DO NOT MERGE AS IMPLEMENTATION**

This note captures a possible next architecture rung for the persistent shared RTS world. It is intentionally documentation-only and should be investigated against the current host-authoritative state, journal, world-time, replay, city, Guardian, streaming, and local-checkpoint systems before any implementation.

## Question

Can the shared world continue **logically** while no browser/player is connected without requiring a server to simulate the whole planet continuously at high frequency?

The proposed shape is:

```text
canonical checkpoint/state
+ last processed global logical tick/time
+ current authoritative global logical tick/time
+ deterministic world transition rules
+ accepted external journal/events
= reconstructed current world state
```

The key idea is that "persistent world keeps going" does not have to mean "every world entity receives a continuous frame/tick forever."

## Proposed global logical clock

Keep one canonical monotonic world-time/tick source beside the deterministic world rules. Each persisted subsystem records enough temporal provenance to know the last authoritative tick/time it processed.

On host startup, request, scheduled maintenance, or player/world access:

1. read the last canonical world checkpoint/state;
2. read its last processed logical tick/time;
3. read the current authoritative logical tick/time;
4. calculate elapsed logical time;
5. resolve only the deterministic transitions/events crossed during that interval;
6. persist the resulting accepted mutations/checkpoint evidence;
7. expose the reconstructed current world to browser/human/machine participants.

This is **catch-up**, not a claim that a hidden simulation was literally running every frame while nobody was present.

## Different systems should advance differently

Do not force every subsystem through one per-frame replay loop.

### Closed-form / delta-resolvable systems

Where safe and exact, jump directly from elapsed time.

Examples:

- passive food/material production;
- upkeep/consumption;
- bounded repair progress;
- research/progress timers when no intermediate branching event exists;
- strategic travel with known departure/arrival time.

Conceptually:

```text
next = deterministic_transition(previous, elapsed_ticks, inputs)
```

rather than iterating thousands of empty ticks.

### Event-indexed systems

Resolve only deterministic events whose indices/times were crossed.

Existing asteroid hour-indexing is already close to this model.

Examples:

- hourly asteroid opportunities;
- scheduled city decisions;
- world events;
- authorized production completions;
- travel arrival/departure boundaries;
- expiry/cooldown boundaries.

### Branching/interaction-heavy systems

If outcome depends on intermediate state, process deterministic decision/event points in order rather than using a single arithmetic delta.

Examples may include:

- NPC strategic decisions;
- city-vs-city interactions;
- conflicts triggered during elapsed time;
- starvation thresholds changing production/readiness;
- resource depletion that changes later production.

The implementation should preserve exact ordering/evidence instead of inventing a cheap formula where one is not valid.

### Active tactical regions

High-detail local battles may still require finer simulation while materially active. They should remain bounded/streamed and should not imply the whole globe needs the same frequency.

## Relationship to current architecture

This proposal appears to fit the repository's existing direction rather than replace it:

- hosted append-only deterministic journal;
- authoritative world time;
- deterministic replay;
- sparse persistent world mutations;
- procedural reconstruction from seed;
- aggregate remote parties;
- aggregate deterministic city state;
- hour-indexed asteroid stream;
- bounded browser working sets;
- host checkpoint adoption/replay.

The intended addition is a **world-level temporal catch-up contract** connecting those pieces when wall-clock/world-time advances without continuous active simulation.

## Important distinction: state authority vs simulation workload

A hosted authority may remain canonical without becoming an MMO-style always-running full simulation server.

Potential responsibility split:

```text
HOST / CANONICAL AUTHORITY
- authoritative logical world time
- accepted ordered external commands/events
- checkpoint/state/journal hashes
- deterministic catch-up admission
- durable sparse mutations
- conflict/order resolution

BROWSER / CLIENT RUNTIME
- bounded visible working set
- rendering
- local tactical detail where permitted
- verified replay/adoption
- human or machine player seat surfaces
```

Exact authority boundaries must follow the repository's existing truth rules; this note does not propose trusting arbitrary browser-produced world outcomes.

## Candidate invariants

Any implementation should investigate preserving at least these:

1. **Determinism:** same canonical prior state + same authoritative elapsed time + same accepted event history => same reconstructed state.
2. **Monotonic time:** a participant cannot move canonical world time backward or forge future advancement.
3. **Idempotence:** catching up to tick/time N twice produces no double production, duplicate events, or repeated rewards.
4. **Ordered boundaries:** events crossed during catch-up resolve in deterministic order.
5. **No hidden client authority:** browser clock/state cannot manufacture canonical elapsed time or mutations.
6. **Sparse cost:** inactive world regions do not require full object allocation or frame simulation.
7. **Replay evidence:** important catch-up transitions remain auditable/reproducible from canonical inputs.
8. **Human/machine parity:** controller kind does not change physical world-time rules or grant a private advancement lane.
9. **Fail closed on ambiguity:** if two dependent transitions cannot be safely collapsed, replay/resolve the necessary deterministic boundaries instead of approximating silently.
10. **No fake continuity claim:** until hosted/offline advancement is actually exercised with restart/replay evidence, call it a proposal/partial rung only.

## Questions for the active builders

Please investigate rather than immediately implement/merge:

- Does current `worldHourIndex` already provide enough canonical time identity, or is a finer logical tick needed?
- Which current systems can advance exactly from elapsed time without per-tick iteration?
- Which systems require indexed decision/event boundaries?
- Should catch-up happen lazily on read/join, periodically in the host, or through a hybrid where important global events materialize on scheduled boundaries?
- What is the smallest safe hosted proof: e.g. advance one aggregate city across N offline world hours, restart, replay, and prove the same final hash?
- How should canonical checkpoints/compaction work once journals become long?
- How does this interact with active local tactical regions and concurrent participants so catch-up cannot race live mutations?
- Can the existing expected-revision/head-hash contracts be reused to serialize catch-up commits?
- What wall-clock source / monotonic-time policy is acceptable for hosted deployment without trusting a player's browser clock?

## Suggested smallest experiment

Do **not** start by making the whole world advance offline.

A minimal proof could be:

1. choose one existing deterministic aggregate city;
2. persist its state + `lastProcessedWorldHour`;
3. advance authoritative world time by a controlled number of hours in a test;
4. run deterministic catch-up for food/material/upkeep/repair only;
5. record resulting state hash/evidence;
6. restart/replay from prior checkpoint + time interval;
7. require identical final state/hash;
8. run the same proof whether the accessing participant is human, machine, or absent.

If intermediate thresholds make closed-form advancement unsafe, the proof should surface that and resolve deterministic event boundaries rather than hide the problem.

## Why this may matter

If this contract holds, the product can truthfully present a persistent world that continued while nobody was connected, while most inactive world state remains compact deterministic data rather than an always-running high-frequency simulation.

That would preserve the current browser-scale/mass-macro direction:

> world persistence from canonical state + elapsed world time + deterministic rules, not brute-force perpetual ticking of every entity.

Again: **research proposal only. Do not merge this note as proof that the architecture is implemented.**
