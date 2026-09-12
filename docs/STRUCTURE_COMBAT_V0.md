# AXM Global State RTS — structure combat v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung connects the material-backed formation combat to actual buildings and static defenses without turning a settlement containing hundreds of turrets into hundreds of independent weapon timers.

## Buildings can now be fought over

`StructureSiegeEncounter` lets a combat formation attack one authoritative construction instance.

Formation weapon packets keep their existing range, penetration and cohort-bounded behavior. Structure armor converts those packets into integrity damage, then the existing `ConstructionEconomy.damage()` path decides whether the building is damaged, destroyed, or whether destruction also exhausts civilization continuity.

This means the previously-shaped death rule remains the authority:

- destroy a Comic-book Wall or Bathtub Turret: the target can die, but the civilization remains alive;
- destroy the final useful continuity-bearing building: the civilization dies;
- farms/mines/defenses still do not become hidden extra lives.

## Static defenses are bounded batteries

`StaticDefenseBattery` takes a battle-local set of building IDs and groups armed structures by defense profile.

The first live profile is the **Bathtub Turret**.

A thousand identical active bathtub turrets therefore emit one aggregate defense packet for the combat step rather than one thousand independent timers. The packet still scales with the number of active turrets, so the defenses are not free or cosmetic; only the computation is compressed.

The caller remains responsible for choosing the battle-local defense set. This layer does not pretend every turret on the planet can shoot across the globe.

## Simultaneous siege ticks

Attackers and defending batteries create their packets before either side takes damage.

So a turret that is destroyed during the tick may still fire the shot it had already committed. This preserves the same no-hidden-first-mover principle used by formation-vs-formation combat.

Static-defense casualties can pass through `AuthoritativeStructureSiegeEncounter` into the existing `CivilizationCombatAuthority`, so a unit killed by a turret is removed from manpower, equipment, parties, production and logistics exactly like a unit killed by another formation.

## No accidental building-to-food conversion

The destruction economy remains **unit destruction**.

Destroying a building does not turn concrete, walls or machinery into the cannibal-food/gold loop. Static defenses that kill enemy units can still record those unit material losses through the defending run economy.

This preserves the earlier design rather than silently expanding the reward rule because both things happen to contain material.

## Current structure combat language

Structure armor is deliberately simple and data-driven in this rung. Continuity cores and comedy walls are harder targets than farms, while the Bathtub Turret is armored enough to matter but remains a non-continuity defense.

These values are tuning placeholders. The structural contract matters more than their current numbers.

## Evidence

`tests/structure-combat-selftest.mjs` verifies:

- 1,000 identical active Bathtub Turrets -> one defense packet / one work unit;
- defense range is respected;
- rifle cohorts damage real construction integrity;
- a turret can inflict a named casualty in the same tick its protected continuity core is destroyed;
- that casualty crosses into authoritative manpower/party state;
- destroying the final continuity building kills the civilization;
- post-death construction remains blocked by the existing continuity rule;
- destroying a non-continuity turret does not kill the civilization.

## Offline Guardian boundary

This does **not** give the offline Guardian permission to attack outward.

A static defense battery only fires inside an explicitly-created encounter. Guardian policy remains what it was: defend, repair and rebuild already-authorized state within available economy; no territorial expansion, new research or autonomous offensive campaigning.

## Truth boundary

Not claimed yet:

- terrain/structure line-of-sight or cover;
- ammunition and fuel;
- moving targets or kiting during a siege;
- vehicle weapons;
- repair crews operating during combat;
- artillery / indirect fire;
- target-priority AI;
- final turret/building balance;
- projectile, impact, destruction animation, audio or debris;
- server replication.

The new invariant is smaller and concrete: **combat can now destroy the structures that actually define whether a civilization survives, while large static defense groups remain computationally bounded.**
