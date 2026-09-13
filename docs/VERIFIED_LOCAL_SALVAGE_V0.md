# Verified LOCAL RTS salvage record v0

Status: **EXPERIMENTAL / PERSISTENT EVIDENCE RUNG**

## Purpose

The host now has a deterministic per-seat LOCAL RTS journal and an explicit browser checkpoint-adoption path. This rung makes one useful result from that host-owned physical state survive on a world account without pretending that LOCAL RTS storage has already become a spendable global economy.

A world-account participant may explicitly choose **Record verified salvage** after the bound host journal has produced at least one command. The host revalidates participant → seat ownership and the exact displayed journal revision, reads `storage.scrap` from the host journal's authoritative simulation snapshot, and records a persistent per-seat high-water proof on the world account.

The browser does not supply the scrap amount. It supplies only the bound participant, seat, and expected host journal revision. The host derives the amount, state hash, controller kind, and current world hour from authoritative state.

## Persistent record semantics

For each world account and LOCAL RTS seat, v0 stores:

- the source seat;
- the exact host journal revision;
- the host journal state hash;
- the highest host-verified stored-scrap amount, represented in thousandths;
- the participant controller kind for audit evidence;
- the host world hour when the proof was recorded.

A same-revision request with the same state and amount is idempotent and adds no new proof credit. A stale revision is rejected. The same revision with different evidence is rejected. A later revision whose stored scrap is lower than the previously recorded high-water mark fails closed instead of silently subtracting or inventing transfer semantics.

That last rule is deliberate. The currently enabled host LOCAL RTS command surface is gather-only, so stored scrap is monotonic in the verified path. If repair, spending, construction, destruction, transfers, or another mechanic can reduce storage later, this v0 record must be replaced or extended with explicit debit/transfer semantics before those outcomes can use this persistence bridge.

## Human / machine equal entry

Human and machine world accounts use the same seat binding, host journal, expected-revision check, salvage endpoint, persistence record, and idempotence rules. Controller kind is retained only as admission/audit evidence; it does not change the physical salvage calculation.

Guests are intentionally excluded from restart-durable salvage records because guest identity is session-scoped. This is a continuity decision, not a capability distinction.

## What this is not

The verified salvage number is **not spendable currency** and is not yet a shared/global economy balance.

Recording it:

- does **not** debit or transfer LOCAL RTS storage;
- does **not** make browser-local gather authoritative;
- does **not** automatically record every host gather;
- does **not** make the browser and host continuously lockstep;
- does **not** grant another participant access to the seat or account;
- does **not** establish transactional coupling between the account file, seat-binding file, and per-seat journal;
- does **not** establish distributed consensus or production database durability;
- does **not** prove secure authentication, deployment readiness, performance, scale, balance, or visual quality.

The account persistence adapter and the LOCAL RTS journal/binding stores remain separate persistence surfaces. A crash between independent writes can still expose a continuity mismatch elsewhere; existing host continuity checks must continue to fail closed rather than guessing repair.

## Why this rung exists

The goal is to preserve provenance before value becomes fungible. The project can now say, narrowly and testably: **this world account has a restart-persistent record that this bound host-replayed LOCAL RTS state held at least this much stored salvage at this named journal checkpoint.**

A later global-economy design can choose whether and how to convert, debit, escrow, spend, or transfer such verified local outcomes. That future choice remains outside v0 so the project does not create duplicate value merely because persistence plumbing now exists.
