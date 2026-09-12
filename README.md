# AXM Global State RTS

Status: **EXPERIMENTAL**

Persistent browser-scale mass-macro RTS built on the existing AXM Foundation Planet rather than a new simplified globe.

The source planet is pulled into this repository as the pinned `planet-upstream` submodule. The source repository stays untouched; game-specific scaling, flat RTS operating frames, units, buildings, economy, fog, cities, Guardian defense, progression, and multiplayer work belong here.

## First architectural rule

The world remains a real sphere globally, but units/buildings should not pay spherical-geometry cost for ordinary RTS logic.

- canonical global identity: Foundation Planet coordinate / globe vector;
- local gameplay identity: bounded flat X/Z metres;
- when an entity travels far enough, rebase it into a neighbouring local frame while preserving the same global position;
- render the globe at planetary scale, but resolve active battles through the local frame appropriate to that area.

This gives us one huge planet without pretending the actual world state is a giant flat rectangle.

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

The first game code only establishes the spatial seam and records the shaped design foundation. It does **not** yet claim the global multiplayer simulation is built.
