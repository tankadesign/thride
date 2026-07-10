# PLAN_PROGRESS_14 — centralized Three.js viewport color theme

**Date:** 2026-07-10
**Chunks worked:** C5 (display / color management) — groundwork: pulled every hard-coded viewport
color into one theme module. Also finished the D5 follow-on "Hidden Lines" display toggle from the
prior turn.
**Milestone context:** M1 in progress. This starts C5. Remaining M1: D6 snapping, D7 boolean
worker, D8 splines + pen tool, D9 spline extrude, F1 generator graph, F3 boolean object, rest of C5.

## Completed

- **`src/render/theme/viewportTheme.ts`** — single source of truth for every viewport color.
  - `SEMANTIC_SPECS` — colors that resolve **live** from daisyUI CSS variables (via the existing
    `themeColor` rasterizer): `primary secondary accent success warning info error baseContent`.
    Fallbacks are the real resolved `sunset` values (pulled from the running app), not the stale
    guesses the scattered call sites had (`--color-success` was `#00b16a`, actually `#addfad`;
    info `#38bdf8` → `#89e0eb`; warning `#ffbf00` → `#f1c892`).
  - `CUSTOM_SPECS` — fixed viewport chrome with no daisyUI equivalent, still centralized +
    adjustable: `backgroundColor activeBackgroundColor gridLineColor gridCellColor polygonColor
lineColor wireframeColor pointColor gizmoCenterColor handleColor handleHoverColor
lightKeyColor lightAmbientColor lightFillColor`.
  - `viewportTheme.gizmo = { x: error, y: success, z: info, center: gizmoCenterColor }` — the axis
    grouping the user asked for, defined **once** and consumed by both the 3D gizmo and the 2D axis
    indicator (kills the duplicated `AXIS_COLORS` that used to live in two files).
  - Colors are mutable `Color` instances; `refreshViewportTheme()` re-resolves semantic colors
    **in place** (`.copy()`) so references held by materials stay valid across a theme change.
  - `themeStyle(color)` → `rgb(...)` for 2D DOM/SVG chrome.
- **Live apply path** — `ViewportSystem.applyTheme()` re-resolves + pushes colors into ALL live
  viewport chrome, then invalidates: background (read per-frame from the theme), grid (rebuilt),
  default lights, shared mesh materials (`applyMeshMaterialsTheme()`), the light/camera-helper
  materials (`applyLightHelperTheme()` / `applyCameraHelperTheme()`), and the per-instance overlays
  via new hooks — `TransformGizmo.applyTheme()` (traverses handle meshes, re-colors `baseColor` +
  material by axis, special-casing the view-plane center; skips pickers and the hovered handle),
  `PrimitiveHandles.applyTheme()` (shared handle mats), and `ComponentOverlays.applyTheme()` (face +
  point mats copied; wire vertex-colors rebuilt by invalidating the build guard). This makes it a
  real system a settings panel can drive live with no reload — verified end-to-end (see Verified).
- **Migrated every `0x…` literal and every scattered `themeColor(...)` call** onto the theme
  (see file list). `themeColor` is now an internal helper used only by `viewportTheme.ts`.
- **Hidden Lines toggle** (prior turn, same session): `PaneDisplay.hiddenLines`; the Lines-overlay
  material's `depthTest` is now `!hiddenLines`, so edges behind polygons are occluded by default
  and shown only when enabled. Menu entry sits below Lines, disabled unless Lines is on.
- **Zoom-pivot bug fix** — Alt+RMB dolly now homes in on the crosshair point under the cursor, the
  same pivot orbit (Alt+LMB) uses, instead of always dollying toward the viewport center. New
  `CameraRig.dollyToward(point, delta)`: perspective slides the camera along the camera→point ray
  (projection is scale-invariant along a view ray, so the point stays glued to its screen pixel);
  ortho scales zoom and shifts the view center by `center' = point + (center - point)*k` so the
  point holds still. `ViewportInput` now resolves the pivot for `dolly` exactly like `orbit`
  (raycast hit → picked point; empty perspective click → viewport center; ortho empty click → old
  center zoom, unchanged) and routes to `dollyToward`. Wheel zoom is intentionally left on the old
  center dolly (the report was specifically about the option-right-click drag).

## Decisions made (and why)

- **Axis X/Y/Z → error/success/info** exactly as instructed. Note: sunset's error/success/info are
  **pastel** (`#febbbd / #addfad / #89e0eb`), so the gizmo + axis indicator are now noticeably
  softer than the old saturated R/G/B. This is the requested semantic mapping and is now a
  one-line override in `CUSTOM_SPECS`/`SEMANTIC_SPECS` if the pastels aren't wanted.
