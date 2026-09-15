# Aggregate city world-hour catch-up — bounded implementation evidence

Status: **EXPERIMENTAL / TEST**

This lane implements the smallest bounded proof spun out of research PR #142. It does **not** claim that the whole persistent world now advances offline.

## What exists

- One existing deterministic aggregate city can be anchored to a canonical host world-hour index.
- A host-side catch-up authority advances that city through exact one-hour logical boundaries when authoritative world time moves forward.
- Each accepted catch-up is appended to the existing hash-chained journal-store contract with prior/result city hashes and the exact world-hour interval.
- Restart replays from deterministic city genesis through every accepted catch-up and requires the stored city snapshot/hash to match the independently reproduced result.
- Repeating the same target hour is idempotent; moving time backward fails closed.
- One catch-up commit is bounded to a configured maximum number of hours and rejects an oversized interval before partial advancement.
- The authority has no participant/controller-kind input. Human, machine, or absent observers therefore cannot receive different physical time rules through this seam.

## Why hourly boundaries instead of one closed-form jump

`AggregateCity.advance()` currently contains starvation pressure, readiness, repair, and integer defense-training thresholds whose results can depend on transition granularity. This proof therefore does **not** pretend a many-hour arithmetic jump is equivalent. It resolves deterministic one-hour boundaries in order until a separately proven closed-form rule exists.

## Evidence scope

The focused selftest covers:

- durable genesis anchoring;
- host world-clock -> catch-up mapping;
- exact equality with an active hourly reference;
- same-target idempotence;
- backward-time rejection;
- file-backed restart/replay;
- continuation after restart;
- human/machine semantic parity through actor-independent physics;
- bounded-window rejection without partial mutation;
- persisted-state tamper rejection;
- world-seed mismatch rejection.

The dedicated PR workflow also runs the full deterministic/source suite and existing real-Chromium world-entry + controller/machine-seat regressions. Those browser tests are regression evidence only; the new catch-up authority is not yet exposed to the browser or world-session HTTP surface.

## Truth boundary / next rung

Not implemented or claimed here:

- whole-globe offline advancement;
- automatic scheduled host maintenance;
- city-vs-city decisions, raids, asteroid materialization, strategic convoy arrival, or other external event journals during catch-up;
- browser/player authority over world time;
- persistent shared-world API exposure for this city catch-up seam;
- efficient checkpoint compaction for arbitrarily long offline periods;
- concurrent/multi-host serialization;
- deployment, scale, target-device performance, balance, or visual-quality evidence.

The next safe rung is to bind this authority to one real hosted city state/read surface and introduce an ordered external-event boundary contract before broadening beyond autonomous city economy/repair/training transitions.
