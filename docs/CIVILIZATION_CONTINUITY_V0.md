# AXM Global State RTS — civilization continuity / death v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung captures the shaped death rule: a civilization should not survive merely because it hid units, spammed defenses, or scattered resource buildings across the world.

## What keeps a run alive

A building may be marked `continuityEligible`.

By default these categories **do not** keep a civilization alive:

- defense;
- resource;
- extractor;
- farm.

Other useful strategic buildings are continuity-eligible by default. Examples include continuity cores, workshops, storage, training and civic/industrial structures.

The default can be overridden explicitly per building because later content may contain unusual hybrids.

## Death rule

A run is alive while at least one continuity-eligible building remains above zero integrity.

When the **last** continuity-eligible building is destroyed:

- civilization death is latched;
- surviving turrets/walls/resource buildings do not prevent death;
- surviving units do not count as hidden continuity;
- later repair/rebuild cannot resurrect that finished run;
- adding a new building after death is rejected.

That matches the drop-in loop: once the run is actually dead, the next entry is a new drop rather than an offline Guardian magically restoring an already-finished civilization.

## Why defense/resource structures do not count

Defensive structures exist to make destruction difficult, not to become infinite life tokens.

Resource buildings are naturally scattered to reduce gathering travel and support wide macro play. Counting every remote farm/mine as civilization continuity would turn cleanup into tedious planet-scale hunting.

The continuity rule therefore keeps defenses and resource logistics strategically important without allowing them to redefine what 'dead' means.

## Offline Guardian boundary

The existing offline Guardian may repair or rebuild previously-existing structures while the civilization is still alive.

This continuity layer is deliberately **latched** at death. Once all continuity-bearing structures are gone, later Guardian repair cannot revive the run.

The two systems should eventually share the same authoritative building registry; this rung establishes the death invariant first.

## Evidence

`tests/civilization-continuity-selftest.mjs` verifies that:

- destroying all defenses/resources does not kill the civilization;
- one surviving useful building is sufficient to keep the run alive;
- a destroyed useful building may be rebuilt while another continuity building still survives;
- destroying the final continuity-bearing building kills the run;
- post-death repair/build attempts cannot resurrect it;
- an explicit `continuityEligible` override can handle unusual hybrid buildings.

## Truth boundary

Implemented now:

- deterministic building continuity registry;
- default defense/resource exclusion;
- explicit per-building continuity override;
- damage/repair/rebuild state;
- last-continuity-building death condition;
- latched death with no resurrection;
- deterministic tests.

Not claimed yet:

- final building catalog/category mapping;
- integration with actual construction placement;
- combat projectile/damage delivery;
- shared registry with the offline Guardian;
- server persistence;
- automatic transition from local death into the next-drop UI;
- spectator/remnant behavior after death.
