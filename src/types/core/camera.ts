/**
 * Camera node payload, stored at node.data.camera.
 *
 * A camera node is a transform + lens carrier, not a live THREE.Camera: a pane
 * "looks through" it by copying its transform onto that pane's CameraRig and
 * applying this lens (see ViewportSystem.syncSceneCamera). Perspective only for
 * now — a free-oriented orthographic scene camera needs a distinct rig mode the
 * axis-aligned ortho builtins can't provide (deferred).
 */
export interface CameraDataDTO {
  /** Vertical field of view, in degrees (three's PerspectiveCamera convention). */
  fov: number;
  /** Near clip plane, world units. */
  near: number;
  /** Far clip plane, world units. */
  far: number;
  /** Film (sensor) width in mm — three's `filmGauge`. Skews the frustum only
   *  together with a non-zero filmOffset; default 35mm (full-frame). */
  filmGauge: number;
  /** Lateral lens shift in mm — three's `filmOffset` (tilt-shift / off-axis). */
  filmOffset: number;
  /** Post-projection zoom multiplier — three's `camera.zoom`; 1 = none. */
  zoom: number;
  /** Focus distance (world units) for depth of field. Overridden by focusTarget
   *  when set — the distance from the camera to that object is used instead. */
  focus: number;
  /** Optional object the camera focuses on: its distance drives DOF focus,
   *  superseding the manual `focus` number. Aim (`data.target`) is separate. */
  focusTarget?: string;
}

export function defaultCameraData(): CameraDataDTO {
  // fov 50 matches the editor's default perspective rig, so looking through a
  // fresh camera doesn't jar; Blender-style 0.1–1000 clip range. filmGauge 35mm
  // full-frame; zoom 1; focus 10 (a sane default DOF plane).
  return { fov: 50, near: 0.1, far: 1000, filmGauge: 35, filmOffset: 0, zoom: 1, focus: 10 };
}
