# AXM Global State RTS — website-hosted shared state v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This game is the exception to AXM's usual local/offline-first runtime pattern because the design itself is one shared website world. It does **not** require Mike to run a dedicated game server or consume the local Workshop machine for public traffic. The intended authority lives with the hosted website/backend runtime.

## What v0 adds

`src/hosted/shared-state-authority.mjs` introduces an append-only deterministic world journal around the existing globe simulation and run leaderboard.

Each accepted shared event records:

- sequential revision;
- unique command ID;
- event type;
- actor ID;
- payload;
- host record time;
- previous journal hash;
- full authoritative state hash after the event;
- hash of the journal entry itself.

The current journaled event set is intentionally small:

- `territory.claim`;
- `city.provoke`;
- `run.closed`.

The authority enforces obvious identity boundaries such as an actor not claiming territory or submitting a closed run as another actor.

## Deterministic replay

The persisted source is the journal, not a pile of opaque mutable server objects.

On startup/recovery the hosted authority:

1. rebuilds the deterministic Foundation-Planet world from the configured world seed;
2. replays the journal in revision order;
3. verifies previous-hash continuity;
4. verifies each replayed state hash;
5. verifies each entry hash;
6. reconstructs the shared leaderboard and world state.

A changed historical payload therefore fails replay integrity instead of silently becoming the new past.

## Storage adapters

`src/hosted/journal-store.mjs` currently provides:

- an in-memory adapter for tests/dev;
- a JSONL file adapter for local/hosted proofs where the website environment supplies persistent disk.

The append contract uses expected revision + expected head hash. If another writer wins first, the losing authority rejects its speculative write and rehydrates from the persisted journal.

This is an important boundary: a production multi-instance host eventually needs a storage adapter with atomic compare-and-swap/transaction semantics. The JSONL adapter is evidence for restart/replay, **not** a claim of distributed-database safety.

## Website API seam

`scripts/serve.mjs` now exposes read-only shared-state routes:

- `GET /api/global-state/meta`
- `GET /api/global-state/leaderboard?metric=dominance&limit=100`
- `GET /api/global-state/player?playerId=...`

The write route exists only as a guarded development proof:

- `POST /api/global-state/command`

It remains disabled unless `AXM_SHARED_WRITE_MODE=dev` is explicitly set.

That restriction is deliberate. The current client does not yet have signed command receipts, account/session proofs or authoritative gameplay-command validation, so opening raw browser world/score writes to the public would be fake security.

`AXM_WORLD_JOURNAL_PATH=/persistent/path/world.jsonl` selects the file journal. Without it, the dev server truthfully reports memory-only state.

## What this is not

This does not mean AXM is changing its general architecture to server-first software.

It also does not yet claim:

- deployed global persistence;
- account identity;
- signed commands;
- anti-cheat;
- public write authority;
- multiple host workers safely sharing JSONL;
- rollback administration;
- journal compaction/checkpoints;
- permanent seasons;
- production uptime.

The rung establishes the portable **website authority + append-only state + deterministic replay** seam so a real hosted persistence adapter can replace the dev storage without rewriting the game simulation.
