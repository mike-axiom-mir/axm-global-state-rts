# Salvage Transfer Session API v0

## Purpose

This rung makes the existing host salvage-settlement coordinator reachable through the real world-session host and an explicit player-facing flow without pretending that LOCAL salvage is already shared/global money.

A host must explicitly configure `AXM_SALVAGE_TRANSFER_JOURNAL_PATH` together with durable world accounts, LOCAL seat bindings, and per-seat LOCAL journals before the settlement HTTP surface is enabled by `scripts/serve.mjs`.

## Explicit flow

1. Enter or restore a world account as either a human or machine controller.
2. Bind the participant to its matching LOCAL RTS seat.
3. Produce canonical LOCAL stored salvage through the host journal.
4. Record current host-verified salvage evidence.
5. Explicitly reserve salvage.
6. Explicitly **prepare** a transfer. Prepare writes ordered transaction evidence only; LOCAL storage does not change.
7. Explicitly **debit** the prepared amount from the canonical LOCAL journal. The host re-derives participant/controller identity, seat ownership, current reservation source, source revision/state hash, amount, and world hour.
8. The durable seat checkpoint is refreshed and the transaction journal records the real LOCAL debit evidence.
9. The flow stops at transaction phase `local-debited`.

The player can cancel a prepared transfer before LOCAL debit. Once a transfer is `prepared` or `local-debited`, its backing reservation cannot be released through the settlement-enabled world session. That preserves the reservation as continuity evidence instead of quietly making the same reserved proof available to another path.

## Restart behavior

When settlement is configured, startup runs the narrow recovery rule introduced by the settlement coordinator before the ordinary durable LOCAL-seat restore. It may advance a stale binding checkpoint only when the LOCAL journal is exactly one revision ahead and that extra revision is a replay-validated salvage debit for the same participant/controller binding.

The transaction journal is also re-read from its configured JSONL store. A completed LOCAL debit therefore remains visible after host restart as `local-debited`; retrying the same transfer ID remains idempotent rather than subtracting the same physical salvage twice.

## Human / machine equality

Human and machine world accounts enter through the same world participant registry, bind through the same LOCAL-seat authority, use the same reservation rules, and traverse the same prepare/debit/cancel/status methods. Controller identity remains auditable, but it does not change physical debit arithmetic or LOCAL state transition rules.

## Player-facing clarity

The LOCAL RTS shell adds an explicit settlement row only after the existing verified-salvage reservation controls. The row reports whether durable settlement is configured. It keeps prepare, debit, and cancel as separate choices and continuously states that:

- prepare does not debit LOCAL storage;
- LOCAL debit is explicit;
- the reservation remains locked after debit;
- no global credit or spendable balance exists yet.

When the host has no durable transfer journal configured, the control remains disabled rather than silently falling back to a process-memory transfer path.

## Truth boundary

This rung proves only the integration that is actually exercised by deterministic/source gates and the dedicated Chromium restart workflow.

It does **not** claim:

- reservation consumption after LOCAL debit;
- a shared/global balance;
- spendable currency;
- global-credit settlement;
- atomicity across account, seat-binding, LOCAL-journal, and transfer-journal files;
- database/distributed transaction semantics;
- concurrent multi-host safety;
- secure public authentication;
- production deployment;
- performance or scale;
- economy balance;
- Creation Machine asset integration;
- visual quality.

## Next safe rung

The next economic rung should introduce a separately persistent global-credit ledger and a crash-reconcilable commit protocol that consumes/releases the locked reservation only when the LOCAL debit is already canonical and the global credit is durably proven. Until then, `local-debited` is a terminal v0 status, not money.
