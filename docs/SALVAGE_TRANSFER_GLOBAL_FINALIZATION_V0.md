# Salvage transfer global-credit finalization v0

Status: **EXPERIMENTAL / WORKING only when the dedicated gates pass**.

This rung connects an already-canonical LOCAL salvage debit to the durable global salvage credit ledger, records the matching `global-credit` event in the salvage transfer transaction journal, and then reconciles the exact transfer-bound verified-salvage reservation through the separate reservation-consumption journal.

## Required order

1. A world-account participant owns the bound LOCAL RTS seat.
2. Verified LOCAL salvage is explicitly reserved.
3. The transfer is explicitly prepared from that exact LOCAL revision/state hash.
4. The host performs the real LOCAL salvage debit and persists the resulting LOCAL checkpoint.
5. `finalizeSalvageTransferGlobalCredit` appends or reuses durable global-credit evidence bound to the exact LOCAL debit digest/result.
6. Only after that durable credit is proven does the transaction journal accept its `global-credit` commit event.
7. The host durably records the transfer-bound reservation-consumption plan, reduces exactly the matching reservation amount, and records the consumption `applied` marker.

The global ledger append remains intentionally first. If a process stops after the durable credit append but before the transaction-journal commit, retrying the same transfer ID reuses the exact credit and completes only the missing transaction event before reservation reconciliation. It must not re-debit LOCAL storage or append a second global credit.

Reservation cleanup is also crash-reconcilable. A process stop after transaction commit but before the consumption plan, after plan but before reservation reduction, or after the account reduction but before the `applied` marker is repaired by retrying the same transfer ID. The durable plan contains exact before/after reservation amounts and the matching LOCAL/global evidence, so retry can distinguish the one missing step from an already-applied reduction. Unexpected reservation state fails closed rather than being guessed or silently rewritten.

## Truth boundary

Durable global credit is **not yet spendable currency**. The ledger reports `spendableMilli: 0` and has no spend/redemption authority.

A successfully finalized transfer now consumes exactly its own verified-salvage reservation amount. Partial reservations remain partial: if 2.000 scrap was reserved and the transfer covers 1.000, 1.000 remains reserved. Manual reservation release is blocked while a committed transfer still lacks its applied consumption marker, then returns to the ordinary explicit reservation rules after reconciliation.

The LOCAL journal, seat checkpoint, transaction journal, account/reservation store, global-credit ledger, and reservation-consumption journal remain separate persistence surfaces. This rung provides explicit restart reconciliation; it does not claim filesystem, database, concurrent multi-host, or distributed atomicity.

Human and machine world-account participants use the same physical debit, durable-credit, transaction-ordering, and reservation-consumption rules. Controller identity remains recorded for audit; it does not alter the economic amount or LOCAL physics.

No deployment, secure-public-authentication, performance, scale, balance, visual-quality, or Creation Machine asset-runtime claim is implied by this protocol.
