# Thride — Master Plan for a Production-Grade Browser 3D IDE (v1.0)

## Context

There is no good production-grade Three.js editor. The goal is to build the first one: a browser-based 3D IDE in the spirit of Cinema 4D and Blender — polished, minimal, beautiful. **Product north star: an open-source Spline (spline.design)** — its direct-manipulation feel, its 3D pen tool for drawing splines in space, and its slider-driven extrude/bevel of splines are the interaction bar to hit; Blender 5's aesthetic is the visual bar. Scope deliberately excludes character rigging, hair, and simulation.

The project is scaffolded: a **Vite+ (`vp`) React 19 + TypeScript app** with pnpm, Oxlint/Oxfmt, Vitest (`vp test`), staged-file checks (`vp check --fix` pre-commit), and git initialized. **PLAN.md in the repo is the canonical plan** (this document, kept in sync); a `progress/` directory holds numbered session logs (`PLAN_PROGRESS_0.md`, `PLAN_PROGRESS_1.md`, …). The build is broken into small, independently start/stop-able chunks spread across many coding sessions — milestones are hard stop points, never blown through.

**Locked architecture decisions (confirmed with user):**

1. **Renderer:** Three.js `WebGPURenderer` + TSL node materials, with automatic WebGL2 fallback.
2. **UI:** Hybrid — React DOM shell (docking, menus, inspectors) + canvas-rendered specialized editors (timeline, curve editor, UV editor). Not a from-scratch canvas UI toolkit.
3. **Deployment:** Client-only, local-first. Static hosting, OPFS autosave, File System Access API, direct browser→S3/GCS uploads with user-provided credentials. No backend in v1.
4. **Mesh editing:** Full component-level editing in v1 — half-edge kernel, point/edge/polygon modes.

## Feature checklist (from the brief + gaps the brief missed)

**Requested:** robust primitive set (C4D-grade), boolean tool, hierarchical object manager, 1-up/4-up views with per-view camera assignment, lights, cameras, cloner with multiple distribution modes + instancing, UV editor, material manager (PBR default + all built-in Three materials), environment/dome light, GLB/GLTF import/export, native GLTF-based file format with extensions, custom shaders as live post effects, Maxon-noise-style procedural materials with layer stack + blend modes, baking procedurals to WebP with realtime quality preview, save/open across machines, S3/GCS storage, C4D navigation (Alt+LMB orbit-around-click-point, Alt+MMB pan, Alt+RMB dolly), click-select with unified TRS gizmo, context-sensitive left toolbar per edit mode (point/edge/polygon/object/texture), realtime texture projections (cube/flat/uv/cylindrical/spherical/camera), animation editor with keyframes for TRS + procedural material parameters.

**Gaps the brief missed — added to scope (the "have I forgotten anything" answer):**

- **Undo/redo** — the single most load-bearing system in any DCC; must be a command architecture from day one, not bolted on.
- **Color management** — linear workflow, AgX/ACES-filmic tone mapping toggle, sRGB output. Without this, nothing ever "looks right."
- **Snapping & grid/units** — grid snap, vertex/edge snap, world units.
- **Keyboard shortcut system** — central, remappable registry; every tool gets a key.
- **Autosave & crash recovery** — OPFS-based rolling autosave; browsers get killed.
- **Camera framing** — F/H to frame selection/all (per-view), essential for navigation.
- **Orthographic views** — the 4-up layout needs top/front/right ortho cameras, not just perspective.
- **Non-destructive generator stack** — Cloner and Boolean should be _generator objects_ (C4D-style live parents in the hierarchy), not one-shot destructive ops. This shapes the scene model.
- **Render-to-image** — high-res viewport snapshot (PNG/WebP) with post FX applied. "Production work" means deliverables.
- **Asset/project browser** — panel listing project textures, materials, imported meshes; drag-and-drop import (GLB, HDR/EXR, images).
- **Selection niceties** — isolate/solo, hide/show, selection sets, box/lasso select in component modes.
- **Copy/paste/duplicate** — with hierarchy, within and across sessions.
- **Settings page** — a real preferences panel: nav sensitivity, theme, layout presets, shortcut remapping, autosave interval, **undo-history memory budget (MB slider — the mesh-snapshot history must respect a user-visible cap)**, viewport quality options. Persisted to localStorage/OPFS.
- **Splines & pen tool (promoted into v1 per Spline north star)** — 3D bezier pen tool drawn directly in the viewport, spline primitives (circle/rect/n-gon/star), and a **SplineExtrude generator** with live sliders for depth, bevel size/segments, and caps — Spline's signature workflow.
- **Worker offloading** — booleans, texture baking, WebP encode, GLTF export in Web Workers/WASM; the UI thread must never hitch.
- **File format versioning/migration** — version field + migration functions from v1 of the format onward.
- **Stats HUD** — draw calls, tris, VRAM estimate, FPS.
- **Icon licensing** — Blender's icons are GPL; we can take _aesthetic_ inspiration but must ship an original SVG icon set.

## Tech stack