- **Semantic mapping only for identity/decoration** colors (axes, selection=primary,
  helpers=secondary, weld=success/base-content). **Functional** colors stay custom-named
  (surface albedo, grid, backgrounds, the studio light rig) — mapping a key light onto "primary"
  would tint the whole render.
- **Left `LightSync` alone** — `new Color(data.color)` and the `#443c30` hemisphere-ground
  fallback are document/user light data, not viewport chrome.
- Theme module lives in `src/render/theme/` (render owns viewport colors). `ui/ViewportPanel`
  importing it is fine — ui→render already exists; only render→ui is forbidden.

## Verified

- **Theme migration** — app loads clean on WebGPU; cube (polygonColor), grid, backgrounds render
  from the theme; the axis indicator shows the themed pastels.
- **applyTheme hooks (end-to-end, live)** — via the `window.__viewport` dev hook: set
  `--color-error` to magenta and called `__viewport.applyTheme()`; the gizmo X-axis handle's
  `baseColor` went `ffdedf` → `ff00ff` and reverted cleanly on removing the override. This exercises
  `refreshViewportTheme()` re-reading the CSS var AND the per-instance `TransformGizmo.applyTheme()`
  traverse (the trickiest hook). (Note: a separate `import()` of the theme module from the console
  gets a DIFFERENT instance than the app under HMR `?t=` versioning — drive the app's own module via
  `__viewport`, don't import it standalone, or the mutation lands on a dead copy.)
- **Zoom fix** — 3 new `CameraRig.test.ts` cases assert the crosshair invariant directly: after
  many `dollyToward(pivot, ±delta)` the pivot's projected NDC is unchanged (<1e-4) for both
  perspective and ortho, and the near-plane clamp keeps the camera ≥0.05 off the pivot. Also drove
  synthetic Alt+RMB pointer events on the live cube: camera distance 10.0 → 7.76 (zoomed in) and the
  picked cube point re-projected to within 0.25px / 0.5px of the cursor (was drifting to center).

## Files added / changed

- Added: `src/render/theme/viewportTheme.ts`
- Render: `scene-sync/SceneSynchronizer.ts` (surface/line/wire mats + `applyMeshMaterialsTheme`),
  `scene-sync/SelectionOutline.ts` (primary), `viewport/ViewportSystem.ts` (bg/grid/lights +
  `buildGrid`/`applyTheme` wiring all hooks), `gizmo/TransformGizmo.ts` (axis + center + hover;
  `baseColor` now a `Color`; `applyTheme` traverse), `handles/PrimitiveHandles.ts` (handle + hover +
  `applyTheme`), `overlays/ComponentOverlays.ts` (wire/point/selected/warning/info + `applyTheme`),
  `helpers/LightHelpers.ts` + `helpers/CameraHelper.ts` (secondary + `applyXTheme`), `tools/WeldTool.ts`
  (success + base-content).
- Zoom fix: `nav/CameraRig.ts` (`dollyToward`), `viewport/ViewportInput.ts` (dolly pivot + routing),
  `nav/CameraRig.test.ts` (3 new cases).
- UI: `ui/panels/ViewportPanel.tsx` (axis indicator + label fill from theme).
- Prior turn: `types/editor.ts` (`hiddenLines`), `ui/panels/viewportMenu.tsx` (toggle).

## Test status

- `vp check`: pass (format + oxlint + tsc all green).
- `vp test`: 124 passed / 124 (20 files) — +3 `dollyToward` cases over the prior 121.

## Known issues / follow-ups

- **`SelectionOutline` is not re-themed live.** Its outline color (`viewportTheme.primary`) is
  captured per-build and the outline already rebuilds on selection change, so it picks up theme
  edits on the next reselection, not on an in-place `applyTheme()`. Low priority (a color tweak just
  needs a reselect); add a hook if the settings panel wants instant selection-color feedback.
- No settings UI yet (the user framed this as "in the end") — the foundation is complete: a panel
  edits `viewportTheme` custom colors (or CSS vars for semantic ones) and calls
  `ViewportSystem.applyTheme()`.

## Next steps (exact, resumable cold)

1. Build a viewport-color settings panel (jotai) that edits `viewportTheme` custom colors and calls
   `applyTheme()`; persist overrides. (Optionally add a `SelectionOutline.applyTheme()` hook.)
2. Then resume the other open M1 chunks (D6 snapping next).
