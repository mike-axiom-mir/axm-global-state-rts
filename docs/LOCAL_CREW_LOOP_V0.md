# Local Crew macro loop v0

Status: **EXPERIMENTAL DETERMINISTIC GAMEPLAY SLICE**

## Purpose

Put the smallest real macro-economy loop underneath the globe → local RTS shell without waiting for final art assets.

The loop is intentionally about **Crew policy**, not repetitive villager clicking:

`Crew → known scrap → carry → storage → continuity-core repair`

This is not an upgrade loop and it does not introduce a small population cap.

## Authoritative slice

`src/sim/local-region-sim.mjs` owns this current local simulation proof.

Each starter region begins with:

- eight base Crew;
- one damaged continuity core at 68% integrity;
- one storage depot;
- one known scrap source;
- one second scrap source that exists canonically but is **not known to the user-state simulation** yet.

The second source cannot be gathered simply because it exists in memory. It only enters the ordinary user snapshot after explicit discovery.

That establishes the first real fog/knowledge invariant:

> automation may act on known state; automation may not manufacture knowledge.

## Macro orders

### Gather known scrap

A gather order chooses a known valid scrap source. Crew then automate the mechanical repetition:

1. travel to the source;
2. gather until carry capacity is reached or the source is exhausted;
3. travel to storage;
4. deliver automatically;
5. return to the nearest remaining known source while the order remains useful.

The user does not need to click every Crew member or every delivery trip.

In the current browser shell:

- controller **A / confirm** issues the gather policy using that seat's local cursor;
- keyboard **Enter** does the same for Seat 1.

### Repair continuity core

A repair order sends Crew to the continuity core and consumes stored scrap as integrity is restored.

- controller **X / context**;
- keyboard **X** for Seat 1.

Repair cannot create material. If storage is empty, Crew can be positioned at the core but no integrity is fabricated.

## Determinism and accounting

The simulation advances through a fixed 250 ms step.

Current deterministic checks prove:

- same state + same commands = same result;
- known scrap is conserved across resource node, Crew carry and storage;
- hidden scrap remains untouched until discovery;
- repair consumes stored scrap and cannot raise integrity over 100%;
- ordinary snapshots exclude undiscovered resource coordinates/amounts.

The tuning values are experimental and are not balance CANON.

## Mass-macro boundary

This active-region proof currently tracks eight Crew individually because the local view benefits from it.

That is **not** a commitment to simulate every distant person on the globe at this resolution.

The intended scale boundary remains:

- active local region: enough detail for visible Crew/vehicles/buildings;
- parties/formations: aggregate control for large forces;
- distant regions: cheaper deterministic summaries/state transitions;
- canonical ownership/resources/continuity remain truthful across all representations.

## Human / machine parity

Local macro commands are admitted only after passing the existing player-seat input surface and rolling 100-APM cap.

A machine user seat uses the same `confirm`, `context`, and `map-toggle` actions as a human user seat. There is no separate instant-economy API and no hidden-resource gathering command.

## Current presentation boundary

The browser HUD now shows, per local seat:

- continuity-core integrity;
- stored scrap;
- current high-level local order.

The current procedural Crew/building geometry is still temporary. The revised Creation Machine assets can replace those stable asset IDs later without changing this simulation contract.

## Not yet claimed

This slice does not yet claim:

- final visual fog/light masking;
- discovery through actual moving vision cones;
- food/upkeep;
- specialization/training;
- building construction placement;
- combat;
- offline Guardian operation;
- server persistence/network synchronization;
- distant-state aggregation/performance at final scale.

## Next useful growth

The next systems rung should connect **vision/light → discovery** so the currently hidden scrap source can become known only through legitimate exploration. After that, add one actual construction path using stored material rather than inventing an upgrade tree.
