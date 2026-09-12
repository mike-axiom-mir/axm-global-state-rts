# AXM Global State RTS — material combat v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung turns the economy into actual combat without paying one attack tick per person in a mass battle.

## Equipment has real material cost

`src/sim/combat-equipment.mjs` introduces a small first weapon catalog:

- Improvised Pistol;
- Scrap Rifle;
- Pipe Shotgun.

Weapons are crafted from the civilization stockpile. Rifle/shotgun crafting respects the existing blueprint ledger. Crafted weapons enter a small equipment inventory and are then equipped to specialized Crew. A raw Crew member cannot silently become an armed ground unit without specialization.

A combatant's destruction material value is derived from its specialization training cost plus equipped-weapon material cost. This is accounting value for the already-shaped destruction -> food/gold rule; it does not spawn salvage objects.

## Cohort combat instead of per-unit firing loops

`src/sim/formation-combat.mjs` materializes a formation from explicit unit identities once, then groups equal role/loadout members into cohorts.

A cohort carries:

- role;
- weapon;
- alive count;
- health/armor;
- deterministic partial-damage carry;
- material value per member;
- stable member IDs for survivor/casualty reconciliation later.

One thousand equal-loadout members therefore emit **one cohort attack packet** per combat step, not one thousand weapon ticks.

Different roles/loadouts still remain separate cohorts, so mixed armies preserve useful tactical differences without the remote/macro cost becoming proportional to head count.

## Deterministic range and simultaneous ticks

Each combat step first calculates both formations' attack packets from their pre-casualty state. Only then are casualties applied. That avoids a hidden first-mover advantage inside one deterministic tick.

Range is literal per weapon. For example, a rifle formation can engage a shotgun formation from outside shotgun range and receive no fictional return fire.

Current damage is expected deterministic output using weapon damage, cooldown, accuracy, role combat factor, food/combat modifier, armor and penetration. Seeded shot variance, cover and line-of-sight are later layers rather than hidden random authority in this rung.

## Existing food and destruction loops connect directly

The encounter accepts each side's combat modifier, so the already-shaped food policies can feed combat without creating a second modifier authority.

When casualties destroy material value, the encounter can write that exact amount into the attacker's existing `RunEconomy`:

`destroyed material -> 99% food + 1% raw gold`

The existing peak-global-control multiplier remains an end-of-run layer and is not recomputed by combat.

## Evidence

`tests/material-combat-selftest.mjs` verifies:

- blueprint-gated material weapon crafting;
- specialization before equipment;
- formation cohort collapse;
- range asymmetry;
- food/combat modifier effect;
- destruction accounting into the existing food/gold economy;
- 1,000 equal-loadout units -> one attack packet;
- unarmed cohorts do not gain hidden ranged attacks.

## Truth boundary

Implemented here is the deterministic combat substrate, not finished tactical warfare.

Not claimed yet:

- projectile rendering;
- cover/terrain line-of-sight;
- suppression/morale;
- ammunition/fuel supply;
- medics/healing;
- vehicle combat;
- building/turret combat;
- party movement during combat;
- casualty writeback into the authoritative manpower registry;
- animation/audio/effects;
- controller combat menus;
- global/server replication;
- final balance numbers.

The structural rule is the important part: **unit identity can remain explicit while ordinary combat work follows active cohorts/formations rather than total population.**
