# PLAN_PROGRESS_9 — M0X round 2: lights, viewport menu, targets, copy-drag

**Date:** 2026-07-09
**Chunks worked:** M0X round 2 (F4-lights pulled forward from M3, C1/C3 display, A4 menu infra)
**Milestone context:** M0X continues; PLAN.md updated — lights officially moved M3 → M0X.

## Completed

- **Menu infrastructure** — `MenuEntry` tree for context menus (16px leading icons, hover-flyout submenus, separators, radio-active rows, registry-resolved `commandId` entries); megamenu gained submenu flyouts + icons (`AppCommand.icon`/`submenu`).
- **Viewport background context menu** (right-click empty space; right-click an object opens the object menu) —
  **Camera**: Active Camera (only when the scene has one), Perspective, Orthogonal (45° parallel), Top, Bottom, Left, Right, Front, Rear, ─, Reset Camera PSR (rebuilds the pane's rigs). New builtin cameras added to `CameraRig`/pane selects.
  **Display** (per-pane): Shading (PBR/Flat/Wireframe radio), Shadows (PBR-only), Backfaces, SSOA (PBR-only; state plumbed — AO pass renders with C6 post-FX), Grid — all toggles use `toggle-on`/`toggle-off` icons @16px. Per-pane `PaneDisplay` atoms applied per render pass (shadowMap enable, material override via `sync.applyShading`, grid visibility, material side).
- **Lights (moved from M3)** — Create → **Lights** submenu with hugeicons (Spotlight/bulb/sunset/sun-cloud-02/layer-mask-01/layer-send-backward): Spotlight, Point, Infinite, Ambient, Hemisphere, Area. `types/core/light.ts` (payloads/defaults/labels/shadow-capability), SceneSynchronizer builders + in-place updates (type change rebuilds preserving children). Shadow-capable lights **cast shadows by default** (1024 maps), toggleable in Attributes. Meshes already default PBR + cast/receive shadows.
- **Targets** — any node can aim at any other object (`data.target`): Attributes Target selector for lights/cameras (self excluded); render-side constraint each frame (`applyTargets`: three-native `light.target` for spot/directional, `lookAt` otherwise; camera-node panes honor targets too). **Infinite lights auto-create a "Directional Light Target" null** in the same undo step.
- **Unique sibling names** — `uniqueSiblingName` (core): "Cube" → "Cube.1"… scoped to siblings only; applied to all creates, groups, and copies.
- **Object-manager copy DnD** — drag shows **alias** cursor; Option shows **copy** cursor (hover + drag); Option-release **copies** via new `DuplicateSubtreeCommand` (id remap, kernel meshes CLONED via `HEMesh.fromSnapshot`, in-subtree targets remapped, unique root name, real memoryCost, single undo step, copies selected).
- **Attributes** — Light section (color, intensity, shadows toggle, angle/penumbra/width/height/ground color by type) + Target section.
- **500-line rule enforcement** — ViewportSystem (597) split: input handling → `render/viewport/ViewportInput.ts` (413 + 219).

## Verified in-browser (WebGPU)

- Cube/Cube.1/Cube.2 naming; Lights submenu with 6 labeled+iconed entries; Infinite creates + targets "Directional Light Target", castShadow=true.
- Background right-click: full Camera list + Reset PSR, Display tree; Wireframe click → pane 0 renders wireframe; toggles show toggle-on/off icons.
- Option-drag Cube.1 onto Cube: copy cursor shown, deep copy landed as child (unique name), original untouched, undo label "Copy Cube.1".
- Post-split sanity: click-select + alt-orbit still work. Gates: tsc clean, 75/75 tests, vp lint 0.

## Fixed along the way

- `setRegistry` during Shell render → React update-during-render violation; moved to an effect.
- MenuBar submenu grouping needed a discriminated union (AppCommand itself has `submenu`).

## Known issues

- SSOA toggle stores state only — AO pass lands with the post-FX chunk (C6).
- Light/camera viewport gizmos (cones, frustum helpers) still M3/F4 scope.
- `App.tsx` still installs the doc during render (harmless first-mount; HMR warning only).

## Post-round fix: per-pane Perspective PSR memory

- **Bug (user-reported):** looking through a scene camera and switching back to "Perspective" showed the scene camera's last PSR. Cause: `rigFor` mapped scene-camera bindings onto the pane's `persp` rig (shared key), and `syncSceneCamera` overwrote that rig's transform every frame. Fix: rigs are keyed by the full binding (`pane:cameraId`), so scene-camera panes get their own rig and each pane's Perspective rig keeps its own PSR memory. Verified live: orbit → look through camera → back to Perspective restores position/rotation exactly.

## Post-round: Active Camera nav writeback + Display > Lines toggle

- **Active Camera nav (user-reported):** navigating (orbit/pan/dolly-drag/wheel) in a pane bound to a scene camera did nothing useful — `syncSceneCamera()` re-pulled the rig's transform from the camera node every frame, stomping any nav change made to the rig. Fix: nav on such a pane now writes back into the actual camera node's transform. Drags (`orbit`/`pan`/`dolly`) use the same preview→commit `TransformDragSession` the gizmo uses (`ViewportSystem.beginCameraNav/updateCameraNav/commitCameraNav`, wired from `ViewportInput`'s existing nav pointerdown/move/up) — one undo step per drag. Wheel ticks push a `SetTransformCommand` per tick (`applyCameraNavTick`), coalesced into one undo step by `History`'s tryMerge window. `syncSceneCamera` still pulls node→rig every frame, but it's now idempotent since nav keeps the node in sync. Verified live: created a camera node, bound pane 0 to it, pan/orbit/wheel-dolly all persisted into the node's transform (rig position matched exactly, no snap-back on subsequent frames), single "Transform" undo step per drag restored exactly.
- **Display > Lines toggle:** wireframe overlay on top of PBR/Flat shading, off by default (`PaneDisplay.lines`). Implemented as a permanent-but-hidden `LINES_MAT` (polygon-offset wireframe, semi-transparent) child mesh per mesh object in `SceneSynchronizer` (`linesOverlays` map, mirrors the existing per-node outline-mesh pattern), geometry kept in sync on rebuild, visibility toggled per-pane in `applyShading(mode, backfaces, lines)`. Disabled (no effect) in Wireframe mode since it's already all lines — verified the menu item shows `menu-disabled` when `shading === "wireframe"`. Verified live: toggling Lines on a PBR cube shows the triangulation wireframe overlaid on the shaded surface.

## Next steps

1. More M0X items from user, then M1 D4.
