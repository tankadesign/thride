import { Box3, type Object3D, Vector3 } from "three";
import type { CameraRig } from "@/render/nav/CameraRig";
import type { AxisProjection, PaneAxes, ViewportSystem } from "./ViewportSystem";

/** Framing + axis-indicator math, split from ViewportSystem (500-line rule). */

export function selectionBox(vs: ViewportSystem): Box3 | null {
  const ids = vs.doc.selection.objectIds;
  if (ids.length === 0) return null;
  const box = new Box3();
  let any = false;
  for (const id of ids) {
    const obj = vs.sync.object(id);
    if (obj) {
      box.expandByObject(obj as Object3D);
      any = true;
    }
  }
  return any ? box : null;
}

export function sceneBox(vs: ViewportSystem): Box3 {
  const box = new Box3();
  if (vs.doc.scene.size > 0) box.expandByObject(vs.sync.root);
  return box;
}

/** World X/Y/Z in this pane's view space (for the corner axis indicator). */
export function projectAxes(rig: CameraRig): PaneAxes {
  const invQuat = rig.camera.quaternion.clone().invert();
  const project = (x: number, y: number, z: number): AxisProjection => {
    const v = new Vector3(x, y, z).applyQuaternion(invQuat);
    return { dx: v.x, dy: -v.y, front: v.z >= 0 };
  };
  return [project(1, 0, 0), project(0, 1, 0), project(0, 0, 1)];
}