| Concern                 | Choice                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language / build        | TypeScript (strict), **Vite+ toolchain** (`vp dev/build/check/test` — Rolldown, Oxlint, Oxfmt, Vitest), pnpm; single app with nested `src/` modules (not a workspace monorepo) |
| 3D                      | Three.js (current release, `three/webgpu` + `three/tsl`)                                                                                                                       |
| UI shell                | React 19 + dockview (MIT, battle-tested docking/tabs/serialization)                                                                                                            |
| UI state binding        | Plain-TS core stores + event bus, exposed to React via `useSyncExternalStore` thin hooks (no Redux/zustand for document state; zustand allowed for pure-UI state)              |
| Booleans                | Manifold (WASM) in a worker; three-bvh-csg optional for live drag preview                                                                                                      |
| Raycast/selection accel | three-mesh-bvh                                                                                                                                                                 |
| HDR/EXR                 | Three RGBELoader / EXRLoader + PMREM for environment                                                                                                                           |
| GLTF I/O                | Three GLTFLoader/GLTFExporter + custom extension plugins                                                                                                                       |
| WebP encode             | OffscreenCanvas `convertToBlob({type:'image/webp', quality})` in a worker                                                                                                      |
| Icons                   | Original SVG set (Blender-5-inspired, original artwork)                                                                                                                        |
| Testing                 | Vitest via `vp test` (unit: kernel, commands, serialization), Playwright (smoke/e2e on WebGPU-enabled Chromium)                                                                |

## Source layout & code organization

