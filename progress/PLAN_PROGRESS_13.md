# PLAN_PROGRESS_13 — edge-bevel bug fix + live tool (modes / segments / angle)

**Date:** 2026-07-10
**Chunks worked:** D5 (bevel) — bug fix + a user-requested expansion into a C4D-style live tool.
**Milestone context:** M1 in progress. D5 now complete beyond its original fixed-segment scope
(PLAN.md updated). Remaining M1: D6 snapping, D7 boolean worker, D8 splines + pen tool, D9
spline extrude, F1 generator graph, F3 boolean object, C5 display / color management.

## The bug (reported with a screenshot)

Edge-beveling edges on an open mesh (a plane, or a plane with insets/extrudes) produced huge
black faces across the surface. Cause: `fillHoles` capped EVERY open boundary loop, including
the mesh's **pre-existing outer boundary** — a closed cube/cylinder has none, so it went
unnoticed. Fix: map the original mesh's boundary half-edges to their post-bevel directed edges
and exclude them from hole-filling, so only the NEW vertex holes get capped. Configs that can't
cap into a simple loop abort untouched (a clean no-op) rather than corrupt. Regression test:
beveling an open plane's interior loop keeps its outer boundary intact.

## Features (all four requests)

- **Angle threshold** (default 40°, 0–180) — `bevelEdges` drops edges whose dihedral (deviation
  between the two adjacent face normals, 0° = coplanar) is below the threshold. This is what
  makes "bevel everything" on a panel do the right thing: flat grid edges are skipped, only the
  sharp feature edges chamfer — the exact plane+frame case from the bug now produces clean
  geometry instead of aborting.
- **Live tool** (`render/tools/BevelTool.ts`) — edge bevel graduates off the build-once modal to
  a **rebuild-on-change** model (segments/angle/mode change topology, not just positions). Holds
  a before-snapshot; any param change → restore → re-run → preview. Stays active with a settings
  panel; bakes ONE undo step on commit. Self-commits when the selection or edit mode changes
  (input is locked while active, so that IS the user moving on — the C4D "live until you do
  something else" behavior). Width scrubs by dragging in the viewport; plain click / Enter / Apply
  commit; Esc / RMB / Cancel abort. `BevelToolParams` in jotai + the `EditorViewportState` facade
  (`subscribeBevel` fires only on param change); `BevelSettings` floating panel (mode toggle,
  width / segments / angle NumberDrag, Apply / Cancel).
- **Two modes** — **chamfer** replaces the edge with a strip (original behavior); **straight**
  keeps the selected edge (original vertices preserved) and bridges each receded face to it with
  a quad ("adds edges without modifying the selected edges").
- **Segments (int)** — chamfer strips subdivide into N quads whose ring points slerp along an arc
  between the two face corners → rounded edges (1 = flat chamfer).

## Verified

Op-direct + live viewport. Bug: open plane keeps its outer boundary (no giant cap); plane+frame,
bevel all 28 interior edges @ 40° → only the ~90° frame edges chamfer, valid, boundary preserved.
Live tool: `B` on all cube edges → live chamfer + panel + gizmo hidden; angle 100 skips the 90°
edges (back to 6 F) then 40 re-chamfers; width live; Apply = one "Bevel" step (undo→6, redo→26);
mode-switch self-commits. Modes/segments: segments=4 → smoothly rounded edges (62 F); straight →
original 8 verts kept + flanking loops (30 F / 32 V); both valid. Property tests exercise
segments=3 and straight over the 4 fixtures. `tsc -b` clean; `vp test` 121/121.

## Commits

`d6f2364` boundary fix · `01fea33` angle threshold + opts object · `5c6078d` live tool framework
· `a9973f8` segments + straight mode.

## Known limitations (v1)

- Edge bevel is clean on planar-convex faces (cube/cylinder); non-planar (sphere) uses a Newell
  plane approximation, concave/partial-junction configs may abort. Segments round the STRIPS;
  vertex-junction corners stay faceted (single cap) — a deliberate simple-corner scope, not full
  rounded-corner meshing. Strips/caps get placeholder UVs.
- Straight mode ignores segments (always flat bridges).

## Next steps

1. **D6 snapping** — vertex/edge snap for component moves (grid snap exists).
2. Then D7 boolean worker / D8 pen tool + splines / D9 spline extrude / F1+F3 / C5 to close M1.
3. (Polish) rounded vertex corners for segments>1; proper strip/cap UVs; straight+segments.
