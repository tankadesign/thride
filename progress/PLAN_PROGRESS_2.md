# PLAN_PROGRESS_2 — Interactive sessions, selection, React bindings

**Date:** 2026-07-09
**Chunks worked:** B3, B4
**Milestone context:** M0 in progress — 5 of 12 chunks done (A1, B1, B2, B3, B4). Remaining: A2, A3, A4, C1, C2, C3, C4, D1, D2, D3.

## Completed

- **B3** — `src/core/session/`: `InteractiveSession<TInput>` interface + `SessionRunner` (one active session; start auto-cancels strays; commit → `history.pushWithoutExecute`; null commit = no history entry). `TransformDragSession` (multi-node, begin-captured befores, preview-tagged updates, composite commit, exact cancel restore). `src/core/selection/`: `Bitset` (growable Uint32Array), `Selection` (object ids + active + edit mode + per-mesh `ComponentSelection` stamped with topologyVersion; NOT undoable by design). Document owns `selection` + `sessions`; `removeNode` prunes selection.
- **B4** — `Document.subscribeSlice(slice, cb)`; `src/ui/hooks/`: `DocumentContext` (provider + `useDocument`), `useDocSlice` (useSyncExternalStore against slice versions, doc override for tests). happy-dom + @testing-library/react wired (`// @vitest-environment happy-dom` per file); test proves a scene bump re-renders only scene-subscribed panels.

## Decisions made (and why)

- Selection is not undoable (C4D/Blender convention); it lives outside History entirely.
- `SessionRunner.start` cancels an existing active session instead of throwing — a stray pointerdown mid-drag must never wedge the editor.
- Deps added: dockview 7.0.2, three-mesh-bvh 0.9.10, earcut 3.2.3, happy-dom, @testing-library/react.

## Test status

- `vp check`: pass (2 warn-level react/only-export-components in DocumentContext.tsx — acceptable)
- `vp test`: 34 passed / 0 failed (8 files)

## Next steps

1. D1 HEMesh kernel (`src/geometry/kernel/`), then D2 render sync, D3 primitives.
2. Then A2–A4 shell, C1–C4 viewport/gizmo, M0 gate.
