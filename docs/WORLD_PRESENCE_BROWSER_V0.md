# World Presence Browser V0

Status: TEST / development-host seam

## Purpose

Expose the existing participant/account/world-time chest authority to the playable browser shell instead of leaving it reachable only through direct HTTP calls. This is a bounded UI/client seam; it does not redefine canonical world state or authentication.

## What this rung adds

- Guest and world-account entry from the same browser control surface.
- Human and machine controller kinds use the same server participant authority.
- Existing development world accounts can be rejoined by reading their participant id before attempting creation.
- World-hour/write-mode/account-store status is visible to the player.
- Current chest storage/opened counts are visible, with explicit accrue/open controls.
- A separate read-only world-presence bridge exposes the current browser view for browser evidence without changing the existing game-seat bridge.

## Root / truth boundary

- **Truth:** this is a development identity seam, not public authentication. Account ids have no ownership proof. Browser evidence must run against `AXM_SHARED_WRITE_MODE=dev`; write-off hosts remain visibly blocked.
- **Agency / non-domination:** guest entry remains available; account creation is optional. Human and machine participant kinds receive the same observation policy, command surface and 100-APM authority.
- **Continuity:** world-account chest state only survives host restart when an account persistence adapter is configured. Guests remain session-best-effort and are not silently promoted.
- **Wisdom before speed:** no TLS, password system, anti-Sybil layer, distributed database, public deployment or performance/scale claim is added here.

## Evidence gates

Source/deterministic:

- `node tests/world-entry-client-selftest.mjs`
- existing `npm test` / source syntax gate on the exact PR head
- syntax checks for the browser world-presence module and browser spec

Browser/controller:

- the existing Chromium controller suite remains required;
- `tests/browser/world-presence.spec.js` enters a machine guest, creates and rejoins a machine world account, checks world-time chest accrual, and reads the dedicated world-presence bridge.

The browser test does **not** claim hour-long chest accrual/open success because the real host clock is not advanced in Chromium. Positive multi-hour accrual/open behavior remains covered by the deterministic world HTTP authority selftest.
