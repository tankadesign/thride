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
  proving `updateCameraHelper` fires on lens edits. Undid all edits → scene restored to 5 objects. Zero
  console/WebGPU errors.

## Known issues

- Orthographic scene cameras not supported (see Decisions) — deliberate.
- Camera texture projection still hidden from the UI (deferred; needs a source-camera picker).

## Next steps (exact, resumable cold)

1. **M3 QA checklist** (hard stop — run + wait for owner sign-off before any M4 work):
   - 100k instances @ 60fps (F2 Instancer — count-drag a dense target).
   - Any camera bindable to any pane (F4 — the pane dropdown lists 🎥 cameras; quad layout binds independent
     cameras per pane).
   - Area lights don't crash (create an Area light — LTC init guards the frame).
2. On sign-off, start **M4** (E7 node-based material editor) — do **not** proceed unprompted (milestone rule).