Single Vite+ app, nested `src/` modules (the plan's former "packages" map 1:1 to top-level folders; chunk IDs below reference these):

```
src/
  types/        # ALL shared types, kept separate for reuse — no logic, no imports from below
    core/ geometry/ materials/ animation/ generators/ io/  (DTOs, ids, enums, contracts)
  core/         # OPERATIONS: document model, stores, history/undo, events, selection, prefs
  geometry/     # OPERATIONS: kernel/ ops/ primitives/ splines/ boolean/ sync/
  materials/    # OPERATIONS: manager/ compiler/ noises/(TSL) projections/ bake/
  animation/    # OPERATIONS: model/ evaluator/
  generators/   # OPERATIONS: graph/ cloner/ boolean/ spline-extrude/
  io/           # OPERATIONS: format/ gltf/ storage/(opfs, s3, gcs) assets/
  workers/      # worker entry points: boolean, bake, autosave, export, compress
  render/       # 3D UI: viewport/ nav/ picking/ gizmo/ overlays/ postfx/ scene-sync/
  editors/      # 2D CANVAS UI: timeline/ curves/ uv/ (shared canvas kit in editors/kit/)
  ui/           # 2D DOM UI (React): shell/ panels/ menus/ toolbar/ settings/ widgets/
  icons/        # original SVG icon components
  app/          # composition root, wiring, frame scheduler
```

**Hard organization rules (enforced in review + lint where possible):**

- **Files stay under 500 lines** — split into submodules rather than grow (keeps per-file token cost low for agent sessions too).
- **UI code never mixes with operations code:** `core/geometry/materials/animation/generators/io` contain zero React/DOM/Three-scene imports; UI layers call them through commands and read them through events/hooks.
- **2D UI is separated from 3D UI:** DOM React lives in `ui/`, canvas-2D editors in `editors/`, viewport-space 3D interaction (gizmos, nav, overlays) in `render/`.
- **Types live in `src/types/`** — the DTO/contract layer everything imports; nothing in `types/` imports from other layers.
- Import direction: `app → (ui, editors, render) → (generators, materials, animation, io) → geometry → core → types`. Workers import operations code only.

## Session workflow & progress memory

The project spans many coding sessions; continuity lives in the repo, not in anyone's head:

- **PLAN.md** — canonical plan, updated whenever scope/design decisions change.
- **progress/PLAN_PROGRESS_N.md** — one numbered log per working session (0, 1, 2 …). Template: date, chunks worked (IDs from the breakdown), what was completed vs. left mid-flight, decisions made (and why), files added/changed, test status (`vp check`/`vp test` results), known issues, and **exact next steps** so a fresh session can resume cold.
- **Session start ritual:** read PLAN.md + the highest-numbered progress file before writing any code.
- **Session end ritual:** stop at a chunk boundary, ensure `vp check` and `vp test` pass, commit, write the progress file.
- **Milestone gates (M0–M6): hard stops.** When a milestone's chunks are done: write the progress file, run the full test suite + the milestone's manual QA checklist, review the work (code + UX), and wait for user sign-off before starting the next milestone. Never continue past a milestone in the same breath.

## Core architecture

### Document model & state (packages/core)

- **`Document`** is the single source of truth: stores for scene nodes, meshes, materials, animation, plus environment, post-FX stack, per-view camera assignments. Plain TS classes, no framework. All entities use **UUIDv7** ids (time-ordered — sorts well as file member names; ship a tiny v7 impl, `crypto.randomUUID` is v4); **all cross-references are by id**, never live object references.
- **Three.js objects are a projection of the Document**, not the truth. A `SceneSynchronizer` in `render` listens to document events and creates/updates/disposes `Object3D`s (`Map<Uuid, Object3D>`). This is what makes serialization, undo, and multi-view sane.
- **Serialization contract:** every store has `toDTO()/fromDTO()`; the native file's `document.json` _is_ the DTO layer (one `ThrideDocumentDTO` type), so file format and runtime model can't drift silently.
- **Command bus + undo:** every mutation is a `Command { execute(), undo(), tryMerge?(), memoryCost? }` on a single history stack spanning all domains. Per-domain delta strategy: scene ops = before/after node DTO patches; mesh component edits = typed-array snapshot + re-run op on redo; material structure = affected layer DTO slice; param tweaks = `(paramId, before, after)` with time-bounded `tryMerge` coalescing; keyframe edits = affected-keys before/after. History has a **memory budget, user-configurable in the Settings page** (MB slider + "steps kept" readout) — mesh snapshots report `memoryCost`, get compressed in a worker (`CompressionStream`), and evict oldest when over budget.
- **Interactive sessions (preview→commit):** every drag (gizmo, sliders, curve handles, extrude drag) uses `begin() → update() (direct mutation, preview-tagged events, no history) → commit() (one command pushed *without re-executing*) / cancel() (restore)`. Preview events carry `{preview: true}` so autosave and expensive caches (BVH rebuilds) skip them. Esc and pointer-capture loss route to cancel.
- **Events:** fine-grained typed emitter (`scene:node-changed`, `mesh:dirty`, `material:param`, `selection:changed`, …) with per-slice version counters. React panels subscribe via `useSyncExternalStore` against slice versions (a 60 Hz gizmo drag re-renders only panels watching that node); render systems subscribe directly. zustand only for ephemeral UI state (hover, focus, tool options) — never document state.
- **Selection model:** object selection (node id set) + component selection (per-mesh bitsets per mode + click-order list for order-sensitive tools, stamped with the mesh's `topologyVersion` so staleness can't leak — topology ops return the new selection) + active edit mode (object/point/edge/polygon/texture). Mode drives the context-sensitive toolbar.
- **Frame pipeline** (single scheduler per tick): events → dirty marks → generator graph eval → render-mesh sync → animation evaluator → uniform tables → `renderer.renderAsync`.

### Non-destructive generators

Cloner, Boolean, and SplineExtrude are `GeneratorNode`s: children are inputs, output is generated geometry. A **pull-based dependency graph** evaluates lazily per frame, memoized by `(inputs' topologyVersion, paramsHash)`; kernel dirty flags propagate downstream. Cloner outputs an `InstancedMesh` descriptor (matrix array — bypasses the kernel entirely); Boolean outputs a kernel mesh so results can feed further generators. Component mode always edits the _base_ mesh (a generator's child), with the generator showing the live result; "make editable" (C4D's `C`) collapses to a plain mesh via a command.

### Geometry kernel (packages/geometry)

- **`HEMesh`: array-based half-edge**, struct-of-arrays on typed arrays (`heNext/heTwin/heVert/heFace: Int32Array`, `vPos: Float32Array`, per-corner UVs in `heUV: Float32Array` — mandatory for seams, don't optimize away). No object-per-element (GC pauses, expensive snapshots); no corner-table (triangle-only — we need n-gons). Capacity-doubling growth, free lists for deletes, `compact()` on save/idle, `topologyVersion` counter bumped on connectivity change, dirty flags (POSITIONS | TOPOLOGY | UVS | NORMALS). Indices are the handles — no stable-ID layer; undo snapshots restore exact indices.
- **Render sync (`RenderMeshSync`):** separate triangulated `BufferGeometry` per editable mesh — fan for convex n-gons, earcut (projected via Newell normal) for concave; maintains `triToFace`/`faceToTriRange` for picking and face highlight. Dirty routing: POSITIONS → in-place attribute rewrite with `updateRanges` (verify support per backend; fall back to full upload) + BVH refit; TOPOLOGY → full rebuild + BVH rebuild. Component overlays (points/edge lines/face highlight) built in the same sync pass from selection bitsets — no per-frame raycasting.
- **Modeling ops** are functions `(mesh, selection, params) → {newSelection}` that mutate the kernel and set dirty flags, never touching Three: extrude (faces/edges), inset, bevel (edges+verts, fixed segments v1, overlap clamp only), delete/dissolve, weld, subdivide (simple), normals recompute.
- **Undo = snapshot, not inverse ops:** committed mesh command stores a full typed-array before-snapshot (memcpy-cheap, ~10–20 MB at 100k polys) + op params; redo re-runs the op. Inverse topological operators (bevel⁻¹…) are a correctness tarpit — rejected. Interactive drags snapshot once at pointerdown, mutate positions live, commit one command at pointerup.
- Primitives (C4D-grade parametric set, live parameters until made editable): cube, sphere (UV + ico), cylinder, cone, capsule, torus, tube, plane, disc, platonic solids, landscape (noise-displaced plane), pyramid.
- **Manifold bridge (in a worker):** triangulate via the same earcut path → `MeshGL` with position-hash weld vectors + `runOriginalID` per input to recover material assignment from result triangles. If construction throws (non-manifold), run one repair pass (ε-merge, drop degenerates), retry, else show a "non-manifold input" badge on the Boolean object and fall back to three-bvh-csg preview-quality output. Result converts back as plain triangle HEMesh (no n-gon reconstruction v1). Expose weld tolerance (ε-welding can eat thin features).

### Splines & pen tool (Spline's signature workflow)

- **`SplineNode`:** cubic bezier path data (control points with in/out handles, per-point corner/smooth/auto mode, open/closed flag), stored as plain DTO data like everything else. Spline primitives (circle, rect, n-gon, star) are parametric spline nodes.
- **3D pen tool:** click to place points, click-drag to pull out handles, drawn onto a work plane (view-aligned, world grid, or snapped to surface); points editable afterward in a spline component mode (move points/handles with the same gizmo + interactive-session machinery).
- **SplineExtrude generator:** child spline in, mesh out — sliders for extrusion depth, bevel size, bevel segments, path steps, caps on/off. Emits a HEMesh (so booleans can consume it). Implementation: profile-offset bevel contour + sweep, adapted from Three's ExtrudeGeometry approach but n-gon-capped via earcut. Lathe and sweep-along-path are 1.x follow-ups on the same foundation.

### Rendering & viewport (packages/render)

- One `WebGPURenderer`, N viewport panes rendered via scissored regions (1-up and 2×2 4-up layouts; each pane bound to any scene camera or a built-in editor camera: perspective/top/front/right).
- **C4D navigation** on the active pane: Alt/Option+LMB orbit _around the clicked point_ (raycast to get pivot; fall back to selection center/origin), Alt+MMB pan, Alt+RMB dolly. Scroll wheel zoom. F frame selection, H frame all.
- **Unified TRS gizmo** (custom; Three's TransformControls is single-mode): combined translate arrows/planes + rotate rings + scale handles in one gizmo, world/local toggle, screen-space constant size, works in component modes on selection centroid.
- Click/box selection via three-mesh-bvh raycast; GPU/edge-friendly picking for component modes (vertex/edge hit-testing with screen-space tolerance).
- **Post-FX stack:** ordered list of effects per viewport (render setting), built on TSL `PostProcessing`. Built-ins: bloom, vignette, chromatic aberration, tone-map stage; plus **user custom shader effects** authored as TSL/GLSL snippets with declared uniforms (animatable). Live in viewport.
- Color management: linear pipeline, AgX default / ACES filmic / neutral toggle.
- Grid, axes, wireframe/shaded/material display modes per pane, stats HUD.

### Materials (packages/materials)

- **Material manager:** library of named materials; assign by drag onto object or via attributes panel. Wraps all built-in Three material types (Standard/Physical as first-class PBR default; Basic, Lambert, Phong, Toon, Matcap, Normal via node-material equivalents).
- **Procedural layer system (the differentiator):** a material channel (baseColor/roughness/metalness/normal-height/displacement/emissive/alpha) holds a **layer stack**; each layer = source (noise: perlin/fbm/ridged/turbulence/voronoi F1/F2/F2−F1/cells — Maxon-noise-like set — or gradient ramp/checker/brick/image/solid) + remap (gradient ramp, contrast, invert, clamp) + per-layer projection + **blend mode** (normal/multiply/screen/overlay/add/subtract/difference/darken/lighten) + opacity + optional layer mask. The layer stack is **pure serializable data** (`ProceduralMaterialDoc` — this _is_ what the file format stores); a `MaterialCompiler` walks it and emits one TSL graph per channel wired into `MeshStandard/PhysicalNodeMaterial` slots (`colorNode`, `roughnessNode`, `normalNode` via screen-space `bumpMap(height)` — uniform across noise types, composes with baked normal maps; `positionNode` for displacement).
  - Noise library: three's MaterialX TSL nodes where they match (`mx_noise_float`, `mx_fractal_noise_float`, `mx_worley_noise_float`, `mx_cell_noise_float`) + custom TSL `Fn`s for ridged/turbulence/wavy. One implementation transpiles to WGSL and GLSL. Every noise gets an animatable `phase` (4th dimension) param for evolving materials.
  - Gradient ramps bake to 256×1 `DataTexture`s updated in place on edit — no shader branches, no recompile.
  - **Recompile boundary:** every numeric param is a `uniform()` node in a per-material `UniformTable: Map<paramId, UniformNode>` — slider edits and animation playback write uniform values, **zero recompiles**. Structural edits (add/remove/reorder layer, change noise kind/blend/projection) rebuild via `renderer.compileAsync` and swap on completion — no frame hitch.
- **Projections:** per-layer UV source — UV (channel 0/1), flat, cubic (triplanar 3-sample blend), cylindrical, spherical (analytic unwrap of object/world position through a `uniform(mat4)`), camera (view-projection matrix uniform) — computed in-shader (realtime, C4D-style), with projection transform gizmo in viewport (texture mode).
- **Baking pipeline:** (1) render the _actual mesh_ in UV space — bake material with `vertexNode = vec4(uv*2−1, 0, 1)` so object/world-space projections stay correct via real position varyings; (2) dilation pass (edge padding) to kill mip seams; (3) `readRenderTargetPixelsAsync` (WebGPU-safe, scheduled after `renderAsync`, never mid-frame); (4) WebP encode in a worker via `OffscreenCanvas.convertToBlob({quality})`. **Quality preview loop:** bake once at 512² and retain raw pixels — the quality slider re-encodes from retained pixels only (instant), showing decoded preview + file size; commit at 1k/2k/4k per channel. Height→normal conversion in a second GPU pass (Sobel), encoded **lossless** (lossy WebP wrecks normal maps). Baked sets feed both "baked mode" materials and GLTF export.
- **Environment:** dome-light panel — load HDR/EXR/image, PMREM, intensity, rotation, background on/off/blur, plus procedural sky option later.

### Animation (packages/animation + editors)

- Track/curve model: `Track(targetPath, keys[])`, keys with time/value/bezier tangents, per-key interpolation (bezier/linear/step). Targets addressed by UUID + property path — works uniformly for node TRS, material layer params, generator params (cloner count!), post-FX uniforms, camera FOV.
- Evaluator runs on the playback clock; writes through the same property system commands use (but non-undoable, transient).
- **Timeline/dopesheet** (canvas): playback transport, key display per track, drag/scale keys, autokey toggle, keyframe button next to every animatable field in the attributes panel (C4D-style dot).
- **Curve editor** (canvas): bezier handles, presets (ease in/out, linear, step).
- GLTF export maps bezier → sampled or CUBICSPLINE tracks for TRS; material param animation exports only into the native format (and optionally baked flipbooks later — out of v1).

### UV editor (packages/editors)

- Canvas 2D view of UV islands for selected mesh; component selection synced with 3D viewport; move/rotate/scale UVs; basic unwrap ops for v1: planar/cube/cylindrical/spherical projection _into_ UVs, plus "unwrap" via xatlas-web (WASM) for automatic atlasing; checker/texture backdrop.

### File format & I/O (packages/io)

- **Native format `.thride` = a ZIP package** (fflate; STORE for binaries, DEFLATE for JSON) — _not_ a GLB with extensions (that would force editor data through glTF buffer views, monolithic rewrites on every save, and baked meshes for live generators). GLTF stays the **interchange/export** representation:
  ```
  project.thride
  ├─ manifest.json          formatVersion, appVersion, savedAt, member index
  ├─ document.json          the entire DTO document model (scene, materials, generators,
  │                         animation w/ full bezier handles, viewports, env, postFX, uiLayout)
  ├─ meshes/<uuid>.hem      binary half-edge chunks (own versioned header)
  ├─ assets/textures/<sha256>.<ext>   content-addressed imported images/HDRs (dedup by hash)
  ├─ assets/sources/<sha256>.glb      original imports preserved verbatim
  ├─ cache/baked/…webp + thumbnail.webp   regenerable, safe to strip
  └─ preview.glb            optional baked GLB for quick-look
  ```
- **Cross-machine story:** default is fully packed — every asset embedded content-addressed (hash once at import, trust immutability). "Keep external" links store `pathHint` + sha256; missing links on open trigger a relink dialog with hash auto-match.
- **Autosave:** OPFS holds an **exploded directory** mirroring the zip (dirty members only rewritten, using per-slice version counters); the zip is materialized only on explicit save/download/upload. OPFS sync handles are worker-only → autosave writer runs in a worker. Debounced on history commits, never on preview events.
- **Versioning:** `formatVersion` semver; loader runs an ordered chain of pure JSON→JSON migrations before deserialization; unknown keys preserved on round-trip; `.hem` chunks self-version.
- **GLTF/GLB export** (clean standard files): cloners → `EXT_mesh_gpu_instancing` (or flattened-nodes compat mode); booleans → baked result mesh; procedural materials → baked WebP/PNG PBR sets via the bake pipeline; bezier curves → exact CUBICSPLINE where handles are hermite-equivalent, else adaptive resample within error tolerance; n-gons → triangulated; lights via `KHR_lights_punctual`. Per-view assignments, post-FX, UI state dropped by design. **Import:** GLB/GLTF via GLTFLoader → editable Document nodes; original file preserved in `assets/sources/`.
- **Storage targets:** local file (FS Access API; Safari lacks `showSaveFilePicker` → anchor-download fallback), OPFS project store + rolling autosave, **S3 & GCS** direct from browser (user supplies bucket + credentials/token; PUT/GET; CORS setup documented in-app with copy-paste bucket policy). Recent-files list.

### UI shell (packages/ui + icons)

- **Design system first:** tokens (spacing, type scale, dark theme palette in the Blender-5 vein — near-black panels, hairline separators, single accent color), primitives (button, slider+drag-number field, color field w/ picker, dropdown, tree view, tabs, tooltip, context menu, modal). Everything minimal, dense, keyboard-friendly.
- **dockview** layout: reconfigurable/dockable panels — viewport(s), object manager (hierarchy tree: drag re-parent, visibility/render toggles, generator badges), attributes/inspector (context: selected object/tool/material), material manager (thumbnail grid + channel editor), timeline, curve editor, UV editor, asset browser, console. Layout presets (Model / Texture / Animate) + user-saved layouts persisted.
- **Left toolbar, context-sensitive by mode:** object mode (select, move-gizmo, primitives, generators, lights, cameras), point/edge/polygon modes (select, move, extrude, inset, bevel, weld, knife-placeholder), texture mode (projection tools). Mode switcher (like Blender's mode dropdown / C4D's left column).
- **Top menu bar** (File/Edit/Create/Mesh/Material/Animate/View/Help) + command palette (Cmd+K, searches every registered command).
- Shortcut registry with remapping UI in preferences.

## Work breakdown — small, start/stop-able chunks

Each chunk is a session-sized unit of focused work with explicit deps and a **"done when"** that is testable in isolation — a chunk can be picked up, finished, committed, and logged in a progress file independently. Contracts between chunks are the `types/` + `core/` interfaces (Document DTOs, Command, events, property paths); **B1–B3 are the only true bottleneck** — everything else parallelizes once they land. Folder names below refer to the `src/` layout above.

**A. Platform & shell** (src: app, ui, icons)

- **A1 Project conventions** _(deps: —; scaffold already exists)_ — strip Vite template cruft, add `three`, create the `src/` folder skeleton + `types/` layer, path aliases, `vp test` wiring with a first smoke test, write progress-file template into `progress/`. Done when: `vp dev` boots the empty shell, `vp check`/`vp test` green, folder skeleton committed.
- **A2 Design system** _(A1)_ — tokens (dark Blender-5/Spline-grade palette), primitives: button, drag-number field, slider, color field+picker, dropdown, tabs, tree view, tooltip, context menu, modal. Done when: Storybook-style gallery page renders all primitives.
- **A3 Docking shell** _(A2)_ — dockview integration, panel registry, layout save/restore, layout presets. Done when: panels dock/float/tab and layout survives reload.
- **A4 Menus + command registry** _(A2)_ — top menu bar, command palette (Cmd+K), central command/shortcut registry with remapping data model. Done when: commands registered once appear in menu, palette, and respond to shortcuts.
- **A5 Icon set** _(A2, parallel with everything)_ — original SVG icons (primitives, tools, modes, panel glyphs). Done when: icon components cover the v1 tool/primitive list.
- **A6 Settings page** _(A3, B2)_ — preferences panel: nav sensitivity, theme, autosave interval, shortcut remap UI, **undo memory budget slider wired to History**. Done when: settings persist and History respects the budget live.

**B. Document core** (src: core, types)

- **B1 Document model** _(A1)_ — stores, SceneNode, UUIDv7, DTO layer, event bus with per-slice versions. Done when: build/serialize/deserialize a document tree round-trips deep-equal in tests.
- **B2 History** _(B1)_ — Command, undo/redo stack, `tryMerge`, `transact`, memory budget + worker compression. Done when: property-tested command sequences undo/redo back to identical DTO state.
- **B3 Interactive sessions + selection** _(B2)_ — preview→commit sessions, cancel/Esc, preview-tagged events; object+component selection model with topologyVersion stamping. Done when: a scripted drag session produces exactly one history entry and cancel restores state.
- **B4 React bindings** _(B1, A3)_ — `useSyncExternalStore` hooks per slice, zustand for ephemeral UI. Done when: a test panel re-renders only on its slice's version bump.

**C. Viewport & rendering** (src: render)

- **C1 Renderer + single viewport** _(B1)_ — WebGPURenderer w/ WebGL2 fallback, SceneSynchronizer (nodes→Object3D), frame scheduler, grid/axes, stats HUD. Done when: document changes appear in-viewport without touching Three directly.
- **C2 C4D navigation** _(C1)_ — Alt+LMB orbit-around-picked-point, Alt+MMB pan, Alt+RMB dolly, wheel zoom, F/H framing. Done when: feel checklist passes (pivot under cursor stays put while orbiting).
- **C3 Multi-view** _(C1)_ — 1-up/4-up scissored panes, per-pane camera binding (persp/top/front/right ortho or any scene camera), active-pane focus. Done when: 4-up with 4 different cameras renders and each pane navigates independently.
- **C4 Picking & unified gizmo** _(C1, B3)_ — three-mesh-bvh click/box select; custom combined TRS gizmo (world/local, screen-constant size) driving interactive sessions. Done when: select+move+rotate+scale each yield one undo step; e2e passes.
- **C5 Display modes + color management** _(C1)_ — shaded/wireframe/material modes per pane; linear pipeline with AgX/ACES/neutral toggle. Done when: screenshot goldens per mode match.
- **C6 Post-FX stack** _(C1, E1)_ — TSL PostProcessing pipeline, ordered per-render-settings stack: bloom, vignette, chromatic aberration, tonemap; **user custom shader effects** (TSL/GLSL snippet + declared uniforms, animatable). Done when: stack edits update live and serialize.

**D. Geometry kernel & modeling** (src: geometry)

- **D1 HEMesh core** _(—, pure TS)_ — typed-array kernel, build-from-polygons, validation (Euler, twin symmetry), free lists, compact. Done when: invariant property tests pass over randomized builds.
- **D2 Render sync** _(D1, C1)_ — earcut/fan triangulation, triToFace maps, dirty routing (positions vs topology), BVH refit/rebuild, component overlays. Done when: 60fps position-drag on a 100k-tri mesh in profiling test.
- **D3 Primitives** _(D1, B1)_ — full parametric set with live params + make-editable command. Done when: every primitive creates, edits params, collapses, undoes.
- **D4 Component mode tools** _(D2, B3, C4)_ — point/edge/poly modes, hit-testing with screen tolerance, move/rotate/scale on components, extrude, inset, weld, delete/dissolve. Done when: each op property-tested for invariants + one undo step each.
- **D5 Bevel** _(D4)_ — edge/vert bevel, fixed segments, overlap clamp. Done when: bevel on cube/cylinder/hard-surface goldens pass.
- **D6 Snapping** _(C4, D2)_ — grid/vertex/edge snap for move ops and pen tool. Done when: snap toggles work in object + component modes.
- **D7 Boolean worker** _(D1)_ — Manifold WASM in worker, weld/repair/fallback path, runOriginalID material recovery. Done when: boolean torture suite (coplanar faces, nested shells, non-manifold input) behaves per spec.
- **D8 Splines + pen tool** _(B3, C4)_ — SplineNode data, spline primitives, 3D pen tool on work planes, spline point-edit mode. Done when: draw-edit-close-undo flow passes e2e.
- **D9 SplineExtrude generator** _(D8, F1)_ — depth/bevel/segments/caps sliders, HEMesh output. Done when: extruded+beveled text-like shapes boolean cleanly.

**E. Materials** (src: materials, workers)

- **E1 Material manager** _(B1, C1)_ — library, thumbnails (offscreen preview scene), assignment, node-material wrappers for all built-in Three types, PBR default. Done when: create/assign/edit/delete/undo materials incl. per-face assignment from booleans.
- **E2 TSL noise library** _(A1)_ — MaterialX-backed + custom noises behind one `tsl.ts` barrel, each with phase param; visual golden tests. Done when: noise gallery screenshot goldens match on WebGPU and WebGL2.
- **E3 Layer-stack compiler** _(E1, E2)_ — ProceduralMaterialDoc → TSL per channel, blend modes, gradient ramp DataTextures, UniformTable, compileAsync swap. Done when: param edits never recompile (instrumented test); structural edits swap hitch-free.
- **E4 Projections** _(E3)_ — uv/flat/cubic-triplanar/cylindrical/spherical/camera per layer + viewport projection gizmo (texture mode). Done when: each projection matches reference renders.
- **E5 Environment** _(C1)_ — HDR/EXR load, PMREM, intensity/rotation, background modes. Done when: dome-light panel round-trips through save.
- **E6 Bake pipeline** _(E3)_ — UV-space render, dilation, async readback, worker WebP encode, quality-slider preview loop, height→normal pass (lossless). Done when: baked set visually matches procedural within tolerance; quality slider re-encodes <100ms.

**F. Generators & scene objects** (src: generators)

- **F1 Generator graph** _(B1, D1)_ — GeneratorNode base, pull-based memoized evaluation, dirty propagation, make-editable. Done when: dependency-graph unit tests incl. chained generators pass.
- **F2 Cloner** _(F1, C1)_ — linear/radial/grid/object-surface distributions → InstancedMesh descriptor, random effector (position/rotation/scale jitter, seed), animatable params. Done when: 100k instances at 60fps; count animates.
- **F3 Boolean object** _(F1, D7)_ — live boolean generator with A/B/operation/badging. Done when: editing a child mesh live-updates the boolean result.
- **F4 Lights & cameras** _(B1, C1)_ — point/spot/directional/area lights and camera objects with gizmos/frustum helpers, "look through selected". Done when: lights render + serialize; any camera bindable to any pane.

**G. Animation** (src: animation, editors)

- **G1 Track model + evaluator** _(B1)_ — channels, bezier keys w/ handles, extrapolation, evaluator writing via property system + UniformTables, playback clock. Done when: evaluator unit tests match reference curves; playback is undo-invisible.
- **G2 Timeline/dopesheet** _(G1, A3)_ — canvas editor: transport, per-track keys, drag/scale, autokey, keyframe dots on every animatable field in the attributes panel. Done when: keyframe TRS + a material param + cloner count via UI in one e2e.
- **G3 Curve editor** _(G2)_ — canvas bezier editing, handle modes, ease presets. Done when: handle drags are single undo steps and match evaluator output.

**H. I/O & storage** (src: io, workers)

- **H1 .thride package** _(B1, D1)_ — zip read/write (fflate), document.json DTOs, .hem chunks, content-addressed assets, manifest + migration chain. Done when: full round-trip deep-equal golden tests incl. a frozen v1 sample file.
- **H2 OPFS autosave + recovery** _(H1)_ — exploded-dir worker writer, dirty-slice writes, crash-recovery prompt, recent files. Done when: kill-tab-mid-edit restores to last commit.
- **H3 GLTF import** _(B1, D1)_ — GLB/GLTF → editable document, source preserved. Done when: Khronos sample-asset suite imports without errors.
- **H4 GLTF export** _(H1, E6, F2)_ — baked generators (`EXT_mesh_gpu_instancing`), baked procedural textures, CUBICSPLINE/resampled curves, gltf-validator clean. Done when: exports validate + render correctly in a reference viewer.
- **H5 Cloud storage** _(H1)_ — S3 + GCS clients (user creds, PUT/GET, progress, CORS docs in-app). Done when: save/open round-trip against real buckets (manual) + mocked CI tests.
- **H6 Asset browser** _(H1, A3)_ — project assets panel, drag-drop import (GLB/HDR/EXR/images). Done when: drop-a-file-onto-viewport imports and undoes.

**I. UV editor** (src: editors)

- **I1 UV canvas editor** _(D2, A3)_ — island display, selection synced with 3D, move/rotate/scale UVs, checker backdrop. Done when: UV edits reflect live on the mesh and undo.
- **I2 Unwrap ops** _(I1)_ — planar/cube/cylindrical/spherical projection-to-UV + xatlas-web auto-unwrap in worker. Done when: unwrap of a hard-surface model produces non-overlapping islands.

**J. Integration & release**

- **J1 Demo scenes + docs** _(most)_ — 3 production-style demo files, in-app help, shortcut cheatsheet. **J2 Perf hardening** — budgets enforced in CI. **J3 1.0 QA sweep** — fallback matrix, crash drills, cross-machine file opens.

## Milestones

- **M0 – Foundation** _(A1–A4, B1–B4, C1–C4, D1–D3):_ app boots, dark shell with docking, viewport renders WebGPU scene, C4D nav, primitives creatable, click-select + unified gizmo, object manager tree, attributes panel, undo/redo, 4-up with per-view cameras.
- **M1 – Modeling & splines** _(D4–D9, F1, F3, C5):_ component modes + context toolbar, extrude/inset/bevel/weld, snapping, boolean generator, make-editable, **pen tool + spline extrude with sliders**.
- **M2 – Materials & look** _(E1–E6 minus bake, C6, A5):_ material manager, PBR + built-ins, procedural layer stacks with blend modes, projections, environment dome light, post-FX stack incl. custom shaders, color management.
- **M3 – Motion & scatter** _(F2, F4, G1–G3):_ cloner + effector, lights/cameras as first-class objects, animation model + timeline + curve editor, animatable material/generator params.
- **M4 – Files** _(H1–H6, E6):_ .thride save/open (round-trip everything), GLTF import/export, baking to WebP with quality preview, OPFS autosave, S3/GCS, asset browser.
- **M5 – UV & polish** _(I1–I2, A6):_ UV editor, xatlas unwrap, texture-mode projection gizmo, render-to-image, settings page (incl. undo memory budget), shortcut remapping, layout presets.
- **M6 – 1.0 hardening** _(J1–J3):_ perf pass (100k+ instances, 1M-tri editing budget), Safari/Firefox fallback QA, crash-recovery drills, demo scenes, docs site.

## Testing plan

**Principles:** the document core, kernel, and serialization are pure TS — they get the deepest automated coverage; rendering gets golden-image coverage; interaction gets e2e flows. Every chunk lands with its "done when" test; CI blocks merges.

1. **Unit (Vitest, runs on every chunk):**
   - _Kernel invariants, property-based:_ random sequences of modeling ops on random primitives must preserve half-edge invariants after every step (twin symmetry, next-cycles close, Euler characteristic consistent with genus changes, no orphan elements). This is the highest-value suite in the project.
   - _Command/undo:_ for every command type, `execute→undo` returns the document to DTO-deep-equal state; randomized command sequences with interleaved undo/redo converge; interactive sessions produce exactly one entry, cancel produces zero.
   - _Serialization:_ DTO round-trip (save→load→deep-equal) for every store; **frozen golden files** — a v1.0.0 sample `.thride` checked into the repo must open in every future build (migration regression net); unknown-key preservation.
   - _Animation evaluator:_ bezier evaluation against reference values, extrapolation modes, CUBICSPLINE export equivalence within tolerance.
   - _Material compiler:_ doc→TSL compile smoke for every noise/blend/projection combination; instrumented assertion that param edits cause zero recompiles.
2. **Golden-image tests (Playwright + pixelmatch, WebGPU Chromium in CI):** noise gallery, blend modes, projections, display modes, tone-mapping modes, post-FX passes, bevel/boolean result renders — rendered headless at fixed size/seed, diffed against checked-in goldens with per-suite thresholds. Run on **both** WebGPU and WebGL2-fallback backends to catch TSL transpile divergence.
3. **E2E flows (Playwright):** the production-work smoke — boot → create primitives → boolean → pen-tool spline → extrude with sliders → component-edit → procedural material → animate TRS + material param → save `.thride` → reload → deep-verify; GLB export validates with gltf-validator and screenshot-matches in a reference viewer; crash-recovery (kill page mid-edit, reopen, recover); drag-drop import; 4-up navigation.
4. **Performance budgets (CI-enforced on reference scenes):** position-drag on 100k-tri mesh ≥ 60fps equivalent frame time; 100k cloner instances render budget; no main-thread task > 50ms during boolean/bake/export (worker enforcement); undo memory stays under configured budget in a scripted 200-step editing session.
5. **Fallback/compat matrix (pre-release, partly manual):** Chrome/Edge WebGPU, Firefox + Safari WebGL2 fallback, Safari file-save fallback path, OPFS quota behavior.
6. **Manual QA checklists (per milestone):** C4D-nav feel (orbit pivot stays under cursor), gizmo precision, pen-tool feel vs Spline, cross-machine `.thride` open, real S3/GCS round-trip.

## Risks & gotchas

- **WebGPU/TSL maturity:** TSL API surface still moves between Three releases — pin Three per milestone and wrap all TSL imports behind one `tsl.ts` barrel; WebGL2 fallback path must stay in CI. Safari WebGPU still uneven.
- **Half-edge kernel scope creep:** bevel/knife are rabbit holes — v1 ships fixed-segment edge/vert bevel with overlap clamp only; knife/loop-cut deferred to 1.x.
- **Manifold requirements:** booleans need oriented 2-manifold inputs; primitives are safe, imports may not be — repair pass + clear badge messaging, three-bvh-csg fallback.
- **GPU readback is async on WebGPU** — the whole bake pipeline is async-first; never read mid-frame.
- **`updateRanges`** partial-upload behavior differs across the WebGPU/WebGL2 backends — verify, else full-attribute upload fallback.
- **Displacement** channels need tessellated geometry — surface a "needs subdivision" hint in the material UI.
- **Camera/world-space projections are state-dependent** — bakes snapshot the current transform/camera; warn in UI.
- **Browser storage/API gaps:** `showSaveFilePicker` absent in Safari (anchor-download fallback); OPFS sync handles are worker-only; OPFS quotas; zip64 needed past 4 GB.
- **WebP encoder output differs per browser** — never hash baked outputs for identity; lossless-only for normal maps.
- **Command hygiene:** commands must capture ids + DTOs, never live object refs (undo-after-delete resurrection bugs); `tryMerge` time-window bounded.
- **S3/GCS CORS:** user buckets need CORS config; ship copy-paste bucket policy docs in-app.
- **Icon/UI licensing:** no Blender GPL assets; original icons only.
