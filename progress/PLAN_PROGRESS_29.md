# PLAN_PROGRESS_29 — F2 tail: Instancer (object distribution) + Convert to Objects

**Date:** 2026-07-18
**Chunks worked:** F2 (Cloner → **Instancer**) — the last two pieces from PLAN_PROGRESS_28 §4:
object distribution and Convert to Objects.
**Milestone context:** M3 (Scatter & cameras). F2 now complete; **F4 Cameras** is the last M3 chunk.

## Completed

The Cloner became an **Instancer**: it takes **two children by object-manager order — child[0] =
the target to clone _onto_ (a mesh or spline), child[1] = the object to instance (template)** — and
scatters the template across the target's geometry. All three built-in distributions
(linear/radial/grid) were removed; object distribution replaces them (linear → a new **Line** spline

- count; radial → a Circle spline; grid → a Cube primitive with segments). The serialized descriptor
  key stays `type: "cloner"` (only the labels say "Instancer") so saved docs and the ~6 call sites keep
  working.

* **Line spline primitive** — `SplinePrimitive` `| { type: "line"; length: number }`, `line()` builder
  (2 linear anchors along local X, centered), Create → Splines → **Line** (`IconLine`), Attributes
  length row. `src/types/geometry/spline.ts`, `geometry/splines/primitives.ts`, `icons/index.tsx`,
  `app/commands.tsx`, `ui/panels/AttributesPanel.tsx`.
* **Object distribution ops** — `ClonerParams` now `{distribution, count, orientation, upVector,
hideTarget, + effector}`. `Instance` carries a column-major 3×3 `basis`; `basisFromUp` builds an
  orthonormal frame with local +Y = a direction (identity for +Y so clones match their template),
  `upVectorAxis` maps the six signed axes. The effector composes jitter onto the basis and bakes 16·N
  matrices. `normClonerParams` degrades legacy linear/radial/grid docs. `generators/cloner.ts`.
* **Target sampler** (`generators/instancerSample.ts`, new) — mesh **points** (vertex + smooth
  normal) / **faces** (centroid + face normal) / **edges** (midpoint + averaged adjacent-face
  normal, via a one-pass `heFace` map); spline **points** (anchors) / **count** (even arc-length via
  the shared `resample`, ≥ 2). Positions/normals baked through child[0]'s transform. Orientation:
  `normal` → surface normal/tangent; `direction` → the fixed `upVector` axis.
* **Graph wiring** (`generators/graph.ts`) — `evaluateCloner`: target = child[0], template =
  child[1]; sample → `clonerInstanceMatrices`. Memo key adds the target fingerprint (mesh:
  id+topology+posChecksum+transform; spline: data+transform). Needs both children or it draws nothing.
* **Render** (`render/scene-sync/SceneSynchronizer.ts`) — `isConsumed` is Instancer-child-aware:
  template (child[1]) always hidden, target (child[0]) hidden only when `hideTarget`.
  `clonerTemplateMaterialId` reads child[1].
* **Attributes** — INSTANCER block reads child[0]'s kind to show the right Distribution options (mesh:
  Points / Polygon Centers / Edge Centers · spline: Points / Count), plus Count (spline, min 2),
  Orientation, Up Vector (direction only), **Hide Target** toggle, and the effector rows.
* **Create menu** — Create → Generators → **Instancer** grabs up to 2 selected mesh/primitive/spline
  nodes in selection order → `[target, template]`.
