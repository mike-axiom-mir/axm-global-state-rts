# AXM Global State RTS — Asset List

Status: **EXPERIMENTAL ASSET BACKLOG v0.1**

Purpose: this is the handoff list for a Creation Machine / working chat. It should create assets against stable IDs instead of inventing a disconnected art pack.

The list is intentionally modular. The game wants huge browser-scale battles, material substitution, blueprint combinations, comedy builds and long-lived world growth. Prefer reusable parts over hundreds of one-off meshes.

## Creation-machine working rule

When a working chat is pointed at this file:

1. Read `GAME_FOUNDATION.md` first.
2. Work only on entries marked `READY` unless explicitly redirected.
3. Preserve the exact asset ID and proposed file path.
4. Create small batches, preferably one family at a time.
5. Do not silently redesign game mechanics to fit an asset.
6. Record provenance and generation method with every delivered asset.
7. Do not mark an item `ACCEPTED` merely because a file exists; runtime visual/scale testing is separate.
8. If an asset needs an unlisted dependency, add/propose that dependency rather than faking completion.

Machine-readable requests live in `assets/asset-requests.v0.1.json`.

## Art direction

**Core look:** miniature post-apocalyptic diorama RTS. Units are tiny in the world, but materials, silhouettes, lighting response and small mechanical details should make close zooms pleasant.

**Do:** readable silhouettes, chunky proportions, believable scrap construction, modular hardpoints, material variety, asymmetry, wear, repair marks, simple animation readiness, strong top-down readability.

**Do not:** chase facial detail, huge texture memory, hyper-dense geometry, tiny invisible greebles, fixed faction colors baked into everything, persistent wreck/corpse variants, or one unique mesh for every material combination.

Comedy items belong in the same world logic. A comic-book wall can be funny and still look like something survivors genuinely bundled into a barrier.

## Common technical contract

Unless an asset says otherwise:

- preferred delivery: `.glb`;
- local simulation scale: **1 unit = 1 meter**;
- orientation: **+Y up**, forward direction documented in sidecar metadata;
- pivot: ground-contact center for buildings/characters; axle/body center where appropriate for modular vehicle parts;
- materials: PBR-friendly base color + roughness/metalness/normal where useful;
- faction identity: use tintable masks/material slots rather than duplicate meshes;
- materials should be swappable independently from geometry where the blueprint/material system needs it;
- lights/emissive parts should be separate named nodes/materials;
- vehicle wheels/tracks/turrets should be separate named nodes if movement/aiming is expected;
- crew should share a common skeleton wherever practical;
- avoid authoring collision as dense render mesh; collision/navigation shapes will usually be cheaper game primitives;
- every asset should remain recognizable from an RTS camera before extra microdetail is added.

### Suggested mass-macro geometry bands

These are targets, not CANON limits:

- tiny crew / handheld props: hundreds to low-thousands of triangles at near LOD;
- ordinary vehicles: low-thousands;
- ordinary buildings: low-thousands, with larger landmark kits allowed more;
- provide or permit cheap LOD/instanced realization; distant armies must not require near-LOD geometry.

## P0 — first playable-region pack

These are `READY` because they directly support the first local gameplay slice.

