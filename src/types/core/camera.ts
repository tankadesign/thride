/**
 * Camera node payload, stored at node.data.camera.
 *
 * A camera node is a transform + lens carrier, not a live THREE.Camera: a pane
 * "looks through" it by copying its transform onto that pane's CameraRig and
 * applying this lens (see ViewportSystem.syncSceneCamera). Perspective only for
 * now — a free-oriented orthographic scene camera needs a distinct rig mode the
 * axis-aligned ortho builtins can't provide (deferred).
 *
 * The artist model is Cinema4D/Blender-style: a **focal length** (mm) against a
 * fixed full-frame sensor. three's PerspectiveCamera does the focal-length↔fov
 * math natively (`setFocalLength` + `filmGauge`) and `setViewOffset` gives the
 * X/Y lens shift, so we keep the stock camera (DOF works unchanged).
 */

/** Sensor width in mm — fixed full-frame. The height derives from the viewport
 *  aspect, so this single dimension is all a responsive app needs. */
export const SENSOR_WIDTH = 36;

export interface CameraDataDTO {
  /** Lens focal length in mm — the primary control. Higher = more telephoto
   *  (narrower view); the opposite sense to FOV. */
  focalLength: number;
  /** Horizontal lens shift as a % of the frame (0 = centred). 100% shifts the
   *  frame by half its width — the vanishing point reaches the edge (C4D). */
  filmOffsetX: number;
  /** Vertical lens shift, % of the frame. */
  filmOffsetY: number;
  /** Post-projection zoom multiplier — three's `camera.zoom`; 1 = none. */
  zoom: number;
  /** Near clip plane, world units. */
  near: number;
  /** Far clip plane, world units. */
  far: number;
  /** Focus distance (world units) for depth of field. Overridden by focusTarget
   *  when set — the distance from the camera to that object is used instead. */
  focus: number;
  /** Optional object the camera focuses on: its distance drives DOF focus,
   *  superseding the manual `focus` number. Aim (`data.target`) is separate. */
  focusTarget?: string;
}

export function defaultCameraData(): CameraDataDTO {
  // 50mm is the classic "normal" lens; centred; Blender-style 0.1–1000 clip
  // range; zoom 1; focus 10 (a sane default DOF plane).
  return {
    focalLength: 50,
    filmOffsetX: 0,
    filmOffsetY: 0,
    zoom: 1,
    near: 0.1,
    far: 1000,
    focus: 10,
  };
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/**
 * Horizontal field of view (degrees) for a focal length against the fixed
 * sensor width. HORIZONTAL fov is aspect-independent (the sensor width is the
 * frame's wider dimension in landscape), so the inspector's focal-length↔fov
 * toggle needs no viewport aspect. `hfov = 2·atan((sensorW/2) / focalLength)`.
 */
export function hFovFromFocalLength(focalLength: number): number {
  return 2 * Math.atan(SENSOR_WIDTH / 2 / focalLength) * RAD2DEG;
}

/** Inverse of {@link hFovFromFocalLength}: focal length (mm) for a horizontal fov. */
export function focalLengthFromHFov(hfov: number): number {
  return SENSOR_WIDTH / 2 / Math.tan((hfov * DEG2RAD) / 2);
}

/**
 * VERTICAL fov (degrees) for a focal length at a given aspect — three's own
 * projection convention (`filmHeight = sensorW / max(aspect, 1)`,
 * `vfov = 2·atan(0.5·filmHeight / focalLength)`). Used to shape the frustum
 * helper at a representative aspect (the render rig derives its own vfov per
 * pane via `PerspectiveCamera.setFocalLength`).
 */
export function fovFromFocalLength(focalLength: number, aspect: number): number {
  const filmHeight = SENSOR_WIDTH / Math.max(aspect, 1);
  return 2 * Math.atan((0.5 * filmHeight) / focalLength) * RAD2DEG;
}
