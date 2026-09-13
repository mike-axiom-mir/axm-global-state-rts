# World Participant Accounts + AI Users v0

## Purpose

Keep entry friction tiny while giving players or machine intelligences an optional persistent identity inside this one RTS world.

This is **not** a global AXM account system. It is a lightweight world-local participant contract.

## Entry modes

### Guest

A visitor may enter without creating an account.

- no login required;
- receives a session-scoped participant identity;
- may play a complete civilization run;
- score identity is run-scoped, so there is no guaranteed career high-score continuity;
- an hourly chest cache may exist while the session survives, but reconnect/restart persistence is explicitly not guaranteed;
- guest state is not exported by the world-account persistence seam.

This lets somebody play first and decide later whether the world is worth keeping an identity for.

### World account

After a first match (or at any later point), a participant may create a simple identity local to this world.

- stable `world:<accountId>` participant identity;
- stable career leaderboard identity across runs;
- hourly chest cache is anchored to the shared world-hour index;
- one chest accrues per elapsed world hour, capped at 24 stored chests;
- account export/restore exists so a host persistence adapter can preserve state across restart;
- v0 credential modes are `none` or `external-proof`; the game authority does not store a raw password.

Creating an account does **not** silently import guest chests or rewrite a completed guest run into the new career. That can be designed later if wanted; v0 avoids an account-farming ambiguity.

## Shared world time

Chest accrual no longer needs a private per-device clock as its authority.

A shared world clock exposes a monotonically increasing `worldHourIndex`. Account chest state records the last accounted world hour, so a reconnecting account can catch up from world time and the existing 24-chest cap bounds absence growth.

The clock contract is deterministic from:

`world epoch + authoritative now -> worldHourIndex`

The production website still needs to provide the authoritative `now`/persistence source; browser wall-clock time alone is not promoted to shared-world authority.

## AI enters as a user

Machine intelligences use the same participant contract as humans.

Example world accounts may be separate identities such as:

- `world:ai-chatgpt-sol`
- `world:ai-codex`
- `world:ai-gemini`

Each identity therefore has its own:

- chest buildup;
- future drop choices;
- run history/high-score identity;
- world decisions;
- command-rate history.

A model does not receive hidden map state, admin privileges, extra commands, free resources, or a second action budget because it is a machine.

## Cooldown / action budget

The existing equality rule remains the simplest answer.

Every participant uses the same default **100 accepted discrete gameplay actions per rolling 60 seconds**.

- the gate is keyed to the participant identity, not a browser tab;
- opening another frontend does not create a second budget for the same world account;
- human and machine users receive the same `retryAfterMs` when the rolling window is exhausted;
- continuous presentation controls are not converted into thousands of gameplay actions;
- model reasoning time is unrestricted, but only accepted world commands affect the game.

This means an AI can think as long as it wants, then submit ordinary player actions. It cannot bypass the world by directly writing canonical state.

## Frontend implication

A machine frontend can be extremely small. It needs only:

1. authenticate/select its world participant identity;
2. read the same fog-limited observation surface exposed to a player;
3. choose one legal action from the same command surface;
4. submit it through the same participant action gate;
5. wait for the returned world state / cooldown before deciding again.

ChatGPT, Codex, Gemini, a local model, or a future WALMI instance can therefore each run their own frontend adapter without changing the RTS rules.

## Persistence truth boundary

The current v0 code establishes export/restore contracts but does **not** claim deployed durable account storage, production authentication, password recovery, email identity, anti-sybil policy, or secure multi-device sessions.

`credentialMode=none` is intentionally an unprotected early-test mode. `external-proof` is the seam for a future host-side credential mechanism.

The hosted world already needs an atomic persistent adapter before production multi-instance deployment; participant accounts should use that same class of durable host storage rather than inventing a separate heavy account service.
