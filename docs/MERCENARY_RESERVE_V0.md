# AXM Global State RTS — mercenary reserve v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung gives the run-earned gold its first concrete use: expensive mercenary contracts reserved for a future drop.

## Gold stays between runs

The existing combat economy produces a small amount of persistent gold from enemy **unit** material destroyed. Run closure banks that gold.

Mercenaries can be rented only while no civilization run is active. A contract therefore cannot be bought as an emergency mid-fight injection.

The paid contracts sit in a pending reserve and are consumed automatically by the **next** run. Once that drop begins, the pending reserve is empty again.

## First contract catalog

The v0 prices are intentionally expensive placeholders rather than a cheap permanent power shop:

- **Lone Rifle Mercenary** — 750 gold;
- **Scout Pair** — 1,800 gold;
- **Five-person Assault Contract** — 4,800 gold.

The purpose is to let gold stack across strong runs until a player decides that a later drop is worth spending the treasury on.

These numbers are not final balance claims.

## Mercenaries are external contracts, not hidden player upgrades

Normal civilization manpower still follows:

`Crew -> irreversible specialization -> equipment / licenses`

A mercenary arrives already specialized because that expertise is what the external contract purchased. Each unit carries explicit provenance:

`source = mercenary-contract`

plus its contract ID and deployment event.

That exception does not unlock the mercenary's role or weapon blueprint for ordinary Crew. If the player has not researched the Scrap Rifle, ordinary Crew still cannot train into a Rifle Guard merely because a contracted rifle mercenary exists in the same run.

## Contracted equipment has real combat value

`CivilizationRun` now owns a combat-equipment ledger directly.

Contracted units receive the weapon named by their contract through an explicit external-loadout receipt. The weapon does not debit the run stockpile a second time because the package was already paid for in persistent gold.

The loadout still contributes its ordinary material value to formation combat. If that mercenary is killed, the equipped weapon is destroyed through the same casualty authority used by locally-trained units; it is not returned as free inventory or spawned as battlefield salvage.

## Mercenaries still belong to the doomed run

Contracted units are not persistent characters.

They increase the manpower of that one drop, eat through the same population food system, can join the same parties, can die through the same combat authority, and disappear with the run. Only the player's persistent progression—banked gold, permanent blueprints, unopened caches, etc.—survives into the next attempt.

## Current unit packages

The first contracts intentionally reuse existing roles and weapons:

- Rifle Guard + Scrap Rifle;
- Scouts with improvised pistol / Scrap Rifle;
- Assault package with three Rifle Guards, one Shotgun Raider and one Medic.

This avoids inventing a second special mercenary combat system. They are ordinary authoritative units after deployment; their only exceptional step is how their specialization/loadout entered the run.

## Evidence

`tests/mercenary-reserve-selftest.mjs` verifies:

- live runs cannot rent contracts;
- banked gold is actually spent;
- pending contracts survive between runs and are consumed by the next drop;
- 8 ordinary starting Crew remain 8 Crew while contracted specialists are added alongside them;
- mercenary provenance is explicit;
- contracted weapons are equipped without silently granting the player blueprint;
- ordinary Crew remain blocked by missing blueprints;
- mercenaries cannot respecialize into something else;
- a larger contract can be saved for and deployed on a later run.

## Truth boundary

Not yet claimed:

- final prices or contract roster balance;
- contract expiry / rotation / marketplace fiction;
- mercenary personalities, loyalty or persistence;
- vehicle mercenary contracts;
- a controller/UI contract screen;
- public server/account persistence;
- matchmaking or pay-to-win mitigation policy beyond the current gameplay rule that this currency is earned by playing, not purchased here.

The new invariant is narrow and concrete: **run gold can now be deliberately saved, spent only between runs, and converted into a one-drop contracted force without creating permanent stat upgrades or bypassing the normal Crew rules for everyone else.**
