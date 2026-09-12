# AXM Global State RTS — vehicle fabric v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung makes the earlier vehicle-license idea authoritative rather than decorative.

## Vehicle chain

The current chain is:

`Crew -> irreversible specialization -> vehicle license -> material-built vehicle -> assigned driver -> motorized party / cargo use`

A raw Crew member cannot drive by category alone. Light vehicles require the light license; heavy vehicles require the light-license prerequisite plus heavy training.

## First vehicle catalog

The first deterministic chassis are:

- **Utility Hauler** — baseline light logistics vehicle, no blueprint gate;
- **Scrap Buggy** — fast light vehicle, blueprint-gated;
- **Armored Bus** — slower heavy transport with much greater seats/cargo/integrity, blueprint-gated and more materially expensive.

These are gameplay definitions. Their final Creation Machine GLBs remain replaceable presentation assets.

## Materials are real

Constructing a vehicle debits the civilization stockpile.

Cargo loading also debits real stockpile resources and stores them on the vehicle. Unloading credits them back. Gold is deliberately excluded from physical cargo in this rung.

A destroyed vehicle clears its onboard cargo rather than creating hundreds of battlefield salvage objects. This follows the existing large-scale no-salvage decision. Destroyed cargo is not silently refunded.

Vehicle destruction itself does not enter the cannibal-food/gold reward loop; that loop remains tied to enemy **unit** material killed.

## Driver authority

A vehicle has one authoritative driver slot in v0.

`CivilizationManpower` now supports explicit unassignment so a vehicle can release a driver without rewriting license history. Destroying the vehicle clears the driver's current vehicle assignment while preserving the driver's specialization/license.

`CivilizationCombatAuthority` also understands an optional vehicle fabric. If a driver dies, the casualty boundary releases that driver from the surviving vehicle before deleting the manpower identity. A dead driver therefore cannot remain as a ghost movement permission.

## Strategic movement

`VehicleFabric.transportProfile()` compresses an ordered set of active, driven vehicles into transport cohorts by chassis definition.

The profile reports:

- total seat capacity;
- total cargo capacity;
- the slowest active chassis speed multiplier;
- movement mode;
- cohort count / bounded work units.

That speed multiplier can be passed directly into the existing `StrategicParty` great-circle travel model. The global scale therefore stays one world model rather than inventing a second vehicle map.

The profile is resolved at the movement-order boundary. Ordinary long-distance travel does not need to tick every wheel or every passenger.

## Mass-macro evidence

The deterministic test creates 20 identical licensed Utility Haulers and verifies that their ordinary strategic transport profile has one chassis cohort/work unit while still representing 20 vehicle instances and 40 seats.

## Current destruction / repair rule

Destroyed chassis can currently be repaired as existing state, but:

- driver assignment is gone;
- carried cargo is gone;
- the repaired chassis must receive a valid licensed driver again.

This is intentionally compatible with the wider AXM principle that existing authorized state may be repairable/rebuildable without granting new expansion authority.

## Truth boundary

Not yet claimed:

- vehicle weapons or armor combat packets;
- passengers/gunners as separate seat assignments;
- fuel consumption despite `fuel-bearing` material already existing;
- road-specific speed modifiers;
- terrain traction / wheeled-vs-tracked local pathing;
- convoy interception;
- aggregate vehicle logistics integration;
- vehicle production buildings/build times;
- collision, suspension or final driving visuals;
- controller vehicle menus;
- final balance.

The invariant established here is narrower: **a vehicle is now paid for, license-gated, driven by a real unit, able to carry real material, and able to change strategic movement without creating a per-frame vehicle simulation across the whole globe.**
