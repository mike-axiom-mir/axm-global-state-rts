# Player-facing verified LOCAL RTS salvage reservation v0

Status: **EXPERIMENTAL / EXPLICIT HOST-AUTHORITY CONTROL**

## Purpose

This lane exposes the already-existing verified LOCAL RTS salvage reservation authority to a bound world-account participant. It does not create a new economy layer: the browser may request a reservation or an explicit release, while the host remains authoritative over identity, seat ownership, journal revision/state, verified salvage proof, controller kind, and world time.

The player-facing surface must make the distinction visible:

- **verified salvage** is persistent host evidence that a named LOCAL RTS checkpoint held stored scrap;
- **reserved salvage** is persistent account intent that currently blocks the known host scrap-spending `repair-core` path from consuming the same set-aside amount;
- **local storage is not debited by reservation**;
- **no shared/global balance is credited**;
- reservation is **not escrow, transfer, spend, currency, or atomic settlement**.

## Explicit control contract

A human or machine world account uses the same browser/API path. Nothing is reserved automatically.

A reserve request carries only:

- participant id from the bound seat;
- region seat id;
- the displayed host journal revision;
- the requested positive amount in milli-scrap.

The host re-reads all authoritative source state and rejects stale or incompatible requests. The browser never supplies the verified balance, controller identity, journal state hash, proof hash, or world hour as authority.

Release is also explicit. It reduces only the reservation record; it does not transfer or credit value elsewhere.

## Continuity and failure behavior

Reservation state continues to use the existing world-account persistence adapter. The UI reads the host summary after each accepted mutation instead of inventing a local balance. A stale host checkpoint/proof is rejected without automatic retry. A rejected request does not silently adopt another checkpoint or change browser-local simulation state.

The current double-use guard remains deliberately narrow: while any verified salvage is reserved for the seat, host `repair-core` is rejected before the LOCAL RTS journal mutates. Future scrap-consuming mechanics must use the same common debit authority or a stronger replacement before they can safely consume reserved value.

## Truth boundary

This surface proves only that a participant can explicitly operate the existing reservation ledger through the hosted world interface and see the resulting host-owned evidence. It does not prove atomic local-debit/global-credit settlement, distributed transactions, secure public authentication, production deployment, economy balance, target-device performance, or visual quality.

The next economic rung must not promote reservation into spendable value until one transaction contract can prove that the same physical scrap cannot remain available locally while also becoming global credit.
