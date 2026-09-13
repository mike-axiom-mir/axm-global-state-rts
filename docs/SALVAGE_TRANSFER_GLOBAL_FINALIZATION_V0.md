# Salvage transfer global-credit finalization v0

Status: **EXPERIMENTAL / WORKING only when the dedicated gates pass**.

This rung connects an already-canonical LOCAL salvage debit to the durable global salvage credit ledger and then records the matching `global-credit` event in the salvage transfer transaction journal.

## Required order

1. A world-account participant owns the bound LOCAL RTS seat.
2. Verified LOCAL salvage is explicitly reserved.
3. The transfer is explicitly prepared from that exact LOCAL revision/state hash.
4. The host performs the real LOCAL salvage debit and persists the resulting LOCAL checkpoint.
5. `finalizeSalvageTransferGlobalCredit` appends or reuses durable global-credit evidence bound to the exact LOCAL debit digest/result.
6. Only after that durable credit is proven does the transaction journal accept its `global-credit` commit event.

The global ledger append is intentionally first. If a process stops after the durable credit append but before the transaction-journal commit, retrying the same transfer ID reuses the exact credit and completes only the missing transaction event. It must not re-debit LOCAL storage or append a second global credit.

## Truth boundary

Durable global credit is **not yet spendable currency**. The ledger reports `spendableMilli: 0` and has no spend/redemption authority.

This v0 does **not** automatically consume or release the separately persisted verified-salvage reservation. Once the transaction reaches `committed`, that obsolete LOCAL reservation may be released through the existing explicit release operation. Automatic crash-safe reservation consumption needs its own idempotent persistence marker before it is safe to add.

The LOCAL journal, seat checkpoint, transaction journal, account/reservation store, and global-credit ledger remain separate persistence surfaces. This rung does not claim filesystem, database, multi-host, or distributed atomicity.

Human and machine world-account participants use the same physical debit, durable-credit, and transaction-ordering rules. Controller identity remains recorded for audit; it does not alter the economic amount or LOCAL physics.

No deployment, secure-public-authentication, performance, scale, balance, visual-quality, or Creation Machine asset-runtime claim is implied by this protocol.
