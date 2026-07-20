# PLAN_PROGRESS_31 — M3 closeout + M4 kickoff

**Date:** 2026-07-20
**Chunks worked:** F2, F4 (M3 closeout); E7 (M4 kickoff)
**Milestone context:** **M3 signed off / done.** M4 (Node material editor, E7) now open — planning stage.

## Completed

### M3 — Scatter & cameras — signed off

- **F2 Cloner** — linear/radial/grid/object-surface distributions → InstancedMesh, random
  effector (pos/rot/scale jitter + seed), animatable count, Convert to Objects, clones inherit
  the template material, per-instance-local texture projection. Stacking bug (WebGPU submitting
  destroyed buffers on template change) fixed by building a fresh InstancedMesh on template
  change + deferring RenderMesh geometry dispose (`ClonerSync.retireMesh`).
- **F4 Cameras** — camera objects with frustum-helper gizmos, per-pane look-through, DOF
  (PBR + look-through only), C4D/Blender lens model (focal length + X/Y film offset, fixed
  full-frame 36mm sensor) mapped onto three's `PerspectiveCamera`; fov-independent gizmo;
  orbit-through-selected-camera fix; look-through helper hiding; NaN-helper fix for cameras
  missing `focalLength`.
- **Area-light LTC crash** — resolved earlier in M0X (folded forward).
- **Done-when met:** user verified **200k instances run smooth** (well past the 100k @60fps
  budget); any camera binds to any pane via per-pane look-through; area lights don't crash.

### M4 — Node material editor (E7) — Stage 1 shipped (headless)

- **`MaterialGraphDTO`** ([src/types/core/graph.ts](src/types/core/graph.ts)) — nodes/connections/
  output, stable UUID ids, `float`/`vec3` socket coercion, the load-bearing param split
  (`select` = structural/recompile; `params`/`colors`/`ramp`/`position` = live/UI-only),
  `defaultMaterialGraph`/`defaultGraphNode`, `graphStructureKey`. `graph?` added to `MaterialDTO`.
- **Graph compiler** ([src/materials/graph/](src/materials/graph)) — `CompiledGraph` matches the
  layer-stack compiler's consumer contract (`nodes`/`applies`/`update`/`dispose`), documented via a
  new `CompiledMaterial<TDoc>` interface so Stage 3 can widen the binder without a rewrite. Memoized
  DFS with a **cycle guard** (fail-safe mid-gray), per-kind emitters (output/noise/coord/float/
  color/math/mix), reuses `noiseDef().sample` + `blendLayer` + `UniformTable`. Scalar channels bind
  `.r`; the normal channel binds directly (the bump node owns height→normal — Stage 2).
- **13 tests** hit the done-when clauses: compiles, zero-recompile scrubs (`getGraphCompileCount`),
  structural invalidation, vec3→scalar coercion, cycle safety, JSON round-trip. Gates green (tsc
  clean, lint 0 errors, `vp test` 283 passing, +13). Committed `83483bd`.

### M4 — E7 Stages 2–4 shipped

- **Stage 2** (`ea4e4e8`) — ramp + bump node emitters. Ramp node → `RampTexture` lookup (reuses
  `procedural/ramp.ts`); `CompiledGraph` owns the textures (update re-bakes stops, dispose frees).
  Bump node → view-space normal via `procedural/bump.ts`, bound straight to `Output.normal`. Both
  done-when graph shapes now compile.
- **Stage 3** (`87ca4a5`) — live viewport integration. `proceduralBind` gains `CompiledLook`
  (normalizes E7 graph + E3 stack to one `nodes`/`applies`/`update`/`dispose` contract; **graph
  wins** when present). `lookKey` tags the front-end (`g:`/`s:`) so a graph⇄stack switch is
  structural. `MaterialSync` + `materialThumbnails` compile via `compileLook` — a graph material
  renders live in viewport + thumbnails on the same recompile gate. +7 tests.
