# AXM Persistent World RPG

Status: **EXPERIMENTAL — EMERGENT CITY RUNG**

This branch is a clean RPG restart built on the existing AXM Foundation Planet and reusable deterministic/host state machinery.

The active rule remains:

> **Players are temporary. The world and its cities inherit what players safely leave behind.**

## City emergence

The city no longer grows from a single abstract level bar.

Safe departure contributes:

- cumulative shared skill XP;
- an equal amount of unassigned **development XP**;
- the carried physical materials/items.

Shared skill XP is knowledge and is never spent away. Development XP is deliberately allocated into city projects. Physical materials are consumed by those projects.

Projects can be partially funded across many lives. Progress survives path changes.

The first project fabric includes:

- Hearth Circle
- Storehouse
- Trailhead
- Field Kitchen
- Workshop
- Archive
- Watch Post
- Community Gardens
- Market Square
- Road Yard
- Palisade
- Guild Hall
- Waterworks
- Council Hall
- Frontier Lodge
- Foundry
- Granary
- Bastion
- Caravanserai
- Great Archive
- Commons Forum

The final seven are path-specific landmarks. Their progress remains if the city changes direction and can continue when that path becomes active again.

## Emergent stages

Stages are derived from what has actually been completed, not chosen directly:

`seed-camp → camp → hamlet → village → town → city → regional-city`

Later stages require combinations of completed projects, category diversity, invested project XP and eventually multiple path hallmarks. A city therefore records its real history of choices rather than climbing one universal tech tree.

## Projects change the world

Completed projects now affect both rules and presentation.

Examples:

- **Storehouse** unlocks taking shared items back out of the communal pool.
- **Field Kitchen / Gardens / Granary** improve starting supply support for later lives.
- **Storehouse / Guild Hall** increase later-life carry support.
- **Road Yard / Frontier Lodge** expand the usable local map span.
- **Road Yard** adds visible roads.
- **Palisade / Bastion** add visible fortification rings.
- Workshops, archives, markets, gardens, halls, waterworks and path landmarks appear as persistent structures on the local Foundation surface.
- City stage itself increases the number and footprint of ordinary settlement structures.

The renderer still uses deliberately simple procedural primitives. These are state proofs, not final art.

## Clean active surface

The browser game layer remains only:

- `game/index.html`
- `game/rpg-world.css`
- `game/rpg-world.mjs`

The clean RPG renderer lives at:

- `src/rpg/presentation/rpg-renderer.mjs`
- `src/rpg/world/rpg-region.mjs`
- `src/rpg/world/rpg-foundation-sampler.mjs`

City emergence logic lives at:

- `src/rpg/city/city-emergence.mjs`

The active RPG does not load the donor RTS units, buildings, combat shell, strategic overlays or post-apocalyptic presentation.

## Run

```bash
git clone --recurse-submodules https://github.com/mike-axiom-mir/axm-global-state-rts.git
git checkout game/persistent-rpg-world-20260920
npm start
```

Then open:

```
http://127.0.0.1:4174/game/
```

## Verify

```bash
npm test
```

The RPG-specific suite verifies:

- world progression without private account-power carryover;
- safe-departure inheritance;
- development XP/material project funding;
- project prerequisites and path locks;
- retained partial project progress across path changes;
- automatic city-stage emergence;
- project-driven possibility unlocks;
- map-span changes from infrastructure;
- later-life supply/carry support;
- deterministic host journal replay;
- human/machine participant parity;
- the clean no-RTS active browser boundary.

## Truth boundary

This is the first deep city-emergence system, not a finished civilization simulator.

Population, NPC occupations, construction time, material refinement, maintenance, decay, city migration, multiple independent cities, political ownership, actual trade simulation, ecology-driven agriculture, procedural architecture quality, multiplayer deployment and final game balance remain future work.
