# PLAN_PROGRESS_10 — M1 kickoff: D4a component modes, picking, overlays, component TRS

**Date:** 2026-07-09
**Chunks worked:** D4 (first half — "D4a"); M0 signed off by user this session
**Milestone context:** M1 in progress. D4 split into D4a (this session: modes/selection/overlays/TRS) and D4b (next: extrude, inset, weld, delete/dissolve + property tests + per-mode toolbar tools).

## Completed

- **Edit modes live** — ToolRail point/edge/polygon buttons enabled (texture stays M2). Entering a component mode with a primitive active **auto-converts it** (Spline-style) via the existing `ConvertToMeshCommand` as one undoable step; `Selection.editMode` drives everything downstream.
- **Component addressing** (`geometry/kernel/components.ts`) — canonical edge handles (boundary halfedge or the smaller of a twinned pair), `uniqueEdges`, `edgeVerts`, `vertsForSelection` (mode → distinct vert set), `vertexCentroid`. Unit-tested (cube: 12 edges, dedupe, centroid).
- **Component picking** (`render/picking/componentPicking.ts`) — points/edges by 2D screen distance with pixel tolerances (10px/8px) projected per pane; polygons by BVH raycast mapped through `RenderMesh.triFace`. Click ops: replace / shift-add / ⌘-toggle; empty replace-click clears. Component clicks are locked to the ACTIVE editable mesh (C4D-style).
- **Component overlays** (`render/overlays/ComponentOverlays.ts`) — wireframe LineSegments (selected edges in primary), billboarded screen-constant vertex handles as TWO InstancedMeshes (selected/unselected — avoids instanceColor backend risk), selected-face highlight rebuilt from the render triangulation. Wire/faces live in mesh-local space under a group mirroring the node's matrixWorld; points are world-space billboards updated per pane. Version-guarded rebuilds (scene + selection slices + topologyVersion).
- **Component move/rotate/scale via the ONE gizmo** — `render/gizmo/componentDrag.ts` (`componentContext` + `ComponentDrag`); `TransformGizmo` gains a component branch: centroid placement, hidden when no components selected, shared plane/snap math, then per-vertex world-space transform → mesh-local write-back. Uniform-scale (shift) and grid/angle/scale snapping work on components too.
- **Mesh-edit undo plumbing** (`geometry/commands/meshEdit.ts`) — `SetMeshPositionsCommand` (packed before/after for affected verts, real memoryCost) + `ComponentTransformSession` (preview-tagged updates, ONE step per drag, cancel restores, no-op commits skipped). `Document.touchNode(id, preview)` added in core: external (registry-mesh) payload changed → scene bump + node-changed, no data rewrite.
- **Render sync for live mesh edits** — `SceneSynchronizer.syncGeometry` now re-syncs registry meshes with dirty flags even when the cache key is unchanged (positions-only path in RenderMesh is cheap); **BVH rebuilds are skipped during preview frames** (`bvhStale`) and run once on the settling non-preview touch. `renderInfoFor(id)` exposes geometry + triFace for picking/overlays.

## Verified in-browser (WebGPU, live drags via synthetic pointer events)

- Point-mode entry auto-converts ("Convert Cube to Mesh"), 8 vertex handles + 12 wire edges appear.
- Vertex click selects (handle turns primary, gizmo on the vertex); X-arrow drag moved it exactly +0.5 X; ONE "Move Components" step; undo/redo exact; **rendered geometry follows undo** (max X back to 0.5).
- Edge click selects the canonical halfedge, gizmo at the edge midpoint.
- Face click maps to the correct kernel face (+Z entry face); scale-cube drag scaled the face ×2 about the selection centroid (Z untouched); one "Scale Components" step; undo exact.
- Shift-add → {5,6}; ⌘-toggle removes; empty click clears and hides the gizmo.
- Top ortho view: vertex select + X-arrow move (+0.75, Y/Z zero) — the M0X gizmo layout keeps component drags usable head-on.
- Object mode regression: click-select, gizmo, overlays hidden — all normal. Gates: `tsc -b` clean, `vp test` 84/84 (9 new).

## Fixed along the way

- **three-mesh-bvh `faceIndex` is in BVH order, not authored order** — `computeBoundsTree` installs a PERMUTED index over the non-indexed corners, so `triFace[hit.faceIndex]` returned the wrong kernel face (raycast hit point was on +Z, mapped face was −X). Fix: map back via `index.getX(faceIndex*3)/3` (authored corner → authored triangle). Face highlight was unaffected (it reads positions + triFace both in authored order).
- `InstancedMesh` is fixed-capacity — allocating with count 0 yields unusable zero-length buffers; points meshes now allocate `vCount` capacity and recreate on growth.

