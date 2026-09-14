# Next-drop run claim bridge v0

Status: **EXPERIMENTAL / RUN-LIFECYCLE CONVERGENCE RUNG**

## Purpose

The world-account chest path already retains opened hourly chest value for the next civilization. The progression layer already knows how to begin and close civilization runs. Before this rung there was no explicit handoff contract between those two truths.

This rung adds a bounded claim/acknowledgement bridge so next-drop value can be moved out of the pending world-account bucket exactly once for one named run, retried after a failed start, and then marked applied after the progression run exists.

## Claim state

`HourlyDropCache` now retains at most one current/last `nextDropClaim` in its snapshot:

- monotonically increasing claim serial;
- target `runId`;
- status `claimed` or `applied`;
- exact bounded reward aggregate copied from `pendingNextDropRewards`.

Claiming a run moves the pending aggregate into the claim and clears the pending bucket. Repeating the same outstanding claim is idempotent. A different run cannot replace an outstanding claimed package. An applied claim cannot be replayed for the same run ID.

Because the claim lives inside the drop-cache snapshot, world-account export/restore carries it through the existing account persistence boundary. Guest behavior remains session-best-effort.

## Progression bridge

`PlayerProgression.beginRunFromNextDropClaim(...)` validates a claimed package, adds its food/scrap/items to the new run's starting setup, unlocks any known RNG-cache blueprint options through normal blueprint provenance, and refuses previously closed run IDs.

`beginClaimedNextDropRun(...)` composes the participant registry and progression layer:

1. claim the pending world-account next-drop value for a named run;
2. attempt to create that run from the claim;
3. leave the claim outstanding if run creation is rejected, so the same claim can be retried without draining more chest value;
4. acknowledge the claim only after the run exists;
5. reconcile a matching already-active run with the matching claim without creating a second civilization.

## Four-root boundary

**Truth:** pending value, claimed value, and applied value are distinct states. A failed run start does not report the claim as applied. Duplicate run IDs are rejected.

**Agency / non-domination:** chest opening remains explicit and this bridge does not auto-open chests or silently create a civilization. A caller explicitly names the target run.

**Continuity:** claim state survives participant export/restore, an outstanding claim blocks conflicting replacement, and a failed start can retry the exact same package.

**Wisdom before speed:** this stops at the deterministic world-account -> progression handoff. It does not pretend that the browser/local-seat host has already deployed the new civilization into the persistent physical world.

## Non-claims / next seam

This does **not** yet expose claim/start/acknowledge through `WorldSessionAuthority`, HTTP, or the player-facing browser shell. It does not persist the full `PlayerProgression`/active civilization through the world-account store, establish cross-file/database atomicity, solve multi-host concurrency, or prove production deployment/performance/security.

The next convergence seam is to place this claim/start/ack contract behind the host session authority and bind the created run to the authoritative LOCAL RTS/world lifecycle before the browser can present the next civilization as live.
