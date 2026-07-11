# PLAN_PROGRESS_16 — M1 COMPLETE: pen tool, splines, extrude generator, booleans

**Date:** 2026-07-10
**Chunks worked:** D8 (splines + pen), F1 (generator graph), D9 (spline extrude), D7 (boolean
worker), F3 (boolean object), C5 remainder (tone mapping). **M1 is complete — HARD STOP for
user sign-off before anything M2.**
**Commits this session:** `b534e71` (D8) · `790d021` (F1+D9) · `e2e2972` (D7+F3+C5).
Earlier same-day: miter fix + D6 snapping (PROGRESS_15), bevel tool (13), theme/C5 groundwork (14).

## D8 — 3D pen + spline editing (the Spline-app centerpiece)

- **Data** (`types/geometry/spline`, `geometry/splines/*`): bezier points with RELATIVE in/out
  handles; tangent modes smooth (collinear, independent lengths) / broken / linear. Positions are
  node-local — **the node transform IS the work plane** (local XY = plane, +Z = normal), so the
  pen writes z=0 and you draw in 2D but in perspective. Pure eval (crisp linear spans), tangent
  ops, selection stamp = point count.
- **Pen** (`render/tools/PenTool` + `penPlane`): phase 1 shows the RED work-plane preview
  (translucent fill + red grid) following the cursor; orientation auto-picks the world plane most
  facing the camera; **X/Y/Z force an axis, A returns to auto**. First click locks the plane,
  creates the node, places point 1. Drawing: click = corner, click-drag = mirrored smooth handles,
  rubber-band preview, green marker + click-first-point closes, **Backspace removes the last
  point, ⌘Z walks the drawing back point-by-point** (SetNodeDataCommand gained `mergeable:false`
  so rapid clicks never coalesce — regression-verified), Enter/Esc/RMB/P finishes, degenerate
  splines self-delete. Alt-nav still orbits mid-drawing.
- **Editing** (`SplineEditTool` + `SplineOverlays` + `SplinePointPanel`): point mode on a spline
  shows anchors + tangent lines/knobs; plane-locked drags; multi-anchor moves; smooth points
  mirror handle DIRECTION keeping each side's length (verified dot(in,out) = −1 exactly);
  **⌘-drag breaks** a handle pair (Alt is nav); pulling a handle out of a linear point promotes
  it to smooth. Floating panel: **Linear · Curve (Catmull-Rom auto) · Break · Equal Angle ·
  Equal Length · 0° Y** + Closed toggle. One undo step per drag/op. Select All + Delete are
  spline-aware.

## F1 + D9 — generator graph + Spline Extrude

- `generators/graph`: pull-based, memoized per node by an input key; dirty propagation re-pulls
  ancestor generators on child edits/reparent/removal. `generators/splineExtrude`: child spline →
  **kernel HEMesh** (n-gon caps, quad walls — boolean-able and convertible), rounded bevel via
  quarter-arc rings + inward miter offset, ribbons for open profiles. Attributes panel: Depth /
  Bevel Size / Bevel Segs / Caps **live sliders**. Create > Spline Extrude adopts the selected
  spline. Convert to Mesh bakes any generator (deep-copied into the registry).

## D7 + F3 — Manifold boolean worker + Boolean object

- `workers/boolean.worker.ts`: **Manifold WASM off the main thread**, zero-copy transfers.
  `geometry/boolean/booleanEngine`: job client + HEMesh↔triangle-soup (earcut triangulator
  reused; dependency-free TRS compose applies child-local transforms).
- Boolean generator: async pull — returns the last good result instantly, kicks a worker job
  when the input key (mesh identity + topologyVersion + position checksum + transforms + op)
  goes stale, re-touches the node on completion; superseded jobs dropped; non-manifold input →
  renders nothing (no corruption). Create > Boolean adopts two selected mesh/primitive children;
  BOOLEAN panel section with Union/Subtract/Intersect.

## C5 remainder — color management

- Per-pane **Tone Mapping** (AgX default / ACES Filmic / Neutral) in Display; non-PBR renders
  untransformed. (Theme system + display modes landed earlier — PROGRESS_14.)

## Verified live (WebGPU, real UI paths — see commit messages for details)

Pen: P → red plane → draw 3 pts (smooth middle) → per-point undo → close → panel ops all pass,
⌘-break verified. Extrude: menu-created, adopts spline, depth 0.5→1.5 exact, spline edit
re-extrudes, bevel 0.12/4 rounds. Boolean: cube∖sphere 466 tris / union 726 / intersect 454,
child move recomputes async. Tests 130/130; `tsc -b` clean throughout.

## M1 QA checklist

- [x] Component modes + context toolbar (D4, PROGRESS_10/11)
- [x] Extrude/inset (modal), bevel (live tool, vertex+edge, modes/segments/angle/miter), weld
      (slide tool), dissolve, delete — each ONE undo step
- [x] Snapping: magnet vertex/edge + grid snap (D6, PROGRESS_15)
- [x] Boolean generator live-updates on child edits (F3)
- [x] Make editable: primitives AND generators (extrude + boolean bake)
- [x] Pen tool + spline extrude with sliders (north-star flow: draw → close → extrude → bevel)
- [x] Display modes + color management (C5: shading, lines/hidden-lines, tone mapping, theme)

## Known limitations (documented, deliberate v1 hedges)

- Generator inputs: extrude uses the first child spline (child transform ignored); boolean takes
  its first two mesh/primitive children (no generator-chaining yet — F1 full vision).
- Boolean UI has no non-manifold badge (result just disappears); no repair pass / bvh-csg
  fallback yet. Extrude/boolean UVs are placeholders. Spline Attributes tab shows the floating
  panel only (no point XYZ fields yet). PenTool plane offset is world-origin along its normal.

## Next steps

**STOP — M1 sign-off required.** After sign-off: M2 (materials & look — E1–E6, C6, A5).
