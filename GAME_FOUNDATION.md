# AXM Global State RTS — shaped game foundation

Status: **EXPERIMENTAL DESIGN FOUNDATION v0.1**

This records the current shaped direction so implementation can grow without silently replacing the game we designed. Tuning numbers are provisional unless explicitly marked as a structural rule.

## World and scale

- One persistent globe-scale world.
- The globe is huge relative to units/buildings; tiny units can remain visually readable while battles scale massively.
- Travel across the world is possible but should take serious real time. Distance is strategy.
- The world is post-apocalyptic: civilizations improvise structures, weapons, vehicles, and infrastructure from available material and blueprints.
- Graphics stay lightweight enough for browser mass-macro play while using strong materials, lighting, terrain, effects, and silhouettes for visual quality.

## Run lifecycle

- A player receives a new drop only after the current run/civilization is dead.
- Logging out never resets or relocates the player.
- Logging back in resumes the same surviving civilization/state.
- A run is expected to end eventually; surviving and scaling for days is possible, but permanent victory over the whole world is not the normal expectation.
- Hourly drop boxes can accumulate up to 24 for the next drop and influence starting options/items.

## Death / continuity

- Hidden surviving units must not act as extra lives.
- Defensive structures do not keep a run alive by themselves.
- Scattered resource/extraction structures do not keep a run alive by themselves.
- Death is tied to loss of all qualifying non-defensive civilization buildings: real structures that represent an operating settlement/civilization rather than walls, turrets, mines, farms, collection posts, roads, etc.
- Exact continuity-building categories still need implementation tests against spam/exploit behavior.

## Offline Guardian

When a player is absent, a bounded defensive system may continue their already-established civilization:

- defend existing holdings;
- keep authorized economic/production orders running;
- repair damaged structures;
- rebuild previously existing structures where resources allow;
- replace/maintain an already-authorized defensive force where crew, food, equipment, and materials allow;
- retreat/reposition defensively when required.

It may not create new strategic ambition:

- no conquest;
- no new expansion;
- no offensive raiding;
- no new research direction;
- no arbitrary force growth beyond player-established defensive policy.

Offline means resistance, not immunity. A sufficiently strong attacker can still exhaust and destroy the civilization.

## Crew root

- Everything begins from Crew.
- Crew can be given deep gathering priorities and automatically seek the nearest allowed known resource and suitable storage.
- Automation can act on knowledge; it cannot create knowledge through fog.
- Crew can be trained/equipped into specialties.
- Specialization is a commitment: once trained into a specialty, that individual does not freely revert to base Crew or swap specialty.
- Vehicles can require separately trained/licensed crew.
- Crew can instead be developed into stronger economic citizens/specialists.
- Specialized/trained population creates ongoing food pressure.

## Parties and input

- Units can be dragged/dropped into persistent pre-made parties.
- A party can be selected/commanded with one action.
- This is a major scale-control abstraction and should make large armies practical on desktop and potentially mobile without removing finer control where useful.

## 1–4 local seats / split screen

- Build around **1–4 active seats from the start** rather than retrofitting multiplayer after a one-camera game exists.
- Local seats can be configured for co-op, teams, opponents, human players or machine players as later rules allow.
- Each active seat owns an independent camera/view/UI surface while sharing one authoritative world state.
- Split-screen is presentation, not a separate simulation.
- Default local layouts use equal information area: one full screen, two equal halves, three equal columns/rows, or four equal quadrants.
- The seat/view boundary should later allow the same seat to render onto another physical screen without changing its authority or command model.

### Controller-first path

Most practical testing is expected to happen with controllers.

- Up to four gamepads can be bound to four local human seats.
- Held buttons must edge-trigger into semantic actions rather than producing one action every render frame.
- Analog cursor/camera/zoom state remains continuous presentation/input state.
- Keyboard + pointer remain available for normal one-player PC play and belong to Seat 1 only in local multiplayer.
- Exact button mappings are tunable; the architecture must not hard-code one input device into game authority.

### Human / machine equality

A machine intelligence may occupy a normal user seat.

- same fog/vision-limited observation policy;
- same command surface;
- same visual-option vocabulary and user-facing view capability;
- same seat privileges;
- same APM cap;
- no hidden world-state feed;
- no direct canonical-state mutation path;
- no faster/private command lane.

Human and machine seats may differ in input source, but not in player authority. World/city simulation AI can later be a different world role; an AI joining as a player uses the same player-seat contract.

### 100 APM cap

Every active user seat, human or machine, is capped at **100 accepted discrete gameplay actions in a rolling 60-second window**.

