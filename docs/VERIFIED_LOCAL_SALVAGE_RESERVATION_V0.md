# Verified LOCAL RTS salvage reservation v0

Status: **EXPERIMENTAL / HOST AUTHORITY RUNG**

## Purpose

`verifiedLocalSalvage` proves that a bound, host-replayed LOCAL RTS checkpoint held a named amount of stored scrap. That proof is deliberately not spendable shared-world currency.

This rung adds an explicit **reservation** on top of that proof. A world account may reserve some currently verified salvage before a later transfer/debit contract exists. The reservation exists so the host can stop its current scrap-consuming LOCAL RTS action from also using value that has been set aside.

This is a continuity guard, not a currency system.

## Authority rules

A reservation is accepted only when all of the following are true:

- the participant is a world account;
- the participant still owns the named LOCAL RTS seat;
- the caller supplies the exact current host journal revision;
- a verified-salvage proof exists for that same seat;
- that proof matches the current host journal revision and state hash;
- the requested reservation is a positive bounded amount no greater than verified salvage that is not already reserved.

The host derives controller identity, seat ownership, journal state, proof state, and world hour. Human and machine accounts use the same path and arithmetic.

Reservation state is written through the existing world-account persistence adapter and restored when a new authority is constructed from that account store.

## Current double-use guard

The current host LOCAL RTS command surface contains one action that can spend stored scrap: `repair-core`.

While a seat has any verified salvage reserved, the world-session authority rejects host `repair-core` for that world account and seat before the command reaches the local journal. The journal revision therefore does not advance on the rejected repair.

Gathering remains allowed because it adds local salvage rather than consuming it. After the journal advances, any *new* reservation requires a refreshed verified-salvage proof for the new exact revision/state hash.

An explicit release removes the reservation. Once the reservation reaches zero, the current repair path can proceed again.

## Human / machine equal entry

Controller kind is retained for audit evidence only. It does not alter reservation arithmetic, source validation, persistence semantics, or the repair guard. Equivalent human and machine accounts are required to produce equivalent physical salvage and reservation amounts.

## What this is not

The reservation is **not escrow, transfer, debit, spend, shared-world credit, or currency**.

In v0:

- no LOCAL RTS scrap is removed when a reservation is created;
- no shared/global balance is credited;
- no other account receives value;
- no reservation can be spent;
- no browser-facing reservation control or HTTP reservation endpoint is added yet;
- browser-local simulation remains distinct from host-journal authority;
- account persistence and LOCAL RTS journal persistence remain separate files/surfaces rather than one atomic transaction;
- a crash spanning separate persistence writes is not claimed transactionally safe;
- only the **currently known host scrap-spending command**, `repair-core`, is guarded. Any future construction, transfer, crafting, destruction, trade, or other spend mechanic must consult this reservation or replace it with a stronger common debit authority before it can consume the same salvage;
- this does not establish secure authentication, distributed consensus, deployment readiness, performance, scale, economy balance, asset runtime quality, or visual quality.

## Why stop here

A direct jump from proof to currency would allow the project to describe value as transferred before a single atomic local-debit/global-credit contract exists. The reservation rung instead establishes a narrow invariant first:

> value explicitly set aside from a current verified LOCAL RTS checkpoint cannot also be consumed by the host's current repair path unless the reservation is explicitly released.

That invariant can be tested independently before a later lane exposes reservation to the player-facing world API and, after that, attempts a real debit/transfer transaction.
