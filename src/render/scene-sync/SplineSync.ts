import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial } from "three";
import type { SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import { sampleSpline } from "@/geometry/splines/eval";
import { viewportTheme } from "@/render/theme/viewportTheme";

// Splines render in the accent color — distinct from mesh wires and helpers.
// Closed splines duplicate the final sample instead of using LineLoop (which
// doesn't render on the WebGPU backend).
const SPLINE_MAT = new LineBasicMaterial({ color: viewportTheme.accent });

/** Re-apply theme colors to the shared spline material. */
export function applySplineTheme(): void {
  SPLINE_MAT.color.copy(viewportTheme.accent);
}

/**
 * Renders a spline node as a sampled bezier polyline. The Line is the
 * node's pickable object (object-mode click select — the raycaster needs
 * `params.Line.threshold` set, see ViewportSystem). Rebuilt on every
 * node-changed for spline nodes: sampling a handful of spans is far cheaper
 * than diffing, and edits stream during pen drawing anyway.
 */
export function buildSplineObject(node: SceneNode): Line {
  const line = new Line(new BufferGeometry(), SPLINE_MAT);
  line.frustumCulled = false; // WebGPU mis-culls Line objects (see helpers)
  line.renderOrder = 1;
  syncSplineGeometry(node, line);
  return line;
}

export function syncSplineGeometry(node: SceneNode, line: Line): void {
  const data = node.data?.spline as SplineData | undefined;
  if (!data) return;
  const positions = sampleSpline(data);
  line.geometry.dispose();
  line.geometry = new BufferGeometry();
  line.geometry.setAttribute("position", new BufferAttribute(positions, 3));
}
