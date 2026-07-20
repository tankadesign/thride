# PLAN_PROGRESS_30 — F4 Cameras (lens objects + frustum helper)

**Date:** 2026-07-20
**Chunks worked:** F4 (Cameras +light polish) — the last M3 chunk.
**Milestone context:** **M3 (Scatter & cameras)** — F2 done (PROGRESS_28/29), F4 now done, area-light
LTC crash already fixed in M0X. **M3 is complete pending the QA checklist + owner sign-off (hard stop).**

## Completed

Camera nodes were already first-class (creatable, selectable via pick-proxy, look-through-able with
nav writeback, targetable) but carried **no lens data** — the look-through rig used a hardcoded fov 50
and the frustum helper was a fixed-size pyramid. F4 adds the lens:

- **`CameraDataDTO`** (`src/types/core/camera.ts`, NEW) — `{ fov, near, far }` (fov = vertical degrees,
  three's convention) + `defaultCameraData()` (`fov 50, near 0.1, far 1000`). Perspective only; see
  Decisions. Imported directly (like `light.ts`), not via the `types/core` barrel.
- **Seeded on create** — `create.camera` now passes `{ camera: defaultCameraData() }` to
  `CreateNodeCommand` (`src/app/commands.tsx`).
- **Lens-driven frustum helper** (`src/render/helpers/CameraHelper.ts`) — `buildCameraHelper(dto)` +
  `updateCameraHelper(helper, dto)` shape the pyramid from `fov` at a **fixed focus distance** (not the
  far plane) using a representative 16:9 sensor, plus a screen-up tick. 9 segments / 18 verts, updated in
  place (vertex count is constant). Tagged `userData.cameraHelper` so the sync layer finds it.
- **Helper build + update wiring** (`src/render/scene-sync/SceneSynchronizer.ts`) — `buildCameraObject`
  takes the node and seeds the helper from its lens; `updateNode` grew a `camera` branch that reshapes the
  held helper on a lens edit (falls back to `defaultCameraData()` for cameras saved before this change).
- **Look-through applies the lens** (`src/render/viewport/ViewportSystem.ts`) — `syncSceneCamera` now
  copies `fov/near/far` from `node.data.camera` onto the perspective rig each frame (only when changed →
  `updateProjectionMatrix`), replacing the hardcoded fov 50.
- **Camera inspector** (`src/ui/panels/attributes/camera.tsx`, NEW) — `CameraParams`: FOV / Near / Far
  NumberDrags through the shared `Section`/`Field` primitives, mirroring `LightParams`' scrub→commit
  (`SetNodeDataCommand`). Wired into `AttributesPanel` for `kind === "camera"` (before the shared
  `TargetSelector`), defaulting the DTO for legacy cameras.

## Left mid-flight

- Nothing. F4 is complete.

## Decisions made (and why)

- **Perspective only** (no ortho toggle). A free-oriented orthographic scene camera can't reuse `CameraRig`
  (its `camera`/`kind` are immutable, `applyOrtho` derives position/up from the axis-aligned builtins, and
  `orbitAround` early-returns on non-persp) — it needs a distinct "free-ortho" rig mode. F4's done-when
  ("any camera bindable to any pane; helpers render + serialize") doesn't require it, so I shipped fov and
  **did not** render a dead ortho control. Ortho is a candidate scope call at M3 sign-off. (Advisor-concurred.)
- **fov (vertical degrees) is the canonical lens field**, not focal length + sensor — simpler, maps straight
  to three; focal-length can be a derived display later. Settled up front since the DTO serializes.
- **Helper drawn to a fixed focus distance, not `far`** — a default far of 1000 would draw a scene-sized
  pyramid. The helper is a representative shape (16:9), independent of the clip range.
- **Deferred the `camera` texture-projection graduation** (the E4 carve-out): it needs a "project from which
  camera" picker and isn't in F4's done-when. The compiler `case "camera"` stays; the UI option stays hidden.
- **No new light-helper work** — the cone/rect/direction/billboard helpers and the area-light LTC fix already
  shipped in M0X and meet F4's "light helpers render + serialize"; eyeballed, nothing to add.

## Files added / changed

- **types/core:** `camera.ts` (NEW)
- **render/helpers:** `CameraHelper.ts` (fov-driven build + update)
- **render/scene-sync:** `SceneSynchronizer.ts` (buildCameraObject(node) + camera update branch)
- **render/viewport:** `ViewportSystem.ts` (syncSceneCamera applies fov/near/far)
- **ui/panels:** `attributes/camera.tsx` (NEW), `AttributesPanel.tsx` (CameraParams wiring)
- **app:** `commands.tsx` (seed camera lens on create)

## Test status

- `pnpm check` (`tsc --noEmit`): clean.
- `pnpm lint` (ESLint): 0 errors (37 pre-existing `no-unnecessary-type-assertion` / one refresh warning,
  none in the new files).
- `vp test`: **262 passed** (40 files) — unchanged; F4 is render/UI wiring, verified in-browser rather than
  by unit test.
- **In-browser (verified, scene restored):** created a Camera → Attributes shows Camera (FOV 50 / Near 0.1 /
  Far 1000) + Target. Looked through it via the pane dropdown; changing **FOV 50 → 100 visibly widened** the
  rendered view (proves the lens flows to the rig). Target = Instancer aimed it at the cluster. Inspected the
  three scene: exactly **1** `cameraHelper` `LineSegments` (18 verts) on the helper layer, parented to the
  camera, `halfW = 2.119` = `tan(50°)·16/9` — i.e. the helper reshaped to fov 100 (default would be 0.829),
  proving `updateCameraHelper` fires on lens edits.
- **Serialize round-trip (the F4 done-when word, verified cold):** set a camera to fov **90**, let autosave
  fire, **reloaded the page**. After the cold load: the persisted DTO reads `{fov:90, near:0.1, far:1000}`,
  and the rebuilt helper's `halfW = 1.778` = `tan(45°)·16/9` (not the 0.829 default) — proving both that
  `data.camera` persisted _and_ that the cold `buildCameraObject → buildCameraHelper(dto)` path consumed it.
  Cleaned up the test camera afterward → scene back to 5 objects. Zero console/WebGPU errors throughout.
- **Not visually confirmed (applied in code, honest note):** `near`/`far` are set on the rig in
  `syncSceneCamera` but weren't observed in isolation (hard to see). The helper uses a **fixed 16:9** frustum
  while look-through fills the _pane's_ aspect, so the wireframe is a representative shape, not the exact
  captured framing — acceptable v1.

## Follow-up round — camera bugs + polish (same session, after initial F4)

Owner reported two bugs and asked for two additions; all done + committed.

- **Bug — gizmo/handle size scaled with camera fov** (`da2d5f0`). `applyScreenScale`/handle sizing used
  distance only; a look-through camera's fov then rescaled the on-screen gizmo. Normalized by
  `tan(fov/2)/tan(25°)` (25° = half the editor's default 50° fov) so only distance drives screen size.
  Verified: at fov 50 vs 120 the gizmo's projected screen size is identical (ratio 1.0), world scale
  compensates. Fixed the same class in `PrimitiveHandles`.
- **Bug — orbit dead while looking through the selected camera** (`da2d5f0`). Root-caused by reproduction:
  a selected scene camera's transform gizmo sits at the camera position = the eye, so it filled the near
  view and `tryInteractivePress` consumed every LMB press (pan/zoom bypass the gizmo pick → still worked).
  Fix: `gizmoBlockedInPane` hides + skips-pick the gizmo in a pane that looks through the selected node
  (render gate in the pane loop; explicit pick gate in `pointerPick`, since the raycaster ignores
  `.visible`). Verified: camera selected + looked-through, orbit now moves the camera.
- **Add — camera params** (`f32dba6`): `filmGauge`, `filmOffset`, `zoom` (three props, applied in
  `syncSceneCamera`), and `focus` for DOF — a focus-object selector (its distance drives focus) or a manual
  focus distance when no object is set. `CameraDataDTO` + `CameraParams` extended; legacy cameras backfill
  from defaults. Verified: fields render; zoom visibly reframes.
- **Add — Depth of Field** (`765ef21`): three's `dof()` node in `DitherOutput.composeOutput` (applied first,
  in linear HDR), focus distance from the scene camera, focal range + bokeh in the pane's Post Processing
  settings. Off by default; gated to **PBR + single layout + looking through a scene camera** (like GTAO/SSR).
  viewZ is rebuilt via `perspectiveDepthToViewZ(depth, near, far)` with the scene camera's OWN near/far
  (added `perspectiveDepthToViewZ` to the tsl barrel). **Critical:** DOF samples hdr depth as a plain 2D
  texture, so it joins the `setSceneMSAA` single-sample gate — else DOF-alone (no GTAO/SSR forcing
  single-sample) reads a 4-sample depth attachment and the frame throws. Verified in exactly that config
  (DOF on, GTAO off, SSR off): real bokeh, clean on/off, zero console errors; DOF node disposed on rebuild.

## Follow-up round 2 — high-count render race + primitive segments

- **Primitive segments** (`4ca1475`, verified): cube gains `segmentsW/H/D` (a welded, editable segmented
  box via a position-keyed vertex map; the plain 1/1/1 box keeps the exact 8-vertex fast path). Cylinder
  gains `heightSegments` (extra profile rings through the shared `lathe`), and its radial `segments` is
  relabelled **"Rot. Segments"**. All new params optional → old cubes/cylinders load unchanged; UI is
  data-driven so fields appear from defaults + `paramMeta` with no panel edits. Verified in-browser: cube
  168 verts / cylinder 564 verts, subdivisions visible, smoothly lit (welded, correct winding); inspector
  shows Segments W/H/D, Rot. Segments, Height Segments.
- **Bug — viewport "doesn't clear / frames stack" at high instance count** (`bf1cc8d`, **needs owner
  verification**): reported at ~1000+ instances (25fps) during value edits AND pure orbit. Reframed via the
  advisor: orbit never calls the instancer sync/grow/retire path, and a real missing-clear would show at
  every count — load-dependence ⇒ a **timing race, not a missing clear**. Found it: the scene passes are
  `await renderer.renderAsync(...)` but the composite was the synchronous `post.render()`, so `renderFrame`
  returned (and the render-loop `rendering` guard dropped) while that frame's composite GPU work was still
  draining → the next frame's scene render could begin before it presented → overlap/stacking once the GPU
  falls behind. Fix: `DitherOutput.renderAsync()` (`post.renderAsync()`) awaited in `renderFrame`, so the
  whole frame serializes on one chain. **Could not self-reproduce** — this automation browser throttles rAF
  between inputs and froze at 20k instances; normal render + orbit confirmed no regression, but the actual
  stacking needs confirming on the reporting hardware at the count that shows it.

## Known issues

- **The high-count stacking fix (`bf1cc8d`) is unverified against the live bug** — see above; confirm on the
  reporting machine. If it persists, next suspect is per-pass presentation ordering in the SSR/overlay path.
- Orthographic scene cameras not supported (see Decisions) — deliberate.
- Camera texture projection still hidden from the UI (deferred; needs a source-camera picker).
- **DOF, like GTAO/SSR, is single-layout only** (it reconstructs from one camera's depth) — a documented
  scope limit to raise at M3 sign-off, not a silent gap. DOF also blurs the grid/outlines in the composite
  (helpers bake into the depth-less color) — acceptable v1; the gizmo is hidden by the orbit fix.
- `near`/`far`/`filmGauge`/`filmOffset` are applied in code but not each independently eyeballed; fov, zoom,
  focus (via DOF), and the film back all exercised.

## Next steps (exact, resumable cold)

1. **M3 QA checklist** (hard stop — run + wait for owner sign-off before any M4 work):
   - 100k instances @ 60fps (F2 Instancer — count-drag a dense target).
   - Any camera bindable to any pane (F4 — the pane dropdown lists 🎥 cameras; quad layout binds independent
     cameras per pane).
   - Area lights don't crash (create an Area light — LTC init guards the frame).
2. On sign-off, start **M4** (E7 node-based material editor) — do **not** proceed unprompted (milestone rule).
