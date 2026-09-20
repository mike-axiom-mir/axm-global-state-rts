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

## Villagers are simulated people

Ordinary villagers are not fixed profession slots and are not scripted quest actors.

Each resident has deterministic but different:

- personality traits: curiosity, sociability, industry, risk tolerance, empathy, ambition, tradition and thrift;
- changing needs: energy, hunger, belonging, purpose and safety;
- skills that grow from actual behavior;
- sparse relationships with affinity, trust and familiarity;
- a bounded rolling memory of recent actions/outcomes;
- position in the city;
- an action history and evolving wellbeing.

Every four-hour simulation tick, each ordinary resident scores the actions currently possible in the city. The score combines:

- current needs;
- individual traits;
- learned skill;
- existing relationships;
- city development path;
- emergent city culture from prior resident behavior;
- unlocked infrastructure/opportunities;
- bounded deterministic variation keyed to resident + tick + action.

That last term makes choices non-uniform without making replay nondeterministic. The same world state and journal reproduce exactly the same decisions. Different residents and different city histories produce different action distributions.

City direction is a **bias**, not an order. A Forge city makes crafting more attractive, but villagers still rest, socialize, explore, help each other, trade or study when their own state makes those choices stronger.

Residents can currently choose among:

- rest
- eat
- socialize
- help a neighbor
- gather
- craft
- grow food
- trade
- study
- patrol
- explore
- maintain the city

Infrastructure determines which of the specialist opportunities actually exist. No Workshop means no normal workshop-craft opportunity; no Market means no trade workplace; no Archive means no study workplace; and so on.

The population can also grow deterministically when wellbeing and city capacity permit. City stage controls capacity.

Only deliberately declared **service NPCs** are fixed:

- Storekeeper after Market Square
- Records/quest keeper after Archive or Council Hall

Those are stable UI/service anchors, not simulated villagers. Ordinary residents retain autonomous growth.

The clean renderer now shows simulated residents at the places their chosen actions took them. Service NPCs are visually separate and anchored to their service building.

## Resident economy, shortages, discoveries and proposals

Villager simulation now produces consequences instead of only behavior labels.

Ordinary residents can now:

- gather timber, stone, fiber and ore into **personal possessions**;
- decide to share surplus into the canonical city material pool;
- craft personal goods/tools from what they carry;
- produce communal food;
- trade personal goods and accumulate individual wealth;
- patrol to improve local security;
- maintain the city and reduce maintenance backlog;
- suffer from communal food shortages;
- live inside infrastructure that can drift into poor condition if nobody maintains it;
- make deterministic local discoveries;
- create small informal works from repeated behavior;
- form advisory project proposals based on skills and lived experience.

Informal works currently include:

- footpaths from repeated exploration;
- market stalls from repeated trading;
- garden plots from repeated food-growing;
- workbenches from repeated crafting.

Those are deliberately smaller than official city projects. Residents can create them autonomously because they represent local lived behavior, not a constitutional city-wide investment.

Resident proposals are also deliberately **advisory only**. A villager can propose a Workshop, Foundry, Archive, Palisade, Granary, road infrastructure and other official projects, and other residents can develop support for that proposal. The proposal does not spend shared materials, allocate development XP, switch city path or complete a project. Shared/project authority remains separate.

The city simulation now tracks:

- communal food reserve and cumulative food production;
- resident-created trade value;
- maintenance backlog and maintenance work;
- aggregate infrastructure condition;
- local security;
- food-pressure and maintenance-shortage counters;
- resident discoveries;
- open proposals and resident support;
- informal resident works.

When a resident voluntarily shares physical material, the deterministic simulation returns that as a city effect and the persistent-world authority puts it into the exact same canonical `sharedItems` pool used by official city projects.

## Same resident model for player and villagers

The human-controlled character is also `kind: resident`.

The meaningful distinction is controller:

- `human`
- `autonomous`
- `machine`

