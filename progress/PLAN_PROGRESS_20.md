# PLAN_PROGRESS_20 — M2/E1: material manager complete

**Date:** 2026-07-12
**Chunks worked:** E1 (material manager) — E1b + E1c (E1a in PLAN_PROGRESS_19)
**Milestone context:** M2 in progress (user-authorized through the milestone). E1 done; E2–E6 + C6 + A5 remain.

## Completed

- **E1b — Material Manager panel + C4D sphere thumbnails + param editor.**
  - `render/thumbnails/materialThumbnails.ts`: offscreen preview with its OWN WebGPURenderer/device (isolated). Lit sphere (hemisphere + 3-point rig) on transparent bg → PNG dataURL. No IBL yet (metals read a touch dark — env map is a later enhancement).
  - `ui/hooks/editor/materials.ts`: `selectedMaterialAtom`, `useMaterialThumbnail` (serialized single-sphere render, cached by visual params), `MATERIAL_DND_MIME`.
  - `ui/panels/MaterialManagerPanel.tsx`: grid of thumbnails, New (default Physical) / Delete / select / rename; live param editor below (Type, Color, Roughness/Metalness, Emissive+strength, Opacity, Transparent, gated by HAS_* per type; scrub = one undo step).
  - Wired into the dock (`materials` component + default-layout tab) + View-menu command (`Shell.tsx`, `app/commands.tsx`).
- **E1c — drag-drop assignment.** Cards are draggable (carry material id); `ViewportSystem.pickNode` raycasts the mesh under the cursor; drop → `SetNodeDataCommand` sets `node.data.material`. Per-object, undoable.

## Left mid-flight

- Nothing broken.

## Decisions made (and why)

- Thumbnail renderer is a **separate WebGPURenderer/device** (materials build fresh per device; pipelines are per-device) — isolated from the main HDR pipeline to avoid the target/clear/readback gotchas.
- Drop target is the **viewport** (C4D-style). Object-Manager-row drop not done (easy follow-up).
- PMREMGenerator is WebGL-only → used a **light rig** instead of IBL for thumbnails (v1).

## Files added / changed

- render: `thumbnails/materialThumbnails.ts` (new), `viewport/ViewportSystem.ts` (pickNode)
- ui: `hooks/editor/materials.ts` (new), `panels/MaterialManagerPanel.tsx` (new), `panels/ViewportPanel.tsx` (drop), `shell/Shell.tsx`, `app/commands.tsx`

## Test status

- `tsc -b`: pass · `vp test`: 170 passed (note: `vp check`/`vp lint` hang on tsgolint — use tsc + vp test, commit `--no-verify`, per project memory).

## Known issues / follow-ups

- Thumbnails have no IBL → metals/chrome read dark. Add an environment map later.
- Object-Manager-row drop target (only viewport drop exists).
- E1d: per-face material assignment from booleans (runOriginalID) — deferred.

## Next steps (exact, resumable cold)

1. **E1d (optional):** per-face material assignment from booleans; and/or the two follow-ups above.
2. **E2 — TSL noise library** (`materials/noises/` behind the tsl barrel; MaterialX + custom, each with a phase param; visual golden tests).
3. Then E3 (layer-stack compiler) → E4 (projections) → E5 (environment dome light) → C6 (post-FX) → A5.
4. **PCSS soft-shadow filter** (task 27) — the "soft" shadow option, an M2 look-dev chunk.
