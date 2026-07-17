# PLAN_PROGRESS_27 — Look-dev re-steer + ESLint/TS6 lint migration

**Date:** 2026-07-17
**Chunks worked:** none coded — a **strategic re-steer of the plan** (PLAN.md rewrite) plus a
**toolchain lint migration** (committed). M2 remains complete/awaiting sign-off; M3 is next.

## 1. Lint migration off `vp` → ESLint on TypeScript 6 (`dc30db3`)

`vp lint`/`vp check` froze indefinitely. Root cause: oxlint's type-aware pass (**tsgolint**)
hangs on the TSL node-graph files (it resolves `three/tsl` expressions to `error` type — real
`tsc` handles them fine). ESLint was evaluated as a replacement and **TypeScript was pinned back
to `~6.0.2`**: `typescript-eslint`'s parser crashes at load against the TS7 native compiler
(peer range `<6.1.0`), so TS7 + ESLint is impossible today.

Shipped:
- **ESLint 10 + typescript-eslint** flat config (`eslint.config.js`); `pnpm lint` / `pnpm lint:fix`.
- `vp check`'s lint + type-check steps **disabled** in `vite.config.ts` (`check.lint:false`,
  `lint.options.typeAware/typeCheck:false`) so it no longer hangs — it runs fmt only. `tsc -b`
  is the type gate.
- **Every `type Node = any` removed from the TSL library** — replaced with real node types from a
  new `@/materials/tsl` barrel: `Vec3`/`Vec2`/`Vec4`/`Float` (the general `Node<T>` @types/three
  doesn't export, named via `typeof normalLocal` + swizzles) and a `ReturnType`-factory pattern
  for uniform nodes. Files: tsl.ts, noises/{functions,registry}, procedural/{blend,bump,compile,
  imageProjection,uniforms,projections}, render/{grid/InfiniteGrid, scene-sync/{SelectionOutline,
  proceduralBind}, viewport/postEffects}.
- The `no-unsafe-*` / `no-explicit-any` family is **enforced as errors in `src/materials/**`**
  (verified it catches a planted `any`) — that's what stops a new `type Node = any` creeping back.
  Off elsewhere (renderer internals, BVH monkey-patch, third-party SSR effect nodes in
  `ditherOutput.ts` keep their `any`).
- Proper typing surfaced + fixed **two latent bugs `any` hid**: a vec4 texture fed into the vec3
  image-projection path, and the per-component overlay blend.
- Docs updated so this isn't re-discovered: **AGENTS.md** (→ CLAUDE.md symlink) + **README.md**
  now document the ESLint/TS6 setup, the `vp check` caveat, and the barrel-type convention.

**Deferred (task chip spawned):** ~11 pre-existing `react-hooks` findings in UI code, surfaced
for the first time (the repo never ran a working linter before). Set to **warn** (visible, not
silenced) pending a dedicated cleanup — they are NOT from the TSL work. `ditherOutput.ts` keeps
its `any` (third-party SSR orchestration, high verification risk, no enforcement benefit).

## 2. Product re-steer — Substance-like look-dev tool (PLAN.md rewritten)

The owner re-scoped the product: from a generic Three.js DCC ("open-source Spline") to **the
realtime look-dev & procedural-material tool for the Three.js ecosystem.** The M0–M2 DCC
foundation stays but **modeling is frozen** (supporting capability, not the pitch). Differentiators:

1. Import **non-triangular** meshes from C4D/Blender (glTF triangulation breaks editing/animating).
2. WYSIWYG realtime look-dev in WebGPU/TSL matching final output (already the core strength).
3. Procedural materials → **bake to maps for performance while keeping the procedural source
   revisable in the file.**
4. Export two ways: **glTF + baked PBR** (any Three.js app) and a live **`.thride`** rendered by an
   **embeddable viewer**.
5. Animation deferred past files (animate sweep/extrude sliders + procedural params on *unbaked*
   materials).

### Grounding (three Explore agents this session)
- **N-gon pipeline is already native end-to-end** — HEMesh kernel (`fromPolygons` takes
  `number[][]`), ops (polygon-soup rebuild), serialization (`meshPack.ts`) all preserve n-gons;
  triangulation is display-only + reversible. **The only import gap is: no mesh importer exists at
  all.**
- **Procedural materials done + mature**; the **image-map + procedural-doc coexistence substrate
  already exists** (`MaterialDTO.textures` + `.procedural`, `TEXTURE_TO_PROCEDURAL`,
  `proceduralBind.ts` priority). **Bake (E6) is 0% built / 100% specified.**
- **File format: DTO layer done, package absent** — no `.thride` zip/`.hem`/CAS/OPFS/import/export;
  persistence is IndexedDB autosave only.

### Owner decisions (locked)
Import **both OBJ (lossless quads) and GLTF/GLB with an opt-in untriangulate toggle** (best-effort,
greedy topology-preserving tri-pairing — NOT a remesher); FBX later if needed. Export to **both**
glTF+baked-maps and the live `.thride` viewer. **S3/GCS cloud dropped.** Cloner+cameras next;
files > animation.

### Re-ordered milestones (PLAN.md updated; prior M3–M6 superseded)
- **M3 Scatter & cameras** (F2, F4; + fix Area-light LTC crash)
- **M4 Import & UV-ready geometry** (N1 OBJ, H3 GLTF + N3 untriangulate, N2 headless unwrap)
- **M5 Bake & live source** (E6, B-SEL selector, VH golden-image harness)
- **M6 Files & interchange out** (H1 `.thride`, H2 OPFS, H4 glTF export, H6 asset browser)
- **M7 Embeddable viewer** (VW)
- **M8 UV editor & polish** (I1, E4 gizmo, A6)
- **M9 Animation** (G1–G3; promote Sweep generator)
- **M10 1.0 hardening** (J1–J3)

New chunks defined in PLAN.md: **N1, N3, N2, B-SEL, VW, VH** (+ H3 promoted to first-class,
H5 cloud dropped). Full detail + critical path in the approved plan
(`.claude/plans/vast-sauteeing-willow.md`).

## Files changed
- **Committed (`dc30db3`, 20 files):** the ESLint/TS6 lint migration (see §1).
- **This session, uncommitted:** `PLAN.md` (north star + M3–M10 + new chunks), this progress file.
- Pre-existing uncommitted (NOT mine, left alone): a `vitest`→`vite-plus/test` test-import
  migration across several `*.test.ts`, and a grid-color cleanup (`viewportTheme.ts` +
  `InfiniteGrid.ts` gridCellColor→gridLineColor).

## Test status
- `tsc -b`: clean. `pnpm lint`: 0 errors (58 warnings = flagged pre-existing debt). `vp test`:
  203 passed / 32 files.

## Next steps (exact, resumable cold)
1. Commit the PLAN.md re-steer + this progress file.
2. **Start M3 — Scatter & cameras.** Begin with the **Area-light LTC crash fix**
   (`RectAreaLightNode.setupDirectRectArea` reads `null.LTC_FLOAT_1`; needs
   `RectAreaLightTexturesLib.init()` — nothing calls it) so imported/demo scenes don't break,
   then **F2 Cloner** (linear/radial/grid/surface → InstancedMesh descriptor + effector), then
   **F4 Cameras** (camera objects, frustum gizmos, look-through; unblocks `camera` projection +
   E4's texture-mode gizmo path).
3. M2 is still a hard stop pending the owner running `progress/M2_QA_CHECKLIST.md` for sign-off.
