# PLAN_PROGRESS_24 — M2/E3+E4+C6: layer-stack compiler, projections, post-FX

**Date:** 2026-07-15
**Chunks worked:** E3 (layer-stack compiler), E4 (projections), C6 (post-FX stack)
**Milestone context:** M2 in progress (user-authorized through the milestone).
E1, E2, E5, E3, E4, C6 done; A5 is the last M2 chunk. C6's "user custom shader
effects" was **deferred to 1.x by user decision** at this boundary (see
Decisions). E6 bake deferred out of M2.

## Completed

### E3 — layer-stack compiler (`21943aa`, `21b36b9`)

`ProceduralMaterialDoc` → one TSL node per channel. **The acceptance criterion is
the architecture, not something bolted on after it:**

- `structureKey(doc)` (`types/core/procedural.ts`) fingerprints only what changes
  the SHAPE of the graph — layer identity/order/source/blend/projection, and
  whether a ramp exists. Params, colors, opacity, transform and ramp stop values
  are deliberately absent, because they're uniforms or texture data.
- `CompiledStacks.applies(doc)` compares keys → `update()` pokes uniforms, or the
  caller recompiles. `compile()` increments a counter, so the test asserts the
  real, observable thing rather than a proxy.
- `UniformTable` addresses every tunable by `<layerId>/<field>` path.
- Ramps bake to a 256×1 RGBA DataTexture **rewritten in place** — a stop edit
  changes pixels, never the graph.

**MaterialSync gains the third branch** the chunk needs: param-only → poke;
structural → build a replacement material, `compileAsync`-warm its pipeline, swap
only when ready (the outgoing material keeps drawing → no hitch). A `swapToken`
guards rapid edits so a stale warm can't clobber a newer material.

Two collisions the exploration predicted, both real and both handled:

- **`colorNode` was already owned by `resolvePlanar`.** A procedural color now
  COMPOSES as the base the mirror mixes over. Its rebuild check also gained the
  structure key — a structural stack edit changes neither type nor material id,
  so without it the planar variant went stale.
- **Thumbnails run on their own device** and were showing the scalar material
  while the viewport showed layers. Both now bind through one
  `render/scene-sync/proceduralBind.ts`.

`NoiseDef` gained `sample(pos, params, phase)` taking **nodes** — that's what lets
params bind to uniforms. The gallery's number previews go through `previewNode()`.

**Verified against the running app, not only unit tests:** 12 param edits held the
compile counter at 1; a source swap took it to 2 and re-shaded correctly; the
material round-trips through autosave (so the DTO serializes).

### E4 — projections (`2056672`)

uv / flat / triplanar / cylindrical / spherical / camera. Additive in
`projections.ts` + the compiler, exactly as intended by designing the layer once.

- **The contract changed shape:** `projectedSample(projection, t, noise)` takes the
  noise as a CALLBACK. Triplanar isn't one coordinate — it's three axis-aligned
  samples blended by the normal, so it must invoke the noise 3×. Returning a bare
  coord makes it inexpressible.
- **Angular projections scale the ANGLE, not the position.** Dividing position
  first barely moves an angle, so their scale control would read as inert.

### C6 — post-FX stack (`7bbbefb`, `6a763d9`)

- **`composeOutput()` extracted FIRST, before adding anything.** The
  `renderOutput` + dither tail was duplicated byte-for-byte in `rebuild()` and
  `buildTemporalSsr()` — an effect added to one would silently not apply in the
  other's SSR mode. Both modes now end in one place.
- Bloom (HDR domain, before tone mapping — it thresholds on luminance, which tone
  mapping squashes toward 1), chromatic aberration + vignette (display domain
  lens artifacts). Dither stays absolutely last.
- **AO setter shape, not SSR's:** every continuous param is a live uniform, so
  only an on/off toggle rebuilds. Bloom's threshold included — BloomNode promotes
  a plain number to a uniform and exposes it.
