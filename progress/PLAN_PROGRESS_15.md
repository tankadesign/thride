# PLAN_PROGRESS_15 — edge-bevel miter fix + D6 snapping (magnet)

**Date:** 2026-07-10
**Chunks worked:** D5 follow-up (edge-bevel miter bug) + **D6 snapping — done.**
**Milestone context:** M1 in progress. (PROGRESS_14 was a concurrent C5 theme-groundwork session.)
Remaining M1: D7 boolean worker, D8 splines + pen tool, D9 spline extrude, F1 generator graph,
F3 boolean object, rest of C5.

## Edge-bevel miter fix (commit `f401bc3`)

User report: beveling edges on an asymmetric inset+extruded frame left the new bevel edges not
lining up along a non-selected diagonal — 2 points where there should be 1 (fixed by hand with
Dissolve). Root cause: the offset-intersect gives each face its receded corner independently; the
two faces sharing a non-beveled edge land corners on that edge's line at DIFFERENT depths on
asymmetric geometry (equal only on symmetric solids, so cube/cylinder always looked right), so the
exact-position weld can't merge them and the edge splits. The classic bevel **miter**.

Fix (`bevelEdge.ts`): a merge pass before the weld unions the two split corners of every
non-beveled edge whose BOTH ends receded and collapses each collinear class to its midpoint
(matching Dissolve); mixed junctions (union chained across edges on different lines) snap to the
shared vertex so every edge stays straight. Only mutates `cornerPos` in place, so the weld
coalesces the now-equal positions — strips/rings/bridges/fillHoles unchanged. Proven: distorted
cube, bevel 11 of 12 edges — without the merge the leftover edge splits (near-duplicate vertex
pair); with it they weld to one, valid kernel. Regression test asserts no near-duplicate vertices.

**Miter STYLE options (Sharp/Patch/Arc) — deferred (design finding).** The Sharp merge is a pure
correctness fix; the split points are collinear on the edge, so there's no area to patch or round.
Blender's Patch/Arc miters apply to CONVEX corners where beveled edges meet (restyle the vertex
caps) — a separate, larger feature that doesn't touch this bug. `BevelEdgeOpts.miter` left as a
reserved seam (default sharp). Surfaced to the user; awaiting a call on the cap-styling follow-up.

## D6 snapping (commit `76bde6a`)

- **`render/picking/snapPoint.ts` — `findSnap()`**: nearest snap target to a world point by
  screen-space distance (12px) through the pane camera. Vertex preferred; else the world-space
  closest point on the nearest edge. `exclude(meshId, v)` skips the dragged geometry.
- **Gizmo translate** gains a `snapWorld` modifier: snaps the moved pivot to the target. Axis
  handles keep their constraint (only the along-axis component snaps); the free view handle snaps
  fully. Same pivot path serves object AND component drags.
- **`ViewportInput`** builds candidates (every editable mesh) + the exclusion (dragged component
  verts, or whole selected meshes in object mode), passes `snapWorld` only when the magnet is on,
  publishes a snap marker.
- **UI**: magnet toggle (persisted `snapEnabledAtom` / `EditorViewportState.snapEnabled`) + a
  success-colored ring marker at the live snap target, in `ViewportPanel`. Grid snap (Shift) is
  independent and unchanged.

Verified in-browser: two meshes, magnet on, dragging one in object mode snaps its origin exactly
onto the other's vertex `(2,-1,-1)`; `findSnap` returns the right vertex and excludes the dragged
mesh. `tsc -b` clean; `vp test` 125/125.

### Decisions & limitations (D6 v1)

- Snap source = the gizmo pivot (object origin / component centroid) — for a single selected vertex
  the centroid IS that vertex (the key modeling case). Screen-space grab, world-space snap.
- Targets are **editable meshes** only; unconverted primitives aren't targets yet (convert first).
  Applies to translate (grid snap covers rotate/scale on Shift). O(V+E) scan per move (fine at M1).

## Test-harness note (for cold resume)

Driving the app from `javascript_tool`: a dynamic `import('/src/…')` yields a SEPARATE module
instance under Vite HMR — atoms set that way don't drive the app store. Flip state via the real UI
(the magnet button) or `window.__viewport`. Grabbing the gizmo synthetically needs the
already-rendered camera (a `frameAll` requires a render frame first).

## Next steps

1. **D8 splines + pen tool** (the Spline north-star workflow — high value) or **D7 boolean worker**.
2. Then D9 spline extrude / F1 / F3 / finish C5 (a viewport-color settings panel over the new theme).
