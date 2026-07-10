# PLAN_PROGRESS_11 — D4b: topology ops (extrude / inset / weld / delete) + context toolbar

**Date:** 2026-07-10
**Chunks worked:** D4 (second half — D4b). **D4 is now complete.**
**Milestone context:** M1 in progress. Remaining M1 chunks: D5 bevel, D6 snapping (vertex/edge), D7 boolean worker, D8 splines + pen tool, D9 spline extrude, F1 generator graph, F3 boolean object, C5 display modes/color management.

## Completed

- **Op strategy** (`geometry/ops/soup.ts`): topology ops edit in POLYGON-SOUP space (positions + face loops + per-corner UVs) and rebuild the kernel via `fromPolygons` — plain-array edits are easy to make correct, `adoptSoup` aborts with the mesh COMPLETELY untouched when a result would be non-manifold, and O(n) rebuilds are fine at M1 scales (native half-edge surgery is a later perf pass). `compactSoup` drops orphaned vertices with an old→new map.
- **Ops** — each `(mesh, ids, params) → OpResult{mode, ids} | null`:
  - `extrudeFaces` (`faceOps.ts`): C4D region semantics — walls only along the region boundary, per-vertex offset along averaged selected-face normals, caps stay selected for immediate gizmo dragging. **Sector-aware duplication:** where a selection touches itself at a single vertex (two disc fan triangles at the center), each contiguous fan sector gets its own duplicate — one shared dup emits duplicate wall edges (non-manifold); found by the randomized property tests, fixed with a per-vertex union-find over selected faces linked by selected interior edges at that vertex.
  - `insetFaces`: per-face inner copy ringed by quads, corners pulled toward the centroid with an inversion clamp (≤0.45 of the corner→centroid distance); inner faces stay selected.
  - `deleteFaces`: removes faces + compacts orphaned verts; refuses to delete the last face (delete the node instead).
  - `weldVertices` (`weld.ts`): merge to centroid; collapsing loops dedupe consecutive repeats, drop <3-gons and bowties; aborts (untouched) on <2 verts or non-manifold results.
- **Undo** (`geometry/commands/topology.ts`): `MeshTopologyCommand` — full before-snapshot (real `memoryCost` via getter), redo re-runs the deterministic op, undo restores arrays bit-exact; the op's returned selection is installed with a fresh topologyVersion stamp (pre-op stamps are void by design). Aborted ops leave an inert command.
- **UI:** new **Mesh menu** (MenuId + MenuBar): Extrude (D), Inset (I), Weld Points — with icons. **Context toolbar** (the M1 item): the ToolRail shows per-mode tools under the mode switcher — point: Weld/Delete; edge: Delete; polygon: Extrude/Inset/Delete. **Delete is component-aware:** the Delete key in a component mode deletes the touched faces (`facesForSelection`: polygon = selected, edge = adjacent, point = touching) instead of the object.

## Verified in-browser (WebGPU, real keyboard/menu/rail paths)

Chain on a converted cube — every action exactly ONE undo step: `d` extruded the selected face (6→10 faces, cap selected, "Extrude"), `i` inset the cap (+4 ring quads, inner selected, "Inset"), gizmo-dragged the inset face ("Move Components", composes with D4a), Delete key removed it ("Delete Components", open boundary of 4 appears), rail-button Weld merged two verts (16→15, welded vert selected). Full undo unwound all 4 remaining steps back to the pristine primitive cube (valid kernel at every stop). Mesh menu present; rail tools switch per mode.

## Test status

- `tsc -b` clean; `vp test` 115/115 (18 new: randomized property suite over 4 primitives × 4 seeds × 4 ops asserting `validateMesh` invariants + count bookkeeping + abort-leaves-untouched + command one-step/undo-exact/redo).

## Decisions made (and why)