- **Stage 4** (`475d2fd`) — Rete v2 node editor panel (read-only render + pan/zoom/select). Added
  `rete` + area/connection/react plugins + `styled-components`. `GRAPH_NODE_DEFS` catalog
  (sockets/params/selects per kind) added to the schema. `ui/nodegraph/`: `starterGraph`
  (coord→fractal→ramp→color), `mountNodeEditor` (DTO→Rete), `NodeGraphPanel` (selected-material
  aware; empty state seeds the starter via `UpdateMaterialCommand`). Registered `nodeEditor` dock
  panel + View → Node Editor. **Verified live in Chrome:** create graph → nodes render with
  sockets/wires/params → the material thumbnail shows the fractal pattern (full E7 loop end-to-end).

## Left mid-flight

- **E7 Stages 5–6 remain.** **Stage 5** — full in-panel editing (add-node menu, connect/disconnect/
  delete, param widgets writing back through `UpdateMaterialCommand`, each structural action = one
  undo step). **Stage 6** — per-node offscreen thumbnails, error badges, optional `compileAsync`
  warm-swap. Polish carried forward: theme the Rete nodes to daisyUI `sunset` (currently default
  Rete blue); improve the initial `zoomAt` framing (nodes cluster at the panel bottom).
- Gates green through Stage 4: tsc clean, lint 0 errors, `vp test` **294 passing**.

## Decisions made (and why)

- **`camera` texture projection (E4) stays deferred** — user call. F4 unblocked it (cameras now
  carry lens data) but it remains a M10-polish item, not pulled forward.
- **M3 marked ✅ Done in PLAN.md** with the deferred list recorded inline on the milestone line.

## Files added / changed (this closeout)

- `PLAN.md` — M3 milestone line marked done + deferred items.
- `progress/PLAN_PROGRESS_31.md` — this file.
- (F2/F4 code all landed in prior commits through `0bacea6`.)

## Test status

- Last full gate (end of F4): `tsc -b` clean, `pnpm lint` 0 errors, `vp test` 270 passing.
- No code changed in this closeout commit, so gates unchanged.

## Known issues

- None blocking. DOF is single-look-through / single-layout (intended). Orthographic scene
  cameras deferred. Film-offset gizmo base-shift is cosmetic-deferred.

## Next steps (exact, resumable cold) — M4 / E7 Stage 1

1. Read `src/materials/` compiler infra to reuse: the M2 layer-stack compiler's uniform table,
   gradient-ramp DataTextures, `structuralKey` recompile gate, and the `MeshStandard/Physical
NodeMaterial` compile slots (`colorNode`/`roughnessNode`/`normalNode`/`positionNode`). E7
   emits the **same** slots — render/bake/viewer must be unaffected.
2. Define `MaterialGraphDTO` (nodes + connections) as an optional `graph?` on `MaterialDTO` in
   `src/types`. Node kinds for Stage 1: **output**, 7 **noises**, **coord/UV**, **value**,
   **color**, **math**, **mix**.
3. Build `src/materials/graph/` compiler: memoized DFS over the graph, uniform-scrub path
   (param edits → uniform writes, zero recompile), `structuralKey` recompile gate. Emit into
   the existing channel slots.
4. Write compiler unit tests (graph → TSL slot presence, scrub = no recompile, structuralKey
   stability). Then Stage 2 (texture/ramp/bump emitters), Stage 3 (live viewport integration).
5. **Rete.js is the editor lib** (`rete` + React render plugin) — not yet a dependency. Add it
   only when Stage 4 (panel) begins; Stages 1–3 are headless (compiler + tests), no UI.

**Milestone hard stop reminder:** M4 done-when — `noise→ramp→color` and `fractal→bump→normal`
built entirely in the UI, live viewport with zero recompile on scrubs, one-undo-step structural
edits, graph survives save/reload. Wait for user sign-off before M5.
