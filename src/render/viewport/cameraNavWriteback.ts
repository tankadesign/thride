import { SetTransformCommand } from "@/core";
import { TransformDragSession } from "@/core/session/TransformDragSession";
import type { TransformDTO, Uuid } from "@/types/core";
import type { CameraRig } from "@/render/nav/CameraRig";
import type { ViewportSystem } from "./ViewportSystem";

/**
 * Active-camera nav writeback (split from ViewportSystem for the 500-line
 * rule). When a pane looks through a scene camera node, nav (orbit / pan /
 * dolly / wheel) must move that actual camera object, not just the pane's
 * local rig — otherwise syncSceneCamera() stomps the rig back to the node's
 * stale transform on the very next frame. Drags use the same preview→commit
 * session the gizmo uses (one undo step per drag); wheel ticks push a
 * SetTransformCommand per tick, coalesced by History's tryMerge window.
 */

function cameraTransform(vs: ViewportSystem, id: Uuid, rig: CameraRig): TransformDTO {
  const scale = vs.doc.scene.mustGet(id).transform.scale;
  return {
    position: [rig.camera.position.x, rig.camera.position.y, rig.camera.position.z],
    rotation: [rig.camera.rotation.x, rig.camera.rotation.y, rig.camera.rotation.z],
    scale: [...scale],
  };
}

export function beginCameraNav(vs: ViewportSystem, pane: number): void {
  const id = vs.sceneCameraNode(pane);
  if (id) vs.doc.sessions.start(new TransformDragSession([id], "Move Camera"));
}

export function updateCameraNav(vs: ViewportSystem, pane: number, rig: CameraRig): void {
  const id = vs.sceneCameraNode(pane);
  if (id && vs.doc.sessions.isActive) {
    vs.doc.sessions.update(new Map([[id, cameraTransform(vs, id, rig)]]));
  }
}

export function commitCameraNav(vs: ViewportSystem): void {
  if (vs.doc.sessions.isActive) vs.doc.sessions.commit();
}

/** One-shot nudge (wheel dolly) — merges into the active undo step via tryMerge. */
export function applyCameraNavTick(vs: ViewportSystem, pane: number, rig: CameraRig): void {
  const id = vs.sceneCameraNode(pane);
  if (!id) return;
  const before = vs.doc.scene.mustGet(id).transform;
  const after = cameraTransform(vs, id, rig);
  vs.doc.history.run(new SetTransformCommand(id, after, before));
}
