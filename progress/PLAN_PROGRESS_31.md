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

### M4 — E7 Stage 5 shipped → **done-when MET**

- **Stage 5** (`675046e`) — the node graph is fully editable in the panel.
  - **Sync model** (per advisor): edits are Rete-first; a JSON signature gates the remount effect —
    panel-originated edits stamp the sig so the editor never remounts (no view jump, scrubs at frame
    rate), external changes (undo/redo, material switch) have a stale sig so it rebuilds. Structural
    edits Rete can't self-reflect (add/delete node, dropdown) rebuild with the transform preserved.
  - `reteEditor.ts`: `node.id = DTO id`; debounced structural-event pipe (one commit per gesture);
    `readStructure()` reads wiring/positions back; custom control preset. `graphControls.tsx`:
    editable widgets — select dropdowns (noise type/op/blend/space, structural), `NumberDrag` params
    (live-uniform scrub), colour swatch; each stops pointer events from panning the canvas.
  - `NodeGraphPanel.tsx`: applies each edit as a DTO delta, commits via `UpdateMaterialCommand`
    (scrub pattern — live during drag, one merged command on release); one-wire-per-input on read-back.
  - **User requests done:** double-click background zoom disabled (area-plugin `onzoom(...,'dblclick')`
    dropped via a pipe); right-click → the app's `ContextMenu` with an **Add Node** submenu; right-click
    a node → **Delete Node**.
  - **Verified live in Chrome:** add node (5) → undo (4) = one step; dropdown/colour/number widgets
    edit; right-click adds at the cursor; double-click no longer zooms; zero console errors.
- **M4 done-when MET:** a `noise→ramp→color` (and `fractal→bump→normal`) graph can be built entirely
  in the UI; viewport/thumbnail are live with zero recompile on param scrubs (Stage-3 gate + unit
  test); each structural edit is one undo step; the graph survives save/reload (autosave verified).

### M4 — node-editor UX redesign (user-directed) (`ba9c83c`)

- User feedback: the inline Rete value widgets were janky and a value edit could **blank the canvas**.
  Reworked so the **Rete canvas is wiring-only** (nodes = title + sockets) and **all value editing
  moves to the Attributes panel**, reached by **double-clicking a node**.
- `inspectedNodeAtom` — the Attributes panel follows the **last-clicked** thing (scene object OR graph
  node; selecting an object reverts to object attributes). `GraphNodeAttributes` renders the node's
  dropdowns/params/colour/ramp with the **existing inspector widgets** (`Field`/`NumberDrag`/`select`/
  `RampEditor`) + the same scrub-commit history pattern. `focusPanel` shell hook brings Attributes to
  front on double-click. Deleted `graphControls.tsx`.
- **Root-cause fix:** `NodeGraphPanel` now gates canvas rebuilds on a **topology signature** (node
  ids+kinds + wiring) — value edits change the graph but not the topology, so the canvas is never
  rebuilt underfoot. Rebuilds only on add/delete/undo/redo/material-switch (connect/disconnect stamp
  the sig; transform preserved).
- **Verified live:** wiring-only nodes; double-click Noise → Attributes focuses + shows Type/Scale/…
  in app widgets; changing Type → Worley leaves the canvas intact (4 nodes) and recompiles the material.
  _(Dev-server shows a stale Vite HMR error for the deleted `graphControls.tsx` — cosmetic; `tsc` is
  clean, no source imports it. Clears on dev-server restart.)_

### M4 — node-editor UX round 2 (user-directed) (`5ecb230`)

- **BUG fixed at the root — canvas disappeared on any wire/value edit:** the stamped-signature
  guard let React run the old effect's CLEANUP (destroying the Rete editor) and then early-return
  without remounting. Removed the stamp/guard machinery — the mount effect always pairs
  mount/cleanup on `[matId, canvasSig]`, where `canvasSig` = topology + selects. Value scrubs stay
  out of the sig (no rebuild); wiring/select edits rebuild with the view transform preserved.
- **Double-click a material card** → selects it and opens/focuses the **Node Editor below the
  viewport** (exists→focus guard added to `openNodeEditor`; focus requests route through it).
- **Noise node = NoiseEditor parity:** Type (param carry-over on swap), **Space** (object/world/uv
  - flat/triplanar/cylindrical/spherical via `projectedSample` when `coord` is unwired; disabled
    with a hint when wired), Seed, per-type params, Contrast/Bias/Clip Low/High. Shaping extracted to
    `procedural/shape.ts` (`shapeValue`) and shared with the layer compiler; all live uniforms.
- **Interactions:** single-click a node → its attributes show (last-clicked wins, no focus steal);
  double-click → Attributes comes forward (detected from `nodepicked` timestamps — DOM `dblclick`
  breaks when the first click re-renders the node); **Delete/Backspace** deletes the selection (one
  undo step, Output excluded, swallowed inside the canvas so scene-delete never fires; ⌘Z bubbles).
  Node context menu removed; background right-click keeps Add Node.
