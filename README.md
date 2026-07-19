# Thride

**A browser-native 3D IDE for the Three.js ecosystem:** realtime look-dev and noise based procedural
materials, created by a heavy Cinema 4D user. Built on
Three.js **WebGPU + TSL**, it runs entirely in the browser: no install, no backend, no
render farm.

If you make things in Three.js and have wanted a real GUI to build, texture, and try
things out in — instead of hand-wiring node materials and re-deploying to see a change —
Thride is that GUI.

> Status: pre-1.0, in active development. Milestones **M0–M2 are shipped** (foundation,
> modeling & splines, materials & look-dev); **M3+** is on the roadmap below.

---

## What Thride is for

The pitch is **look-dev and procedural materials for the web**:

1. **Bring in finished geometry** from Blender / Cinema 4D as editable quad/n-gon meshes —
   not glTF-triangulated soup that breaks editing.
2. **Build node-driven procedural materials** that are WYSIWYG-identical to final output,
   because the viewport and the export are the _same_ WebGPU/TSL graph.
3. **Bake to PBR image maps** for runtime performance — _while the procedural source stays
   live and revisable in the file._ Tweak the noise, re-bake, ship.
4. **Ship two ways:** standard **glTF + baked PBR** for any Three.js app, or a live
   **`.thride`** rendered by an embeddable Thride viewer that keeps the material procedural.

It started life as a capable general-purpose modeler ("open-source Spline" — direct
manipulation, a 3D pen tool, slider-driven extrude/bevel), and all of that still ships.
But modeling is now the _supporting_ act. The headliner is the material system.

### Who it's for

- **Three.js developers** who want a visual tool to author scenes, materials, and lighting
  instead of writing node graphs by hand — then export clean glTF or embed a live viewer.
- **Technical artists & look-dev** who want Substance-style procedural texturing that runs
  in a browser and previews exactly what ships.
- **Anyone building on the web 3D stack** who wants a local-first, install-free DCC that
  speaks glTF fluently.

---

## The procedural material system (the differentiator)

This is where Thride earns its keep. Every material channel — _base color, roughness,
metalness, normal/height, displacement, emissive, alpha_ — is built from **noise-driven
procedural sources**, pure serializable data that a compiler turns into one TSL graph per
channel, wired straight into Three's `MeshStandard/PhysicalNodeMaterial`. What ships today:

- **A Maxon-noise-grade noise library** — Perlin, fBm, ridged, turbulence, Voronoi
  (F1 / F2 / F2−F1 / cells), plus gradient ramps, checker, brick, image, and solid sources.
  Every noise carries an animatable **`phase`** (4th-dimension) parameter for evolving
  materials. One implementation transpiles to both WGSL and GLSL, so WebGPU and the WebGL2
  fallback stay in sync.
- **Blend modes** (normal / multiply / screen / overlay / add / subtract / difference /
  darken / lighten), opacity, remap (gradient ramp, contrast, invert, clamp), and optional
  masks — real compositing, not a single texture slot.
- **Realtime projections, per source and per image channel** — UV, flat, cubic (triplanar),
  cylindrical, spherical, and camera — computed in-shader, C4D-style, no pre-baking needed.
  (These are also how you texture without UVs — Thride has no manual UV editor by design.)
- **No-hitch editing.** Every numeric parameter is a `uniform()` node in a per-material
  uniform table, so **slider edits and animation playback cause zero shader recompiles.**
  Structural changes rebuild via `compileAsync` and swap in on completion — no frame
  stutter. Gradient ramps bake to 256×1 data textures updated in place, so even a ramp edit
  avoids a recompile.

Because materials are _data_, they're inherently portable, diff-able, and programmable —
and the exact same graph renders in the (planned) embeddable viewer.

### The direction: a node-based material editor ("Substance-lite") — _M4, next up_

A material creator is only powerful when you can **layer and modify** freely, so the
go-forward authoring model is a **Blender/Substance-style node graph**: noise, texture, and
constant nodes pipe through **modifier** nodes — `math`, `ramp`, **`mix` (this _is_ the
layering, with the full blend-mode set)**, and `bump` — into an **Output** node's channels
(color, roughness, metalness, emission, alpha, normal). Because TSL is itself a node system,
your wires map 1:1 onto what the GPU runs, and it compiles to the same channel slots as today
— so bake, glTF export, and the embeddable viewer all keep working unchanged. Live viewport,
zero-recompile parameter scrubbing, per-node previews, and full undo. The editor is built on
**Rete.js** (`rete` + its React render plugin), with fully custom node and connection
components themed to match Thride's dark daisyUI look. This is the headline of the next
milestone; see [`PLAN.md`](PLAN.md) (chunk **E7**) for the full design.

---

## What's working now

**App shell**

- Dockable, reconfigurable panels (dockview) with saved layouts and presets
- Top menu bar + **⌘K command palette** searching every registered command
- Central, remappable shortcut/command registry; right-click context menus everywhere
- daisyUI (sunset theme) UI — dense, keyboard-friendly, dark

