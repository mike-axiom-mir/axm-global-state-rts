# Global Salvage Credit Ledger v0

## Purpose

This rung adds a separate append-only persistence surface for salvage that has already left a LOCAL RTS journal and is intended to become global account value.

The ledger exists so later settlement coordination can recover across a process restart without inventing a second copy of the same scrap. It is deliberately smaller than a complete economy.

## Credit record

A credit entry binds:

- one stable `transferId`;
- the world-account `participantId` and its `human` or `machine` controller kind;
- an integer salvage amount in milli-scrap;
- the LOCAL debit digest;
- the resulting LOCAL journal revision and state hash;
- the host world-hour index;
- the append-only ledger revision, previous hash, and entry hash.

The same transfer ID with exactly the same credited evidence is idempotent. Reusing a transfer ID with different evidence fails closed.

## Replay and restart

The ledger replays from its configured journal store. A JSONL file store therefore survives process restart. Replay checks the hash chain, each entry hash, its credit fingerprint, revision ordering, transfer uniqueness, and normalized fields. Tampered persisted evidence is rejected rather than repaired silently.

## Human / machine equality

Human and machine world accounts use the same validation and accounting rules. Controller kind remains in the evidence for auditability; it does not alter the amount or physical LOCAL-debit evidence required to represent a credit.

## Truth boundary

A ledger credit is **not yet spendable currency**.

This module does not itself inspect or mutate the LOCAL RTS journal. Its caller must prove that the referenced LOCAL debit is canonical before crediting. It has no spend, redemption, transfer-out, market, crafting, or construction authority. Its summaries therefore expose credited evidence while reporting `spendableMilli: 0`.

This version also does **not** claim an atomic transaction across the LOCAL journal, seat-binding checkpoint, transaction journal, reservation persistence, and global-credit journal. The next settlement rung must reconcile those persistence surfaces across crashes before the player-facing flow may describe a transfer as complete.

## Merge evidence required

The dedicated gate must prove:

1. repository deterministic/source tests pass;
2. the ledger syntax and selftest pass;
3. exact retry is idempotent and conflicting transfer reuse fails closed;
4. memory replay and file-backed restart reproduce the same credit evidence;
5. persisted tampering is rejected;
6. human and machine accounts preserve equal actor-independent credit semantics;
7. existing Chromium world-entry and four-controller/machine-seat regressions still pass.
