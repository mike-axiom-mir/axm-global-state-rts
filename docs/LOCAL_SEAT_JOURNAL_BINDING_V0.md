# Host local-seat → command-journal binding v0

Status: **EXPERIMENTAL / AUTHORITY BINDING RUNG**

## Purpose

PR #76 gave each local RTS region a host-owned deterministic command journal, but that journal was not attached to the participant/seat path used by the browser game. A browser could be authority-revalidated as a shared-world participant while the host journal existed as a separate experiment.

This rung connects those two authority surfaces without pretending the browser's continuously running local simulation is already the journaled canonical state.

## Host-owned binding

`LocalSeatJournalAuthority` resolves participant identity from the existing host `WorldParticipantRegistry` and binds that record to one `seat-1` … `seat-4` region journal.

The browser may request a seat and may state the controller kind it expects, but it cannot create or rewrite the participant record used by the binding. The host checks the stored participant controller kind and rejects a mismatch.

V0 deliberately allows:

- one participant per local region seat;
- one local region seat per participant;
- idempotent re-entry for the same participant + seat;
- identical physical journal genesis for human and machine participants when seat and host world hour are the same;
- read-only checkpoint/status inspection even when mutation mode is disabled.

It deliberately does not silently replace an occupied seat. Rebinding/transfer needs its own explicit authority contract later.

## Journal continuity exposed to the player

A successful binding creates or attaches the seat's existing host `LocalRegionCommandJournalAuthority` and exposes:

- participant and controller identity;
- region seat;
- host world hour at binding;
- deterministic journal genesis digest;
- genesis state digest;
- current journal revision;
- journal head hash;
- current canonical host state digest;
- persisted-journal verification result.

The RTS shell displays the host journal revision and a short state digest beside the shared-world identity. The full evidence remains queryable through `/api/world/local-seat`.

## HTTP/browser route

Development write mode adds:

- `POST /api/world/local-seat/bind`
- `GET /api/world/local-seat?regionSeatId=seat-1&participantId=...`

The POST route uses the same host write switch as other development world mutations. The GET route is read-only and remains available when writes are disabled.

The browser client uses the participant that was already re-read from host authority by the existing world-seat binding path. The session-storage handoff remains only a navigation hint; it is not identity authority.

## Equal-entry contract

Human and machine participants use the same host local-seat binding authority and the same `LocalRegionCommandJournalAuthority`. Controller kind remains explicit admission evidence, but does not alter the physical genesis state for equal seat + world-hour context.

The deterministic selftest constructs separate human and machine authorities for the same seat and host world hour and requires equal genesis/state digests.

## Truth boundary

This rung does **not** append browser-local `gather-scrap`, `explore`, or `repair-core` activity to the host journal yet.

That distinction is intentional and tested in Chromium: after a bound machine participant enters LOCAL RTS and issues a browser-local gather order, refreshing host checkpoint evidence must still show journal revision `0` and the same host state digest.

Therefore:

- the host can prove which participant owns which journaled local seat;
- the host can prove the journal checkpoint for that seat;
- the browser can display that proof;
- the browser cannot claim its independently advancing local simulation equals the host checkpoint merely because both refer to the same seat.

No local scrap total, Crew position, resource depletion, core integrity, exploration knowledge, combat result, or other browser-local outcome is promoted into shared/global state by this rung.

## Durability boundary

The default runtime wiring currently uses an in-memory per-seat journal store and process-local seat bindings. The underlying command-journal authority has separately demonstrated file-backed rehydration, but this binding rung does **not** yet persist participant→seat ownership/genesis metadata across a host restart.

So this change does not claim restart durability, distributed persistence, consensus, secure authentication, deployment, latency, scale, browser performance, visual quality, or gameplay balance.

## Evidence required for merge

Exact PR head must pass:

- full repository deterministic/source suite;
- chained local command-journal regression;
- local-seat binding deterministic selftest;
- HTTP binding/status authority selftest;
- existing world-session and world-HTTP authority regressions;
- existing browser-client regression;
- real Chromium bound-participant → host local checkpoint exercise;
- existing world-entry Chromium regression;
- existing controller/machine-seat Chromium regression.

The dedicated Chromium test also proves that a browser-local gather order does not silently advance the host journal.

## Next safe rung

The next persistence step should make one browser/local command use an explicit host-journal command intent with a host-issued expected revision/checkpoint and then render the host-reproduced result back to the seat. That should happen before any local economic total is promoted to shared-world state.

A separate follow-up should define restart-safe persistence for participant→seat binding/genesis metadata before describing the local journal as restart-durable in the hosted runtime.
