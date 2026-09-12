# AXM Global State RTS — combat authority v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

The formation-combat layer deliberately keeps ordinary fighting bounded by cohorts rather than head count. That optimization creates a second requirement: when a cohort actually loses named members, those casualty identities must cross back into the authoritative civilization state exactly once.

## The casualty boundary

`src/sim/combat-authority.mjs` is the bridge between bounded combat and persistent civilization truth.

A confirmed casualty is removed from:

1. equipped combat loadouts;
2. aggregate production assignments;
3. persistent pre-made parties;
4. the authoritative manpower registry;
5. logistics worker counts derived from those production jobs.

The ordering is intentional. Production caches role factors, so it releases the worker while the unit identity still exists. The manpower record is deleted only after dependent systems have reconciled.

## Equipment is destroyed, not salvaged

An equipped weapon carried by a casualty is deleted from the loadout ledger and is **not** returned to inventory.

That matches the global-state scale decision not to create battlefield salvage objects for ordinary deaths. The already-existing material-destruction accounting remains the reward path:

`destroyed material -> food value -> 1% raw gold`

No second loot simulation is introduced.

## Persistent parties cannot command ghosts

`PartyRegistry.unregisterUnits()` removes casualty IDs both from the known-unit set and from every stored party. A saved macro group therefore cannot issue a later order to units that combat already destroyed.

## Dead workers cannot keep producing or hauling

`CivilizationProduction.releaseUnitIds()` removes casualty workers and subtracts their cached gather/production factors at the casualty boundary.

`CivilizationLogistics.reconcileWorkerCounts()` then updates existing aggregate haul routes from the remaining production job worker counts. If the last worker on a route dies, its throughput becomes zero; already-buffered goods remain buffered rather than teleporting to storage through a dead workforce.

## Encounter integration

`AuthoritativeCombatEncounter` wraps the existing simultaneous `CombatEncounter`.

The underlying encounter still calculates both sides' attack packets before applying casualties. The wrapper does not change damage, range, armor, food modifiers or first-mover behavior. It only consumes the stable casualty IDs emitted by the combat tick and reconciles those IDs into each civilization authority.

Replaying an already-applied casualty ID is a no-op because only currently-live manpower IDs are admitted to reconciliation.

## Mass-macro boundary

Ordinary combat remains cohort-bounded.

The potentially per-unit work happens only at the casualty boundary, proportional to the number of identities that actually died. This preserves explicit named units for parties, training, licenses and equipment without turning every 50,000-person firefight into 50,000 weapon timers every tick.

## Evidence

`tests/combat-authority-selftest.mjs` verifies:

- casualty manpower deletion;
- equipped weapon destruction without free inventory return;
- removal from persistent parties;
- removal from aggregate production;
- logistics throughput reconciliation;
- buffered resources do not keep moving through zero dead workers;
- repeated casualty reconciliation is idempotent;
- real `CombatEncounter` casualty IDs cross through `AuthoritativeCombatEncounter` into persistent civilization state.

## Truth boundary

This rung closes the **unit casualty authority** gap. It does not yet claim:

- vehicle destruction/crew ejection;
- turret or building combat;
- cover / terrain LOS;
- ammunition or fuel supply;
- medics, wounds or recovery states;
- moving formations during an encounter;
- projectile/effects/audio realization;
- server replication or conflict resolution;
- final combat balance.

Those can now build on one consistent rule: **if combat says a named unit died, the rest of the civilization can no longer keep using that unit.**
