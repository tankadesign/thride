# PLAN_PROGRESS_4 — UI shell + viewport/gizmo: M0 complete, awaiting sign-off

**Date:** 2026-07-09
**Chunks worked:** A2, A3, A4, C1, C2, C3, C4 (+ M0 integration)
**Milestone context:** **M0 COMPLETE — 12/12 chunks. HARD STOP: awaiting user sign-off before M1.**

## Completed

- **A2 Design system** — `src/ui/widgets/`: tokens + `widgets.css` (dark, hairline, dense); Button, NumberDrag (scrub streams committed=false → one committed=true on release; click to type; shift/alt precision), Select, Checkbox; tree/menu/palette/rail styles. `GalleryPanel` (View → UI Gallery).
- **A3 Docking shell** — dockview-react 7 (`dockview` v7 split React bindings into `dockview-react`!): panel registry, default layout (viewport + 340px right column: Objects / Attributes), layout persisted to localStorage + Reset Layout command.
- **A4 Menus/commands** — `CommandRegistry` (single registration → menu bar, ⌘K palette, shortcuts with mod/shift/alt parsing), `MenuBar`, `CommandPalette` (fuzzy), `ToolRail` (edit-mode buttons — object active, others stubbed for M1 — + quick-create). Commands: File>New; Edit>Undo/Redo/Delete/Deselect; Create>10 primitives+Null+Camera; View>toggle 4-up, Frame Selection (F), Frame All (H), palette, gallery, reset layout.
- **C1 Renderer** — `ViewportSystem`: WebGPURenderer (verified running on WebGPU backend), on-demand render loop, `SceneSynchronizer` (doc events → Object3D map, primitive geometry cache keyed by descriptor JSON, BVH bounds trees, selection tint), grid+session lights, stats HUD (backend/fps/objects).
- **C2 Navigation** — CameraRig: C4D scheme — Alt+LMB orbit **around raycast pick point** (`setPivotKeepingView`), Alt+MMB pan (cursor-tracking scale), Alt+RMB dolly, wheel zoom, F/H framing; ortho rigs (top/front/right) pan/zoom only.
- **C3 Multi-view** — 1-up/4-up scissored panes, per-pane camera dropdown (builtins + scene camera nodes), active-pane highlight, independent per-pane nav.
- **C4 Picking + gizmo** — three-mesh-bvh accelerated click select (shift add, cmd toggle, empty-click deselect); custom **unified TRS gizmo** (translate arrows + rotate rings + scale cubes + view-plane center, hover feedback, screen-constant in both projections) driving `TransformDragSession` → exactly one undo step per drag, Esc cancels.
- **Integration** — ObjectManagerPanel (tree, rename, visibility, multi-select), AttributesPanel (transform scrubs through sessions; live primitive parameter editing via preview + `SetNodeDataCommand`), seeded startup scene.

## Verified in-browser (Chromium, WebGPU backend)

- Boot → shell renders; Create>Sphere adds + selects; attributes show its live params.
- ⌘Z removes sphere, ⇧⌘Z restores (tree follows); ⌘4 toggles 4-up (correct per-view axes) and back.
- Click cube → selects; click empty → deselects; re-click reselects.
- `vp check` 0 errors; `vp test` 68/68; production build OK.

## Bugs found & fixed during browser verification

- **WebGPU viewport origin is TOP-left** (WebGL is bottom-left) — pane y-flip must branch on backend, else 4-up panes swap.
- **Don't double-multiply pixelRatio**: `renderer.setViewport/setScissor` take logical px.
- **React StrictMode removed**: double-mount races async WebGPU init/dispose on one canvas and double-builds dockview layout.
- Gizmo screen-constant sizing must use frustum height for ortho cameras (camera distance explodes at ortho distance 1000).
- `setPointerCapture` wrapped in try/catch (synthetic/test events have no active pointer).
- dockview measures 0×0 in the preview harness's transient window — layout widths are fine in a real browser; use `preview_resize` before judging layout.

## Known issues / M1 backlog

- Gizmo drag not yet exercised by automated test (unit-level session tests cover commit semantics) — manual QA item.
- Ortho panes: no per-view grid (world XZ grid only); no box-select yet; duplicate/copy-paste missing.
- Scene-camera panes are read-only (nav doesn't move camera nodes).
- Component modes, snapping, booleans, splines = M1 (D4–D9, F1, F3, C5).
- Dev note: `vp` not on PATH (`export PATH="$PWD/node_modules/.bin:$PATH"`); preview server can't bind 5656 (user's server) — `.claude/launch.json` uses 5175.

## M0 QA checklist (PLAN.md gate)

- [x] App boots to dark shell with docking
- [x] Viewport renders WebGPU scene (backend badge confirms WebGPU)
- [x] C4D nav implemented (orbit-around-point verified in code; **feel-check on real hardware = user QA**)
- [x] Primitives creatable (menu + rail + palette)
- [x] Click-select + unified TRS gizmo
- [x] Object manager tree (rename, visibility, reparent via core API)
- [x] Attributes panel (transform + primitive params, undo-correct scrubs)
- [x] Undo/redo across all ops
- [x] 4-up with per-view cameras
- [ ] **USER: nav/gizmo feel pass on real machine** ← the one open gate item

## Next steps (after user sign-off — do not start unprompted)

1. M1 session 1: D4 component mode tools (needs C4 pick plumbing for verts/edges/faces + B3 component selections).
2. Then D5 bevel, D6 snapping, D7 boolean worker, D8/D9 splines + extrude, F1/F3 generator graph + boolean object, C5 display modes/color mgmt.
