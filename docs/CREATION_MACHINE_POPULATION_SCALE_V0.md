# Creation Machine population scale v0

Status: **descriptive browser evidence only**.

This gate answers a narrow question left open by the explicit checked-in workshop adoption path: what actually happens when the current verified Creation Machine `improvised-workshop / far` derivative is repeated at RTS-like population counts in the repository's real split-screen renderer?

## Matrix

The browser gate prepares the exact checked-in `improvised-workshop / far` source through `assets/creation-machine/prepare_runtime_glb.py`, verifies the generated GLB SHA-256 against its receipt, and renders these total workshop populations:

- 1, 10, and 100 total visible workshop copies;
- each population is distributed as evenly as possible across 1, 2, and 4 active LOCAL RTS split-screen scenes;
- all copies use the existing SHA-keyed decoded-template cache, so geometry/material/texture resources are shared by contract while object/transform wrappers remain instance-local.

The test uses the production `SplitScreenPlanetRenderer`, production local-region scenes, production checked-in static GLB decoder/cache, and the actual generated derivative from the verified Creation Machine transfer. It does **not** create simulation buildings or economy state: repeated copies are presentation-probe objects added only for this measurement.

For every scenario the retained JSON records source identity and SHA, source triangle/mesh/material/image counts, population allocation, cache deltas, WebGL draw-call/triangle counts, render wall-clock samples, requestAnimationFrame intervals, viewport, browser user agent, and WebGL renderer/vendor strings. The 100-copy cases also retain screenshots for 1-, 2-, and 4-player split layouts.

## Why this is separate from the existing LOD ladder

The repository already has a Universal Creation producer lane that can build lower-triangle workshop LOD tiers from a pinned external producer commit. This gate does not duplicate or replace that producer. It measures the **checked-in Creation Machine transfer currently exposed to the player-facing adoption path**, whose `far` derivative is generated from `assets/creation-machine` itself.

That distinction matters: a low-triangle tier existing somewhere else is not evidence that the asset actually offered by the checked-in adoption path is suitable for ordinary RTS population use.

## Truth boundary

A passing run means only that the exact checked-in derivative was decoded, instanced, presented through the real split renderer, and measured in the CI browser for the declared matrix without the gate's factual assertions failing.

A pass does **not** establish:

- target-device FPS, GPU residency, memory budget, thermal behavior, or production-scale performance acceptance;
- visual quality, perceptual equivalence, art-direction acceptance, tactical readability, or split-screen readability acceptance;
- collision, navigation, combat, balance, authoritative simulation, economy state, persistence, deployment, or secure authentication;
- that the current checked-in `far` derivative is a suitable ordinary-RTS LOD or should become the default presentation asset.

The timing values are intentionally descriptive. There is no FPS threshold and no attempt to turn a GitHub headless Chromium runner into target-hardware certification.

## Decision use

If the 100-copy matrix is expensive or unstable, the next safe rung is not to hide that result. It is to connect a genuinely lighter, provenance-preserving Creation Machine/Universal Creation tactical derivative to the same explicit adoption and cache path, then rerun this exact matrix. If the matrix is cheap in CI, target-device and visual/readability acceptance still remain separate gates.
