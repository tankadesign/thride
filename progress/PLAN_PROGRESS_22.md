# PLAN_PROGRESS_22 — M2/E5: Environment (HDR) + the reflections system

**Date:** 2026-07-14
**Chunks worked:** E5 (Environment) — HDR/EXR load + background modes (the chunk
deliverable), which then grew into a full reflections stack (SSR Fast/High,
planar reflectors, helper-exclusion) driven by user requests.
**Milestone context:** M2 in progress (user-authorized through the milestone).
E1 + E5 done; E2, E3, E4, C6, A5 remain. E6 bake deferred out of M2.

## Completed

**E5 core — HDR/EXR environment loading (`1360477`).**
- `types/core/environment.ts` already held `EnvironmentDTO` + `defaultEnvironment`;
  this wired the load path. `render/environment/EnvironmentSync.ts` decodes an
  HDR/EXR asset via `RGBELoader`/`EXRLoader` (async, falls back to the painted
  studio env until ready, then re-applies), keyed per asset in a Map.
- `EnvironmentPanel.tsx` gains an "HDR / EXR" source option + a file loader
  (reads bytes → `TextureAssetDTO` → `textureAssets.register` →
  `setEnvironment({source:"hdr", hdrAssetId})`). `projectStore.ts` persists /
  hydrates / releases the env's HDR asset alongside material textures
  (`environmentAssets(document.environment)`). **E5 "done when" met:** the
  dome-light panel round-trips through save (verified: load → decode →
  scene.environment + background render → autosave → reload).

