# Local RTS → persistent world seam v0

Status: **EXPERIMENTAL, NARROWLY VERIFIED SURFACE**

This rung deliberately persists one physical-world action only: a participant already bound to a local RTS seat may submit the current local cursor coordinate as the existing hosted `territory.claim` event. The local cursor is converted through that seat's deterministic Foundation Planet starter-region frame, so the hosted latitude/longitude comes from the same physical world coordinate system used by the local terrain shell.

## Why this is the first seam

The host already owns deterministic journal admission, optimistic revision checks, participant rate limits, replay/hash verification, and actor binding for `territory.claim`. Reusing that authority creates real local-gameplay → persistent-world continuity without pretending the browser-local Crew simulation is server-authoritative.

The client claim intent contains latitude/longitude only. It does not assert `ownerId`; the host binds ownership to the registered participant. Human and machine participants use the same bound-seat world command surface.

## Truth boundary

This does **not** make local `gather-scrap`, `explore`, `repair-core`, storage scrap, Crew positions, resource depletion, or core integrity persistent. Those remain browser-local simulation state because the host does not yet own or independently verify those outcomes. Promoting those numbers directly from a client snapshot would turn a client assertion into authoritative world truth and is intentionally not done here.

A successful cursor claim proves only that the development host accepted the mapped coordinate through the existing participant `territory.claim` authority. It is not evidence of secure public authentication, distributed persistence, deployment, scale/performance, balance, or visual quality.

## Player-facing behavior

A shared-world participant must be revalidated and bound to the seat, and the seat must be in `LOCAL RTS` mode. Seat 1 exposes an explicit **Persist cursor claim** control; human seat 1 can also press `C`. The machine-facing browser surface exposes the same claim operation through `window.__AXM_PERSISTENT_WORLD__.claimSeatCursor(...)`. The UI reports whether the hosted authority accepted or rejected the claim and keeps the last returned evidence for inspection.

## Next activation

The next persistence seam should not simply forward browser-local resource deltas. Either move a small deterministic local outcome under host authority, or define a verifiable receipt/replay contract that lets the host reproduce the outcome before it mutates shared world state. Until then, local economic/combat outcomes remain local-only.
