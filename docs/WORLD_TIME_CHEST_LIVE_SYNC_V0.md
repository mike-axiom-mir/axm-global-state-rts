# World-time chest live sync v0

Status: **EXPERIMENTAL / PLAYER-FACING HOST-TIME ACCOUNTING RUNG**

## Purpose

World entry already asks the host to account hourly chests when a participant enters or manually presses the chest-clock refresh control. This rung closes the smaller continuity gap where a participant could leave the world-entry page open across a host world-hour boundary and keep seeing an older accounted-through hour until manually refreshing.

While the entry page is open, the browser now reads the host-provided `msUntilNextHour` snapshot and schedules a chest-accounting check just after that boundary. The check calls the existing host `chests/accrue` authority, re-reads the participant, then refreshes host world metadata and schedules the next check.

## Authority boundary

The browser timer is **not** world-time authority and does not mint a chest. It only decides when to ask the host to account time again.

The host remains authoritative for:

- the canonical world-hour index;
- the participant's accounted-through world hour;
- how many elapsed hourly chests can be added;
- the 24-chest storage cap and any elapsed chests discarded beyond that cap.

A delayed or slightly early browser callback therefore cannot create an extra reward. The host can return `+0`, and the client then refreshes the host snapshot and reschedules.

## Agency boundary

Automatic boundary handling performs **accounting only**. It never calls the chest-open route and never spends or converts a stored chest. Opening remains an explicit participant action.

Human and machine participants use the same browser-entry controls and the same host accounting endpoint. There is no controller-kind-specific reward path.

## Continuity boundary

This is page-open convenience, not a background service. If the page is closed, suspended, offline, or the timer is delayed, no browser-side background claim is made. The existing entry-time host accrual remains the continuity mechanism: the next valid entry/accounting request catches up from the host's persisted participant anchor.

If an automatic boundary check fails, the UI reports the failure and retains the manual refresh path rather than claiming the account is current.

## Non-claims

This rung does not establish secure authentication, distributed persistence, exact browser timer timing, background execution while the page is closed, deployment readiness, latency/performance targets, economy balance, visual-quality acceptance, or any promotion of LOCAL RTS scrap into shared/global economy state.