- **Post tab (the user's explicit ask):** Ambient Shadows + Reflections moved in
  alongside the new effects; section order mirrors the pipeline order. Tone Map
  stays on View — it's the output transform, not a stacked effect. The modal was
  at 463/500 lines, so it split into `viewSettings/` (chrome 98, tabs 343 + 114,
  widgets 97).

### Also: dropped E2's `LATTICE_BIAS = 4096`

Hashing in int space (Teschner) fixes the negative-seed clamp with no coordinate
bound. Verified on GPU at −9000, past the old limit. The **real** remaining limit
is f32 precision in the coordinate (~100k; measured degenerate at 500k), which is
inherent to sampling a float position and applies to every noise, not just value.

## Left mid-flight

Nothing. C6 closes here on the fixed stack + reorg (custom shaders deferred).

## Decisions made (and why)

- **The layer type was designed once, ahead of its consumers.** `projection` and
  `ramp` shipped in E3 though E3 only implemented uv/flat. E4 then touched one
  file instead of migrating the compiler, DTO, serialization and thumbnails.
- **E3 was gated on the compiler + instrumented test + a real render, not on a
  layer-stack editor GUI.** The "done when" is compile behavior, provable
  programmatically; the editor UI is separable (as the E2 gallery was) and is not
  yet built — **procedural materials currently have no UI**, only the DTO.
- **`flat` drops the third axis.** It was passing the full 3D position, which made
  it a _solid_ projection that never streaked — and made triplanar nearly
  indistinguishable from it. A real planar projection streaks along its axis, and
  that artifact is precisely what triplanar exists to fix. The cube caught this;
  the sphere thumbnails alone did not.
- **Post-FX effect order is fixed, not user-reorderable.** PLAN.md says "ordered
  per-render-settings stack". The order here is pinned by the tone-map boundary
  (bloom must precede it, lens effects must follow), so the useful degrees of
  freedom are on/off + params, which is what shipped. Revisit if custom shaders
  land, where ordering becomes meaningful.
- **Vignette is ours; bloom + CA are three's.** three ships no standalone vignette
  node (only one inside CRT.js), and a radial multiply needs no resampling.
- **C6's "user custom shader effects" (TSL/GLSL snippet + declared uniforms,
  animatable) deferred to 1.x — user decision, surfaced at the chunk boundary.**
  The fixed stack + the Post tab reorg were built as the spine first; custom
  shaders are a large sub-feature (user code compiled at runtime, declared
  uniforms, failure handling that must not brick the viewport). PLAN.md's C6 line
  is updated so this reads as an explicit deferral, not a silent drop. Layer
  ordering becomes meaningful if/when they land.

## Files added / changed

- `src/types/core/procedural.ts` — new; the whole layer-stack DTO + `structureKey`.
- `src/types/core/material.ts` — `MaterialDTO.procedural?`.
- `src/materials/procedural/{compile,blend,ramp,projections,uniforms,index}.ts` —
  new; the compiler. Tests: `compile.test.ts`, `ramp.test.ts`, `projections.test.ts`.
- `src/materials/noises/registry.ts` — `NoiseDef.sample` (nodes) + `previewNode`.
- `src/materials/noises/functions.ts` — int-space value-noise hash.
- `src/materials/tsl.ts` — blend/projection/post primitives.
- `src/render/scene-sync/proceduralBind.ts` — new; the one place nodes bind to slots.
- `src/render/scene-sync/MaterialSync.ts` — three-way classification + warm/swap.
- `src/render/scene-sync/SceneSynchronizer.ts` — `setMaterialWarm` + `warmProbe`.
- `src/render/thumbnails/materialThumbnails.ts` — compiles stacks on its own device.
- `src/render/viewport/postEffects.ts` — new; the C6 stack.
- `src/render/viewport/ditherOutput.ts` — `composeOutput()` + `setPostFx`.
- `src/render/viewport/ViewportSystem.ts` — warm hook + `setPostFx` call.
- `src/types/editor.ts` — 9 post-FX fields on `PaneDisplay`.
- `src/ui/panels/ViewSettingsModal.tsx` + `src/ui/panels/viewSettings/*` — tabs.

## Test status

- `tsc -b`: clean. (`vp check`/`vp lint` still **hang on tsgolint** — `tsc -b` +
  `vp test` are the gates; commit `--no-verify`. Unchanged since PROGRESS_22.)
- `vp test`: **197 passed / 32 files**, 0 failed.
- Browser (MCP): procedural material renders + live-updates + swaps; all six
  projections on a sphere; flat-vs-triplanar on a cube; bloom/CA/vignette each
  verified on; Post tab drives the renderer; bloom persists across reload;
  fresh-tab console clean on the default path.
