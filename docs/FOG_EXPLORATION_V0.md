# Fog / exploration seam v0

Status: **EXPERIMENTAL IMPLEMENTATION RUNG**

This rung makes the first resource-knowledge boundary active inside the local deterministic simulation.

## What is real now

- canonical local state may contain a resource that an ordinary player-seat snapshot does not expose;
- Crew vision deterministically admits hidden resources into knowledge when Crew physically come within allowed vision;
- day and night use different unaided Crew vision radii;
- an active light tower can contribute a separate local vision radius;
- `explore` is a high-level macro order that moves Crew toward the seat cursor rather than revealing the destination in advance;
- after legitimate discovery, the same gather automation can use the resource without a special hidden-state path;
- controller L3, Seat 1 keyboard `F`, and a machine player seat all submit the same `explore` action through the ordinary 100-APM seat gate;
- `describeSeatSimulation()` exposes only the same user-visible simulation snapshot, not canonical hidden resources.

## Tuning, not canon

Current local test values are provisional:

- day Crew vision: 180 m;
- night Crew vision: 45 m;
- active light-tower vision: 240 m.

These values prove the contract and can change with gameplay evidence.

## Still not claimed

- final rendered fog mask;
- global/region LOD fog aggregation;
- line-of-sight occlusion by terrain/buildings;
- light exposing a settlement to enemies;
- world day/night clock;
- scouting specializations;
- network replication of knowledge state.

The important invariant is already enforced: automation may exploit what the seat legitimately knows, but does not receive a private hidden-resource feed.
