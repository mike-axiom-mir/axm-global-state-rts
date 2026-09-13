# Host-journaled LOCAL salvage debit v0

Status: **EXPERIMENTAL / REAL LOCAL STORAGE DEBIT, NO GLOBAL CREDIT**

## Purpose

The verified-salvage transfer kernel can already order `prepare -> local-debit evidence -> global-credit evidence`, but its `local-debit` event previously accepted evidence for a transition that no live LOCAL RTS authority could actually perform. This rung closes that truth gap without promoting salvage into spendable shared-world value.

`LocalRegionCommandJournalAuthority.submitSalvageDebit(...)` now performs one deterministic host-owned settlement transition:

1. bind a non-empty transfer id to an exact current LOCAL journal revision and state hash;
2. bind the transition to the host world hour and independently supplied host participant identity;
3. require a positive integer milli-scrap amount and prove the host simulation currently has at least that much stored scrap;
4. subtract that amount from canonical LOCAL `storage.scrap` without advancing Crew movement or issuing a browser/gameplay order;
5. append a distinct hash-chained salvage-debit journal entry with source/result state hashes and an actor-independent `localDebitDigest`;
6. replay the same debit after restart as part of the LOCAL journal's canonical state;
7. treat an exact retry of the same transfer id, participant/controller identity, and amount as idempotent instead of subtracting twice.

Conflicting transfer-id reuse, stale revision, stale state hash, insufficient stored scrap, journal tampering, or replay disagreement fails closed.

## Transaction-kernel seam

The debit result exposes exactly the evidence expected by `SalvageTransferTransactionJournal.recordLocalDebit(...)`:

- `sourceRevision`
- `sourceStateHash`
- `amountMilli`
- `resultingLocalRevision`
- `resultingLocalStateHash`
- `localDebitDigest`

The deterministic selftest prepares a transfer in the existing transaction kernel, performs the real LOCAL debit, and records that exact evidence. The transaction remains only `local-debited`; committed shared/global credit stays zero.

The LOCAL journal entry also retains the `transferId`, so if a process fails after the storage debit but before the transaction kernel records the debit evidence, a retry can recover the already-applied debit evidence without subtracting the salvage again.

## Human / machine equal entry

Controller kind and participant identity remain admission/audit evidence, not physical settlement rules. Under the same LOCAL source state, transfer id, amount, and host world hour, a human and machine participant produce the same `localDebitDigest` and resulting LOCAL state hash. Their admission digests remain distinct so identity is still auditable.

## Truth boundary

This rung intentionally stops after the real LOCAL storage debit.

- It does **not** consume or release the verified-salvage reservation ledger entry.
- It does **not** create shared/global credit, spendable currency, escrow, trade value, or a world-account balance.
- The low-level LOCAL journal method does not independently prove that a reservation/prepare record exists; the settlement integrator must bind those existing authorities before calling it.
- It is **not yet wired through `LocalSeatJournalAuthority`**. A raw debit of a journal belonging to a durable bound seat would advance that journal without automatically refreshing the separate durable seat-binding checkpoint. The next coordinator must perform the debit through a bound-seat authority path that also checkpoints ownership continuity, rather than bypassing that layer.
- The LOCAL journal and transfer transaction journal are still separate persistence surfaces. A crash can occur between their writes; transfer-id idempotence makes recovery possible, but this is not a claim of filesystem/distributed atomicity.
- No browser control is added in this rung.
- No new deployment, secure-authentication, performance, scale, balance, Creation Machine asset-runtime, or visual-quality claim is made.

The next safe rung is a host settlement coordinator/bound-seat authority path that derives a prepared transfer from the existing reservation and transaction authorities, invokes this real LOCAL debit, refreshes the durable seat checkpoint, records/reconciles the debit evidence, and only then considers a separately persistent global credit step. Reservation consumption must be designed so a crash cannot make the same salvage locally usable again while global value exists.
