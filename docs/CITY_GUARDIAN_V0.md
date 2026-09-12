# AXM Global State RTS — aggregate world cities + offline Guardian v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

The persistent globe needs powerful world cities and meaningful offline resistance without paying for thousands of always-live city units or letting an autonomous system invent new strategic ambition while a player is away.

## Aggregate world cities

`src/sim/aggregate-city.mjs` represents a city as a small deterministic economic/defensive summary rather than one object per resident.

Each city keeps:

- population and worker count;
- food stock and food production;
- material stock and material production;
- defensive force and an authorized defense cap;
- infrastructure integrity;
- readiness / starvation pressure;
- provoked defender state.

Default major cities start as substantially larger powers than regional cities. Their exact starting population/defense values are derived deterministically from the world seed and city ID.

### Food is the natural pressure

Cities produce and consume food continuously in aggregate.

If food is healthy, a damaged city may:

- repair existing infrastructure from material stock;
- restore its defensive force up to its pre-authorized cap.

Food shortage reduces readiness and stops easy force recovery.

The city does **not** receive an infinite scripted army.

### Provoking a major city

A city can enter `mobilized-defense` against an attacker.

That does not automatically create conquest behavior. Current aggregate city state always keeps:

`expansionIntent = 0`

The later combat/response layer can send already-authorized forces against an immediate threat without silently turning the city into an infinite world-conquest AI.

## World city fabric

`src/sim/world-city-fabric.mjs` owns the small set of generated city summaries.

Default world layout currently has:

- 3 major cities;
- 24 regional cities.

That means the whole starting city layer is only a few dozen aggregate records, even though each record can represent tens of thousands of inhabitants.

`GlobalWorldRuntime` now composes the city fabric with the same world seed, landmarks, routes, territory, streamed features, asteroid events and strategic parties.

## Offline Guardian

`src/sim/offline-guardian.mjs` protects an already-established player civilization while the user is absent.

At activation, the Guardian records hard operational bounds from the player's current state:

- existing building IDs;
- current research direction;
- current territory revision;
- authorized defensive-force cap.

While offline it may:

- keep previously-authorized passive food/material income running;
- consume food/upkeep;
- repair existing damaged buildings;
- rebuild a previously-existing destroyed building if resources permit;
- restore defensive units only up to the player's existing authorized cap.

It may **not**:

- invent a new building identity;
- change research direction;
- claim or release territory;
- raise the defensive cap;
- exceed that cap;
- emit offensive/conquest action types.

Every Guardian iteration checks those bounds after applying work.

Offline protection therefore means **resistance, repair and continuity**, not immunity or autonomous empire growth.

## Scale property

A major city with 100,000+ inhabitants remains one aggregate city object when nobody is locally fighting inside it.

Likewise, an offline civilization can maintain a bounded building/defense summary without simulating every sleeping unit frame-by-frame.

When a battle actually becomes locally relevant, later systems can materialize formations/parties from these summaries into the streamed tactical region.

## Truth boundary

Implemented now:

- deterministic aggregate major/regional city economies;
- food consumption and food-limited readiness;
- aggregate material production;
- infrastructure repair;
- defensive-force restoration to a fixed cap;
- city provocation / mobilized-defense state;
- zero automatic expansion intent;
- bounded offline Guardian with explicit no-expansion/no-research/no-new-building invariants;
- Guardian repair/rebuild/authorized-defense recovery;
- global runtime integration and deterministic tests.

Not claimed yet:

- local city district geometry;
- actual city-vs-player combat deployment;
- city territorial borders;
- trading/markets;
- diplomacy;
- capture/occupation behavior;
- player offline persistence/server execution;
- Guardian tactical retreat/formation movement;
- final food/production balance numbers.
