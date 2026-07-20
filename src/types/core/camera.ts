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
}

export function defaultCameraData(): CameraDataDTO {
  // fov 50 matches the editor's default perspective rig, so looking through a
  // fresh camera doesn't jar; Blender-style 0.1–1000 clip range.
  return { fov: 50, near: 0.1, far: 1000 };
}
