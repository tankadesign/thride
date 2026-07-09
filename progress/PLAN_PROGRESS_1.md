# PLAN_PROGRESS_1 — History: commands, undo/redo, budget

**Date:** 2026-07-09
**Chunks worked:** B2
**Milestone context:** M0 in progress — 3 of 12 chunks done (A1, B1, B2). Remaining for M0: A2, A3, A4, B3, B4, C1, C2, C3, C4, D1, D2, D3.

## Completed

- **B2 History** — `src/core/history/`:
  - `Command.ts`: `Command` interface (`type/label/execute/undo/tryMerge?/memoryCost?`) + `CompositeCommand`.
  - `History.ts`: single undo/redo stack; `run()`, `pushWithoutExecute()` (for B3 interactive sessions), `transact()` (groups into one step, flattens nested, rolls back executed commands in reverse on throw), time-window-bounded `tryMerge` coalescing (injected clock for tests), retained-bytes memory budget with oldest-first eviction (newest step always survives), `setBudget()` for the future Settings page, `stats`/labels for Edit-menu display.
  - `commands/scene.ts`: `CreateNodeCommand` (DTO built up front → stable id across redo), `RemoveNodeCommand` (captures subtree DTOs parents-first + sibling index), `ReparentNodeCommand`, `RenameNodeCommand`, `SetTransformCommand` (merge-capable; optional explicit `before` for interactive commits), `SetFlagsCommand`.
  - `Document` now owns `history` (bumps new `"history"` slice + emits `history:changed`); `loadDTO()` clears history. `SliceId`/`DocEventMap` extended.
  - Tests: 11 new — behavior suite (merge window, transact rollback, budget eviction, pushWithoutExecute, event emission) + property suite: 4 seeds × 150 random commands with snapshots at every depth; 200-step random undo/redo walks and full unwind/replay must match snapshots exactly.

## Left mid-flight

- Nothing. Clean chunk boundary.

## Decisions made (and why)

- **`erasableSyntaxOnly` is on in this template** — TS constructor parameter properties are forbidden; write explicit field assignments. (Cost us 13 lint errors; now a known rule.)
- **Rolled-back transactions leave the redo stack intact** — nothing was recorded, so history must be exactly as before the attempt.
- **Session-commit commands take an explicit `before`** — a command pushed via `pushWithoutExecute` must carry the value captured at session `begin()`; lazy capture at execute-time would read the already-mutated state. `SetTransformCommand(nodeId, after, before?)` models this; B3 sessions must follow the same pattern.
- Worker compression of evicted snapshots deferred (TODO in `History.evict`) until mesh snapshots exist (D-chunks).

## Files added / changed

- `src/core/history/`: `Command.ts`, `History.ts` (+`History.test.ts`), `commands/scene.ts` (+`commands/scene.property.test.ts`)
- `src/core/document/Document.ts` (owns History, clears on load), `src/core/index.ts` (exports), `src/types/core/events.ts` (+`history` slice, `history:changed`)

## Test status

- `vp check`: pass (0 errors, 23 files)
- `vp test`: 24 passed / 0 failed (5 files)

## Known issues

- History eviction drops steps outright; compress-before-evict lands with mesh snapshots (D1+).
- `DEFAULT_COMMAND_COST = 512` bytes is a guess for DTO-patch commands; revisit when profiling real sessions.

## Next steps (exact, resumable cold)

1. **B3 Interactive sessions + selection** (`src/core/session/`, `src/core/selection/`): `InteractiveSession<T>` per PLAN.md (`begin/update/commit/cancel`, preview-tagged events, commit via `history.pushWithoutExecute` with begin-captured `before` — see SetTransformCommand pattern). Selection model: object id set + per-mesh component bitsets stamped with `topologyVersion`, `"selection"` slice bumps + events. Done when: scripted drag session yields exactly one history entry; cancel restores state byte-identical.
2. **B4 React bindings** (`src/ui/hooks/`): `useSyncExternalStore` per-slice hooks against `doc.version(slice)`.
3. Then C1 (renderer + viewport) and A2 (design system) — parallelizable.
