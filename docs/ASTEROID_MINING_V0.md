# AXM Global State RTS — asteroid mining v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung connects the rolling deterministic asteroid field to actual civilization macro economy without teleporting mined material directly into storage.

## Known asteroid site boundary

A deterministic asteroid event is not automatically a build site.

`createKnownAsteroidSite()` requires an explicit legitimate-knowledge boundary before producing a local `asteroid-impact` site record. That local record carries the asteroid event ID, its discovered material class, remaining amount and the local flat-map X/Z position used by the RTS construction layer.

The boolean used by this internal adapter is **not** a public anti-cheat proof. The website authority must eventually derive it from signed/validated observation or knowledge receipts rather than trusting a browser claim.

## Extraction rig

The rung introduces a first `building:asteroid-extraction-rig` blueprint and definition.

The rig is:

- a resource building, not a continuity building;
- tied to one legitimately known `asteroid-impact` site;
- materially expensive enough to make distant mining infrastructure a choice;
- bounded to a local worker capacity;
- compatible with the existing construction integrity / repair model through the same `ConstructionEconomy` class.

`createAsteroidMiningConstructionEconomy()` is currently the adapter that extends the ordinary building catalog with this rig. This avoids silently rewriting every ConstructionEconomy caller before the extraction loop is proven.

## Aggregate Crew mining

`AsteroidMiningFabric` assigns a bounded set of explicit Crew IDs to each rig once, sums their existing gather factors and then advances work **per active rig/job**, not per worker per frame.

Manpower revisions are watched. When a Crew member disappears from authoritative manpower, the mining job lazily reconciles on the next job boundary so dead workers cannot keep extracting forever.

Food-policy gather modifiers can feed the aggregate extraction rate through the existing modifier seam.

## No resource teleport

A successful mining step does two things in order:

1. asks the shared asteroid field to harvest the amount, making depletion global/sparse state;
2. sends the accepted extracted amount into the existing `CivilizationLogistics` route buffer using the extraction rig as the route origin.

The material reaches the civilization stockpile only after aggregate hauling advances it to an active storage building.

That preserves the macro meaning of farther territory: a distant rich impact may be valuable, but it also creates a longer logistics line.

## First material mapping

- `common-industrial` -> `industrial-metal`
- `rare-alloy` -> `rare-alloy`
- `strange-mineral` -> `strange-mineral`
- `unknown-component` -> **kept distinct / not silently converted**

Unknown components deliberately do not become ordinary ore in this rung. Their artifact/technology outcome needs its own rule rather than a convenience conversion.

## Evidence

`tests/asteroid-mining-selftest.mjs` verifies:

- hidden asteroid data does not become a site without the knowledge boundary;
- the extraction rig uses the normal blueprint + material construction path;
- specialized harvester gather factors matter;
- one rig produces one mining work unit regardless of its worker count;
- actual asteroid depletion becomes sparse world mutation;
- extracted material enters the logistics buffer before stockpile delivery;
- hauling eventually credits the normal stockpile;
- removed/dead workers are pruned from the rig job;
- rig workforce capacity is bounded;
- unknown components remain distinct rather than being rewritten as ore.

## Truth boundary

Not claimed yet:

- hosted journal command for asteroid mining/depletion;
- public knowledge proof / anti-cheat;
- final extractor art or placement UI;
- vehicle-assisted hauling integration;
- attacks on mining convoys;
- multiple players contesting one local impact in a single tactical encounter;
- unknown-component artifact outcomes;
- final costs, rates, workforce cap or asteroid lifetimes.

The important connection is now present: **vision -> known impact -> extraction infrastructure -> Crew macro job -> globally depleted asteroid -> logistics route -> stored resource**.