* **Convert to Objects** (`generators/commands/convertToObjects.ts`, new) — bakes the live instances
  into a GROUP of real, materialed clone nodes (`Base`, `Base.1`, `Base.2` …), one shared registered
  geometry, template material per clone, decomposed TRS (pure `mat16 → TRS`, three XYZ Euler). The
  Instancer node + its inputs are replaced by the group in one undo step. Guarded at
  `MAX_CONVERT_INSTANCES = 2000` (caller checks `instanceCount` and `window.alert`s past the cap).
  Shares the Convert-to-Mesh shortcut via a new `AppCommand.dynamicTitle` (label swaps to "Convert to
  Objects" when only Instancers are selected); render sites: `MenuBar`, `ContextMenu`, `CommandPalette`.
* **Shared resampler** — `resample()` + `computeTangents()` + `normalize`/`lerp3` extracted from
  `sweep.ts` into `geometry/splines/resample.ts` and reused by both.

## Decisions made (and why)

- **Removed linear/radial/grid entirely** (owner-confirmed). Object-only is C4D-flexible; grid is
  covered by a Cube-with-segments target, linear by Line + count, radial by Circle. Old docs degrade
  via `normClonerParams`.
- **Target visible by default + a Hide Target toggle** (owner-confirmed) — you see what you scatter on.
- **Kept the `type: "cloner"` serialization key** — renaming it would break saved docs and every
  `gen.type === "cloner"` site; only the UI labels changed.
- **Clones share one geometry** on Convert to Objects — memory-safe, matches the instancing model
  (edit-one-affects-all until individually re-converted). Documented; acceptable for v1.
- **`normal`-mode roll** uses a fixed world-Z reference (not a user up-vector) — matches the plain
  reading of the spec (up-vector picker is for `direction` only).
- **Clone naming uses the app convention** `Base.1/.2` (`uniqueSiblingName`), not zero-padded
  `.001/.002` — the whole app names siblings this way (Convert to Mesh, duplicate, etc.); a second
  scheme would look foreign. Flag for the owner if zero-padding is specifically wanted.

## Files added / changed

- **types/geometry:** `spline.ts` (+line)
- **geometry/splines:** `primitives.ts` (+line), `resample.ts` (NEW, extracted), `eval.ts` (unchanged, reused)
- **generators:** `cloner.ts` (rewritten ops), `instancerSample.ts` (NEW), `graph.ts` (evaluateCloner),
  `sweep.ts` (imports from resample.ts), `commands/convertToObjects.ts` (NEW)
- **render:** `scene-sync/SceneSynchronizer.ts` (consume + material by child index)
- **ui:** `panels/AttributesPanel.tsx` (Instancer block + line meta), `commands/CommandRegistry.ts`
  (`dynamicTitle`), `shell/MenuBar.tsx` · `shell/ContextMenu.tsx` · `shell/CommandPalette.tsx` (dynamicTitle)
- **app:** `commands.tsx` (Instancer create, Line create, convert branch + label swap)
- **icons:** `index.tsx` (`IconLine`)
- **tests:** `generators/cloner.test.ts` (rewritten), `generators/instancerSample.test.ts` (NEW)

## Test status

- `tsc -b`: clean.
- `pnpm lint` (ESLint): 0 errors (48 pre-existing `no-unnecessary-type-assertion` warnings, none new).
- `vp test`: **238 passed** (36 files) — includes the new sampler + basis/effector suites.
- **In-browser (verified, scene restored):** Line spline; Instancer onto a Line (points = 2 anchors,
  count = 10 evenly spaced) and onto a Cube (points = 8 verts, Polygon Centers = 6 faces); Distribution
  options switch by target kind; target visible, template consumed; INSTANCER attributes render;
  Convert to Objects → group of `Sphere`/`Sphere.1…9` real clones; one undo restores the Instancer.
  Zero console/WebGPU errors throughout.

## Known issues

- Clones from Convert to Objects share geometry (see Decisions).
- `edges` distribution enumerates every undirected edge; no dedup beyond the twin check (correct, but
  a very dense mesh target yields a lot of clones — the 2000 guard on convert still applies).

## Next steps (exact, resumable cold)

1. **F4 Cameras** — cameras as first-class objects, bindable to any viewport pane; closes M3.
2. Then run the **M3 QA checklist** and wait for owner sign-off (M3 is a hard stop): 100k instances
   @60fps, any camera bindable to any pane, area lights don't crash.
