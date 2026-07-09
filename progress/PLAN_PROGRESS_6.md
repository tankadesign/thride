# PLAN_PROGRESS_6 — Nav feel fixes: free-camera orbit, pivot marker, uniform scale, selection outline

**Date:** 2026-07-09
**Chunks worked:** C2/C4 rework (user feedback round 2)
**Milestone context:** Post-M0 polish; M1 not started.

## Completed

- **Orbit jump fixed** — root cause: the old rig always `lookAt(pivot)`, so option-clicking an object re-aimed the camera at the clicked point (instant view jump). `CameraRig` (persp) rewritten as a **free camera**: orbit is a rigid rotation of position+orientation around a per-drag pivot (world-Y yaw + camera-right pitch, pole-clamped); the clicked point stays put on screen. Pan/dolly/frame reworked on a `focusDistance` model (frame still recenters intentionally). Ortho rigs keep the center+zoom model.
- **Orbit pivot rules** — option-click on an object: pivot = picked point (also refocuses `focusDistance`); option-click on empty space: pivot = viewport-center point at the current focus distance (no finicky far-plane pivots).
- **Pivot marker** — any option+mouse-button press shows a 14px SVG plus (2px strokes, drop-shadowed, `text-base-content`) at the pivot's 2D location: the click point when an object was hit, the pane center on empty orbits, the click point for pan/dolly. Cleared on release. Plumbed via `ViewportSystem.onNavMarker` → React overlay in ViewportPanel.
- **Shift = uniform scale** — gizmo scale-cube drags with Shift held apply the axis ratio to all three axes (`TransformGizmo.pointerMove(raycaster, uniformScale)`).
- **Selection outline** — emissive tint replaced with a **2px primary-color silhouette**: per selected mesh, a BackSide hull mesh expanded along normals via TSL `positionNode = positionLocal + normalLocal * uniform`. The uniform is set per pane per frame from camera distance/frustum so the outline is a true 2 screen px in persp and ortho (object world-scale compensated). Primary color resolved from the daisyUI `--color-primary` oklch var via canvas rasterization (`themeColor.ts`). First TSL use → created **`src/materials/tsl.ts`**, the mandatory TSL barrel.

## Verified in-browser (5656, WebGPU)

- Alt+click on object: camera does not move at click (before/after screenshots identical); orbit is smooth around the clicked point; marker at click point.
- Alt+click on empty space: marker at exact pane center (533.5, 418 == center); marker removed on pointerup.
- Selected cube shows thin orange silhouette; no tint; outline follows primitive param edits (geometry swap keeps outline in sync).

## Known issues

- Cube shading looks "rounded" at some angles — pre-existing: kernel vertex normals are smooth-averaged with no hard-edge splitting; crease-angle normal splitting lands with D2/D4 in M1.
- `vp check` got stuck once mid-session (killed + re-run clean); watch for recurrence.

## Next steps

1. M1 session 1: D4 component mode tools (see PLAN_PROGRESS_4/5 next-steps).
