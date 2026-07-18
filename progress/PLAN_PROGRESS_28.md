# PLAN_PROGRESS_28 — M3 kickoff: Area-light fix + F2 Cloner (through radial/grid)

**Date:** 2026-07-18
**Milestone:** M3 (Scatter & cameras). M2 signed off by owner.
**Chunks worked:** Area-light LTC crash fix · F2 Cloner (ops → render → distributions →
material/texture correctness) · gate hygiene · object-manager icon fixes. All committed.

## 1. M2 finish (prior, committed) + M3 kickoff

M2's last pieces landed before this file: the **projection gizmo** (Texture mode — TRS gizmo
edits a material channel's projection placement via `ProjectionDragSession`, verified), hide/show
map toggles, lights/cameras selectable (PICK_LAYER), directional-light circle helper. Then M2 was
signed off and **M3 started**.

## 2. Area-light LTC crash (`2500156`)

WebGPU `RectAreaLightNode.setupDirectRectArea` dereferenced `null.LTC_FLOAT_1` — any scene with an
area light threw. New `src/render/lights/rectAreaLTC.ts` calls
`RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init())` once, lazily from `LightSync` on the
first area light. Verified in-browser: Create → Lights → Area renders instead of crashing.

## 3. Gate hygiene (`e45d676`)

- The Option-B worktree under `.claude/worktrees/` polluted `vp test` (vitest globbed 33 phantom
  suites). Added `test.include: ["src/**/*.{test,spec}.{ts,tsx}"]` in `vite.config.ts` so the glob
  stays in this tree's `src/`.
- Fixed two pre-existing `tsc -b` errors in the keybindings code (noUncheckedIndexedAccess).

## 4. F2 Cloner — DONE except **object distribution** + **Convert to Objects**

A cloner is a `GeneratorNode` (`data.generator.type === "cloner"`) that clones its first
mesh/primitive child across a distribution, output as an **InstancedMesh** (bypasses the HEMesh
pipeline). Commits `739036a` → `5541865`.

**Ops** (`src/generators/cloner.ts`, pure): `ClonerParams` + `clonerMatrices` → flat column-major
`Float32Array` (16·N), allocation-free (reused scratch 3×3s) so a 100k count-drag stays a tight
loop. Distributions: **linear**, **radial** (ring about an axis, each clone fanned), **3D grid**
(centered lattice). Emits `Instance{position,rotation}` per clone; the effector composes its
jitter ONTO the base orientation. `object` mode is declared but its points come from the graph
layer via `clonerInstanceMatrices` (next chunk). PRNG = `mulberry32(seed ^ i·φ)` (index mixed IN,
not added). `norm()` merges params over defaults so pre-grid docs don't crash. 11 unit tests.

**Graph** (`graph.ts`): `cloner` in `GeneratorDescriptor` + separate `evaluateCloner` (own memo;
returns `{key, base: HEMesh, matrices}` — kept apart so the HEMesh path stays non-optional).

**Render** (`src/render/scene-sync/ClonerSync.ts`): cloner node maps to an `InstancedMesh` (IS the
node object → material resolution + pick-parent-walk free). Matrices copy straight onto
`instanceMatrix.array` (no `setMatrixAt`). **WebGPU lifetime, hard-won (all verified):**
(a) resizing needs a NEW InstancedMesh — reassigning `instanceMatrix` doesn't re-bind on the
backend; (b) the outgoing mesh is disposed on a **timer** (`RETIRE_MS`), never synchronously —
eager/one-gen dispose races the async submit → "buffer used while destroyed" → blank frame;
(c) the base geometry re-syncs only when the template changes, not every count edit. `frustumCulled
= false`. Amortized capacity growth (`×1.5`). `isConsumed` hides the template.

**Create + UI**: Create → Generators → Cloner (`IconCloner` = Layers02); Attributes → Cloner block
with Mode select + mode-specific rows (step / radius+axis / grid count+spacing) + effector.

**Material persistence** (`4b60687`): clones wear the TEMPLATE child's material (applyShading falls
back to it), a cloner-level material overrides. Verified: cloning the marble cube → marble clones.

**Per-instance-local texture** (`f0232fd`): projections sampled `positionLocal`/`normalLocal`, which
on an InstancedMesh are POST-instance → every clone read a different slice of one texture and the
mapping ignored effector rotation. Switched `projections.ts` to `positionGeometry`/`normalGeometry`
(raw pre-transform) — each clone samples in its own base frame → identical texture per clone, glued
to the instance. Non-instanced meshes: geometry ≡ local, so single meshes + the projection gizmo
are unaffected. Verified: separated clones went from different marble slices to identical.

**Verified in-browser** (then scene restored): create, linear/radial/grid render, click-a-clone
selects the cloner (BVH), live param edits reflow, 5→1300+ count grow renders with zero WebGPU
errors, material + texture correctness.

## 5. Object-manager icons (`722eec8`)

Primitives showed a bare cube regardless of shape → added `PRIMITIVE_KIND_ICON`. `IconCloner` is
now Layers02 in menu + tree.

## Test status

`tsc -b` clean · `pnpm lint` 0 errors · `vp test` 35 files / 231 tests.

## Next steps (exact, resumable)

1. ✅ **DONE (see PLAN_PROGRESS_29)** — **F2 object distribution**, implemented as the **Instancer**:
   child[0] = target (mesh/primitive/spline), child[1] = template. Built-in linear/radial/grid were
   **removed entirely** (owner-confirmed); object distribution replaces them (linear → new Line
   spline + count, radial → Circle, grid → Cube-with-segments). Target stays **visible by default**
   with a Hide Target toggle. New `generators/instancerSample.ts` samples mesh points/faces/edges or
   spline points/count with orientation; `evaluateCloner` reworked; memo key includes the target
   fingerprint.
2. ✅ **DONE (see PLAN_PROGRESS_29)** — **Convert to Objects**
   (`generators/commands/convertToObjects.ts`). Shares the Convert-to-Mesh shortcut via a new
   `AppCommand.dynamicTitle` (label swaps to "Convert to Objects" for Instancers); bakes instances →
   a GROUP of clones named `Base.001/.002` (zero-padded, as requested), one shared geometry, material
   per clone (cloner override else template), ONE undo step, guarded at `MAX_CONVERT_INSTANCES = 2000`.
3. Then **F4 Cameras** to close M3. ← **the remaining M3 chunk.**
