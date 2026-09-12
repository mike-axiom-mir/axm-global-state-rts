# AXM Global State RTS — Post-apocalyptic art direction correction

Status: **EXPERIMENTAL ART DIRECTION v0.2**

## Why this correction exists

The first generated Crew/building batch is technically useful and readable, but its visual language is too clean and coordinated to communicate the intended post-apocalyptic world strongly enough.

The current batch reads closer to a low-poly frontier / worker settlement: intact wall panels, coordinated beige/green palettes, tidy roof lines, repeated trim language and relatively uniform Crew clothing. That is a usable geometry/style baseline, but it is **not yet the target apocalypse language**.

Do not throw the batch away. Treat it as a clean base layer that can be dirtied, broken, patched, mixed and scavenged.

## Target feeling

The world should look like people are rebuilding civilization from whatever survived.

Not generic fantasy ruins. Not glossy sci-fi. Not costume-heavy "Mad Max" parody everywhere.

The visual question for almost every object should be:

> What did this used to be, what broke, what was scavenged, and how did survivors make it useful again?

## Core visual rules

1. **Mismatched construction**
   - roofs, walls, doors and braces should often come from visibly different source materials;
   - avoid one clean factory kit repeated everywhere;
   - use steel sheet, timber, concrete, old vehicle panels, tarps, glass, brick and appliance parts in believable combinations.

2. **Visible repair history**
   - welded patch plates;
   - replacement boards;
   - bent or reused framing;
   - bolted braces;
   - crude sealant/tape/cable ties where appropriate;
   - repaired corners and patched roof sections.

3. **Asymmetry over tidy modular symmetry**
   - one side reinforced more than the other;
   - doors/windows moved or blocked;
   - added lean-tos, pipes, tanks, awnings, ladders, cable runs and improvised external storage;
   - silhouettes should feel assembled over time.

4. **Old-world fragments remain visible**
   - faded signage fragments;
   - cut-down road signs;
   - old industrial panels;
   - repurposed shop shutters;
   - vehicle bodywork;
   - appliance panels;
   - broken concrete/brick foundations under newer scrap construction.

5. **Wear without unreadable grime**
   - dust, soot, rust, sun bleaching, chipped paint, water streaks and repaired paint zones;
   - keep top-down silhouette and team/readability clean enough for RTS scale;
   - do not turn every asset into dark brown noise.

6. **Crew should look adapted, not uniform**
   - patched layered clothing;
   - mismatched boots/gloves/knee protection;
   - tool belts, scavenged pouches, radios, masks, goggles, old workwear and sports/industrial protection;
   - role kits should attach to the same shared base skeleton but introduce stronger scavenged identity.

7. **Comedy belongs inside the same material logic**
   - comic-book walls, fridge barricades, bathtub turret cradles and similar pieces work because survivors genuinely used them as available material;
   - funny objects should still look structurally plausible in-world.

## Building language

A continuity building should feel like a real place people kept alive for months or years:

- mixed wall materials;
- at least one obvious repair or retrofit story;
- external utility pieces such as cable, pipe, tank, battery, antenna, water collector, vent or improvised light;
- one stronger silhouette feature visible from RTS distance;
- no requirement for every wall/roof panel to be damaged.

The settlement should feel **maintained after collapse**, not freshly manufactured after collapse.

## Crew language

Crew are small on screen, so apocalypse detail must survive at silhouette level:

- uneven shoulder/backpack shapes;
- different headgear and protective shapes;
- rolled sleeves / layered jackets / belts / pouches;
- one or two strong scavenged-role cues per specialization;
- weapons/tools may have wrapped grips, improvised stocks, replacement parts or taped repairs.

Avoid spending geometry on facial detail that disappears at gameplay scale.

## Material palette

Preferred base mix:

- faded painted metal;
- oxidized/rusted steel accents;
- reclaimed wood;
- cracked concrete and brick foundations;
- dirty glass/poly-sheet;
- rubber and tarp/canvas;
- occasional surviving original paint/sign color as contrast.

Use more material contrast and less coordinated faction-like palette on neutral world assets.

## First batch disposition

The uploaded `axm-rts-crew-buildings-v01` batch should be treated as:

**CREATED · STYLE REVIEW: REVISE**

Useful qualities to preserve:

- compact geometry;
- strong basic silhouettes;
- shared Crew base + modular role kits;
- LOD availability;
- readable building categories;
- simple browser-friendly forms.

Needed before acceptance:

- stronger material mismatch;
- more visible salvage/repair history;
- less clean coordinated architecture;
- stronger apocalypse silhouette cues on Crew kits;
- more old-world reuse and external utility details.

Do not mark the current batch `ACCEPTED` yet.

## Creation Machine correction prompt

When revising or generating the next batch, preserve the current low-cost geometry discipline but push every asset through this question:

> Make this look like a functioning object maintained by survivors after long collapse, using visibly scavenged, mismatched and repaired materials, while keeping a clean RTS silhouette and browser-scale performance.

The target is **simple geometry + rich history**, not simple geometry + clean construction.