- **Post-FX verified in the High-SSR (temporal) path too** — that's the whole
  point of extracting `composeOutput`, and the temporal tail is the one that was
  rewritten. Bloom + vignette + High SSR compose correctly together. That check
  is what surfaced the depth-copy bug below (pre-existing, now fixed); the
  console is clean there now, across Fast→High, High→Fast, resize and idle.

## Known issues

- **FIXED during this session: the High-SSR depth-copy sample-count mismatch.**
  Found while verifying post-FX in the High-SSR path, and fixed — see the note
  below for how the first diagnosis was wrong.

  ```
  Source [Texture "depth"] sample count (4) and destination ... sample count (1)
  does not match. — CopyTextureToTexture / TemporalReprojectNode
  ```

  **Cause:** the gen-1 (Fast) SSR branch built its pass as
  `pass(scene, camera)` with no options, so it inherited `renderer.samples` (4).
  It was the ONLY multisampled target in the app — the baseline `hdr` target and
  the temporal pass are both single-sample — and its depth texture is also named
  `"depth"`. On a Fast→High graph swap it outlived the switch just long enough to
  be the source of `TemporalReprojectNode`'s first depth copy, which WebGPU
  rejected. **Fix:** `{ samples: 0 }` on that pass too, which is also simply
  consistent with the rest of the pipeline. Beauty AA is unaffected — the
  baseline was never multisampled either.

  **Correcting the first diagnosis (recorded because the error was instructive):**
  it was initially logged here as failing _every frame_, with the reprojection
  "running blind". That was wrong, and it was wrong because the browser console
  buffer accumulates across reloads — the errors looked continuous. Instrumenting
  `console.error` around specific actions showed the truth: **exactly one error,
  only on a Fast→High switch**; zero on High→Fast, zero on resize, zero across
  repeated fresh renders. The impact was one dropped history-depth copy on the
  first frame of a ~40-frame convergence, not a blind denoiser. Confirmed
  pre-existing regardless (reproduced at `a4e9685` in a clean worktree). Lesson
  for the next session: a console buffer is not a timeline — hook `console.error`
  around the action to attribute an error to it.

- **Procedural materials have no editor UI.** The DTO, compiler and render path
  are complete and proven, but a user can only author a stack via the document
  API. The layer-stack editor is unbuilt (it is not in E3's "done when", but it
  IS what makes the feature usable).
- **No rendered-output regression guard** (carried from E2, and it bit here):
  three validates component counts only at WGSL generation, so a ramp lookup fed
  a vec3 instead of `.r` built a 4-component vec2 — three logged it at build and
  still rendered something plausible. Neither the node-graph tests nor a
  screenshot caught it; only the live console did. Any headless-golden work
  should check the console, not just pixels.
- **three's `chromaticAberration` has a broken documented default:** `center`
  defaults to null and the JSDoc says null means screen-center, but nothing
  implements that — `nodeObject(null)` stays null and the node throws at build
  (black viewport). We pass the center explicitly.
- **`compileAsync` warm uses the real geometry of a mesh already using the
  material** (`warmProbe`). If no mesh uses it yet, the warm is skipped and the
  swap is immediate (may hitch) — correct, just not optimal.
- Post-FX is **active-pane only** in quad layout, inheriting the existing AO/SSR
  limit (one composite, one tone map for the whole canvas).
- Value/all noises degrade past ~100k world coordinates (f32 coordinate precision).

## Next steps (exact, resumable cold)

1. **Decide C6's custom shader effects** (TSL/GLSL snippet + declared uniforms,
   animatable) — surfaced to the user at this boundary: build now, or defer to
   1.x and close C6. Everything else in C6's line is done.
2. **A5 (icons)** — the last M2 chunk besides the above.
3. Consider a **layer-stack editor UI** for procedural materials. Not required by
   E3's "done when", but without it E3/E4 are unreachable for a user. This is the
   single highest-value follow-up in M2's materials arc.
4. M2 is a **hard stop**: when C6 + A5 are done, write the progress file, run the
   M2 QA checklist, and wait for user sign-off before touching M3.