- **"Coordinate" → "Coordinate Space"**, and Blender-style **inline fallbacks on unwired inputs**
  (`ui/nodegraph/inlineControls.tsx`): noise coord → space select, math a/b → number drags, mix a/b
  → colours, ramp t / bump height → numbers; the Coordinate Space node shows its select on-canvas.
- **Verified live in Chrome** end-to-end (incl. socket-drag wiring with the canvas intact). +4
  compiler tests.

### M4 — detached wires stay live for re-wiring (`cb9c359`)

- Grabbing a wire off an occupied input is Rete's re-wire gesture (pseudo-connection follows the
  pointer), but we committed the removal the instant `connectionremoved` fired — the rebuild killed
  the drag and the wire vanished. Structure commits are now **deferred during a wire drag**
  (`connectionpick`/`connectiondrop` bracket it) and flushed once on the drop: pick-up→re-drop is a
  single rewire commit, drop-in-void is the deliberate disconnect, and a no-op guard skips the
  commit when the wire lands back where it started. Verified live: no mid-drag rebuild, ghost stays
  rendered, re-drop connects, one ⌘Z restores.

### M4 — node canvas themed to the app UI (`10a5a0f`)

- Custom Rete components in `ui/nodegraph/nodeTheme.tsx` (Tailwind/daisyUI only, no custom CSS):
  nodes = `base-200` panels with `base-300` borders + title strip at inspector type scale;
  selection = primary border + soft ring (matches material-card selection); sockets = primary dots
  with padded grab area + hover scale; wires = the classic curve restroked in primary/60; canvas =
  the app's `dot-bg` over `base-300`. The classic preset's DOM contract (data-testids, RefSocket/
  RefControl registration) is preserved, so hit-testing/positions/interactions are untouched.
  Inputs with inline fallbacks now show label AND widget. Verified live incl. rewire + undo.

### M4 — E7 Stage 6 shipped → **all E7 stages complete** (`fab6947`)

- **Per-node preview thumbnails** — `emitNodePreviews()` (one GraphEmit pass → per-node vec3s) +
  `GraphNodeThumbnails` (own WebGPU device, aspect-correct quad, dataURL per node). The panel owns
  one renderer across canvas rebuilds, re-renders debounced (120ms) on ANY graph change, and applies
  srcs imperatively (`data-node-thumb`) — previews ride outside React since value edits never
  re-render the canvas. Verified live: position gradient / Worley / ramp-mapped previews, refreshing
  on a Type change.
- **Error badges** — `graphProblems()` flags cycle members + unknown noise types (both structural →
  build-time badges stay correct); `ThrideNodeData` payload carries `problem`, title row renders a
  red dot with the reason tooltip. Diagnostics unit-tested (+2 tests).
- **Initial framing** — retry `zoomAt` until the dock panel has real dimensions (the zero-size
  container was what framed nodes into a corner). `compileAsync` warm-swap was already live via
  Stage 3's `hasLook` routing.
- Also this round (user-directed): option-drag node copy + copy cursor (`4f4f7fc`), connected
  sockets filled `bg-primary` (`0be55f6`), canvas themed to daisyUI `sunset` (`10a5a0f`), detached
  wires stay live for re-wiring (`cb9c359`), RampEditor 7px endpoint inset (`ac4f693`),
  `erasableSyntaxOnly` + real-type-gate fixes (`4fff55d`, `4584ac4` — `pnpm check` now runs `tsc -b`).

### M4 — node-editor UX round 3 (user-directed) (`4ba506e`)

- **Ghost copy** — from the first move of an option-drag a 45%-opacity clone marks the original
  spot, so both nodes are visible while copying. **Solo** (Monocle01Icon → new `IconSolo`) +
  **Bypass** (`toggle-xs`) in every node title: bypass = first-wired-input passthrough (dims 55%,
  per-node, structural); solo = material color previews only that node, other channels unbind
  (graph-level `solo?: Uuid`, structural; `hasGraph` treats soloed graphs as live). Both in
  `graphStructureKey` + `canvasSig`.
- **Multi-select** — Shift or ⌘/Ctrl accumulates; picking an already-selected node keeps the
  selection, so dragging any member moves the whole group without a modifier.
- **Navigation** — middle-drag pans; C4D Option+right-drag zooms about the grab point (menu
  suppressed for alt-right / after nav drags); left-drag background pan unchanged.
- Verified live end-to-end; +1 compiler test. Gates: tsc -b clean, lint 0, `vp test` **301**.

## Left mid-flight

- **Nothing — M4 (E7 stages 1–6 + all user-directed UX rounds) is complete.** Milestone hard stop:
  awaiting user sign-off before M5 (Import & UV-ready geometry: N1 OBJ import, H3 GLTF import,
  N3 untriangulate, N2 headless auto-unwrap).
- Gates green: `pnpm check` (tsc -b) clean, lint 0 errors, `vp test` **300 passing**.

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
