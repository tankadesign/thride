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
const SPLINE_MAT = new Line2NodeMaterial({
  color: viewportTheme.accent,
  linewidth: 1.5,
  worldUnits: false,
  depthTest: false,
});

/** Re-apply theme colors to the shared spline material. */
export function applySplineTheme(): void {
  SPLINE_MAT.color.copy(viewportTheme.accent);
}

/** Spline Thickness setting (screen px) — drives every spline in one place. */
export function applySplineThickness(px: number): void {
  SPLINE_MAT.linewidth = Math.max(0.5, px);
}

/**
 * Renders a spline node as a sampled bezier polyline. The Line2 is the
 * node's pickable object (raycaster needs `params.Line2.threshold`, see
 * ViewportSystem). NOTE: Line2 extends Mesh — render passes that sweep
 * "all meshes" (shading override, selection outline) must skip objects
 * with `userData.spline`.
 */
export function buildSplineObject(node: SceneNode): Line2 {
  const line = new Line2(new LineGeometry(), SPLINE_MAT);
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
  if (positions.length >= 6) geo.setPositions(Array.from(positions));
  line.geometry = geo;
}