## Decisions made (and why)

- **D4 split** into D4a/D4b — the full op set with property tests is > one session at our verification standard; D4a is a coherent, independently verified foundation.
- **Auto-convert on entering component modes** (vs C4D's explicit-only "make editable") — matches the Spline north star's frictionless direct editing; still one clean undo step.
- **Component clicks locked to the active object** — C4D behavior; Blender-style multi-object editing out of scope.
- **Two instanced meshes for vertex handles** instead of `instanceColor` — deterministic on both backends after the LineLoop/WebGPU episode.
- **BVH staleness deferred to drag end** — rebuilding per preview frame would hitch; stale BVH during a drag only affects picking mid-drag, which doesn't happen.

## Files added / changed

- core: `document/Document.ts` (touchNode)
- geometry: `kernel/components.ts` (+test), `commands/meshEdit.ts` (+test)
- render: `picking/componentPicking.ts`, `overlays/ComponentOverlays.ts`, `gizmo/componentDrag.ts`, `gizmo/TransformGizmo.ts`, `scene-sync/SceneSynchronizer.ts`, `viewport/ViewportSystem.ts`, `viewport/ViewportInput.ts`
- ui: `shell/ToolRail.tsx`

## Test status

- `tsc -b`: clean. `vp test`: 84/84. (`vp check` runs via the pre-commit hook; watch the recurring tsgolint hang — `pkill -f tsgolint` if wedged.)

## Known issues

- Point/edge picking is pure 2D-nearest: overlapping projections (e.g. top view where top/bottom cube verts coincide) tie-break by lower index instead of nearest-to-camera. Add a depth tie-break in D4b.
- No box/lasso component selection yet (Selection-niceties backlog).
- Component edits live only in the registry — a browser refresh drops converted-mesh geometry (existing H1 limitation, now more visible).
- Pre-existing HMR-only MenuBar setState warning (PLAN_PROGRESS_9) still around; absent on fresh loads.

## Post-round: polygon display colors, outline suppression, per-mode selection memory, Attributes component editing

Four user requests after the D4a review:

- **Selected polygons show orientation** — the face highlight is now two single-sided meshes over ONE shared geometry: camera-facing triangles in `--color-warning` (FrontSide), away-facing in `--color-info` (BackSide) — so a selected face reads warning from the front and info from behind, exposing winding at a glance. Edges bounding a selected polygon light up in primary in the wire overlay ("same as objects"; 1px — `linewidth` is a no-op on WebGL/WebGPU, the 2px-outline treatment for edges can come later if wanted).
- **Object silhouette suppressed outside object mode** — `SelectionOutline.sync` drops/skips outlines whenever `editMode !== "object"` (mode switches fire `selection:changed`, so it passes through sync both ways).
- **Per-mode component selection memory (C4D)** — `Selection.components` is now `Map<node, Map<ComponentMode, ComponentSelection>>`; `componentsFor(node, mode)`, `setComponents` stores under `sel.mode`, `clearComponents(node, mode?)` clears one mode / node / all. Empty viewport clicks clear only the CURRENT mode. Verified live: points {5,6} survive an edge-mode detour, polygon memory intact, overlays/gizmo restore from memory. Unit-tested (3 new tests).
- **Attributes component section** — in point/edge/polygon mode the panel shows `Points/Edges/Polygons (n)` with X/Y/Z NumberDrags (object-space): one point edits its exact position; multiple components act as ONE — fields show the selection **centroid** and edits translate the whole selection rigidly (typed 0.5→1.5 → both verts +1.0, one "Move Components" step, undo restores mesh and panel). Streams through `ComponentTransformSession` like the transform fields.
- Also: `NumberDrag.setPointerCapture` wrapped best-effort (same convention as ViewportInput) — synthetic/test pointers used to throw before the drag ref was set, killing click-to-edit under e2e drivers; real mice were unaffected.

## Post-round: selection bounding box (W/H/D + flatten) and mode-locked Attributes

- **Selection bounding box in Attributes** — a Size row (W/H/D, object-space AABB via new `vertexExtents`) sits under Centroid whenever the selection spans >1 vertex. Edits scale the selection about its centroid so the extent hits the typed value; **typing 0 flattens** the selection onto the centroid plane for that axis (verified: H→0 collapsed all 8 cube verts to Y=0 in one "Scale Components" step; undo restored both mesh and fields). All field math runs off a scrub-start snapshot (`ComponentScrub`), so repeated keystrokes are exact and a flattened (degenerate) axis can't NaN — expanding a 0-extent axis is a documented no-op (no direction to recover).
- **Mode-locked Attributes panel** — in point/edge/polygon mode the panel shows ONLY the component section and the dock tab retitles to Points/Edges/Polygons (via dockview's `panel.api.setTitle`, passed structurally from Shell); object settings (name/visible/transform/params/light/target) render only in object mode. The section legend is now `n Selected` (the tab already names the mode). Verified live through the real tabs: Attributes ↔ Points/Edges retitle both ways, object legends return in object mode.

## Post-round: converted meshes survive reload (autosave v2)

- **Bug (user-reported):** edited/converted meshes reverted to the primitive fallback with "mesh data missing" after a browser refresh — the localStorage autosave stored only the document DTO; the kernel meshes lived solely in the in-memory `meshRegistry`.
- **Fix:** autosave payload v2 (`thride:autosave:v2`) = `{ document, meshes }` — every node-referenced registry mesh is packed via new `src/io/storage/meshPack.ts` (typed arrays → base64 of their bytes, chunked `btoa`; JSON-safe, same-machine interim until the binary `.hem` chunks of H1). `loadLocalProject()` registers the unpacked meshes BEFORE returning the DTO, so the scene rebuild after `loadDTO()` finds them; corrupt mesh entries are dropped individually. v1 payloads migrate (document only — their meshes were never saved) and the old key is removed.
- Round-trip unit-tested (bit-exact arrays incl. an edited vertex; truncated data throws instead of building a broken mesh). Verified live: convert → move vert 6 to (1.25, 2.5, 0.75) → real `location.reload()` → mesh restored bit-exact, deformed shape renders (not the fallback cube), MeshInfo shows real counts, point mode works on the restored mesh.
- Note: localStorage quota (~5MB) bounds this interim path for large meshes — H2's OPFS autosave replaces it.

## Post-round: IndexedDB project storage + multi-project workspace tabs

- **localStorage → IndexedDB (user-directed):** scene data now lives in an `idb` database `thride` / `projects` store — ONE record per project `{ id, name, updatedAt, document, meshes }`, with kernel meshes stored as structured-clone snapshots (typed arrays store natively — no base64; `meshPack` survives only for the one-time legacy migration). Zero-dependency promise wrapper in `src/io/storage/projectStore.ts`. If scenes ever reach hundreds of MB, the noted split is a `projects` + `objects` store pair; a single record is fine at current scales. Legacy `thride:autosave:v1/v2` payloads migrate into a project record on first boot and the keys are removed.
- **Multi-project workspace** (`src/ui/hooks/doc/projects.ts`): several projects open at once; the active one is installed into `docAtom` so the whole downstream (shell/panels/viewport) keys off the existing contract. Per-project debounced IDB autosave (+ close-flush + beforeunload flush); which tabs are open + which is active is session state in localStorage (`thride:workspace:v1`, like the dock layout). `File → New Project` now opens a new tab (was: wipe the current document). Closing a tab keeps the stored record; the last tab can't close.
- **Project tabs UI** (`src/ui/shell/ProjectTabs.tsx`): top level directly below the menu bar — daisyUI `tabs tabs-lift tabs-sm`, horizontally scrollable (`overflow-x-auto`, flex-none tabs), ✕ per tab (hidden when only one), `+` appends a seeded "Untitled N".
- **Critical enabler:** `sliceVersionAtom` now re-attaches its document subscription when `docAtom` changes — mounted panels previously kept listening to the FIRST document forever, which would have frozen every panel after a tab switch.
- Verified live end-to-end: legacy autosave migrated to IDB on boot (keys removed); "+" opened an isolated seeded project; tab clicks swap documents with panels tracking (Objects/Attributes/viewport all follow); edited vertex in project A survived tab round-trips AND a full reload bit-exact alongside project B's distinct content; active tab remembered across reload; 8 tabs overflow and scroll horizontally; close keeps records. Zero console errors across create/switch/close on a fresh load (earlier scary entries were a stale HMR console buffer).
- **Known issues:** per-pane camera rigs live in the ViewportSystem, which is recreated on tab switch — camera PSR resets when switching projects (per-project rig memory is a follow-up). Editor viewport state (pane cameras/layout atoms) is global, not per-project.

## Next steps (exact, resumable cold)

1. **D4b:** topology ops as `(mesh, selection, params) → { newSelection }` in `geometry/ops/`: extrude (faces), inset, weld, delete/dissolve — each one undo step (kernel snapshot command), each property-tested for half-edge invariants (`validate.ts` exists).
2. Per-mode tools in the ToolRail (extrude/inset/weld buttons appear in component modes) — the M1 "context toolbar".
3. Depth tie-break for point/edge picking; then D5 bevel, D6 snapping (vertex/edge snap), D7 boolean, D8/D9 splines, F1/F3, C5 to close M1.
