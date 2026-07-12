import type { Object3D } from "three";
import { Line2 } from "three/examples/jsm/lines/webgpu/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { Line2NodeMaterial } from "three/webgpu";
import type { SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import { sampleSpline } from "@/geometry/splines/eval";
import { viewportTheme } from "@/render/theme/viewportTheme";

// Splines render as WIDE lines (Line2 — screen-pixel thickness, adjustable
// via the Spline Thickness setting) in the accent color. depthTest off:
// splines are control objects and draw on top of shading (C4D-style) —
// vital for projected splines lying exactly ON a surface.
//
// A Line2NodeMaterial CANNOT be shared across multiple Line2 objects on WebGPU:
// only the LAST-rendered line reflects the material's linewidth/color, the rest
// render stale. So this is only a TEMPLATE — every spline gets its own clone,
// and the thickness/theme setters walk the scene to update each live material.
const SPLINE_MAT_TEMPLATE = new Line2NodeMaterial({
  color: viewportTheme.accent,
  linewidth: 1.5,
  worldUnits: false,
  depthTest: false,
});
let currentThickness = 1.5;

function makeSplineMaterial(): Line2NodeMaterial {
  const m = SPLINE_MAT_TEMPLATE.clone();
  m.linewidth = currentThickness;
  return m;
}

const splineMaterialOf = (o: Object3D): Line2NodeMaterial =>
  (o as Line2).material as Line2NodeMaterial;

/** Re-apply theme colors to the template + every live spline material. */
export function applySplineTheme(root: Object3D): void {
  SPLINE_MAT_TEMPLATE.color.copy(viewportTheme.accent);
  root.traverse((o) => {
    if (o.userData.spline) splineMaterialOf(o).color.copy(viewportTheme.accent);
  });
}

/** Spline Thickness setting (screen px) — walk the scene, update every spline. */
export function applySplineThickness(px: number, root: Object3D): void {
  currentThickness = Math.max(0.5, px);
  root.traverse((o) => {
    if (o.userData.spline) splineMaterialOf(o).linewidth = currentThickness;
  });
}

/** Dispose a removed spline's own material (each spline owns a clone). */
export function disposeSplineObject(o: Object3D): void {
  if (o.userData.spline) splineMaterialOf(o).dispose();
}

/**
 * Renders a spline node as a sampled bezier polyline. The Line2 is the
 * node's pickable object (raycaster needs `params.Line2.threshold`, see
 * ViewportSystem). NOTE: Line2 extends Mesh — render passes that sweep
 * "all meshes" (shading override, selection outline) must skip objects
 * with `userData.spline`.
 */
export function buildSplineObject(node: SceneNode): Line2 {
  const line = new Line2(new LineGeometry(), makeSplineMaterial());
  line.frustumCulled = false; // WebGPU mis-culls line objects (see helpers)
  line.renderOrder = 3; // above surfaces + edge wires (control object)
  line.userData.spline = true;
  syncSplineGeometry(node, line);
  return line;
}

export function syncSplineGeometry(node: SceneNode, line: Line2): void {
  const data = node.data?.spline as SplineData | undefined;
  if (!data) return;
  const positions = sampleSpline(data);
  line.geometry.dispose();
  const geo = new LineGeometry();
  const drawable = positions.length >= 6;
  if (drawable) geo.setPositions(Array.from(positions));
  line.geometry = geo;
  // a LineGeometry without instance data builds an invalid pipeline on
  // WebGPU and kills the whole render pass — never draw a <2-point spline.
  // This owns the object's visibility (SceneSynchronizer skips splines).
  line.visible = drawable && node.visible;
}