**Viewport & rendering**

- One **WebGPU** renderer with automatic **WebGL2 fallback**
- **Cinema-4D navigation** — Alt+LMB orbit _around the clicked point_, Alt+MMB pan,
  Alt+RMB dolly, F/H framing
- **1-up and 4-up** scissored multi-view, any camera bindable to any pane (persp / top /
  front / right ortho)
- Unified **TRS gizmo** (translate + rotate + scale in one, world/local, screen-constant size)
- Shaded / wireframe / material display modes; per-viewport axis indicator; stats HUD
- **Color management** — linear pipeline, AgX / ACES-filmic / neutral tone-mapping
- **Post-FX stack** — bloom, vignette, chromatic aberration, tone-map; live, serialized per pane
- **Reflections** — screen-space (Fast / High) + planar reflectors
- **Environment** — HDR/EXR dome light with PMREM, intensity, rotation, background modes

**Objects & hierarchy**

- Object manager tree with drag-reparent/nesting, visibility & render toggles, generator
  badges, ⌘G group-under-null, option-drag copy, unique sibling naming
- Full **parametric primitive set** (cube, spheres UV+ico, cylinder, cone, capsule, torus,
  tube, plane, disc, platonic solids, landscape, pyramid) with live params + C4D-style
  **adjustment handles**, and **Convert to Mesh**
- All **six Three.js light types** with shadow defaults and a target/aim system

**Modeling & splines**

- Point / edge / polygon **component modes** with a context-sensitive left toolbar
- Modeling ops: extrude, inset, **bevel** (chamfer/straight, N segments, angle threshold),
  weld, delete/dissolve, subdivide, normals
- Grid / vertex / edge **snapping**
- **Boolean generator** (Manifold WASM in a worker) — live, non-destructive, with repair +
  fallback and per-face material recovery
- **3D pen tool** + spline primitives (circle, rect, n-gon, star, line) with a point-edit mode
- **Spline Extrude** and **Sweep** generators with live sliders (depth / bevel / segments / caps)

**Generators**

- **Instancer** (cloner) — scatter a template across a target's geometry (mesh points /
  face centers / edge centers, or spline points / even arc-length count), with a random
  effector (position/rotation/scale jitter). **Convert to Objects** bakes instances into
  real, materialed clones.
- Pull-based, memoized generator graph; "make editable" collapses any generator to a mesh

**Materials** — the noise-driven procedural system described above (per-channel sources,
blend modes, projections, zero-recompile scrubbing), plus a material manager (library,
thumbnails, drag-to-assign) wrapping every built-in Three material type (Standard/Physical
as the PBR default; Basic, Lambert, Phong, Toon, Matcap, Normal). _The node-based editor
(M4) is the next step — the current editor is per-channel, not yet a free-form graph._

**Everything is undoable** — a single command/history stack spans scene, mesh, material, and
generator edits, with a user-configurable memory budget. Interactive drags commit exactly
one history entry; Esc cancels.

---

## Roadmap (M3 and beyond)

Thride is built in hard-stop milestones. What's next:

| Milestone              | Theme                      | Highlights                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M3** _(in progress)_ | Scatter & cameras          | Instancer + effector ✅, cameras as first-class objects bindable to any pane                                                                                                                                                                                     |
| **M4**                 | **Node material editor**   | The headline: a **node-based ("Substance-lite") material editor** — noises, textures, and constants piped through math / ramp / **mix (layer/blend)** / bump modifier nodes into channel outputs. Live viewport, zero-recompile scrubbing, full undo. See below. |
| **M5**                 | Import & UV-ready geometry | **OBJ import** (lossless quads), **glTF/GLB import** with an opt-in **untriangulate** (best-effort quad recovery), headless auto-unwrap for un-UV'd imports                                                                                                      |
| **M6**                 | Bake & live source         | UV-space **bake to WebP** with a quality-preview loop + height→normal; **per-channel baked/procedural selector** (bake while keeping the procedural source live); golden-image regression harness                                                                |
| **M7**                 | Files & interchange        | **`.thride`** package format (round-trips everything), OPFS autosave + crash recovery, **glTF export** (baked PBR + `EXT_mesh_gpu_instancing`), asset browser with drag-drop import                                                                              |
| **M8**                 | Embeddable viewer          | Read-only `.thride` runtime that renders procedural materials live — no editor, no gizmos                                                                                                                                                                        |
| **M9**                 | Animation                  | Timeline / dopesheet + curve editor; keyframe TRS, generator sliders, and procedural material params                                                                                                                                                             |
| **M10**                | Polish                     | Texture-mode projection gizmo, settings page, render-to-image, shortcut remapping, layout presets                                                                                                                                                                |
| **M11**                | 1.0 hardening              | Perf pass (100k+ instances, 1M-tri editing), Safari/Firefox fallback QA, crash drills, demo scenes, docs                                                                                                                                                         |

