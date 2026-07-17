<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Thride Project Conventions

Thride is a browser 3D IDE on Three.js WebGPU/TSL — an open-source Spline with Blender 5 aesthetics. **PLAN.md is the canonical plan; read it plus the highest-numbered `progress/PLAN_PROGRESS_N.md` before writing code.**

## Linting & type-checking (read this — it overrides the vite-plus checklist above)

**ESLint is the linter, not `vp lint`.** oxlint's type-aware pass (tsgolint) hangs
indefinitely on our TSL node-graph files, so it is disabled:

- **Lint:** `pnpm lint` (ESLint) / `pnpm lint:fix`. Do **not** use `vp lint`; it hangs.
- **Type-check:** `tsc -b` (also `pnpm check`). This is the real type gate.
- **`vp check`** runs fmt only — its lint + type-check steps are turned off in
  `vite.config.ts` (`check.lint: false`, `lint.options.typeAware/typeCheck: false`) so
  it doesn't hang. `vp test` and `vp fmt` are fine.
- **TypeScript is pinned at `~6.0.2`.** Do not bump to 7 — `typescript-eslint` has no
  TS7-native support yet (its parser crashes on the native compiler), so ESLint would
  stop running entirely.

**TSL node typing — never `type Node = any`.** Import the node value types from the
`@/materials/tsl` barrel instead: `Vec3`, `Vec2`, `Vec4`, `Float` (the general
`Node<T>` alias @types/three doesn't export, named via barrel values). Uniform nodes
follow the `ReturnType<typeof makeXU>` factory pattern in `materials/procedural/uniforms.ts`.
The strict `no-unsafe-*` / `no-explicit-any` family is **enforced as errors in
`src/materials/**`** (see `eslint.config.js`) — that's what stops a new `type Node = any`
from creeping back into the noise/procedural graph code. Elsewhere the family is off
(scattered escape hatches: renderer internals, the BVH monkey-patch, the third-party
SSR effect nodes in `render/viewport/ditherOutput.ts`).

## Session workflow

- Work in the chunk units defined in PLAN.md (A1…J3). End sessions at chunk boundaries: gates green (`pnpm lint` + `tsc -b` + `vp test` — **not** `vp check`; see Linting above), commit, write the next numbered `progress/PLAN_PROGRESS_N.md` (template in `progress/TEMPLATE.md`).
- Milestones M0–M6 are hard stops: write progress, run the milestone QA checklist, and wait for user sign-off. Never continue into the next milestone unprompted.

## Code organization (hard rules)

- Files stay **under 500 lines** — split into submodules instead of growing.
- Operations code (`src/core`, `geometry`, `materials`, `animation`, `generators`, `io`) never imports React, DOM, or Three scene objects.
- 2D DOM UI lives in `src/ui`, 2D canvas editors in `src/editors`, 3D viewport UI in `src/render`. Never mix.
- All shared types/DTOs live in `src/types` (no logic, no imports from other layers).
- Import direction: `app → (ui, editors, render) → (generators, materials, animation, io) → geometry → core → types`.
- Path alias: `@/` → `src/`. All TSL imports go through the `materials/noises` barrel, never scattered.

## UI & state conventions

- 2D UI is **Tailwind CSS 4 + daisyUI 5** (theme: `sunset`). Always reach for a daisyUI component class before a bare HTML element; use the smallest size variants (`btn-xs`, `menu-xs`, `input-xs`, …) to keep the UI compact. No custom CSS unless genuinely impossible with utilities (current exceptions: dockview theme glue, scrub cursor in `src/index.css`).
- App/UI state is **jotai**. All state logic lives under `src/ui/hooks/` in nested domain dirs (`doc/`, `editor/`, …). Combine related hooks in one file named for the domain (`history.ts`, `viewport.ts`) — never one file per hook, never `use*.ts` filenames.
- The render layer never imports `src/ui`; it consumes editor state via the `EditorViewportState` contract in `src/types/editor.ts` (implemented over jotai's default store in `ui/hooks/editor/viewport.ts`).
- Icons are hugeicons wrapped as `Icon<Concept>` components in `src/icons` (global size via
  `iconSizeAtom`, default 20px; `strokeWidth` 1.6; currentColor). **Add icons to that barrel
  only — never import `@hugeicons/*` elsewhere**, or the icon stops honoring the global size.
  Grep the `hugeicons` skill's `references/icon-list.md` for exact names; never guess one.
- Use the DaisyUI theme color in ThreeJS where possible, especially for primary, secondary, and accent colors. Maintain a ThreeJS color system in a centralized place. Do not hard code colors in various files.
