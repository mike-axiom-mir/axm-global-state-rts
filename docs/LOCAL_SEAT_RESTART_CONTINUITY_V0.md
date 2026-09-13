# LOCAL RTS seat restart continuity v0

Status: **EXPERIMENTAL / HOST RESTART CONTINUITY RUNG**

## Purpose

PR #78 proved that a bound human or machine participant can ask the host to reproduce and journal one `gather-scrap` command against an explicit host checkpoint. The remaining continuity gap was that participant → LOCAL RTS seat ownership still lived only in process memory.

This rung makes world-account seat ownership restart-restorable when the host is explicitly configured with both a durable binding file and durable per-seat command journals.

## Durable scope

Only `world-account` participants are written to the local-seat binding store. Human and machine world accounts use the same persistence path and the same restore checks.

A durable binding checkpoint records:

- participant id and controller kind;
- region seat id;
- original bound world-hour index;
- journal genesis digest and genesis state hash;
- current journal revision, head hash, and state hash.

On restart the host restores world accounts first, then restores each LOCAL RTS binding from the binding store, recreates the corresponding per-seat journal from its original genesis world hour, replays the persisted journal, and requires the replayed checkpoint to match the stored binding checkpoint exactly.

If participant identity, controller kind, genesis, revision, head hash, or state hash disagree, startup fails closed for that authority rather than silently inventing or discarding continuity.

## Guest boundary

Guest participants remain session-scoped in v0. Their local-seat bindings are deliberately not written into the restart store because the guest identity itself is not restart-durable.

A guest can still bind and play during the current host process. After host restart, that seat is unbound unless a durable world account owns it.

## Host configuration

The development server accepts paired configuration:

- `AXM_LOCAL_SEAT_BINDINGS_PATH` — JSON binding/checkpoint file;
- `AXM_LOCAL_SEAT_JOURNAL_DIR` — directory containing one JSONL journal per region seat.

They must be configured together. Supplying only one is rejected at startup so the host does not advertise durable ownership while the associated command journal is knowingly process-local.

World-account persistence remains separately configured through `AXM_WORLD_ACCOUNTS_PATH`.

## Crash boundary

The binding checkpoint file and the per-seat journal are separate files, not one transactional database. The host appends an accepted local command to the journal and then checkpoints the durable binding metadata.

A process or storage failure between those two writes can leave a valid journal ahead of the last binding checkpoint. v0 does not guess how to repair that condition. The next startup detects the mismatch and fails closed instead of silently rolling back or automatically accepting the newer state.

This is intentional truth-before-availability behavior for the current experiment.

## What this proves

The focused deterministic test covers:

- durable human world-account seat ownership;
- durable machine world-account seat ownership through the same path;
- one host-journal gather on each before restart;
- reconstruction at a later authoritative world hour without rewriting the original genesis hour;
- identical revision/head/state continuity across the restart;
- continued host-journal commands after restart;
- occupied-seat protection after restart;
- guest binding remaining session-scoped;
- fail-closed startup when the persisted binding checkpoint is tampered away from the replayed journal state.

The browser gate starts the real development host with paired local-seat persistence configured and exercises the existing authority-revalidated bound-seat → explicit host gather flow. The controller gate remains a separate real-Chromium regression.

## Truth boundary

This is **not** distributed consensus, database-grade transactions, automatic crash repair, browser/server lockstep, global scrap economy, secure public authentication, deployment, scale, latency, target-device performance, visual-quality acceptance, or gameplay balance evidence.

The host LOCAL RTS journal is still distinct from the independently running browser simulation. `gather-scrap` remains the only host-enabled local macro command. Explore, repair, Crew positions, resource depletion, construction, combat, and exploration knowledge are not promoted by this rung.

## Next safe rung

With participant → seat → journal continuity now restart-restorable under explicit host storage, the next high-value choice is an **explicit host-checkpoint adoption/reconciliation contract** for the browser simulation.

That contract should let a human or machine participant intentionally adopt a specific host checkpoint, prove which local state was replaced or retained, reject stale/conflicting adoption, and preserve rollback/replay evidence. Globalizing gathered scrap should still wait until reconciliation and an explicit shared-economy promotion contract exist.
