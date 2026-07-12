# PLAN_PROGRESS_19 — M2/E1a: material data model + render sync

**Date:** 2026-07-12
**Chunks worked:** E1 (material manager) — sub-chunk E1a
**Milestone context:** M2 in progress (user-authorized to proceed through the milestone without a sign-off stop). Also this session: viewport-settings persistence, shadow resolution/blur fixes (PCF), 4-up render fix, spline-thickness fix.

## Completed

- **E1a — material foundation (headless, verified live).** Everything below the UI: materials exist, assign, render, edit, persist, undo.
  - `MaterialDTO` (all 8 built-in three families; physical default) + `MaterialStore` on the Document. Assignment = `node.data.material` (Uuid).
  - Document `add/update/removeMaterial` → bump `materials` slice + `material:*` events; `toDTO/loadDTO` persist the library (optional field, no FORMAT_VERSION bump).
  - Create/Update(+tryMerge)/Delete material commands (undoable).
  - `materials/build.ts`: MaterialDTO → three WebGPU node material (only place naming concrete material classes). One material SHARED across all meshes referencing it.
  - Render `MaterialSync` cache: resolve a node's material (or default) in `applyShading`'s PBR branch; live param edits apply in place and propagate to every mesh; type change rebuilds. flat/wireframe keep their global override.
  - Autosave now triggers on the `materials` slice too.

## Left mid-flight

- Nothing broken. E1 UI (below) not started.

## Decisions made (and why)

- **Standard/Physical node materials DO propagate in-place param edits to all meshes** (verified with a two-mesh emissive spike) — unlike `Line2NodeMaterial` (see [[webgpu-render-gotchas]] #8). So one shared material + in-place edits is the cache design; no reassign-clone dance needed.
- **Default (unassigned) mesh look stays the existing themed `BASE_MAT`** (MeshStandard); the "physical default" is for NEW library materials. Revisit if the user wants the default *look* physical too.
- **No eager material disposal** on type-change/delete (rare, discrete; disposing a material still bound to a mesh until the next `applyShading` risks a stale-GPU glitch). Deferred disposal later.
- Thumbnails are a separate chunk (offscreen WebGPU sphere render — its own gotchas), not part of E1a. (Advisor-endorsed.)

## Files added / changed

- types: `types/core/material.ts` (new), `events.ts`, `document.ts`, `index.ts`
- core: `core/document/MaterialStore.ts` (new), `Document.ts`, `history/commands/material.ts` (new), `index.ts`, `document/material.test.ts` (new)
- materials: `materials/build.ts` (new)
- render: `render/scene-sync/MaterialSync.ts` (new), `SceneSynchronizer.ts`
- ui: `ui/hooks/doc/projects.ts` (autosave materials sub)

## Test status

- `tsc -b`: pass
- `vp test`: 170 passed (7 new material tests)

## Known issues

- Per-pane `material.side` (backfaces) is last-pane-wins for shared materials (pre-existing class of issue; not fixed).

## Next steps (exact, resumable cold)

1. **E1b — Material Manager panel:** dockview panel with a grid of materials (name + large sphere thumbnail, C4D-style), create (default physical) / rename / delete, selection. Material param editor in the attributes panel (type dropdown + color/roughness/metalness/emissive/opacity, gated by `HAS_PBR`/`HAS_COLOR`/`HAS_EMISSIVE`).
2. **E1b thumbnails:** offscreen sphere preview per material — render a lit sphere with the material to a small RenderTarget, read back to an `<img>`/canvas. Reuse or mirror the main WebGPURenderer; watch the HDR-target/viewport/clear/readback gotchas.
3. **E1c — drag-and-drop assignment:** drag a material thumbnail onto an object (viewport pick or Object Manager row) → `SetNodeDataCommand` setting `data.material`. Also assign via the attributes panel.
4. Then E2 (TSL noise library) → E3 (layer-stack compiler) → E4 (projections) → E5 (environment) → C6 (post-FX) → A5.
