# Host-owned local RTS command journal continuity v0

Status: **EXPERIMENTAL / CONTINUITY AUTHORITY RUNG**

## Why this exists

The previous host replay verifier could independently reproduce one bounded local RTS command, but every verification started again from the deterministic starter-region baseline. That was useful evidence, not ongoing state authority.

This rung gives one local region a host-owned append-only command journal. Every accepted command now extends the state produced by the commands before it. The journal uses the existing memory/file world-journal store contract, deterministic replay of the existing `LocalRegionSimulation`, a previous-state SHA-256 checkpoint digest, and the existing journal-head hash chain.

A restart can rebuild the local physical state by replaying the persisted journal from its pinned genesis context. This is deliberately replay-first rather than snapshot-restore-first: continuity is proven from the command history before any performance optimization or compaction is introduced.

## Host trust split

The physical intent remains the same narrow four-field shape as the one-shot verifier:

- `actionId`: `gather-scrap`, `explore`, or `repair-core`;
- `cursorXM`;
- `cursorZM`;
- bounded `stepCount`.

Participant identity, controller kind, region seat, world hour, journal revision, previous state hash, and journal head are host-side context or authority-owned fields. A client cannot place those fields inside the physical intent.

The authority is constructed for one trusted `regionSeatId` and a pinned `genesisWorldHourIndex`. Each later command receives a host-provided world hour. That hour deterministically selects the existing local day/night lighting phase before the command is applied.

## Checkpoint / journal chain

Each accepted entry contains:

- monotonic revision and host-generated command id;
- participant/controller audit identity;
- pinned seat and genesis digest;
- host world hour and derived lighting phase;
- normalized physical intent;
- `previousStateHash`;
- physical-command digest that binds the prior state + physical intent + trusted physical context;
- separate admission digest that additionally binds the participant;
- resulting `stateHash`;
- previous journal-entry hash and current entry hash.

`stateHash` is a deterministic checkpoint **digest** of the complete host-replayed canonical local simulation state. It is not yet a serialized snapshot checkpoint. Rehydration currently replays the complete bounded journal.

The v0 authority caps a region journal at 128 commands. Hitting the cap stops additional commands instead of silently pretending the current replay-first implementation is a scale solution.

## Equal-entry contract

Human and machine participants use the exact same physical transition path. With the same prior state, intent, seat, and host world hour, controller kind does not alter either the physical-command digest or resulting state hash. Participant/controller identity remains visible in the admission digest and append-only audit entry.

This preserves equal physical entry while retaining accountability.

## Evidence

The selftest covers:

- deterministic chained prior-state extension;
- previous-state and previous-entry hash continuity;
- human/machine physical parity;
- host world-hour binding;
- stale revision rejection;
- rejection of client identity fields in physical intent;
- file-backed journal rehydration across a simulated process restart;
- tampered state-hash rejection;
- wrong-genesis rejection.

The PR gate also runs the full repository deterministic/source suite and the prior one-shot replay verifier.

## Truth boundary

This closes the prior-state gap **inside the host local-region authority**, but it does not yet connect this journal to the browser seat-binding surface or the public/dev HTTP routes. Therefore it does not prove that a currently running browser shares this host state.

It also does **not** promote local scrap, Crew positions, resource depletion, core integrity, exploration knowledge, or combat results into shared/global world state. The persistence label is intentionally `host-journaled-local-state-no-shared-world-mutation`.

The file store is local JSONL persistence, not distributed consensus, secure public authentication, production durability, crash-atomic database storage, or multi-host replication. Full replay is intentionally bounded and is not a performance or scale claim.

No browser rendering, controller behavior, visual quality, gameplay balance, deployment, latency, or target-device performance claim is made by this rung.

## Next safe rung

The next activation can bind one such host journal to a **trusted host-side local-seat authority** and expose player-facing journal/checkpoint status through the existing shared entry flow. Only after the host can prove that a participant's live local seat is acting on this journaled state should a useful local economic result be mapped into persistent shared-world state.

Snapshot/compaction can be added later when evidence shows replay cost matters; it should not replace the journal as the continuity proof.
