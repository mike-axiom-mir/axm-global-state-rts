# Salvage transfer reservation consumption v0

This rung closes the reservation-cleanup seam after a real LOCAL salvage debit has already been durably finalized into non-spendable global credit evidence.

## Why it exists

Before this rung, a finalized transfer could be `committed` while its verified LOCAL salvage reservation remained recorded until a separate manual release. That preserved value safety, but it left an awkward restart window: the same transfer had durable LOCAL-debit and global-credit evidence while its reservation cleanup had no transfer-bound idempotence marker.

The new reservation-consumption journal records a deterministic two-step reconciliation contract per transfer:

1. `plan` binds the transfer, participant/controller, seat, exact amount, reservation before/after values, durable global-credit receipt, LOCAL debit digest, resulting LOCAL revision/state hash, and world hour.
2. `applied` records that the reservation account has reached the planned after-state.

The journal is SHA-256 hash chained and replayed on restart. When the salvage transfer journal is file-backed, the default consumption journal is a sidecar at `<AXM_SALVAGE_TRANSFER_JOURNAL_PATH>.reservation-consumption.jsonl`. Tests may inject another store explicitly.

## Ordering

Finalization remains explicit. The host performs these rungs in order:

- real LOCAL debit is already canonical;
- durable global-credit evidence exists;
- transaction journal commits the matching global-credit receipt;
- reservation consumption plan is durably recorded;
- the account reservation is reduced by exactly the transfer amount;
- the consumption journal records `applied`.

A crash after transaction commit but before the plan is repaired by retrying the same transfer. A crash after the plan but before reservation reduction replays the plan and performs the one missing reduction. A crash after the account reduction but before the `applied` marker recognizes the exact planned after-state and appends only the missing marker. Once `applied` exists, retries do not reduce the reservation again even if the participant later changes other reservation state.

While a committed transfer lacks an applied consumption marker, manual reservation release for that seat fails closed. This prevents a restart-time manual release from racing the missing transfer-bound cleanup evidence.

Partial reservations are supported: if 2.000 scrap is reserved and a committed transfer represents 1.000 scrap, finalization consumes exactly 1.000 and leaves 1.000 reserved. Human and machine participants use the same arithmetic and physical settlement path.

## Truth boundary

This is **reservation reconciliation**, not a spend system. The real LOCAL scrap was already removed by the earlier LOCAL debit. The global salvage ledger still reports `spendableMilli: 0`. No crafting, construction, market trade, transfer-out, withdrawal, redemption, or shared-currency spend authority is introduced here.

The account store, LOCAL journal, transfer journal, global-credit journal, and reservation-consumption sidecar remain separate persistence surfaces. The recovery protocol is explicit and testable, but this does not claim filesystem/database/distributed atomicity or concurrent multi-host safety.

No performance, scale, deployment, secure-authentication, visual-quality, economy-balance, or Creation Machine asset-runtime claim is made by this rung.
