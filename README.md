# AXM Persistent World RPG

Status: **EXPERIMENTAL — CLEAN RPG RESTART**

This branch began as a copy of `axm-global-state-rts` because that project already had useful Foundation Planet, state, website, spatial, input and persistence machinery.

The active RTS game and presentation layer has now been removed from this branch.

## Active rule

**Players are temporary. The world and its cities inherit what players safely leave behind.**

A life may gain temporary XP and carry items. Safe departure can transfer those into a shared city. Death does not magically bank them. Cities keep domain XP, shared inventory, overall rank and retained development-path XP.

Current city directions:

- balanced
- frontier
- forge
- harvest
- defense
- trade
- lore

Changing direction affects future contributions. Previous path progress is retained rather than erased.

## Clean visual boundary

The active browser surface now consists only of:

- `game/index.html`
- `game/rpg-world.css`
- `game/rpg-world.mjs`

The RPG renderer is new:

- `src/rpg/presentation/rpg-renderer.mjs`
- `src/rpg/world/rpg-region.mjs`
- `src/rpg/world/rpg-foundation-sampler.mjs`

It samples the existing Foundation Planet directly. It does **not** load the donor RTS renderer, RTS local scene, Crew, buildings, combat presentation, strategic overlays, Creation Machine RTS asset adoption, or post-apocalyptic style.

## Capabilities deliberately retained underneath

The branch still retains reusable donor infrastructure while capability extraction continues:

- pinned Foundation Planet submodule;
- global globe sampling;
- local/global spatial-frame conversion;
- hosted hash-chained world journal;
- world participants and equal human/machine action admission;
- browser/host API seams;
- deterministic RPG world replay;
- persistent city inheritance;
- existing server/bootstrap machinery.

Dormant donor source under older `src/` areas remains available as rollback/reference until each useful capability is either adopted into the RPG namespace or proven unnecessary. It is not part of the active RPG browser path.

## Run

```bash
git clone --recurse-submodules https://github.com/mike-axiom-mir/axm-global-state-rts.git
git checkout game/persistent-rpg-world-20260920
npm start
```

Open:

```
http://127.0.0.1:4174/game/
```

## Verify

```bash
npm test
```

The branch-specific gates verify:

- world progression without account-power progression;
- safe-departure city XP/item inheritance;
- retained city path progress;
- deterministic hosted hash-journal replay;
- human/machine participant parity;
- spatial-frame capability;
- active browser boundary contains no RTS game/presentation files;
- syntax of the clean RPG renderer and host seams.

## Truth boundary

This is a clean architectural restart, not a finished RPG.

The globe and local Foundation surface are real rendered inputs from the existing planet model. The local RPG terrain renderer is intentionally simple and new. NPC ecology, individual character movement/animation, final city visuals, combat, quests, economy, multiplayer synchronization, world-scale local streaming, final materials and visual acceptance remain future work.