| ID | Asset | Role / important requirements | Status |
|---|---|---|---|
| `crew-base-a` | Neutral base Crew | Shared humanoid skeleton, simple survivor clothes, strong silhouette, no baked faction identity | READY |
| `crew-worker-kit-a` | Worker / gatherer gear kit | Backpack, hand tools, carry points; attaches to Crew skeleton | READY |
| `crew-rifle-kit-a` | Basic ground-combat gear | Simple rifle + chest/helmet silhouette; modular rather than separate human body | READY |
| `crew-driver-kit-a` | Licensed vehicle-crew look | Headgear/vest/tool pouch; subtle readable role cue | READY |
| `crew-citizen-kit-a` | Economic specialist / citizen | Workwear/apron/tool satchel; visually distinct from military | READY |
| `building-settlement-core-a` | Small continuity settlement building | One of the first buildings that can keep a run alive; improvised but substantial | READY |
| `building-workshop-a` | General fabrication workshop | Continuity-capable industrial building; doors/work area readable from above | READY |
| `building-training-hall-a` | Training / licensing building | Continuity-capable; clear yard / instruction silhouette | READY |
| `building-housing-a` | Compact habitation block | Continuity-capable; modular so clusters can vary | READY |
| `building-storage-depot-a` | General storage depot | Resource/logistics building; clearly different from continuity anchors | READY |
| `resource-farm-field-kit-a` | Open food production kit | Field rows + small shed/markers; large vulnerable footprint | READY |
| `resource-greenhouse-scrap-a` | Scrap greenhouse | Denser food option; glass/poly-sheet + improvised frame | READY |
| `resource-scrap-collector-a` | Surface scrap collection point | Low-cost non-continuity extractor / sorting platform | READY |
| `resource-mine-head-a` | Shallow/common mine head | Non-continuity resource structure; compact and cheap-looking | READY |
| `resource-deep-mine-rig-a` | Expensive deep-mine construction | Bigger machinery, power/cable cues; visibly high investment | READY |
| `defense-wall-scrap-kit-a` | Scrap wall kit | Straight, corner, end, gate modules; material-swappable | READY |
| `defense-light-tower-a` | Night vision/light tower | Separate emissive lamp head; readable light direction | READY |
| `defense-watch-post-a` | Small observation post | Cheap silhouette; no need to imply it is a continuity anchor | READY |
| `defense-turret-base-a` | Improvised defensive turret base | Universal hardpoint for several weapon modules | READY |
| `vehicle-scrap-truck-a` | Basic cargo truck | Cab + cargo bed, modular wheels, universal cargo hardpoint | READY |
| `vehicle-scout-buggy-a` | Fast light scout vehicle | Small, open-frame, easy to read at distance; quality-v2 candidate under `assets/quality-rebuilds/vehicle-scout-buggy-a/` | CREATED |
| `vehicle-cargo-trailer-a` | Towable cargo trailer | Simple logistics multiplier, universal hitch | READY |
| `weapon-rifle-a` | Basic rifle | Crew-held; simple silhouette | READY |
| `weapon-machinegun-module-a` | Mounted machine gun | Turret/vehicle hardpoint module | READY |
| `weapon-mortar-a` | Light indirect-fire weapon | Crew-served / emplacement-compatible | READY |
| `resource-node-scrap-a` | Scrap pile family | 4–6 variants, deterministic scatter friendly | READY |
| `resource-node-stone-a` | Common stone/ore outcrop family | 4–6 variants | READY |
| `resource-node-timber-a` | Harvestable fallen/standing timber family | 4–6 variants; can reuse Planet biome placement | READY |
| `impact-asteroid-common-a` | Small asteroid + crater kit | Rock + shallow crater/decal/ground insert; discovery target | READY |
| `impact-asteroid-rare-a` | Rare-material asteroid family | Distinct but not glowing fantasy by default; 3 variants | READY |
| `environment-road-scrap-a` | Rough road/path kit | Straight/curve/junction visual modules or tiling surface set | READY |
| `environment-ruin-small-a` | Small old-world ruin kit | Walls, broken slab, doorway, column pieces; scatterable | READY |

## P1 — expand macro choices

These should be created after the P0 scale/style pass is visually accepted.

| ID | Asset | Role / important requirements | Status |
|---|---|---|---|
| `crew-heavy-kit-a` | Heavy weapon / armored ground-unit gear | Heavier silhouette without becoming a giant character | HOLD-P1 |
| `crew-scout-kit-a` | Scout / exploration gear | Binocular/radio/hood/light backpack cues | HOLD-P1 |
| `crew-medic-kit-a` | Medical specialist kit | Useful future blueprint route | HOLD-P1 |
| `vehicle-tracked-carrier-a` | Generic tracked carrier | Modular chassis for transport/weapon builds | HOLD-P1 |
| `vehicle-armored-chassis-a` | Heavy modular fighting chassis | Armor plates separate where practical | HOLD-P1 |
| `vehicle-forklift-combat-a` | Forklift utility/combat platform | Serious-enough utility with comedic edge | HOLD-P1 |
| `vehicle-garbage-rammer-a` | Heavy garbage-truck ram platform | Post-apocalyptic heavy utility/assault | HOLD-P1 |
| `weapon-autocannon-module-a` | Autocannon module | Vehicle/turret hardpoint | HOLD-P1 |
| `weapon-artillery-module-a` | Heavy indirect-fire module | Tow/vehicle/emplacement compatible silhouette | HOLD-P1 |
| `weapon-rocket-rack-a` | Improvised rocket rack | Modular launch frame | HOLD-P1 |
| `building-refinery-a` | Material refining facility | Large industrial footprint | HOLD-P1 |
| `building-vehicle-works-a` | Vehicle fabrication works | Continuity-capable candidate; large doors and yard | HOLD-P1 |
| `building-power-yard-a` | Generator/power yard | Modular generator tanks/cables; can scale with production | HOLD-P1 |
| `building-research-shop-a` | Research/blueprint workshop | Long-term tech route, not a magical sci-fi lab | HOLD-P1 |
| `infrastructure-bridge-scrap-a` | Modular scrap bridge | Short span, pier, ramp pieces | HOLD-P1 |
| `infrastructure-rail-kit-a` | Improvised rail / heavy transport kit | Straight/curve/switch/depot pieces | HOLD-P1 |
| `infrastructure-depot-forward-a` | Forward logistics depot | Small support structure, not continuity anchor by default | HOLD-P1 |
| `impact-extractor-a` | Asteroid extraction rig | Fits multiple asteroid material families | HOLD-P1 |
| `resource-node-fuel-a` | Old fuel/chemical recovery site | Tank/pump family | HOLD-P1 |
| `environment-ruin-industrial-a` | Old industrial ruin kit | Beams, pipes, tanks, broken factory shells | HOLD-P1 |
| `environment-ruin-urban-a` | Old urban ruin kit | Modular façades, floors, stair shells | HOLD-P1 |

