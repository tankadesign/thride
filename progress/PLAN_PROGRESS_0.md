# PLAN_PROGRESS_0 — Project conventions + document model core

**Date:** 2026-07-09
**Chunks worked:** A1, B1
**Milestone context:** M0 in progress — 2 of 12 chunks done (A1, B1). Remaining for M0: A2, A3, A4, B2, B3, B4, C1, C2, C3, C4, D1, D2, D3.

## Completed

- **A1 Project conventions** — Vite template cruft removed (App.css, assets, template App). `three@0.185.1` + `@types/three` + `vitest` installed. `src/` module skeleton created with a purpose README in each folder (types, core, geometry, materials, animation, generators, io, workers, render, editors, ui, icons, app). `@/` → `src/` alias wired in `tsconfig.app.json` (paths) and `vite.config.ts` (resolve.alias). `strict` + `noUncheckedIndexedAccess` enabled. Dark placeholder shell in `src/app/App.tsx`; base theme tokens in `src/index.css`. Project conventions written into `AGENTS.md` (session workflow, org rules, import direction). Progress template at `progress/TEMPLATE.md`.
- **B1 Document model** — `src/types/core/`: `Uuid` brand, tuple math types, `SceneNodeDTO` (flat list, parent refs, DFS sibling order), `ThrideDocumentDTO` (+ `FORMAT_VERSION` "0.1.0"), `SliceId` + `DocEventMap` (with `preview` tagging). `src/core/`: `uuidv7()` (time-ordered, tested), `EventBus` (typed, listener-isolated), `SceneNode` (toDTO/fromDTO, structuredClone of unknown `data` keys), `SceneStore` (flat map + child-order index, cycle-rejecting reparent, subtree removal parents-first), `Document` (mutation methods that emit events + bump per-slice versions; `toDTO`/`loadDTO`).

## Left mid-flight

- Nothing. Clean chunk boundary.

## Decisions made (and why)

- **Sibling order = DFS order of the flat DTO node list** (no `children` array in DTOs) — avoids parent/children redundancy and the desync bugs it invites; `SceneStore` maintains the runtime child-order index.
- **Test imports use `vite-plus/test`** (not `vitest` directly) — enforced by the `vite-plus/prefer-vite-plus-imports` lint rule; the auto-fixer rewrites them anyway.
- **`DocEventMap` is a `type`, not `interface`** — interfaces don't satisfy `Record<string, unknown>` generic constraints (no implicit index signature).
- **`vp` is not on PATH** in shell sessions — use `export PATH="$PWD/node_modules/.bin:$PATH"` or `pnpm exec vp`.
- Dev server is expected to already run on port 5656 (per AGENTS.md) — reuse it, don't spawn new ones.

## Files added / changed

- Root: `PLAN.md` (synced approved plan), `AGENTS.md` (+conventions), `vite.config.ts` (+alias), `tsconfig.app.json` (+strict/paths), `package.json` (+three, @types/three, vitest)
- `src/`: `main.tsx`, `index.css`, `app/App.tsx`
- `src/types/core/`: `ids.ts`, `math.ts`, `scene.ts`, `document.ts`, `events.ts`, `index.ts`
- `src/core/`: `ids/uuid.ts` (+test), `events/EventBus.ts` (+test), `document/SceneNode.ts`, `document/SceneStore.ts`, `document/Document.ts` (+test), `index.ts`
- Module READMEs in every `src/` folder; `progress/TEMPLATE.md`

## Test status

- `vp check`: pass (0 lint/type errors, 18 files)
- `vp test`: 13 passed / 0 failed (3 files: uuid, EventBus, Document)
- `pnpm build`: production build OK (190 kB js before three is actually imported anywhere)
- Dev server on :5656 serves the shell (HTTP 200)

## Known issues

- `identityTransform()` is a (trivial) factory living in `src/types/` — acceptable as a contract default, but keep `types/` otherwise logic-free.
- `three` is installed but not yet imported (C1 starts that); expect bundle size to jump then.

## Next steps (exact, resumable cold)

1. **B2 History** (`src/core/history/`): `Command` interface (`execute/undo/tryMerge/memoryCost`), `History` class with `run`, `transact`, `pushWithoutExecute`, undo/redo, time-bounded merge coalescing, memory budget accounting (worker compression can stub for now). Property-test: random command sequences with interleaved undo/redo converge to DTO-deep-equal states. Wrap existing `Document` mutators in command factories (`src/core/history/commands/scene.ts`).
2. **B3 Interactive sessions + selection** per PLAN.md.
3. Then A2 (design system) or C1 (renderer + viewport) — both unblocked once B2/B3 land; C1 only needs B1 and can start in parallel with B2 if a second agent is available.