- Action 101 is rejected until an earlier accepted action leaves the rolling window.
- Rejected actions do not mutate authoritative state.
- The same deterministic admission gate is used for human and machine commands.
- Continuous stick/cursor/camera values are not separate APM actions on every frame; when input becomes a discrete gameplay command, that command is counted.

Implementation contract: `docs/MULTISEAT_CONTROLLER_ARCHITECTURE.md`.

## Fog / night

- Strong fog of war is fundamental.
- Nothing outside permitted vision/knowledge is automatically revealed.
- Exploration physically grows what the civilization can act on.
- At night, unaided vision contracts.
- Artificial light restores local vision but can expose the civilization's presence.
- Workers assigned to gather only discover/exploit materials they can legitimately encounter through the vision/knowledge rules.

## Food and population

Food is pressure, not a hard population cap.

- Every person consumes food over time.
- Food can be stockpiled.
- If the economy can feed and equip an enormous population, the game should not invent a small arbitrary design cap merely to stop it.
- More food allows larger sustainable armies.
- Lower food but better material/technology can support strategies based on smaller, stronger forces.

Initial food-policy shape for later balancing:

- **Well Fed:** about +20% food consumption, about +10% gathering/production, about +10% overall performance.
- **Normal:** baseline; tiny flavour penalties are allowed but should not dominate strategy.
- **Rations:** about -40% food consumption, about -30% gathering/production/work output, about -10% physical/combat performance.

Exact percentages are tuning values, not yet final balance.

## Territory, materials, and technology

More territory increases access to opportunity rather than granting an automatic tech level.

- common useful surface/near-ground materials should be limited;
- expensive deep mining can discover RNG-based useful materials later;
- the world continually receives small RNG asteroid/impact opportunities;
- impacts are not globally announced: they matter only when actually discovered through vision/operation;
- broader territory therefore exposes more land to mining, impacts, ruins, and other opportunities while increasing defense/travel/logistics burden.

Blueprints/capabilities can be acquired through multiple routes:

- deliberate research;
- milestones/quests;
- RNG discoveries;
- run-only discoveries;
- later world/city/player interactions.

Different materials can change cost, strength, weakness, weight, buildability, and other useful properties. Technology should not collapse into a single linear `+damage` ladder.

Post-apocalyptic construction can include practical, strange, and comedic solutions when the material/function makes sense. The simulation should judge the item by its actual properties rather than whether it looks serious.

## World cities

- The globe contains settlements/cities at very different scales.
- A few enormous major cities can begin as established powers.
- They should be extremely dangerous to provoke because they can mobilize large existing economies/forces.
- They are not hard-coded invulnerable. Taking one should be technically possible but close to impossible for ordinary lone growth and worthy of a major world event.
- Their growth/power is naturally constrained by the same food/upkeep pressure instead of infinite scripted expansion.

## Destruction economy

Persistent battlefield salvage is intentionally avoided because the world can contain enormous wars.

- destroyed units do not create persistent corpse/wreck loot objects;
- destruction can be resolved by cheap deterministic arithmetic;
- a fixed conversion from the opposing unit's destroyed material value can generate food for the destroying side;
- the same rule applies to all sides;
- **1% of food gained through this destruction conversion is also credited as gold.**

Gold is intended as a slow-stacking reserve primarily for expensive mercenary reinforcement. Mercenaries should be costly enough that small amounts accumulate over a long time and can eventually be spent for a meaningful push.

## Peak map-control gold modifier

For each completed run/fight, record the **highest percentage of the entire globe controlled at any moment during that run**.

That literal percentage becomes the small final gold multiplier:

`final_gold = raw_gold * (1 + peak_global_control_percent / 100)`

Examples:

- peak 0.10% of the globe -> `x1.001`;
- peak 1.00% of the globe -> `x1.01`;
- theoretical 100% -> `x2.00`.

The bonus is deliberately tiny. Controlling even 1% of a truly huge globe should already be extraordinary. The metric is meant to accumulate as a slight edge and potentially separate exceptional high-score runs, not become a mandatory territory-spam progression system.

## Mass-macro rule

Before adding a mechanic, ask:

> Would this still be sensible if 100,000 units were involved?

Prefer:

- aggregate arithmetic;
- deterministic state;
- cheap distant-state representation;
- bounded automation;
- persistent high-level decisions;

instead of:

- per-corpse interaction;
- per-wreck salvage objects;
- repetitive upgrade homework every drop;
- micro bookkeeping multiplied by every casualty.

**Working rule: complexity belongs in relationships between large systems, not chores attached to every little object.**