- **Soup-rebuild over native half-edge surgery** — correctness-first; the kernel keeps indices-as-handles semantics via snapshot undo, and per-op rebuild cost is negligible at current mesh sizes.
- **Extrude/inset apply immediately with a small default (0.1) and keep results selected** — the gizmo then handles the interactive push/scale (C4D's drag-tool feel arrives when tools get drag handles; two steps for now is honest).
- **Edge-mode dissolve deferred** — "delete" removes adjacent faces everywhere; proper edge-dissolve (merge faces across the edge) slots naturally next to D5 bevel.

## Known issues

- Aborted ops (e.g. a weld that would go non-manifold) still record one inert history step when triggered — harmless (undo/redo skip it) but could be suppressed by pre-flighting the op.
- Extrude walls/inset rings get placeholder UVs (0..1 quads).

## Post-round: tools rework — modal extrude/inset + slide-to-target Weld tool

User feedback: centroid weld → rename **Dissolve**; Weld becomes a C4D-style TOOL
(drag a point along an edge, weld into the nearest point); extrude/inset become
Blender-style modal tools; **the tool rail is reserved for tools, not actions**.

- **Ops split** (`geometry/ops/weld.ts`): shared `mergeInto()` core;
  `dissolveVertices` (collapse to centroid — the Mesh-menu "Dissolve" action) and
  `weldVerticesTo(mesh, sources, target)` (merge INTO target keeping its exact
  position — the Weld tool op). `OpResult` gained optional `lift` data
  (`pos(v) = base + dir·min(amount, max)`) recorded by `extrudeFaces` (max=∞) and
  `insetFaces` (max = 0.45·corner→centroid — the inversion clamp).
- **`render/tools/AmountTool.ts`** — modal extrude/inset: activation applies the
  topology once at amount 0, then mouse-Y drives the amount live through
  positions-only updates (`setPosition` + preview `touchNode` — no per-frame
  topology/BVH rebuild). LMB confirms: snapshot restored, then ONE
  `MeshTopologyCommand` re-runs the op at the final amount (single deterministic
  undo step, cap/inner selection installed). Esc/RMB cancels bit-exact with the
  original selection re-stamped. Cursor is `move` while modal; the gizmo hides by
  itself (mid-edit selection stamps are void — emergent, zero code).
  Screen→world scale from the pane camera at the selection centroid.
- **`render/tools/WeldTool.ts`** — armed via `weldArmedAtom` (exposed through the
  `EditorViewportState` facade as `weldArmed`/`setWeldArmed`). Dragging a vertex
  slides a GHOST billboard along the best incident edge (screen-space projection;
  the real vertex never moves). Within **50px** (`WELD_RADIUS_PX`) of the edge's
  far vertex: target lights up (success color) + connecting line appears;
  release welds source INTO target via `weldVerticesTo` (one "Weld" step).
  Release outside the radius = strict no-op. Esc cancels.
- **Input routing** (`ViewportInput`): modal first (LMB confirm / RMB cancel with
  contextmenu suppression / Esc), weld drag second (armed point-mode clicks skip
  gizmo/handles; misses fall through to normal component selection), then the
  existing chain. Esc priority: modal > weld drag > handles > gizmo.
- **UI:** ToolRail is tools-only — point: Weld toggle (GitMergeIcon, primary
  highlight when armed); polygon: Extrude (D) / Inset (I) — Delete buttons
  removed (Delete key/menu still does actions). Mesh menu: Extrude, Inset,
  Weld Tool (toggle), Dissolve. Icons: `IconWeld` → GitMergeIcon,
  new `IconDissolve` = PathfinderMergeIcon.

**Verified in-browser** (WebGPU, synthetic pointer/keyboard through real handlers):
`d` on a selected cube face → modal (6→10 faces at amount 0, cursor `move`),
90px pull, LMB → exactly one "Extrude" step (face pushed to z≈3.64), undo/redo
exact; `i` → inset modal, 400px over-pull clamped precisely at ±0.275
(0.45 rule), one "Inset" step; `d`+drag+**Esc** → bit-exact restore, 0 steps,
selection re-stamped. Weld: armed via rail (button highlights), drag on a 510px
screen edge — mid-edge: ghost only (not locked); ≤50px from target: target quad
+ success line visible; release → 16→15 verts, one "Weld" step, merged vert
keeps the target's exact position; release outside radius → 0 steps, mesh
untouched; undo restores. Property tests extended: `weldVerticesTo` (target
position preserved, −1 vert, valid kernel), lift-data sanity for both ops,
`dissolveVertices` rename. `tsc -b` clean; `vp test` 115/115.

## Next steps (exact, resumable cold)

1. **D5 bevel** (edge/vert, fixed segments, overlap clamp) — same soup pipeline; add edge-dissolve alongside.
2. **D6 snapping** — vertex/edge snap for component moves (grid snap exists).
3. Then D7 boolean worker (Manifold WASM) / D8 pen tool + splines / D9 spline extrude / F1+F3 / C5 to close M1.
