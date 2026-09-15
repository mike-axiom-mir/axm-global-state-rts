# Primary city-pressure convergence v0

Status: experimental browser-local convergence rung.

## What is connected

The primary strategic convoy reaches a real aggregate city landmark, can explicitly provoke its existing city simulation, and now carries that consequence through the already-existing LOCAL combat authority without creating a second city, raid, travel, or combat system:

1. physical convoy arrival + explicit city provocation mobilizes the existing `AggregateCity`;
2. the same event marks the seat's deterministic `starterDropAnchor()` as a known target in the existing `WorldPressureDirector`;
3. the director evaluates one bounded low-pressure response wave for this explicit provocation;
4. any admitted raid spends real aggregate-city defense units, food, and materials through `WorldCityFabric.dispatchRaid()`;
5. each dispatched raid keeps the director's existing great-circle `travelSeconds` and therefore has a finite arrival time at the actual LOCAL starter-drop coordinate;
6. on arrival, a bounded adapter maps aggregate raid strength into the existing `LocalCombatGameplay` contact rather than instantiating every aggregate city unit as a LOCAL Crew-equivalent;
7. the player fights that contact through the already-promoted selected-party Combat controls, including existing LOCAL casualty reconciliation and civilization-continuity consequences;
8. once the LOCAL raid contact is cleared, or the LOCAL civilization reaches terminal continuity loss, surviving aggregate strength is mapped proportionally back to the original dispatched raid and resolved through `WorldCityFabric.resolveRaid()`, returning survivors to the originating `AggregateCity` and recording aggregate losses there;
9. the primary strategic snapshot and threat-intel surface expose transit, arrival, bounded LOCAL admission, and aggregate-city resolution with the browser-local authority boundary visible.

Repeated interaction with the same city during the same convoy visit still fails closed, so it cannot manufacture repeated scouting or raid waves. Only one aggregate raid contact is admitted into a seat's LOCAL combat authority at a time; later arrivals wait rather than being silently merged into one synthetic force.

## Aggregate → LOCAL mapping contract

`aggregate-raid-local-combat.mjs` is deliberately an adapter, not an ontology claim. By default one LOCAL hostile combat packet represents up to eight aggregate raid units, with a hard cap of sixteen LOCAL combat packets per admitted raid. The ratio is an experimental bounded gameplay compression so a city-scale aggregate force does not become per-unit LOCAL simulation work. It does **not** mean one city defense unit equals one Crew, and it does not claim realism or final balance.

When LOCAL hostile packets take losses, surviving aggregate units are calculated proportionally from the original dispatched raid size and remaining combat packets. Cleared contacts resolve with zero survivors. If civilization continuity is exhausted while raid packets remain, the proportional survivors return through the existing aggregate-city raid-resolution authority.

## Why this is convergence rather than a new subsystem

No new raid economy, path model, combat resolver, casualty model, or city authority is introduced. The rung reuses:

- `AggregateCity` / `WorldCityFabric` for city state, material-backed dispatch, and raid return/loss accounting;
- `WorldPressureDirector` for known-target pressure and bounded wave selection;
- `strategicTravelSeconds()` for finite world travel;
- `starterDropAnchor()` for the same deterministic planet coordinate used by the playable LOCAL seat;
- `LocalCombatGameplay` / formation combat for the player-facing fight;
- existing LOCAL casualty reconciliation, production/vehicle cleanup, structure siege, and civilization continuity for consequences.

Human and machine seats continue through the same admitted RTS action surface and 100-APM gate. 1–4 seats remain per-client access to one world model, not a global player cap.

## Truth boundary

This is **not** host-persistent or host-replay-authoritative world pressure/combat yet. The strategic world runtime, city state, target knowledge, raid expenditure, transit list, aggregate-to-LOCAL mapping, combat result, and city raid resolution currently live in the browser runtime. The adapter is bounded deterministic gameplay compression, not a validated military-scale equivalence. The existing LOCAL defeat → explicit durable host close/score bridge remains the only host lifecycle seam; the combat cause itself is still client-observed evidence rather than host-replayed authority.

This rung makes no claim about production hosting, concurrent multi-host scale, secure networking, final balance, final visuals, target-device performance, or bespoke character/vehicle/building animation.

## Next convergence seam

The next non-animation authority seam is to make this already-player-visible raid/combat consequence host-replay-verifiable without duplicating the LOCAL simulation: admit the provenance-bearing raid/contact outcome into durable authority, or reproduce the minimum deterministic inputs needed to verify it, before allowing combat-caused civilization death to be treated as host-grounded rather than client-observed. A separate useful gameplay seam is deterministic world-event route/claim/reward integration, which remains visible but unpromoted.
