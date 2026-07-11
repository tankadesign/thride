import {
  MathUtils,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import { BufferAttribute, BufferGeometry, type Line } from "three";
import type { SplineData } from "@/types/geometry/spline";
import { sampleSpline } from "@/geometry/splines/eval";
import type { ViewportSystem } from "@/render/viewport/ViewportSystem";

/** Clicking this close (px) to the first anchor closes the spline. */
export const CLOSE_RADIUS_PX = 12;

/**
 * Close-the-spline affordance helpers for the pen tool (split for the
 * 500-line rule): first-anchor screen proximity + the green marker billboard.
 */

export function nearFirstAnchor(
  vs: ViewportSystem,
  obj: Object3D,
  data: SplineData,
  e: PointerEvent,
): boolean {
  if (data.points.length === 0) return false;
  const rect = vs.canvas.getBoundingClientRect();
  const pane = vs.paneRect(vs.editor.activePane);
  const cam = vs.rigFor(vs.editor.activePane).camera;
  cam.updateMatrixWorld();
  obj.updateMatrixWorld();
  const w = new Vector3(...data.points[0]!.position).applyMatrix4(obj.matrixWorld);
  const v = w.clone().applyMatrix4(cam.matrixWorldInverse);
  if ((cam as PerspectiveCamera).isPerspectiveCamera && v.z >= -1e-6) return false;
  v.applyMatrix4(cam.projectionMatrix);
  const sx = pane.x + ((v.x + 1) / 2) * pane.w;
  const sy = pane.y + ((1 - v.y) / 2) * pane.h;
  return Math.hypot(sx - (e.clientX - rect.left), sy - (e.clientY - rect.top)) <= CLOSE_RADIUS_PX;
}

/** Billboard the green "click to close" marker over the first anchor. */
export function placeCloseMarker(
  vs: ViewportSystem,
  marker: Mesh,
  obj: Object3D,
  data: SplineData,
): void {
  obj.updateMatrixWorld();
  const w = new Vector3(...data.points[0]!.position).applyMatrix4(obj.matrixWorld);
  const cam = vs.rigFor(vs.editor.activePane).camera;
  const paneH = Math.max(1, vs.paneRect(vs.editor.activePane).h);
  const ortho = cam as OrthographicCamera;
  const persp = cam as PerspectiveCamera;
  const perPixel = ortho.isOrthographicCamera
    ? (ortho.top - ortho.bottom) / paneH
    : (2 * cam.position.distanceTo(w) * Math.tan(MathUtils.degToRad(persp.fov / 2))) / paneH;
  const q = new Quaternion();
  cam.getWorldQuaternion(q);
  marker.matrixAutoUpdate = false;
  marker.matrix.compose(w, q, new Vector3().setScalar(Math.max(1e-6, 12 * perPixel)));
}

/**
 * The world plane most facing the camera (auto axis), or the forced axis.
 * Returns the unit normal + which axis was resolved.
 */
export function resolvePlaneNormal(
  vs: ViewportSystem,
  axis: 0 | 1 | 2 | "auto",
): { normal: Vector3; resolvedAxis: 0 | 1 | 2 } {
  let resolvedAxis: 0 | 1 | 2;
  if (axis !== "auto") {
    resolvedAxis = axis;
  } else {
    const camDir = new Vector3();
    vs.rigFor(vs.editor.activePane).camera.getWorldDirection(camDir);
    const ax = Math.abs(camDir.x);
    const ay = Math.abs(camDir.y);
    const az = Math.abs(camDir.z);
    resolvedAxis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
  }
  const normal = new Vector3(
    resolvedAxis === 0 ? 1 : 0,
    resolvedAxis === 1 ? 1 : 0,
    resolvedAxis === 2 ? 1 : 0,
  );
  return { normal, resolvedAxis };
}

/** Rebuild the pen's rubber-band Line: last anchor → hover position. */
export function updateRubberBand(
  rubber: Line,
  obj: Object3D,
  data: SplineData,
  hoverLocal: Vector3,
): void {
  const last = data.points[data.points.length - 1]!;
  const ghost: SplineData = {
    closed: false,
    points: [
      last,
      {
        position: [hoverLocal.x, hoverLocal.y, hoverLocal.z],
        inHandle: [0, 0, 0],
        outHandle: [0, 0, 0],
        mode: "linear",
      },
    ],
  };
  const flat = sampleSpline(ghost, 16);
  rubber.geometry.dispose();
  rubber.geometry = new BufferGeometry();
  rubber.geometry.setAttribute("position", new BufferAttribute(flat, 3));
  rubber.position.copy(obj.position);
  rubber.quaternion.copy(obj.quaternion);
  rubber.visible = true;
}
