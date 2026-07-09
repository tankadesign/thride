# PLAN_PROGRESS_7 — M0X: expanded foundation round 1 (11 user items)

**Date:** 2026-07-09
**Chunks worked:** M0X (user-directed M0 expansion; touches A2/A5/C1–C4/D3 areas)
**Milestone context:** M0 expanded before M1 per user review. More M0X items expected.

## Completed (all 11 requested items)

1. **hugeicons @ 20px global** — `src/icons/index.tsx` rebuilt on `@hugeicons/react` + core-free-icons behind `makeIcon` wrappers; global size from `iconSizeAtom` (persisted via `atomWithStorage`, future Settings page). New `ui/hooks/editor/settings.ts`. Sphere/Cube/Torus/Cylinder01/Video02(camera)/Diamond(plane) per request; tool rail widened.
2. **Per-viewport axis indicator** — C4D-style top-right corner widget per pane: world X/Y/Z projected through the pane camera (`ViewportSystem.projectAxes` → `onAxes` callback → SVG overlay), gizmo-matched colors, back-facing axes dimmed/undecorated.
3. **Gizmo 50% + primary hover** — scale factors halved (0.07/0.08); hover now recolors the handle to daisyUI `--color-primary` (restores base color on out).
4. **Shift-snap on gizmo** — `GizmoModifiers {snap, snapSize, uniformScale}`: translate snaps the drag **delta** (local/relative, not world) to `gridSnapSizeAtom` (default 0.1 = 10cm, persisted setting, exposed to render via `EditorViewportState.gridSnapSize`); rotate snaps 5°; scale snaps ratio to 0.1 (shift still = uniform scale too).
5. **Object nesting + DnD** — any node can parent any node. Pointer-based drag in the object manager: top/bottom 25% of a row = insert before/after (dashed primary **drop-indicator line**, depth-indented), middle 50% = drop inside (dashed row outline, auto-expands target); multi-drag uses topmost selected; cycle-guarded; one undo step.
6. **Convert to Mesh** — `geometry/store/meshRegistry.ts` (kernel meshes keyed by id; core can't import geometry, so the registry lives in geometry) + `geometry/commands/convert.ts` (`ConvertToMeshCommand`, real `memoryCost`, undo restores primitive). Edit menu + `C` shortcut + context menu; multi-select converts eligible, skips converted. SceneSynchronizer resolves `data.mesh` via registry (`mesh:<id>:<topologyVersion>` cache key); Attributes shows pts/edges/polys badges.
7. **Primitive adjustment handles** — `render/handles/` (defs + PrimitiveHandles): C4D yellow billboarded squares per float param (cube w/h/d, cylinder rTop/rBottom/h, sphere r, torus R/r, cone, capsule, plane, pyramid, disc, icosphere); drag along local axes with world-scale compensation; previews via `setNodeData`, commits one `SetNodeDataCommand`; hover whitens; **hit-tested before the gizmo and rendered above it** (renderOrder 1500).
8. **Int-stepped params** — `primitiveParamMeta` in types (segments-family int min 3 max 1000, segmentsX/Z min 1, subdivisions 0–5, capRings 2–128); `NumberDrag integer` prop (rounds, precision 0). Handles skip int params.
9. **Double-sided default** — BASE_MAT `side: DoubleSide`.
10. **Context menu + Group** — `ContextMenu` (command-id driven, daisy menu, Esc/click-away, on-screen clamping) + `contextMenuAtom`/`registryAtom` in `ui/hooks/editor/shell.ts`. Object-manager right-click: Group (**⌘G**), Convert to Mesh, Delete, Deselect. `edit.group`: creates a Null at root and reparents topmost selected under it (one transact), selects the group.
11. **Collapse/expand** — hugeicons `MinusSignSquare`/`PlusSignSquare` toggles; **⌘-click = deep** expand/collapse of the whole subtree.

## Verified in-browser (preview :5175, WebGPU)

- Axis indicator renders color-coded per pane; gizmo half-size; yellow handles visible over gizmo.
- Height handle drag: 2 → 3.272 live, **one** ⌘Z restores 2.
- `C` converts multi-selection (sphere badges: 482 pts / 992 edges / 512 polys); ⌘G groups both under "Group"; collapse 3→1 rows, expand back; context menu lists the 4 commands with kbd hints.
- DnD: dragged Sphere out of Group to root (indicator line shown), then into Cube as child — tree verified via document introspection.
- Gates: tsc clean, 70/70 tests (new ConvertToMesh suite), vp lint 0, prod build OK.

## Bugs found & fixed during verification

- **DnD drop no-op**: `onPointerUp` nulled `dragRef` _before_ computing dragged ids from it → always empty. Ids now derived from the captured drag state (`draggedIdsFor(d.id)`).
- Test threshold: cube kernel is ~728 B (assertion said >1000).

## Decisions / notes

- `window.__viewport` + `window.__dockview` DEV-only escape hatches (e2e/debug tooling).
- `vp check`'s lint stage intermittently no-ops/hangs (tsgolint daemons) — gates run as tsc + vp lint + vp test until Vite+ fix; `pkill -f tsgolint` clears wedges.
- Preview harness window randomly collapses to ~200px; functional evals are the source of truth.

## Next steps

1. Await further M0X items from user review ("I'll think of more things").
2. Then M1 D4 (component modes) — Convert to Mesh already produces registry-backed kernel meshes for it.
