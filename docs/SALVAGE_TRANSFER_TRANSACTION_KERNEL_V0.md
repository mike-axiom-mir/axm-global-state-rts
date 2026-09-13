# Verified salvage transfer transaction kernel v0

Status: **EXPERIMENTAL / NOT YET WIRED TO LIVE LOCAL OR GLOBAL ECONOMY**

## Purpose

The current verified-salvage reservation path proves that a world-account participant can explicitly set aside salvage reproduced by a host-owned LOCAL RTS journal, while the known `repair-core` spend path fails closed against that reservation. The missing safety rung is settlement: the same physical scrap must never remain locally usable while also becoming shared/global value.

This lane introduces the smallest deterministic transaction kernel needed before that integration. The kernel records an append-only, hash-chained transfer lifecycle:

1. **prepare** — bind a transfer id to one participant, controller kind, region seat, exact LOCAL journal revision/state hash, reserved amount, requested amount, and host world hour;
2. **local-debit recorded** — accept only evidence tied to that exact prepared source, exact amount, and the immediately following LOCAL journal revision;
3. **global-credit committed** — accept only after a matching local debit is recorded, once, for the same participant and amount;
4. **cancel** — allowed only while still prepared, before any local debit exists.

Replay reconstructs transfer state and per-participant committed credit totals from the journal. Reusing the same transfer/event evidence is idempotent; conflicting reuse, credit-before-debit, cancel-after-debit, source mismatch, amount mismatch, journal-chain tampering, or state-transition regression fails closed.

## Human / machine equal entry

`controllerKind` is retained as audit evidence on the prepare event. It does not change amount validation, transition rules, replay semantics, idempotence, cancellation rules, or derived committed-credit arithmetic. Equivalent human and machine transactions must produce equivalent semantic settlement state.

## Continuity contract

The kernel can use the repository's existing memory or JSONL journal stores. A restart replays the same ordered evidence. Each entry binds its previous hash and a canonical SHA-256 hash of its own transaction payload. The kernel therefore detects content tampering in addition to the generic journal store's revision/head-chain validation.

## Truth boundary

This is **not yet the live transfer path**. In v0:

- no LOCAL RTS storage is debited by this module;
- no reservation ledger entry is consumed by this module;
- no world-account/shared-state balance is mutated by this module;
- no browser control can start settlement;
- no production/distributed transaction, crash-atomic coupling across separate files, secure authentication, economy balance, deployment, performance, or visual-quality claim is made;
- a `global-credit committed` entry means only that the transaction kernel has accepted ordered evidence for a later integration. It is not spendable game currency.

This deliberately prevents a false "atomic transfer" claim while giving the next integration lane a deterministic contract to wire against. The next rung must make the LOCAL debit itself a host-journaled state transition and then bind live account/shared credit to this transaction journal without permitting duplicate local/global value.