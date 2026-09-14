# World-time chest next-drop cache v0

Status: **EXPERIMENTAL / DURABLE NEXT-DROP VALUE RUNG**

## Why this exists

The game foundation says hourly drop boxes accumulate for the **next drop** and influence starting options/items. Before this rung, opening a chest decremented the stored chest count and returned deterministic contents to the caller, but the world-account snapshot retained only the opened serial/count. A process restart could therefore remember that the chest had been consumed without retaining the food, scrap, item, or blueprint-option value that opening revealed.

This rung closes that loss seam without pretending the run-death/new-drop lifecycle is finished.

## Authority and persistence

`HourlyDropCache` now keeps a bounded `pendingNextDropRewards` aggregate alongside stored/opened chest counters:

- total next-drop food;
- total next-drop scrap;
- counts for the fixed starting-item vocabulary;
- unique known blueprint option IDs;
- number of opened chests represented by the aggregate.

Opening a chest adds its deterministic contents to that aggregate before the host persists the world-account snapshot. Reconstructing `WorldSessionAuthority` from the same account file restores the aggregate. Older account snapshots without the field restore an empty next-drop cache rather than inventing value.

The aggregate is intentionally bounded by fixed item types and the blueprint catalog rather than storing an ever-growing per-chest history. The existing deterministic opened serial remains the provenance input for chest contents.

## Player-facing meaning

World entry now labels the action **Open 1 for next drop** and shows the retained aggregate after entry/re-entry. A successful open states the exact deterministic chest contents and says that current LOCAL RTS resources are unchanged. A rejected open no longer says a chest was opened.

This is setup value held for a future drop. It is not current civilization food, current LOCAL RTS scrap, global salvage currency, or a blueprint unlock in the current run merely because it appears in the pending cache.

## Human / machine equality

Human and machine world accounts use the same chest accrual, open, aggregate, persistence, and browser API paths. A parity test uses the same world-account seed under isolated human and machine authorities and requires identical chest contents and aggregate results.

## Continuity and failure boundaries

World-account persistence is only as durable as the configured account store. Guest next-drop value remains session-best-effort, matching existing guest chest semantics.

This rung does **not** yet consume/apply the pending aggregate into a newly spawned civilization. The rule that a new drop occurs only after the current civilization is dead still needs a canonical run-lifecycle bridge before these values can become starting resources/options. Until that bridge exists, the correct behavior is to retain the value without silently applying it anywhere.

There is no distributed-transaction, multi-host concurrency, secure-authentication, deployment, performance, balance, or visual-quality claim here. This change also does not modify the separate verified-salvage/global-credit settlement lane.

## Evidence target

The dedicated gate requires:

1. full repository deterministic/source tests;
2. a deterministic selftest proving open → account-file persistence → authority restart → exact aggregate restoration, plus human/machine parity and tamper rejection for unknown item/blueprint IDs;
3. real Chromium using a pre-seeded durable world account to explicitly open one chest, show the retained next-drop value, re-enter the account, and prove that a rejected second open does not mutate the aggregate.
