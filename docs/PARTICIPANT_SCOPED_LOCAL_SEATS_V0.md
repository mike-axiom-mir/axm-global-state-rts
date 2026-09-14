# Participant-scoped LOCAL seat identity v0

Status: **WORKING / bounded host authority repair**

## Problem repaired

The browser has always described `seat-1` through `seat-4` as **local client seats**: presentation/input slots for one client looking into a much larger persistent world. They are not world-player identities and they must not cap the shared world at four participants.

The first host LOCAL RTS journal binding accidentally keyed ownership only by `regionSeatId`. Because one `WorldSessionAuthority` owns one `LocalSeatJournalAuthority`, the first participant to bind `seat-1` prevented every other world participant from using their own local client `seat-1`. Repeating that pattern for four IDs silently turned the host LOCAL layer into a four-world-player gate.

That contradicted the game foundation.

## v0 repair

LOCAL seat journal ownership is now scoped by:

`world participant identity + client-local seat id`

Consequences:

- many world participants may each use their own `seat-1` without colliding;
- each participant has an isolated host replay journal and revision chain;
- human and machine participants still use the same physical LOCAL command authority and the same account-level rolling 100 APM admission gate;
- one participant is still limited to one bound LOCAL client slot in this v0 contract;
- a lookup by `seat-1` alone fails closed as `local-seat-participant-required` when more than one participant uses that client seat id;
- durable world-account bindings retain exact participant ownership across host restart;
- guest bindings remain session/process scoped and are not promoted into durable identity.

Durable journals use a deterministic participant-scoped storage key. Legacy v0.1/v0.2 saved bindings without that key retain their old seat-key journal lookup on restore so existing state is not silently abandoned.

## Evidence target

The dedicated selftests exercise more than four participants sharing `seat-1`, isolated journal revisions, human/machine equal physical command outcome, account APM admission, restart continuity for multiple accounts sharing the same client seat id, newcomer reuse of `seat-1` after restart, and fail-closed checkpoint tamper detection.

GitHub CI remains the execution evidence for this branch because repository/submodule checkout is required for the full deterministic and Chromium gates.

## Truth boundary

This repair removes an accidental **identity/authority cap**. It does **not** prove production concurrency, networking scale, multi-host operation, deployment security, browser performance, or a production-sized player population.

It also does not yet make the whole visible browser macro simulation host-authoritative. The browser gameplay surface still has local-only actions and must be progressively moved onto the already existing participant-scoped host command/replay path. Host command enablement remains deliberately narrow while that convergence is verified.

Checkpoint adoption and verified-salvage helpers must always carry participant identity when resolving a shared client seat id. Any remaining helper that relies on seat id alone is a follow-up integration blocker, not permission to infer a participant.

## Architectural rule preserved

**1–4 seats means 1–4 seats per client/view/input surface. It never means only four players may inhabit the persistent globe.**