**Screen-Space Reflections — "Fast" (gen-1) (`801a4e1`, `6a0b16d`).**
- `render/viewport/ditherOutput.ts`: `DitherOutput` gained a **dual-mode graph**.
  Default (SSR off) is unchanged (the manual multi-pane hdr blit + GTAO). SSR-on
  moves the scene render INTO the node graph via `pass(scene,camera).setMRT(...)`
  for a real view-space normal + metalness/roughness G-buffer (three's `SSRNode`
  needs real normals — depth-only can't supply them). Single mirror ray +
  roughness-driven internal blur. Single-pane + PBR only, gated in
  `ViewportSystem.renderFrame`.
- `6a0b16d` added roughness fade-to-IBL (SSR fades out as roughness→1, handing
  off to the env reflection) AND fixed a latent bug: **SSR params don't
  live-update** — poking `ssrNode.*.value` (even with `post.needsUpdate`) never
  re-runs the reflection render; only a graph `rebuild()` applies changes. Every
  SSR slider was silently dead until this. `setScreenReflections` now rebuilds on
  any value change (field-compared so steady frames skip it).

**SSR — "High" (temporal, example-quality) (`460827b`, `75d3e53`, `67c4f04`).**
- Mirrors three's `webgpu_postprocessing_ssr_denoise`: stochastic GGX `ssr()` →
  `temporalReproject` → `recurrentDenoise`, accumulated across frames via a
  velocity-buffer G-buffer (MRT packs metalness in `diffuse.a`, roughness in the
  packed-normal `.a`, plus `velocity`).
- **Converge-then-idle render loop** (`ViewportSystem`): `accumFrame`/`accumTarget`
  — `invalidate()` resets accumFrame; the gate renders until
  `accumFrame >= accumTarget` (ssrMaxFrames + 8) then idles. `accumTarget=0` on
  every non-temporal path → the on-demand loop is byte-identical when High is
  off. Only the reflection layer accumulates; beauty/overlays are deterministic
  (no camera jitter → TRAA deferred).
- Needs an equirect HDR for off-screen ray misses → `render/environment/defaultHdr.ts`
  loads the bundled `public/hdri/golden_gate_hills_1k.hdr`; uses the scene's HDR
  when the env source is HDR, else the bundled default (so High works on Studio
  env too). Studio source + Environment background now shows that bundled HDRI as
  the backdrop.
- `67c4f04` fixed converged grain: enabled `envImportanceSampling` (MIS) +
  relaxed `TemporalReprojectNode.clampIntensity` 1→0.25 (the default re-injected
  the current noisy frame every accumulation step). AO also now composites in
  High mode.

**Planar reflections (`23f102f`).** Per-object `node.data.planar` (axis/strength/
resolution) on a flat mesh → three's `reflector()` TSL node, scene re-rendered
through the surface's plane → shows occluded geometry SSR physically can't (a
floor mirror reflects a sphere's underside). Per-node material variants in
`MaterialSync.resolvePlanar` (`colorNode = mix(materialColor,
textureBicubic(refl, materialRoughness), strength)` — roughness-blurred);
reflector target parented to the mesh. UI in `AttributesPanel`; undoable via
`SetNodeDataCommand`.

**Helpers out of all reflections (`23f102f`, `f34874a`, `36337b5`).** New
`render/layers.ts` `HELPER_LAYER = 1`. Gizmo, handles, overlays, tools, selection
outlines, light helpers (cone/rect/billboard — but NOT the Light objects, which
must stay layer-0 or nothing is lit), camera pyramids, and splines are tagged
onto layer 1 (gizmo/handles **after** their per-pane `update()` since those
rebuild children); scene cameras stay layer-0, so no scene render / SSR pass /
reflector mirror sees them. A per-frame overlay render draws them
(`raycaster.layers.enableAll()` keeps picking working). In SSR mode the overlay
draws into the hdr buffer (transparent clear) and the output graph blends it by
alpha — the WebGPU backend force-clears the canvas every render, so you cannot
draw on top of the composite directly.

**Robustness.**
- Boot hardening (`4d98b99`): `SceneSynchronizer.addNode/updateNode` contain
  per-node throws (empty-group fallback / keep-stale) so one corrupt node payload
  can't unmount the whole app.
- Black-artifact fixes (`4a60d3f`, `a4e9685`): three NaN sources in the temporal
  chain — (1) roughness-0 + MIS hits 0/0 in D_GTR → `roughnessNode.max(0.12)`;
  (2) degenerate silhouette normals → `lengthSq` guard on the sceneNormal;
  (3) **the decisive one** — reproject/denoise reconstruct view positions from
  depth, and background pixels at depth 1.0 → `1/(1-d)`=Inf/NaN wherever a kernel
  or history sample touches the sky. `dn.rgb.max(0).min(1e4)` at the composite
  kills it (WGSL max/min return the non-NaN operand). Denoiser retuned for
  specular: kernel `radius` 5→1.5, `depthPhi` 5→30.
- `13513cb` (pre-SSR): NumberDrag Tab/Enter keyboard focus fix.

## Left mid-flight

- Nothing broken. All work committed; `tsc -b` + `vp test` green (174).

## Decisions made (and why)

- **SSR is a per-pane `PaneDisplay` toggle with Fast/High modes**, not a material
  property — it's a viewport look setting, gated single-pane + PBR (like GTAO).
  Persists via `paneDisplays` (no projectStore change).
- **TRAA deferred.** Temporal SSR forces MSAA off (`pass(...,{samples:0})`), but
  the baseline viewport hdr target is already single-sample → not a regression.
  TRAA (which adds camera jitter and would disturb overlays) stays a future
  enhancement, not a requirement. The plan's "no jitter, overlays safe"
  assumption held.
- **Bundled default HDRI ships in `public/hdri/`.** Stochastic SSR hard-requires
  an equirect HDR with CPU `image.data`; the Studio env (a CanvasTexture) can't
  drive it. Shipping a default makes High work everywhere.
- **Two three 0.185.1 bugs worked around, not patched:** `RenderTarget.setSize`
  doesn't resize `depthTexture` (size `image` dims in build + resize; the
  temporal graph rebuilds on resize because it has previous-depth AND
  previous-normal history buffers). Clean fix would be a three upgrade.
- **Gen-1 SSR / all SSR params only apply on graph rebuild** (live uniform pokes
  are dead for this pass) — a real constraint, documented in the code.

## Files added / changed (by module)

- types: `core/scene.ts` (PlanarReflectionDTO), `core/index.ts`, `editor.ts`
  (PaneDisplay ssr\* fields incl. ssrMode/ssrDenoise/ssrMaxFrames)
- render: `layers.ts` (new), `environment/defaultHdr.ts` (new),
  `environment/EnvironmentSync.ts`, `viewport/ditherOutput.ts` (the bulk — dual
  graph, temporal chain, NaN guards), `viewport/ViewportSystem.ts` (converge loop
  + helper layers + SSR env), `scene-sync/MaterialSync.ts` (planar variants),
  `scene-sync/SceneSynchronizer.ts` (planar hook + boot containment),
  `scene-sync/SelectionOutline.ts`, `scene-sync/LightSync.ts`, `scene-sync/SplineSync.ts`
- materials: `tsl.ts` (MRT / reflector / guard node re-exports)
- ui: `panels/EnvironmentPanel.tsx` (HDR source + loader),
  `panels/ViewSettingsModal.tsx` (Reflections section, Fast/High),
  `panels/AttributesPanel.tsx` (Planar Reflection section)
- io: `storage/projectStore.ts` (env HDR asset persist/hydrate/release)
- widgets: `NumberDrag.tsx` (focus fix)
- assets: `public/hdri/golden_gate_hills_1k.hdr`

## Test status

- `vp check`: not run — hangs on tsgolint. Gates used: `tsc -b` clean, `vp fmt`
  applied.
- `vp test`: 174 passed / 0 failed (27 files).

## Known issues

- Faint residual smudge at extreme-contrast horizon silhouettes in SSR High
  (grazing all-miss region — no screen-space data exists there). Tunable via
  Edge Fade; a bounded cosmetic, not the runaway artifact that was fixed.
- SSR param edits recompile the graph (live uniforms don't work for the pass) —
  scrubbing SSR sliders is choppier than AO. Functional.
- Planar reflector cost = one scene render per reflective plane at its resolution
  scale; fine at a few planes.
- `vp check`/`vp lint` still hang on tsgolint (pre-existing).

## Next steps (exact, resumable cold)

1. Pick the next M2 chunk. Remaining after E1+E5: **E2** (TSL noise library behind
   the `tsl.ts` barrel, phase param, visual golden tests) → **E3** (layer-stack
   compiler, ProceduralMaterialDoc → TSL) → **E4** (projections); **C6** (post-FX
   stack: bloom/vignette/CA/tonemap + custom shaders — builds on DitherOutput);
   **A5** (icons, parallel). E2 is the dependency root for the procedural-material
   spine (E3/E4).
2. This is a chunk boundary, not a milestone boundary — M2 continues without
   sign-off (user-authorized through the milestone).
3. Optional E5 polish if revisited: TRAA for beauty AA in High mode; expose the
   denoiser radius/depthPhi as advanced controls; env-map intensity matched to
   backdrop brightness for the horizon smudge.