All three use the same equipment/capability contract. Controller kind grants no hidden combat, defense, survival, utility or carry bonus.

Shared equipment slots:

- weapon
- armor
- tool
- pack

Adventure capability is derived from actual skills, equipment, supplies and vitality. It exposes power, defense, survival, utility, carry capacity, learned abilities and an adventure score.

For autonomous residents, the city/user can explicitly:

- assign real gear from the canonical shared city pool;
- set adventure permission on/off;
- set the maximum allowed risk: safe / standard / bold;
- set expedition-return focus: self / mixed / city.

Permission does not override capability. Setting a resident to `bold` means “you may go this far if you are ready,” not “pretend you are ready.” The resident only gets the autonomous adventure option when the same shared capability rules say the chosen risk is supportable.

A geared and experienced ordinary resident can therefore become adventurer-like without changing class.

Successful expeditions can:

- grow exploration / defense / gathering skill;
- return materials or equipment;
- create discoveries;
- keep loot personally, split it, or return it to the city depending on policy;
- feed the same canonical city pool used by player-funded projects.

Adventure is also an explicit gameplay danger. A failed expedition can injure or kill the resident. On death, some gear/possessions may be recovered to the city and some may be lost; the resident and accumulated skill/labor leave the active population, while a fallen-resident record remains. There is **no aging, old-age death or passive mortality timer**.

Human-controlled residents currently perform moment-to-moment world play directly, while autonomous residents use the deterministic action selector. That controller difference is input/control only, not a different character species or hidden ruleset.

## Dormant equilibrium, session survivors and chained explorers

A city now begins in a **living equilibrium** rather than a free idle-growth machine.

Before meaningful interaction, residents can stay alive, eat, forage, rest, socialize and form ordinary memories/relationships, but the untouched city does not autonomously snowball:

- no population expansion;
- no accumulating resident skill progression;
- no discoveries;
- no informal works;
- no proposals;
- no adventures;
- no passive infrastructure decay spiral.

The first real resident/user interaction explicitly awakens the city. From that point the existing open-ended causal simulation can roll without a fixed destination.

Human-controlled lives now have a deterministic session-survival threshold. The current threshold is based on actual accumulated XP plus journey marks from travel/discovery. Before the threshold, safe session exit uses the existing city-contribution path. After the threshold, a living session can instead become a persistent city resident.

A retained session survivor:

- keeps the exact personal equipment worn at session end;
- keeps personal carried possessions instead of double-banking them into the city;
- keeps personal earned skill growth translated into the resident skill fabric;
- receives a stable survivor-chain index;
- switches from `controllerKind: human` to autonomous control after the session;
- starts with conservative city-oriented exploration permission;
- remains in the greater world until a real gameplay outcome kills them.

There is no aging or passive mortality.

### Explorer package rule

The city has an adjustable **explorer package**: a desired weapon / armor / tool / pack loadout.

For retained session-survivors:

- if their own session gear is as strong or stronger than the configured package, they keep their own gear and may continue exploring when capable;
- if the configured package would be stronger, they do **not** discard their existing gear and do not blindly adventure;
- they remain in town and keep choosing useful city work while waiting;
- once the actual stronger package items exist in canonical city inventory, the resident equips only the slots that are upgrades;
- replaced personal gear goes back into the canonical city pool;
- package gear is actually consumed from that pool, not conjured.

Adventure permission is still bounded by the same character capability contract. Autonomous residents also use higher self-preservation vitality floors than a human-directed player would voluntarily choose for themselves. Resting heals vitality.

### Survivor expedition groups

When multiple retained session-survivors independently choose adventure on the same simulation tick, they can form deterministic expedition groups of up to three.

Group membership:

- is derived from retained survivor order/state;
- is recorded in expedition history;
- gives no hidden stat rewrite;
- instead provides a bounded expedition support bonus and reduces fatal risk;
- lets chained successful player sessions gradually become an organically persistent exploration crew.

