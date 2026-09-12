# AXM Global State RTS — vehicle combat v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung gives the material-backed vehicle fabric its first real combat layer without turning global-scale vehicle wars into one weapon timer per chassis.

## Vehicle weapon modules

`src/sim/vehicle-combat.mjs` adds a separate material-backed module fabric.

Initial modules:

- `module:vehicle-rotary-gun` — compatible with Scrap Buggy and Armored Bus;
- `module:armored-bus-turret` — heavy Armored Bus weapon.

Both require explicit blueprints and real run materials. Mounting checks chassis compatibility. One vehicle currently accepts one weapon module.

If the chassis is destroyed, the mounted module is destroyed with it. It is not returned to inventory and no battlefield salvage object is created.

## Driver authority remains real

An armed vehicle contributes fire only while it still has a live licensed driver assigned through the existing vehicle/manpower authority path.

A parked armed vehicle therefore cannot silently become an autonomous turret. Vehicle destruction releases the driver from the destroyed chassis; it does not silently kill the Crew member, and their learned license remains learned.

## Cohort combat

`VehicleCombatFormation` materializes explicit vehicle IDs once, then groups equal chassis + mounted-module + current-integrity vehicles into cohorts.

One thousand equal healthy armed Scrap Buggies therefore produce **one vehicle attack packet/work unit** for the combat step rather than one thousand weapon timers.

The packet strength still reflects the number of live driven vehicles in that cohort.

The first armor profiles distinguish Utility Hauler, Scrap Buggy and Armored Bus. Damage resolves through range, cooldown, accuracy, armor and penetration. The values are balance placeholders; the structural path is the point of the rung.

## Simultaneous combat

`VehicleCombatEncounter` calculates both sides' attack packets from the pre-casualty state before applying either side's destruction. This preserves the same no-hidden-first-mover rule already used by unit combat and static-defense combat.

A vehicle destroyed during that tick can therefore still contribute the shot it legitimately had at the beginning of the same deterministic step.

## Existing economy decisions preserved

Vehicle destruction itself currently does **not** enter the unit-destruction 99% food / 1% raw-gold loop.

Destroyed vehicle cargo is lost rather than materialized as a battlefield salvage pile. This preserves the earlier decision not to turn giant macro wars into thousands of persistent debris/resource objects.

## Evidence

`tests/vehicle-combat-selftest.mjs` covers:

- chassis/module compatibility;
- light/heavy driver-license use through the existing vehicle layer;
- real material module crafting;
- range asymmetry between rotary-gun buggy and bus turret;
- destruction of vehicle cargo and mounted module;
- driver release + retained license after vehicle loss;
- one thousand equal armed buggies collapsing to one attack packet/work unit;
- un-driven armed vehicles producing no hidden autonomous fire.

## Truth boundary

This is not finished combined-arms warfare.

Not implemented yet:

- infantry ↔ vehicle mixed encounter packets;
- passengers/gunners separate from the driver;
- fuel and ammunition;
- road/traction effects during combat;
- cover/line-of-sight;
- component damage / disabled wheels / engines;
- vehicle repair during combat;
- artillery or long-range bombardment;
- projectile/effect/audio realization;
- controller vehicle-combat menus;
- final balance;
- hosted shared-state commands for vehicle battle outcomes.

One more important implementation boundary: cohort `damageCarry` allows deterministic sub-kill damage to accumulate during the current encounter, but survivor partial-integrity reconciliation back into every explicit vehicle instance is not yet claimed. Full vehicle kills are authoritative immediately. That survivor reconciliation should be added before interrupted/cancelled encounters become a real gameplay path.