**No interactive UV editor.** A serviceable in-browser UV canvas is a big build for a
mediocre result, so it's dropped: **bring your own UVs** (imports keep their authored layout),
**use projections** (UV-free in-shader texturing), or let **headless auto-unwrap** generate
islands for baking.

Deferred to 1.x: user-authored custom shader effects, knife/loop-cut. Cloud (S3/GCS)
storage is dropped in favor of local-file + OPFS.

The canonical, always-current plan lives in [`PLAN.md`](PLAN.md); per-session logs are in
[`progress/`](progress/).

---

## Customizable

Thride is designed to be shaped to your work:

- **Data-driven materials** — procedural materials are plain serializable data (and the
  coming node graph is just `nodes` + `edges`), so materials are portable, inspectable,
  diff-able, and script-friendly.
- **Remappable everything** — the shortcut/command registry is central and remappable; the
  command palette exposes every command.
- **Dockable layouts** — reconfigure panels freely and save layout presets (Model / Texture
  / Animate and your own).
- **Per-pane post-FX and display** — build a different look per viewport.
- **Themeable** — Tailwind CSS 4 + daisyUI; the Three.js side draws from a centralized
  color system tied to the DaisyUI theme rather than hard-coded colors.
- **Fork-friendly** — MIT-licensed, with a strictly layered architecture (below) that keeps
  operations code free of UI so it's easy to extend or reuse.

---

## For developers (fork / contribute)

Thride is **MIT-licensed** and open to contribution. It's a single **Vite+ (`vp`) React 19 +
TypeScript** app on the [Vite+ unified toolchain](https://viteplus.dev/guide/) (Rolldown,
Vitest, Oxfmt), with a deliberately strict architecture.

### Architecture at a glance

- **Renderer:** Three.js `WebGPURenderer` + TSL node materials, automatic WebGL2 fallback.
- **Document is the source of truth.** A plain-TS `Document` holds all state; **Three.js
  objects are a _projection_** of it, kept in sync by a `SceneSynchronizer`. All entities use
  time-ordered UUIDs and reference each other **by id**, never by live object — which is what
  makes serialization, undo, and multi-view sane.
- **Command bus + single undo stack** across every domain; interactive edits use a
  `begin → update (preview) → commit / cancel` session model so a 60 Hz drag produces one
  history entry.
- **Half-edge geometry kernel** — array-based, struct-of-arrays on typed arrays; supports
  n-gons and quad editing (no triangle-only corner tables). Undo is snapshot-based, not
  inverse-ops.
- **Layered imports, enforced:**
  `app → (ui, editors, render) → (generators, materials, animation, io) → geometry → core → types`.
  Operations code (`core`, `geometry`, `materials`, …) imports **no** React, DOM, or Three
  scene objects. 2D DOM UI lives in `src/ui`, 2D canvas editors in `src/editors`, 3D viewport
  UI in `src/render`. Path alias `@/` → `src/`.
- **Hard rules:** files stay **under 500 lines** (split, don't grow); all shared types live
  in `src/types`; all TSL imports go through the `materials` barrel; icons go through the
  `src/icons` hugeicons barrel only.

See [`PLAN.md`](PLAN.md) for the full architecture and [`CLAUDE.md`](CLAUDE.md) /
[`AGENTS.md`](AGENTS.md) for the working conventions.

### Getting started

```bash
vp install        # install deps (run after every pull)
vp dev            # boot the app (http://localhost:5656)
vp build          # production build
```

### Linting & type-checking

> **Read this — it overrides the generic Vite+ checklist.** ESLint is the linter here, not
> `vp lint`.

oxlint's type-aware pass (`oxlint-tsgolint`) hangs indefinitely on the TSL node-graph files,
so it's disabled. Use:

```bash
pnpm lint         # ESLint (type-aware, via typescript-eslint) — the real lint gate
pnpm lint:fix     # ESLint with --fix
pnpm check        # tsc --noEmit  (the real type gate; also `tsc -b`)
vp test           # Vitest
vp fmt            # Oxfmt (fine to use)
```

`vp check` runs **format only** — its lint and type-check steps are turned off in
`vite.config.ts` so it doesn't hang. Do **not** use `vp lint` or rely on `vp check` for
linting/types.

Notes:

- **TypeScript is pinned at `~6.0.2`.** `typescript-eslint` has no support for the TS 7 native
  compiler yet (its parser crashes against it), so bumping to 7 would stop ESLint from running
  entirely.
- **Never `type Node = any` in TSL code.** Import node value types from the `@/materials/tsl`
  barrel (`Vec3` / `Vec2` / `Vec4` / `Float`). The strict `no-unsafe-*` / `no-explicit-any`
  family is enforced as **errors in `src/materials/**`\*\* to keep the node-graph code honest;
  it's relaxed elsewhere for renderer internals and third-party effect nodes.

See the [typescript-eslint docs](https://typescript-eslint.io) for rule details.

---

## License

MIT © 2026 Jeff Falcon. See [`LICENSE`](LICENSE).
