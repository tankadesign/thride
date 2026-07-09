# PLAN_PROGRESS_8 — Bug round: render watchdog + local/world gizmo

**Date:** 2026-07-09
**Chunks worked:** C1/C4 fixes (user bug reports)
**Milestone context:** M0X polish continues; M1 not started.

## Completed

- **Stale primitive handles after undo — root cause was the render loop, not the handles.** Handle positions are recomputed every rendered frame; the bug was that no frame ran: the on-demand render loop was purely rAF-driven, and Chrome throttles rAF to ~1Hz (or pauses it) in occluded/unfocused windows — so the frame that would reposition handles after an undo could arrive seconds late or effectively never ("refresh needed"). Fix: `invalidate()` now arms a **50ms setTimeout watchdog** that renders if rAF hasn't serviced the request (`renderIfNeeded()` shared by both paths, cleared on dispose). Verified in a 1Hz-throttled tab: handle snaps back within 250ms of ⌘Z.
- **Local/world gizmo (W)** — gizmo axes now follow the active object's world orientation by default ("local"); `W` (or View → World / Local Gizmo) toggles world-aligned axes. World mode defaults OFF per request. Implementation: `gizmoSpaceAtom` (+ `EditorViewportState.gizmoSpace`/`toggleGizmoSpace`), gizmo group takes the object's world quaternion in local mode, and all drag math (translate axis, rotate plane basis, scale axis) runs through the drag-start basis quaternion — so local-mode rotation is a true local-axis rotation. Atom added to the editor-state subscription list so toggling re-renders.

## Gotchas

- Editor-state atoms consumed by the render layer MUST be in `EditorStateStore.subscribe` or changes won't trigger a viewport re-render (bit me with `gizmoSpaceAtom`).
- HMR keeps Shell's memoized CommandRegistry — new commands need a full reload to appear (test-env artifact only).
- Known limit (pre-existing): gizmo transforms write LOCAL node transforms assuming an unrotated/unscaled parent; correct nested-parent math lands with M1 component/transform work.

## Test status

- tsc clean; 73/73 tests; verified live (throttled-tab undo refresh, W toggle quaternions exact).

## Next steps

1. More M0X items from user, then M1 D4.
