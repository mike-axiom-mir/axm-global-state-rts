# AXM Global State RTS

Status: **EXPERIMENTAL**

Persistent browser-scale mass-macro RTS built on the existing AXM Foundation Planet rather than a new simplified globe.

The source planet is pulled into this repository as the pinned `planet-upstream` submodule. The source repository stays untouched; game-specific scaling, flat RTS operating frames, units, buildings, economy, fog, cities, Guardian defense, progression, multiplayer work, and the post-apocalyptic miniature presentation belong here.

## First architectural rule

The world remains a real sphere globally, but units/buildings should not pay spherical-geometry cost for ordinary RTS logic.

- canonical global identity: Foundation Planet coordinate / globe vector;
- local gameplay identity: bounded flat X/Z metres;
- when an entity travels far enough, rebase it into a neighbouring local frame while preserving the same global position;
- render the globe as a miniature global expression, but resolve active battles through the local frame appropriate to that area.

This gives us one huge planet without pretending the actual world state is a giant flat rectangle.

## Planet presentation

The game is intentionally allowed to make Foundation Planet look radically different without changing its canonical world truth. The current target is a miniature post-apocalyptic diorama world with cheap globe/region LOD and richer local RTS rendering.

See:

- `docs/PLANET_PRESENTATION_TARGET.md`
- `src/presentation/planet-style.mjs`

## First browser shell

The current experimental browser shell already starts from the multi-seat boundary rather than assuming one camera forever:

- 1–4 local seat viewports from one authoritative world;
- equal split-screen layouts;
- controller-first per-seat camera path;
- Seat 1 keyboard/mouse camera fallback for one-player PC use;
- human and machine seats share the same player-seat observation/visual/command contract;
- every discrete human or machine player action passes through the same rolling **100 APM** gate;
- Foundation Planet samples drive the first miniature globe mesh.

Run locally after cloning with submodules:

```bash
npm start
```

Then open `http://127.0.0.1:4174/game/`.

Optional query examples:

- `?players=4` — four local seats;
- `?players=3&seat3=machine` — two human seats plus one machine user seat.

The machine seat is a truthful seat shell only; no connected AI provider is claimed yet.

See `docs/MULTISEAT_CONTROLLER_ARCHITECTURE.md`.

## Reuse from the earlier RTS

The previous Many-Race RTS already contains useful globe geometry, globe-aware map authoring, one-schema flat/globe map data, visual layers and deterministic decoration ideas. The new game reuses those ideas selectively instead of copying the small-skirmish assumptions.

See `docs/OLD_RTS_REUSE_ANALYSIS.md`.

## Asset work

Creation Machine / working-chat handoff:

- human-readable backlog: `ASSET_LIST.md`
- machine-readable READY requests: `assets/asset-requests.v0.1.json`

Assets use stable IDs so procedural placeholders can later be replaced without rewriting canonical game state.

## Pull the exact Planet body

```bash
git clone --recurse-submodules https://github.com/mike-axiom-mir/axm-global-state-rts.git
```

For an existing clone:

```bash
git submodule update --init --recursive
```

The pinned source revision is recorded in `UPSTREAM_PLANET.json`.

## Current rung

The current game code establishes the globe/local spatial seam, miniature Planet presentation, a real multi-viewport browser shell, controller/input contracts, and the shaped design foundation. It does **not** yet claim the global multiplayer network simulation, final local RTS terrain renderer, physical-controller QA, connected AI provider, or mass-war performance is finished.
