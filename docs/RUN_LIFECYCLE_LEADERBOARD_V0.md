# AXM Global State RTS — run lifecycle + leaderboard v0

Status: **EXPERIMENTAL IMPLEMENTATION CONTRACT**

This rung connects the already-existing civilization death invariant to the run boundary and preserves the deliberately tiny map-control advantage discussed for highscore play.

## A run ends only on actual civilization death

Going offline does not end a run.

Returning later means returning to the same still-live civilization, with the offline Guardian limited to its existing defend / repair / rebuild authority.

The run closes only after the civilization continuity system says it is dead: the final useful continuity-bearing building has been destroyed. Defenses, farms, mines, resource buildings and surviving units do not become hidden extra lives.

`RunLifecycleController` watches that authoritative continuity state. Once death is latched it closes the active `CivilizationRun`, clears match-only blueprint state through the existing progression path, banks final run gold, and optionally submits the immutable run record to a leaderboard.

Repeated lifecycle synchronization after closure is a no-op because there is no longer an active run. A player can begin a new drop only after this closure boundary.

## Peak control is a high-water mark

Leaderboard and payout logic uses the **highest global map-control percentage reached at any point during that run**, not current control when the civilization dies.

A run may expand and then collapse:

`0.02% -> 0.22% -> 0.31% -> 0.04% -> DEAD`

Its recorded peak is still **0.31%**.

This matters because the game is supposed to end in destruction eventually; using territory at death would erase the accomplishment the metric is meant to recognize.

## The bonus is literally tiny

The run multiplier remains:

`1 + peakGlobalControlPercent / 100`

Examples:

- `0.31%` peak control -> `x1.0031`
- `1.00%` peak control -> `x1.01`
- `5.00%` peak control -> `x1.05`

There is no reinterpretation where 1% control doubles a score. Controlling 1% of the full persistent globe is already an enormous accomplishment; its direct reward is intentionally only +1%.

## Highscore metrics

The v0 deterministic ledger supports several views rather than pretending one metric must describe every kind of strong run:

- **dominance** — enemy unit material destroyed × the tiny peak-control multiplier;
- **destruction** — enemy unit material destroyed, with peak control acting as the first tie-breaker;
- **peak control** — highest share of the complete globe held during the run;
- **final gold** — the actual closed-run gold payout after the existing 1% combat-gold rule and peak-control multiplier;
- **career dominance** — sum of run dominance scores for one player, allowing very small territorial edges to accumulate through consistently strong runs.

For two players who both destroy `1,000,000` material:

- player A at `0.31%` peak -> dominance `1,003,100`;
- player B at `0.22%` peak -> dominance `1,002,200`.

That 900-point difference is intentionally small. At ordinary play it is nearly irrelevant; at the top of a global highscore table it can separate otherwise similar runs.

## Append-once run evidence

A `runId` may be submitted only once to the v0 leaderboard ledger.

A second submission with the same ID cannot rewrite the original player, destruction value, map-control peak or final gold. This is not a complete anti-cheat system, but it prevents the in-memory scoring layer itself from silently mutating an already-recorded run.

## Death / next-drop relationship

Closing a run does not start another automatically.

It creates the clean boundary where future-drop systems may use persistent progression such as banked gold, hourly caches, permanent blueprints and—later—mercenary contracts. The next civilization still has to be explicitly dropped into the world.

## Truth boundary

This rung is a deterministic in-memory simulation ledger and lifecycle contract. It does **not** yet claim:

- a real global server leaderboard;
- account persistence;
- signed receipts or anti-cheat verification;
- seasons / resets / historical archive policy;
- networking or conflict resolution;
- public profile pages;
- matchmaking;
- final ranking weights or UI;
- automatic persistence across browser/server restarts.

The invariant established here is smaller: **offline is not death; continuity death closes exactly one run; the run remembers its highest map-control percentage; and that percentage remains the tiny literal scoring edge it was designed to be.**
