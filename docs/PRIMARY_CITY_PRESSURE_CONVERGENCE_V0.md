# Primary city-pressure convergence v0

Status: experimental browser-local convergence rung.

## What is connected

The primary strategic convoy already reaches a real aggregate city landmark and can explicitly provoke its existing city simulation. This rung carries that same consequence one step farther without creating a second city, raid, travel, or combat authority:

1. physical convoy arrival + explicit city provocation mobilizes the existing `AggregateCity`;
2. the same event marks the seat's deterministic `starterDropAnchor()` as a known target in the existing `WorldPressureDirector`;
3. the director immediately evaluates one bounded low-pressure response wave for this explicit provocation;
4. any admitted raid spends real aggregate-city defense units, food, and materials through `WorldCityFabric.dispatchRaid()`;
5. each dispatched raid keeps the director's existing great-circle `travelSeconds` and therefore has a finite arrival time at the actual LOCAL starter-drop coordinate;
6. the primary strategic snapshot exposes the target, raid transit/arrival state, city/resource costs, and the exact authority boundary.

Repeated interaction with the same city during the same convoy visit still fails closed, so it cannot manufacture repeated scouting or raid waves.

## Why this is convergence rather than a new subsystem

No new raid economy or path model is introduced. The rung reuses:

- `AggregateCity` / `WorldCityFabric` for city state and material-backed dispatch;
- `WorldPressureDirector` for known-target pressure and bounded wave selection;
- `strategicTravelSeconds()` for finite world travel;
- `starterDropAnchor()` for the same deterministic planet coordinate used by the playable LOCAL seat.

The player-facing strategic clock remains the trigger point for later pressure evaluations. Human and machine seats continue through the same admitted RTS action surface; 1–4 seats remain per-client access to one world model, not a global player cap.

## Truth boundary

This is **not** host-persistent or host-replay-authoritative world pressure yet. The strategic world runtime, city state, target knowledge, raid expenditure, and transit list currently live in the browser runtime. An arrived raid is only reported as reaching the LOCAL drop perimeter; it is **not yet admitted into `LocalCombatGameplay`**, does not yet create LOCAL Crew/building casualties, and cannot by itself close a durable host civilization run. The existing LOCAL combat → continuity loss → explicit durable host close/score bridge remains separate.

This rung makes no claim about production hosting, concurrent multi-host scale, secure networking, balance, final visuals, target-device performance, or bespoke character/vehicle/building animation.

## Next convergence seam

The next non-animation seam is deliberately narrow: admit an arrived `WorldPressureDirector` raid into the existing LOCAL combat authority with an explicit, tested mapping from aggregate raid units to combat strength; resolve survivors back to the originating `AggregateCity`; then allow the already-proven LOCAL continuity/death path to feed the durable host close/score/next-drop lifecycle. The mapping must fail closed rather than silently pretending aggregate city units are identical to LOCAL Crew.
