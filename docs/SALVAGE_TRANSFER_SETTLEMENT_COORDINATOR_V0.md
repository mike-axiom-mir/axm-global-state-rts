# Bound-seat salvage transfer settlement coordinator v0

Status: **EXPERIMENTAL / REAL LOCAL DEBIT COORDINATION, NO GLOBAL CREDIT**

## Purpose

PR #87 made salvage transfer debit a real deterministic LOCAL RTS journal transition, but intentionally left a continuity seam: invoking that low-level debit directly could advance a durable seat journal without refreshing the separate durable participant-to-seat checkpoint. A process failure in that window would cause the normal restart path to fail closed because the binding checkpoint lagged the canonical LOCAL journal.

This rung adds a host-only settlement coordinator around the existing authorities. It does not invent a second economy. It composes the current bound-seat authority, verified-salvage reservation ledger, LOCAL command journal, and salvage-transfer transaction journal so one prepared transfer can reach the already-defined `local-debited` phase without silently losing seat continuity.

## Prepare contract

`SalvageTransferSettlementCoordinator.prepare(...)` accepts a transfer only when:

1. the participant exists and is a persistent world account;
2. the participant currently owns the requested LOCAL region seat;
3. the caller names the exact current LOCAL revision;
4. an existing verified-salvage reservation covers the requested milli-scrap amount;
5. reservation controller identity matches the bound participant;
6. reservation revision/state hash exactly match the current canonical LOCAL checkpoint.

The coordinator then asks the existing `SalvageTransferTransactionJournal` to append its deterministic `prepare` evidence. No LOCAL storage changes at prepare time.

## LOCAL debit settlement contract

`settleLocalDebit(...)` re-reads the prepared transaction and existing reservation from host authority. It does not trust a client-supplied amount, seat, source revision, source state hash, or controller kind.

The coordinator then:

1. revalidates the world-account participant and bound seat;
2. requires the reservation to still cover the transaction and to reference the transaction's exact source revision/state hash;
3. invokes the existing LOCAL journal's deterministic `submitSalvageDebit(...)` using the prepared source and amount;
4. refreshes all durable world-account seat-binding checkpoints to the journal state that now exists;
5. records that exact LOCAL debit evidence into the transfer transaction journal.

The order is deliberate. If the process fails after the LOCAL journal append but before the binding checkpoint or transaction evidence is written, the same transfer id remains recoverable and idempotent rather than subtracting storage again.

## Narrow startup recovery

`recoverSettlementAdvancedLocalSeatBindings(...)` handles one specific crash window before the ordinary `LocalSeatJournalAuthority` restart check runs.

A stale binding checkpoint may advance automatically only when all of these are true:

- the LOCAL journal is exactly one revision ahead;
- the persisted genesis still matches;
- the persisted head/state exactly match the journal checkpoint immediately before the extra entry;
- the single extra entry is a validated `LOCAL_REGION_SALVAGE_DEBIT_JOURNAL_ENTRY_SCHEMA` entry;
- that debit's `previousHash` and `previousStateHash` match the persisted checkpoint;
- its participant id and controller kind match the durable bound world account.

Any arbitrary gameplay command, multi-revision gap, participant mismatch, genesis mismatch, state mismatch, or other divergence still fails closed. The recovery helper never rewrites the LOCAL journal; it only advances the separate binding checkpoint to a debit that the canonical journal already contains and can replay.

`createSettlementReadyLocalSeatJournalAuthority(...)` packages this recovery-before-bind-authority construction order for hosts that opt into the settlement path.

## Human / machine equal entry

Human and machine world accounts use the same reservation coverage rules, source checkpoint rules, LOCAL debit transition, binding checkpoint persistence, transaction ordering, and crash recovery. Controller identity remains audit evidence, not a different physical settlement rule. Deterministic parity evidence requires equivalent human and machine runs to produce the same actor-independent `localDebitDigest` and resulting LOCAL state hash.

## Reservation behavior after debit

The verified-salvage reservation intentionally remains locked after the real LOCAL debit. This is conservative: it prevents a later LOCAL repair from treating that reserved value as available again while there is not yet a crash-safe reservation-consumption plus global-credit contract.

This rung therefore stops at transaction phase `local-debited`.

## Truth boundary

This build does **not** claim:

- reservation consumption or release as part of settlement;
- shared/global credit, spendable currency, trade balance, escrow, or a player wallet;
- filesystem, database, or distributed atomicity between the LOCAL journal, binding checkpoint, account store, and transaction journal;
- concurrent multi-host writer safety. Startup recovery assumes the host owns these files while recovering;
- browser/API settlement controls or player-facing transfer UI;
- deployment, secure authentication, performance, scale, economy balance, asset-runtime integration, or visual quality.

The coordinator's persistence sequence is recoverable through deterministic transfer-id evidence, not transactionally atomic across files. That distinction must remain explicit.

## Next safe rung

Wire this coordinator into `WorldSessionAuthority` and the host persistence configuration, then expose an explicit player-facing prepare/debit status flow with real browser evidence. Only after that should a new contract consume the locked reservation and create separately persistent global credit, with restart recovery proving that the same physical scrap can never become locally reusable and globally spendable at the same time.
