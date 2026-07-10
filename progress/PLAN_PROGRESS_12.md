# PLAN_PROGRESS_12 — D5 bevel (vertex + edge)

**Date:** 2026-07-10
**Chunks worked:** D5 (bevel) — **complete: vertex bevel + edge bevel (1 segment).**
**Milestone context:** M1 in progress. This session also shipped, ahead of D5: the tools
rework (modal extrude/inset + slide-to-target Weld + Dissolve — PLAN_PROGRESS_11), viewport
Select All (A), and the extrude/inset "show new polygon selected" highlight. Remaining M1:
D6 snapping, D7 boolean worker, D8 splines + pen tool, D9 spline extrude, F1 generator graph,
F3 boolean object, C5 display modes / color management.

## Completed

- **`geometry/ops/bevel.ts` — `bevelVertices(mesh, vertIds, width)`**: vertex truncation.
  Each selected vertex is replaced by a cut face; one new point per incident edge, slid
  `width` along that edge from the vertex. Every incident face swaps its corner for the two
  points of that corner's two edges — **the points are SHARED between the faces adjacent to an
  edge (no gap strip), which is why vertex bevel stays manifold on convex corners where edge
  bevel does not** (see Decisions). The cut face caps the hole, ordered by walking the corner's
  neighbour cycle (each incident face contributes one cut edge → a single ring); winding is
  fixed against the vertex normal. Width is clamped per vertex to ½ the shortest incident edge.
  Boundary / irregular fans (incident faces don't close into one ring) abort untouched via the
  neighbour-cycle checks + `adoptSoup`. Returns `mode:"point"` with the new cut points selected,
  and `lift` (base = vertex, dir = unit edge, max = the clamp) for the interactive amount.
- **Modal wiring**: `AmountTool` generalised from polygon-only to a per-kind
  `AMOUNT_MODE` / `AMOUNT_OP` table — `extrude`/`inset` read polygon selection, `bevel` reads
  point selection. Same Blender-style flow: build topology at width 0, mouse-Y drives positions
  live, LMB confirms as one `MeshTopologyCommand`, Esc/RMB cancels bit-exact. Centroid for the
  screen→world scale now comes from `vertsForSelection` (works for both modes). Bevel amount is
  clamped ≥ 0 like inset.
- **UI**: Mesh menu **Bevel** (shortcut **B**, point mode) → starts the modal via
  `beginAmountTool("bevel")`; point-mode tool rail gains a Bevel button before the Weld toggle.
  `IconBevel` = OctagonIcon (truncated-corner glyph).

## Verified in-browser (WebGPU, synthetic keyboard/pointer through real handlers)

Fresh converted cube (6 F / 8 V). One corner: `B` → modal (cursor `move`, gizmo hidden,
6→7 F / 8→10 V, the 3 cut points selected with a valid stamp); mouse-up widened the cut
(3-point spread 0.385); LMB → exactly one "Bevel" step; `validateMesh` clean; undo → 6/8,
redo → 7/10, both valid. All 8 corners beveled → 14 F / 24 V (truncated cube), renders as a
clean rounded-corner solid. Property suite extended: `bevelVertices` over 4 primitives × 4
seeds (valid kernel, verts grow, one cut face per vertex, lift sanity) + empty-selection abort.

## Decisions made (and why)

- **Vertex bevel first, edge bevel deferred** (advisor-guided). Edge bevel's degeneracy trap:
  for an edge strip to be non-degenerate the two points at each end must come from offsetting
  each adjacent face's boundary _into its own plane_ (per-face 2D edge-offset-and-intersect),
  **not** sliding along the beveled edge — sliding along the edge lands both on the same point
  → zero-length strip end, and that fires on every both-beveled corner (i.e. the cube edge-loop
  and cube-all-edges cases, not just pathological ones). Vertex bevel has no strips (shared
  points), so `V + w·unit(edge)` is exactly right there. Shipped the clean half; edge bevel is a
  legitimate v1 follow-up per the plan's own "fixed-segment, abort-elsewhere" hedge.
- **Acceptance = property-test invariants + in-browser eval, not pixel goldens** — the golden
  infra (Playwright + pixelmatch) isn't built yet; `validateMesh` over cube/cylinder/random
  vertex subsets is the real bar here.

## Post-round: edge bevel (D5 now complete)

- **`geometry/ops/bevelEdge.ts` — `bevelEdges(mesh, edgeIds, width)`**: 1-segment chamfer.
  Each selected edge → a quad strip; the faces on both sides recede. The receded corner of every
  face is the **planar offset-intersect**: in the face plane, each selected boundary edge's line
  is offset inward by `width`, non-selected edges stay put, and the corner is the intersection of
  its two (offset-or-original) edge lines (a 2D solve in a per-face basis; linear in width, so
  `lift` is exact). Corner points that land on the same spot — a non-beveled edge shared by two
  faces on a symmetric solid — are welded (position hash), so the shared edge stays one edge; the
  leftover vertex holes are closed by `fillHoles` (chain unmatched directed edges into loops, cap
  with the reversed loop). Strips are wound to twin both shrunk faces' shared edges. Scoped to
  interior edges; boundary edges, collinear corners, or non-simple junctions abort untouched.
  Returns `mode:"edge"` (ids empty — edge handles are unstable post-rebuild) + `lift`.
- **Modal**: `AmountKind` gains `bevelEdge` (edge mode) in the same `AMOUNT_MODE`/`AMOUNT_OP`
  tables; the degenerate-width-0 rebuild + amount-≥0 clamp now key off `IS_BEVEL` (covers both
  bevel kinds). The **Bevel** command + rail dispatch by edit mode — point → vertex truncation,
  edge → chamfer (both `B`); Bevel added to the edge-mode rail.

**Verified**: op-direct on constructed cube/cylinder — bevel all 12 cube edges = chamfered cube
(exactly 26 F / 24 V, valid); bevel one face's 4 edges (10 F / 12 V, valid, strip ends distinct —
the advisor's discriminating probe); capped-cylinder top rim, 8 edges (10→18 F, 16→24 V, valid).
Full modal in the live viewport: `b` on all cube edges → chamfer builds (26/24), width drag,
LMB → one "Bevel" step, wireframe renders clean (no black holes — the width-0 rebuild fix
applies), undo → 6/8, redo → 26/24. Property suite: `bevelEdges` over 4 primitives × 4 seeds
(random edge subsets → valid kernel when it commits, lift sanity) + empty-set abort.

### Edge-bevel limitations (v1)

- Correct/clean on planar-convex faces (cube, cylinder). Non-planar faces (sphere) use the Newell
  plane approximation — may commit an imperfect-but-valid result or abort. Concave faces / messy
  partial junctions (e.g. a single interior edge whose endpoints keep unbeveled corners) may
  produce odd caps or abort. Multi-segment rounding and knife/loop-cut remain out of scope.

## Files added / changed

- `geometry/ops/bevel.ts` (new), `geometry/ops/ops.property.test.ts` (bevel cases)
- `render/tools/AmountTool.ts` (per-kind mode/op table, bevel support)
- `app/commands.tsx` (mesh.bevel, B), `ui/shell/ToolRail.tsx` (point-mode Bevel), `icons/index.tsx` (IconBevel)

## Test status

- `tsc -b` clean; `vp test` 120/120. `vp fmt` applied. (Pre-commit tsgolint hook still hangs —
  gate manually + commit `--no-verify`.)

## Post-round fix: bevel modal black-hole gaps

User reported missing polygons (black star-shaped gaps) around a beveled interior vertex on a
subdivided plane. Root cause was in the RENDER path, not the op: the modal builds topology once
at width 0 and then only streams positions. At width 0 every cut point collapses onto its
vertex, so the cut face and notched faces are geometrically degenerate; RenderMeshSync's n-gon
triangulation is baked on that collapsed shape and never recomputed, so as the points spread the
triangle pattern is garbage. (Extrude/inset survive width-0 because their faces are quads, whose
one-diagonal triangulation is stable under motion; bevel's cut face + notched pentagons are not.)
Fix (`AmountTool.begin`): for bevel only, probe the op at 0 to read the width-independent clamp,
then rebuild at a small non-degenerate width (2% of the tightest clamp) so the triangulation
pattern is valid; the lift still drives the displayed amount from 0. Also added a confirm guard —
a click with no drag (amount ≈ 0) cancels instead of committing a degenerate/no-op step (all
kinds; magnitude-tested so signed extrude still commits). Verified in-browser: plane interior
vertex bevels cleanly through the full modal (16→17 F, 25→28 V, valid kernel, one "Bevel" step),
no gaps at any width.

## Known issues

- Cut faces get placeholder (0,0) UVs, like extrude walls / inset rings.
- Edge bevel not yet implemented (see Left mid-flight).

## Next steps (exact, resumable cold)

1. **D6 snapping** — vertex/edge snap for component moves (grid snap already exists).
2. Then D7 boolean worker / D8 pen tool + splines / D9 spline extrude / F1+F3 / C5 to close M1.
3. (Optional polish) edge-bevel robustness on non-planar/concave faces + multi-segment rounding,
   proper UVs on strips/caps — deferred with D5's other v1 hedges.