## P2 — city scale / strange technology / comedy

These remain intentionally later because the game systems should decide which are actually useful.

| ID | Asset | Role / important requirements | Status |
|---|---|---|---|
| `city-block-residential-a` | Dense survivor/old-world residential block kit | Major-city / regional-city composition | HOLD-P2 |
| `city-block-industrial-a` | Heavy industrial city block kit | Production district composition | HOLD-P2 |
| `city-fortification-heavy-a` | Major-city heavy wall/tower kit | Top-city defenses; imposing but not invulnerability magic | HOLD-P2 |
| `city-logistics-hub-a` | Major transport/storage hub | Makes large city economy visually legible | HOLD-P2 |
| `city-food-complex-a` | Large-scale food production complex | Supports believable high-population city | HOLD-P2 |
| `future-energy-module-a` | Rare-material advanced energy module | Blueprint/material gated; modular, not generic sci-fi glow | HOLD-P2 |
| `future-weapon-core-a` | Advanced weapon component | Requires later gameplay definition | HOLD-P2 |
| `future-mobility-module-a` | Advanced drive / mobility component | Requires later gameplay definition | HOLD-P2 |
| `comedy-comic-wall-a` | Bundled comic-book wall | Funny but mechanically valid cheap barrier; paper/bundle look | HOLD-P2 |
| `comedy-fridge-barricade-a` | Refrigerator barricade kit | Appliance wall material source | HOLD-P2 |
| `comedy-bathtub-turret-a` | Bathtub turret cradle | Universal turret mount with ridiculous silhouette | HOLD-P2 |
| `comedy-shopping-cart-a` | Shopping cart utility module | Cargo / improvised light transport prop | HOLD-P2 |
| `comedy-sofa-armor-a` | Sofa padding/armor module | Silly protection add-on, material-swappable | HOLD-P2 |
| `comedy-vending-cover-a` | Vending machine cover block | Small defensive/urban prop | HOLD-P2 |
| `comedy-traffic-cone-kit-a` | Traffic cone marker kit | Nonessential world character / marking | HOLD-P2 |

## Material library — critical for the blueprint system

Geometry should not force one material. The following material families are more important than creating many duplicate finished units.

| ID | Material family | Desired character | Status |
|---|---|---|---|
| `mat-scrap-steel` | mixed scrap steel | dents, mismatched panels, repair welds | READY |
| `mat-rusted-steel` | weathered steel | rust without destroying readability | READY |
| `mat-painted-metal` | old painted metal | chipped, tint-friendly | READY |
| `mat-aluminum-salvage` | light salvaged alloy | brighter worn metal, lower visual mass | READY |
| `mat-concrete-broken` | broken concrete | aggregate/chips, modular wall/building use | READY |
| `mat-brick-ruined` | ruined brick | old-world city/ruins | READY |
| `mat-wood-reclaimed` | reclaimed wood | mixed boards, nails/patches | READY |
| `mat-rubber-worn` | tire/rubber | vehicle/wall use | READY |
| `mat-glass-dirty` | dirty/partly broken glass | greenhouse/urban | READY |
| `mat-tarp-fabric` | tarp/canvas | tents, patch roofs, cargo covers | READY |
| `mat-paper-comics` | compressed comics/paper | comedy barrier material | HOLD-P2 |
| `mat-meteor-common` | common meteor metal/stone | unusual but grounded | HOLD-P1 |
| `mat-meteor-rare-a` | rare dense meteor material | later property definition | HOLD-P2 |
| `mat-meteor-rare-b` | rare lightweight/ceramic-like material | later property definition | HOLD-P2 |

## Animation library

Prefer one reusable animation vocabulary over custom animation per unit.

Initial desired shared Crew clips:

`idle`, `walk`, `run`, `carry`, `gather-low`, `gather-high`, `build`, `repair`, `aim`, `fire`, `reload`, `hit-react`, `down/death`.

The runtime may use simplified or sampled versions at distance. Animation detail must not become a requirement for every far-away unit.

## Asset states

- `READY` — suitable for Creation Machine work now.
- `HOLD-P1` — useful after first visual/runtime acceptance.
- `HOLD-P2` — intentionally deferred until mechanics mature.
- `CREATED` — file exists but is not automatically accepted.
- `TESTED` — runtime scale/material/readability tested.
- `ACCEPTED` — admitted to the active asset catalog through grounded review.

## Explicit non-assets

Do **not** generate these as persistent world-object packs unless later evidence demands them:

- corpse libraries;
- wreckage for every destroyed vehicle;
- loot piles for every casualty;
- unique debris for every destroyed building;
- facial-expression sets;
- dozens of baked faction-color duplicates;
- hundreds of finished vehicles that could instead be assembled from modular chassis/mobility/weapon parts.

The game deliberately resolves enormous destruction cheaply. Visual battle aftermath may use temporary effects/decals/aggregate state without becoming persistent salvage inventory.