This means city population can grow not only through baseline simulation conditions, but also from actual human/machine sessions that survived long enough to become part of the world.

## Resident-power attack pressure

City attacks now use the resident population itself as the scaling metric.

The important rule is asymmetric on purpose:

- **incoming wave power = aggregate living resident power only** at warning time;
- buildings, walls, roads, supplies, maintenance and other foundation systems **never increase the incoming wave**;
- the city foundation only adds defensive leverage.

Any resident origin can trigger the next un-crossed city-wide power milestone:

- simulation-born resident;
- retained human-session survivor;
- machine-controlled resident using the same capability contract.

The current milestone bands are:

`22 → 30 → 40 → 52 → 66`

The first resident to cross a new band schedules one attack warning for the city. Other residents later crossing that already-used band do not spam duplicate waves. Higher bands can still trigger later.

A warning currently lasts **12 simulation ticks = 48 world hours**.

At warning time the wave locks:

- triggering resident;
- triggering milestone;
- aggregate living resident power;
- resident count.

That attack power then stays fixed. Building a Bastion after the warning cannot make the current attackers magically stronger.

During the warning:

- autonomous exploration/adventure is disabled;
- residents are marked for defense recall;
- patrol becomes available even without a formal Watch Post;
- patrol, maintenance, healing/rest and useful sharing become more attractive;
- the UI shows locked wave power and the city's live defense preview.

### Foundation advantage

Unprepared residents convert only part of their raw population power into organized city defense. The rest has to come from the foundation.

Additive defense currently comes from maintained/supplied systems such as:

- Watch Post
- Palisade
- Bastion
- Storehouse
- Field Kitchen
- Road Yard
- Guild Hall
- Waterworks
- Council Hall
- food reserve
- security
- infrastructure condition

Thus two cities with identical residents receive the **same attack**, while the better-built city can have a dramatically better defense ratio.

Good preparation can reduce resident losses to zero. Weak preparation can cause wounds, resident deaths, maintenance damage and city-integrity loss. Repeated failed defenses can eventually leave a city fallen, which stops normal growth until a future recovery system exists.

The threat therefore answers the character-rush problem directly: growing powerful residents without growing the place they depend on increases what the world can throw at them, while investing in the foundation is the only way to turn that resident power into safe long-term civilization strength.

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
- deterministic autonomous villager choice;
- resident trait/need/skill/relationship/memory growth;
- city-path influence without hard scripting;
- fixed service-NPC boundary for store/quest interfaces;
- personal villager possessions and voluntary surplus sharing;
- food production/shortage and maintenance-pressure state;
- local discoveries and informal resident works;
- advisory resident project proposals that cannot auto-spend city resources;
- identical capability math for human/autonomous/machine controllers;
- journaled villager gearing from canonical city inventory;
- journaled autonomous adventure permission/risk/return focus;
- autonomous adventure loot/skill growth and explicit gameplay death;
- no aging/passive resident mortality;
- untouched-city equilibrium without autonomous snowballing;
- deterministic survivor-residency threshold and no double-banking of retained gear;
- stronger-session-gear versus stronger-explorer-package comparison;
- canonical city-inventory consumption when survivor package upgrades become available;
- chained session-survivor expedition grouping;
- city-wide resident-power milestone attack scheduling;
- identical wave power for identical residents regardless of foundation strength;
- additive foundation defense only;
- visible 48-hour warning and explorer recall;
- deterministic wave casualties/integrity damage and journal replay;
- deterministic host journal replay;
- human/machine participant parity;
- the clean no-RTS active browser boundary.

## Truth boundary

This is the first deep city-emergence system, not a finished civilization simulator.

Population, NPC occupations, construction time, material refinement, maintenance, decay, city migration, multiple independent cities, political ownership, actual trade simulation, ecology-driven agriculture, procedural architecture quality, multiplayer deployment and final game balance remain future work.
