import type { Object3D } from "three";
import { Line2 } from "three/examples/jsm/lines/webgpu/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { Line2NodeMaterial } from "three/webgpu";
import type { SceneNode } from "@/core";
import type { SplineData } from "@/types/geometry/spline";
import { sampleSpline } from "@/geometry/splines/eval";
import { HELPER_LAYER } from "@/render/layers";
import { viewportTheme } from "@/render/theme/viewportTheme";

// Splines render as WIDE lines (Line2 — screen-pixel thickness, adjustable
// via the Spline Thickness setting) in the accent color. depthTest off:
// splines are control objects and draw on top of shading (C4D-style) —
// vital for projected splines lying exactly ON a surface.
//
// ALL splines share this ONE material. three's per-material `materialReference`
// uniforms (linewidth / color) do NOT propagate an IN-PLACE change to more than
// the last-rendered line — so a thickness/theme edit swaps in a fresh CLONE and
// reassigns it to every spline, which forces each Line2 to re-bind and pick up
// the new value. The clone is a pipeline-cache hit (a re-bind, not a shader
// recompile), so this is cheap even though it touches every spline.
let splineMat = new Line2NodeMaterial({
  color: viewportTheme.accent,
  linewidth: 1.5,
  worldUnits: false,
  depthTest: false,
});

/** Swap in a freshly-mutated clone of the shared material, reassigned to every spline. */
function rebindSplineMaterial(root: Object3D, mutate: (m: Line2NodeMaterial) => void): void {
  const fresh = splineMat.clone();
  mutate(fresh);
  root.traverse((o) => {
    if (o.userData.spline) (o as Line2).material = fresh;
  });
  // NOTE: don't dispose the old material — the clone is a pipeline-cache hit
  // that shares its compiled pipeline, and disposing tears that down for lines
  // not yet re-bound this frame (one renders stale). The orphaned material is a
  // negligible one-off per discrete thickness/theme change.
  splineMat = fresh;
}

/** Re-apply theme colors to every spline (via a re-bind — see rebindSplineMaterial). */
export function applySplineTheme(root: Object3D): void {
  rebindSplineMaterial(root, (m) => m.color.copy(viewportTheme.accent));
}

/** Spline Thickness setting (screen px) — re-bind every spline to the new width. */
export function applySplineThickness(px: number, root: Object3D): void {
  rebindSplineMaterial(root, (m) => {
    m.linewidth = Math.max(0.5, px);
  });
}

/**
 * Renders a spline node as a sampled bezier polyline. The Line2 is the
 * node's pickable object (raycaster needs `params.Line2.threshold`, see
 * ViewportSystem). NOTE: Line2 extends Mesh — render passes that sweep
 * "all meshes" (shading override, selection outline) must skip objects
 * with `userData.spline`.
 */
export function buildSplineObject(node: SceneNode): Line2 {
  const line = new Line2(new LineGeometry(), splineMat);
  line.frustumCulled = false; // WebGPU mis-culls line objects (see helpers)
  line.renderOrder = 3; // above surfaces + edge wires (control object)
  line.userData.spline = true;
  // helper layer: splines are control objects — never reflected by SSR or
  // planar mirrors; the viewport's overlay render draws them (still pickable,
  // the shared raycaster enables all layers)
  line.layers.set(HELPER_LAYER);
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
