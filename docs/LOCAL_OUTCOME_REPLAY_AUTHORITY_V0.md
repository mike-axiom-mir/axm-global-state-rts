# Host-reproducible local RTS outcome replay authority v0

Status: **EXPERIMENTAL / VERIFICATION RUNG ONLY**

## Why this exists

The current browser-local RTS can gather scrap, explore, repair the core, move Crew, deplete resources, and change local storage, but those numbers are intentionally not shared-world truth. Forwarding a browser snapshot directly into persistent state would let an untrusted client author canonical economic or combat outcomes.

This rung adds the smallest host-side alternative: the host can reconstruct a fresh deterministic starter-region simulation from trusted context, admit one bounded macro intent, advance an explicit number of fixed simulation steps, and hash the host-reproduced canonical result. A claimed outcome digest is accepted as verified only when it matches that independently reproduced result.

No shared-world mutation is performed by this module.

## Trust split

The client-side intent is deliberately narrow and must contain exactly:

- `actionId` (`gather-scrap`, `explore`, or `repair-core`);
- `cursorXM`;
- `cursorZM`;
- `stepCount`, capped at 2,400 fixed 250 ms steps.

Identity, controller kind, local region seat, and world hour are **not** accepted from the intent. They are separate host context. This prevents the receipt format from quietly making a client-provided participant id or clock authoritative.

The replay creates the local simulation with the host-provided world hour's day/night phase from the start rather than first constructing a default-day simulation and changing it afterward.

## Equal-entry contract

Human and machine participants use the same physical replay kernel. Controller kind and participant identity are retained in an `admissionDigest`, while the physical intent digest and reproduced outcome digest are independent of whether the bound participant is human or machine. Same physical intent + same trusted physical context therefore reproduces the same physical result.

## Evidence shape

A successful replay returns:

- a physical-intent SHA-256 digest over the normalized intent plus trusted region/world-time context;
- an admission digest that additionally binds the host-resolved participant;
- an outcome digest over the physical intent digest and the full host-reproduced canonical local snapshot;
- a bounded player-readable outcome summary;
- explicit `verification-only-no-shared-world-mutation` persistence status.

`verifyClaimedLocalOutcome(...)` recomputes the replay and compares the claimed digest against the host result. A forged digest is reported as a mismatch; it does not replace the host result.

## Truth boundary

This does **not** prove that the currently running browser simulation had the same prior state. The replay starts from the deterministic starter-region baseline. It does not yet replay an ongoing host checkpoint, a complete command journal, weather gameplay effects, Creation Machine collision state beyond what the starter simulation already owns, or network latency/timing.

It also does **not** persist scrap, Crew positions, resources, core integrity, exploration knowledge, combat results, or any other local result into the hosted journal. The next safe persistence rung needs a host-owned checkpoint/journal chain (or another equally reproducible prior-state contract) before an ongoing local outcome can mutate shared world state.

No runtime performance, deployment, secure public authentication, multiplayer scale, balance, or visual-quality claim is made by this verifier.

## Merge evidence required

1. full repository deterministic/source suite (`npm test`);
2. syntax check for the replay authority and its selftest;
3. `tests/local-outcome-replay-authority-selftest.mjs`, including deterministic repeat, human/machine physical parity, forged-digest rejection, host-world-hour binding, and client-identity-field rejection;
4. four-root review: Truth, Agency/non-domination, Continuity, Wisdom before speed.

Browser/controller runtime is not changed by this rung, so a passing verifier workflow is not evidence that Chromium/controller behavior changed or was newly exercised.
